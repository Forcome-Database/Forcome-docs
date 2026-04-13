import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { ResourceAbilityFactory } from '../casl/abilities/resource-ability.factory';
import { ResourceVisibilityService } from '../resource-permission/resource-visibility.service';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { TokenService } from '../auth/services/token.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { SearchService } from '../search/search.service';
import { updateAttachmentAttr } from '../share/share.util';
import { Node } from '@tiptap/pm/model';
import { Page, User } from '@docmost/db/types/entity.types';
import { SpaceCaslAction, SpaceCaslSubject } from '../casl/interfaces/space-ability.type';
import { ModuleRef } from '@nestjs/core';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import type {
  AiChatMessage,
  AiImagePayload,
  RetrievalScope,
} from '../../ee/ai/services/ai-search.service';
import {
  WikiConversationStore,
  WikiConversationMessage,
} from './wiki-conversation.store';

interface WikiAiAnswerInput {
  query: string;
  workspaceId: string;
  pageSlugId?: string;
  images?: AiImagePayload[];
  history?: AiChatMessage[];
  userId: string;
  sessionId?: string;
  deepResearch?: boolean;
}

interface UserSpaceAccess {
  spaceRole: string;
  overrides: {
    resourceType: string;
    resourceId: string;
    role: string;
    directoryId: string | null;
    topicId: string | null;
  }[];
}

@Injectable()
export class PublicWikiService {
  private readonly logger = new Logger(PublicWikiService.name);
  private readonly redis: Redis;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly resourcePermissionRepo: ResourcePermissionRepo,
    private readonly resourceAbility: ResourceAbilityFactory,
    private readonly resourceVisibility: ResourceVisibilityService,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
    private readonly searchService: SearchService,
    private readonly moduleRef: ModuleRef,
    private readonly redisService: RedisService,
    private readonly conversationStore: WikiConversationStore,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  // ---------------------------------------------------------------------------
  // Settings (public — no auth required)
  // ---------------------------------------------------------------------------

  async getSettings(workspaceId: string) {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select('settings')
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    return {
      wiki: {
        renderFormat:
          (workspace?.settings as any)?.wiki?.renderFormat || 'html',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a user's space-level role and resource overrides.
   * Returns null if user has no access to the space.
   */
  private async resolveUserSpaceAccess(
    user: User,
    spaceId: string,
    workspaceId: string,
  ): Promise<UserSpaceAccess | null> {
    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      spaceId,
    );
    let spaceRole = findHighestUserSpaceRole(userSpaceRoles);
    if (!spaceRole) {
      // Not a member — check if space is open
      const space = await this.db
        .selectFrom('spaces')
        .select('visibility')
        .where('id', '=', spaceId)
        .executeTakeFirst();
      if (!space || space.visibility !== 'open') return null;
      spaceRole = 'reader';
    }
    const overrides =
      await this.resourcePermissionRepo.getUserOverridesInSpace(
        user.id,
        spaceId,
        workspaceId,
      );
    return { spaceRole, overrides };
  }

  /**
   * Build a set of page IDs that should be hidden from the current user.
   * Dual-mode: spaceRole='none' → additive (only explicitly allowed);
   * otherwise → subtractive (only explicitly denied).
   */
  private buildHiddenPageIds(
    pages: { id: string; directoryId?: string | null }[],
    access: UserSpaceAccess,
  ): Set<string> {
    const { spaceRole, overrides } = access;

    if (spaceRole === 'none') {
      // Additive: only show pages with explicit non-none override
      const allowedPageIds = new Set<string>();
      const allowedDirIds = new Set<string>();
      for (const o of overrides) {
        if (o.role === 'none') continue;
        if (o.resourceType === 'page') allowedPageIds.add(o.resourceId);
        if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
      }
      const hidden = new Set<string>();
      for (const p of pages) {
        if (
          !allowedPageIds.has(p.id) &&
          !(p.directoryId && allowedDirIds.has(p.directoryId))
        ) {
          hidden.add(p.id);
        }
      }
      return hidden;
    }

    // Subtractive: hide pages with explicit none override
    const deniedPageIds = new Set<string>();
    const deniedDirIds = new Set<string>();
    for (const o of overrides) {
      if (o.role !== 'none') continue;
      if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
      if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
    }
    const hidden = new Set<string>();
    for (const p of pages) {
      if (
        deniedPageIds.has(p.id) ||
        (p.directoryId && deniedDirIds.has(p.directoryId))
      ) {
        hidden.add(p.id);
      }
    }
    return hidden;
  }

  /**
   * Get all space IDs the user can access (member + open visibility).
   * Returns deduplicated array.
   */
  private async getAccessibleSpaceIds(
    user: User,
    workspaceId: string,
  ): Promise<string[]> {
    // Spaces user is a member of
    const memberSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    // Open-visibility spaces
    const openSpaces = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('visibility', '=', 'open')
      .execute();
    const openSpaceIds = openSpaces.map((s) => s.id);
    // Deduplicate
    return [...new Set([...memberSpaceIds, ...openSpaceIds])];
  }

  // ---------------------------------------------------------------------------
  // E1. getSpaces — user's accessible spaces
  // ---------------------------------------------------------------------------

  async getSpaces(user: User, workspaceId: string) {
    // Member spaces
    const memberSpaces = await this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug', 'description', 'position'])
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(user.id))
      .execute();

    // Open-visibility spaces
    const openSpaces = await this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug', 'description', 'position'])
      .where('workspaceId', '=', workspaceId)
      .where('visibility', '=', 'open')
      .execute();

    // Deduplicate by id using Map
    const spaceMap = new Map<
      string,
      { id: string; name: string; slug: string; description: string | null; position: string | null }
    >();
    for (const s of memberSpaces) spaceMap.set(s.id, s);
    for (const s of openSpaces) {
      if (!spaceMap.has(s.id)) spaceMap.set(s.id, s);
    }
    const spaces = [...spaceMap.values()].sort((a, b) => {
      const pa = a.position ?? '\uffff';
      const pb = b.position ?? '\uffff';
      return pa < pb ? -1 : pa > pb ? 1 : a.id < b.id ? -1 : 1;
    });

    // Count directories (no visibility filter — user-based access handles this)
    const spaceIds = spaces.map((s) => s.id);
    const dirCounts =
      spaceIds.length > 0
        ? await this.db
            .selectFrom('directories')
            .select(['spaceId'])
            .select((eb) => eb.fn.countAll().as('count'))
            .where('spaceId', 'in', spaceIds)
            .where('deletedAt', 'is', null)
            .groupBy('spaceId')
            .execute()
        : [];

    const dirCountMap = new Map(
      dirCounts.map((d) => [d.spaceId, Number(d.count)]),
    );

    const items = spaces.map((s) => ({
      ...s,
      hasDirectories: (dirCountMap.get(s.id) || 0) > 0,
    }));

    return { items };
  }

  // ---------------------------------------------------------------------------
  // E2. getDirectories — user-scoped directory listing
  // ---------------------------------------------------------------------------

  async getDirectories(user: User, spaceSlug: string, workspaceId: string) {
    const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const access = await this.resolveUserSpaceAccess(user, space.id, workspaceId);
    if (!access) {
      throw new NotFoundException('Space not found');
    }

    const directories = await this.db
      .selectFrom('directories')
      .select(['id', 'name', 'slug', 'icon', 'position'])
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    // Dual-mode filter
    let visibleDirectories: typeof directories;
    if (access.spaceRole === 'none') {
      // Additive: only show directories with explicit non-none override
      const allowedDirIds = new Set<string>();
      for (const o of access.overrides) {
        if (o.role === 'none') continue;
        if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
        // Page override with directoryId → promote that directory
        if (o.resourceType === 'page' && o.directoryId) {
          allowedDirIds.add(o.directoryId);
        }
      }
      visibleDirectories = directories.filter((d) => allowedDirIds.has(d.id));
    } else {
      // Subtractive: hide directories with explicit none override
      const deniedDirIds = new Set<string>();
      for (const o of access.overrides) {
        if (o.role !== 'none') continue;
        if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
      }
      visibleDirectories =
        deniedDirIds.size > 0
          ? directories.filter((d) => !deniedDirIds.has(d.id))
          : directories;
    }

    return { items: visibleDirectories };
  }

  // ---------------------------------------------------------------------------
  // E3. getSidebarTree — user-scoped sidebar
  // ---------------------------------------------------------------------------

  async getSidebarTree(
    user: User,
    spaceSlug: string,
    workspaceId: string,
    directoryId?: string,
  ) {
    const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const access = await this.resolveUserSpaceAccess(user, space.id, workspaceId);
    if (!access) {
      throw new NotFoundException('Space not found');
    }

    // When directoryId is provided, build a mixed tree of topics and pages
    if (directoryId) {
      return this.getDirectorySidebarTree(user, space, directoryId, access);
    }

    const pages = await this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'position',
        'parentPageId',
        'spaceId',
        'directoryId',
        'textContent',
      ])
      .select((eb) => this.pageRepo.withHasChildren(eb))
      .where('spaceId', '=', space.id)
      .where('directoryId', 'is', null)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    const hiddenPageIds = this.buildHiddenPageIds(pages, access);

    // Filter hidden pages
    const visiblePages = pages.filter((p) => !hiddenPageIds.has(p.id));

    // Re-parent orphans: if a page's parent was hidden, promote to nearest visible ancestor
    const pageMap = new Map(pages.map((p) => [p.id, p]));
    for (const page of visiblePages) {
      if (page.parentPageId && hiddenPageIds.has(page.parentPageId)) {
        let ancestor = pageMap.get(page.parentPageId);
        while (ancestor && hiddenPageIds.has(ancestor.id)) {
          ancestor = ancestor.parentPageId
            ? pageMap.get(ancestor.parentPageId)
            : undefined;
        }
        (page as any).parentPageId = ancestor ? ancestor.id : null;
      }
    }

    // Build recursive tree
    const tree = this.buildTree(visiblePages, null);

    return {
      space: { id: space.id, name: space.name, slug: space.slug },
      items: tree,
    };
  }

  // ---------------------------------------------------------------------------
  // E4. getDirectorySidebarTree — user-scoped directory tree
  // ---------------------------------------------------------------------------

  private async getDirectorySidebarTree(
    user: User,
    space: { id: string; name: string; slug: string },
    directoryId: string,
    access: UserSpaceAccess,
  ) {
    // Verify directory exists in this space
    const directory = await this.db
      .selectFrom('directories')
      .select(['id', 'name'])
      .where('id', '=', directoryId)
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!directory) {
      throw new NotFoundException('Directory not found');
    }

    // Dual-mode directory access check
    if (access.spaceRole === 'none') {
      // Additive: directory must have explicit non-none override or be promoted by page override
      const allowedDirIds = new Set<string>();
      for (const o of access.overrides) {
        if (o.role === 'none') continue;
        if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
        if (o.resourceType === 'page' && o.directoryId) {
          allowedDirIds.add(o.directoryId);
        }
      }
      if (!allowedDirIds.has(directoryId)) {
        throw new NotFoundException('Directory not found');
      }
    } else {
      // Subtractive: directory must not have explicit none override
      for (const o of access.overrides) {
        if (
          o.role === 'none' &&
          o.resourceType === 'directory' &&
          o.resourceId === directoryId
        ) {
          throw new NotFoundException('Directory not found');
        }
      }
    }

    // Query topics in this directory
    const topics = await this.db
      .selectFrom('topics')
      .select(['id', 'name', 'icon', 'position'])
      .where('directoryId', '=', directoryId)
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    // Query all pages in the space for directory tree building
    // Child pages may not have directoryId set (only their ancestors do),
    // so we fetch all space pages and let buildTree trace parentPageId chains.
    const allPages = await this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'position',
        'parentPageId',
        'topicId',
        'directoryId',
        'textContent',
      ])
      .select((eb) => this.pageRepo.withHasChildren(eb))
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    const hiddenPageIds = this.buildHiddenPageIds(allPages, access);

    // Collect pages directly assigned to this directory + all their descendants
    // Hidden pages participate as "pass-through" nodes in BFS (added to frontier
    // so their children are discovered) but NOT included in the final result.
    const directIds = new Set(
      allPages.filter((p) => p.directoryId === directoryId).map((p) => p.id),
    );
    const relevantIds = new Set<string>();
    const visitedIds = new Set<string>();
    for (const id of directIds) {
      visitedIds.add(id);
      if (!hiddenPageIds.has(id)) {
        relevantIds.add(id);
      }
    }
    let frontier = [...directIds];
    while (frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const p of allPages) {
        if (
          p.parentPageId &&
          frontier.includes(p.parentPageId) &&
          !visitedIds.has(p.id)
        ) {
          visitedIds.add(p.id);
          if (!hiddenPageIds.has(p.id)) {
            relevantIds.add(p.id); // visible child → include in result
          }
          // Hidden or not, add to frontier so its children can be discovered
          nextFrontier.push(p.id);
        }
      }
      frontier = nextFrontier;
    }
    const pages = allPages.filter((p) => relevantIds.has(p.id));

    // Re-parent orphans whose parent was hidden
    const allPageMap = new Map(allPages.map((p) => [p.id, p]));
    for (const page of pages) {
      if (page.parentPageId && hiddenPageIds.has(page.parentPageId)) {
        let ancestor = allPageMap.get(page.parentPageId);
        while (ancestor && hiddenPageIds.has(ancestor.id)) {
          ancestor = ancestor.parentPageId
            ? allPageMap.get(ancestor.parentPageId)
            : undefined;
        }
        (page as any).parentPageId = ancestor ? ancestor.id : null;
      }
    }

    // Build topic nodes with their pages
    const topicNodes = topics.map((topic) => {
      const topicPages = pages.filter(
        (p) => p.topicId === topic.id && !p.parentPageId,
      );
      const topicPageNodes = topicPages.map((p) => ({
        nodeType: 'page' as const,
        id: p.id,
        slugId: p.slugId,
        title: p.title,
        icon: p.icon,
        position: p.position,
        hasChildren: p.hasChildren,
        excerpt: p.textContent
          ? p.textContent.substring(0, 120).replace(/\s+/g, ' ').trim()
          : '',
        children: p.hasChildren ? this.buildTree(pages, p.id) : [],
      }));

      return {
        nodeType: 'topic' as const,
        id: topic.id,
        name: topic.name,
        icon: topic.icon,
        position: topic.position,
        children: topicPageNodes,
      };
    });

    // Build uncategorized page nodes (topicId is null, parentPageId is null)
    const uncategorizedPages = pages.filter(
      (p) => !p.topicId && !p.parentPageId,
    );
    const uncategorizedPageNodes = uncategorizedPages.map((p) => ({
      nodeType: 'page' as const,
      id: p.id,
      slugId: p.slugId,
      title: p.title,
      icon: p.icon,
      position: p.position,
      hasChildren: p.hasChildren,
      excerpt: p.textContent
        ? p.textContent.substring(0, 120).replace(/\s+/g, ' ').trim()
        : '',
      children: p.hasChildren ? this.buildTree(pages, p.id) : [],
    }));

    // Merge and sort all top-level items by position
    const items = [...topicNodes, ...uncategorizedPageNodes].sort((a, b) => {
      const posA = a.position || 'a0';
      const posB = b.position || 'a0';
      if (posA < posB) return -1;
      if (posA > posB) return 1;
      return 0;
    });

    return {
      space: { id: space.id, name: space.name, slug: space.slug },
      directory: { id: directory.id, name: directory.name },
      items,
    };
  }

  // ---------------------------------------------------------------------------
  // Tree builder (unchanged)
  // ---------------------------------------------------------------------------

  private buildTree(pages: any[], parentId: string | null): any[] {
    return pages
      .filter((p) => p.parentPageId === parentId)
      .sort((a, b) => {
        const posA = a.position || 'a0';
        const posB = b.position || 'a0';
        if (posA < posB) return -1;
        if (posA > posB) return 1;
        return 0;
      })
      .map((p) => ({
        id: p.id,
        slugId: p.slugId,
        title: p.title,
        icon: p.icon,
        position: p.position,
        hasChildren: p.hasChildren,
        excerpt: p.textContent
          ? p.textContent.substring(0, 120).replace(/\s+/g, ' ').trim()
          : '',
        children: p.hasChildren ? this.buildTree(pages, p.id) : [],
      }));
  }

  // ---------------------------------------------------------------------------
  // E5. getPage — user-scoped page access
  // ---------------------------------------------------------------------------

  async getPage(
    user: User,
    opts: { pageId?: string; slugId?: string; format?: string },
    workspaceId: string,
  ) {
    if (!opts.pageId && !opts.slugId) {
      throw new BadRequestException('pageId or slugId is required');
    }

    const identifier = opts.pageId || opts.slugId;
    const page = await this.pageRepo.findById(identifier, {
      includeContent: true,
      includeCreator: true,
    });

    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    // Verify page belongs to an accessible space
    const space = await this.db
      .selectFrom('spaces')
      .select(['id', 'slug', 'name'])
      .where('id', '=', page.spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!space) {
      throw new NotFoundException('Page not found');
    }

    // Check user permission using the same resolveUserSpaceAccess path
    // as getSpaces/getDirectories/getSidebarTree (handles open spaces).
    // DO NOT use ResourceAbilityFactory directly — it doesn't handle
    // visibility='open' spaces where user isn't in space_members.
    const access = await this.resolveUserSpaceAccess(user, space.id, workspaceId);
    if (!access) {
      throw new NotFoundException('Page not found');
    }

    // Check if this specific page is hidden for the user
    const hiddenPageIds = this.buildHiddenPageIds([page], access);
    if (hiddenPageIds.has(page.id)) {
      throw new NotFoundException('Page not found');
    }

    // Process attachments for wiki access (signed URLs)
    const processedContent = await this.updatePublicAttachments(page);

    // Generate HTML or markdown
    const format = opts.format || 'html';
    let content: string;
    if (format === 'markdown') {
      const { jsonToMarkdown } = await import(
        '../../collaboration/collaboration.util'
      );
      content = jsonToMarkdown(processedContent);
    } else {
      const { jsonToHtml } = await import(
        '../../collaboration/collaboration.util'
      );
      content = jsonToHtml(processedContent);
    }

    // Get breadcrumbs and filter denied ancestors (reuse 'access' from above)
    const breadcrumbs = await this.getPageBreadcrumbs(page.id);
    const deniedAncestorIds = new Set<string>();
    for (const o of access.overrides) {
      if (o.role === 'none' && o.resourceType === 'page') {
        deniedAncestorIds.add(o.resourceId);
      }
    }
    const filteredBreadcrumbs = deniedAncestorIds.size > 0
      ? breadcrumbs.filter((crumb) => !deniedAncestorIds.has(crumb.id))
      : breadcrumbs;

    return {
      id: page.id,
      slugId: page.slugId,
      title: page.title,
      icon: page.icon,
      content,
      breadcrumbs: filteredBreadcrumbs,
      spaceSlug: space.slug,
      spaceName: space.name,
      updatedAt: page.updatedAt,
      createdAt: page.createdAt,
      creator: (page as any).creator,
    };
  }

  private async getPageBreadcrumbs(childPageId: string) {
    const ancestors = await this.db
      .withRecursive('page_ancestors', (db) =>
        db
          .selectFrom('pages')
          .select(['id', 'slugId', 'title', 'icon', 'parentPageId'])
          .where('id', '=', childPageId)
          .where('deletedAt', 'is', null)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select([
                'p.id',
                'p.slugId',
                'p.title',
                'p.icon',
                'p.parentPageId',
              ])
              .innerJoin(
                'page_ancestors as pa',
                'pa.parentPageId',
                'p.id',
              )
              .where('p.deletedAt', 'is', null),
          ),
      )
      .selectFrom('page_ancestors')
      .selectAll()
      .execute();

    // Reverse to get root → child order, exclude self
    return ancestors
      .filter((a) => a.id !== childPageId)
      .reverse()
      .map((a) => ({
        id: a.id,
        slugId: a.slugId,
        title: a.title,
      }));
  }

  // ---------------------------------------------------------------------------
  // E6. searchPages — user-scoped search
  // ---------------------------------------------------------------------------

  async searchPages(
    user: User,
    query: string,
    workspaceId: string,
    spaceSlug?: string,
    limit?: number,
  ) {
    if (query.length < 1) {
      return { items: [] };
    }

    let accessibleSpaceIds: string[];
    if (spaceSlug) {
      // Scoped search: resolve single space
      const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
      if (!space) return { items: [] };
      const access = await this.resolveUserSpaceAccess(user, space.id, workspaceId);
      if (!access) return { items: [] };
      accessibleSpaceIds = [space.id];
    } else {
      accessibleSpaceIds = await this.getAccessibleSpaceIds(user, workspaceId);
    }

    if (accessibleSpaceIds.length === 0) {
      return { items: [] };
    }

    // Build slug map from DB for all accessible spaces
    const spaceRows = await this.db
      .selectFrom('spaces')
      .select(['id', 'slug'])
      .where('id', 'in', accessibleSpaceIds)
      .execute();
    const slugMap = new Map(spaceRows.map((s) => [s.id, s.slug]));

    // Search per-space and merge
    const allResults: any[] = [];
    for (const spaceId of accessibleSpaceIds) {
      const result = await this.searchService.searchPage(
        { query, spaceId, limit: limit || 25, offset: 0 },
        { workspaceId },
      );
      for (const item of result.items) {
        allResults.push({
          ...item,
          spaceId,
          spaceSlug: item.space?.slug || slugMap.get(spaceId) || '',
        });
      }
    }

    // Filter with user-scoped permissions
    const visibleResults = await this.resourceVisibility.filterByPermissions(
      allResults,
      user.id,
      workspaceId,
    );

    // Sort by rank desc, limit
    visibleResults.sort((a: any, b: any) => (b.rank ?? 0) - (a.rank ?? 0));
    return { items: visibleResults.slice(0, limit || 25) };
  }

  // ---------------------------------------------------------------------------
  // E7. AI Answers — user-scoped
  // ---------------------------------------------------------------------------

  private enforceAiLimits(input: WikiAiAnswerInput): void {
    if (!this.environmentService.isPublicWikiAiEnabled()) {
      throw new HttpException(
        'Public wiki AI is disabled',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const query = input.query?.trim() || '';
    if (!query) {
      throw new BadRequestException('Query is required');
    }

    if (query.length > this.environmentService.getPublicWikiAiMaxQueryChars()) {
      throw new BadRequestException('Query is too long');
    }

    const history = input.history || [];
    if (
      history.length >
      this.environmentService.getPublicWikiAiMaxHistoryMessages()
    ) {
      throw new BadRequestException('History is too long');
    }

    const historyChars = history.reduce(
      (total, message) => total + (message.content?.length || 0),
      0,
    );
    if (
      historyChars >
      this.environmentService.getPublicWikiAiMaxHistoryChars()
    ) {
      throw new BadRequestException('History payload is too large');
    }

    const images = input.images || [];
    if (images.length > this.environmentService.getPublicWikiAiMaxImages()) {
      throw new BadRequestException('Too many images');
    }

    const imageBytes = images.reduce((total, image) => {
      try {
        return total + Buffer.from(image.data, 'base64').byteLength;
      } catch {
        throw new BadRequestException('Invalid image payload');
      }
    }, 0);

    if (imageBytes > this.environmentService.getPublicWikiAiMaxImageBytes()) {
      throw new BadRequestException('Images are too large');
    }
  }

  private async enforceAiRateLimit(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const bucketKey = `ratelimit:public-wiki-ai:${workspaceId}:${userId}`;
    const now = Date.now();
    const windowMs =
      this.environmentService.getPublicWikiAiRateLimitWindowMs();
    const maxRequests =
      this.environmentService.getPublicWikiAiRateLimitMaxRequests();
    const windowStart = now - windowMs;

    // Atomic pipeline: clean expired + count + add new entry + set TTL
    const results = await this.redis
      .multi()
      .zremrangebyscore(bucketKey, 0, windowStart)
      .zcard(bucketKey)
      .zadd(
        bucketKey,
        now,
        `${now}:${Math.random().toString(36).slice(2, 8)}`,
      )
      .pexpire(bucketKey, windowMs)
      .exec();

    // results[1] = [err, count] from zcard
    const count = results?.[1]?.[1] as number;
    if (count >= maxRequests) {
      // Remove the entry we just added since request is denied
      await this.redis.zremrangebyscore(bucketKey, now, now);
      this.logger.warn(`Wiki AI rate limited: ${bucketKey}`);
      throw new HttpException(
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  enforceOrigin(origin: string | undefined): void {
    const allowed = this.environmentService.getPublicWikiAiAllowedOrigins();
    // Empty whitelist = allow all (backward compatible)
    if (allowed.length === 0) return;

    if (!origin || !allowed.includes(origin)) {
      throw new HttpException('Origin not allowed', HttpStatus.FORBIDDEN);
    }
  }

  async *aiAnswers(input: WikiAiAnswerInput): AsyncGenerator<string> {
    this.enforceAiLimits(input);
    await this.enforceAiRateLimit(input.workspaceId, input.userId);

    // Resolve or generate session ID
    const sessionId = input.sessionId || crypto.randomUUID();

    // Yield session ID as the first SSE event so the client can persist it
    yield JSON.stringify({ sessionId });

    // Load server-side history; server history takes precedence over client-provided
    let history: AiChatMessage[] = input.history || [];
    const serverHistory = await this.conversationStore.load(
      sessionId,
      input.userId,
    );
    if (serverHistory && serverHistory.length > 0) {
      history = serverHistory as AiChatMessage[];
    }

    // Build user-scoped retrieval scope
    const accessibleSpaceIds = await this.getAccessibleSpaceIds(
      { id: input.userId } as User,
      input.workspaceId,
    );

    if (accessibleSpaceIds.length === 0) {
      throw new NotFoundException('No accessible spaces found');
    }

    // Collect excluded resources from user's NONE overrides across spaces
    const excludedPageIds: string[] = [];
    const excludedDirectoryIds: string[] = [];
    for (const spaceId of accessibleSpaceIds) {
      const overrides =
        await this.resourcePermissionRepo.getUserOverridesInSpace(
          input.userId,
          spaceId,
          input.workspaceId,
        );
      for (const o of overrides) {
        if (o.role !== 'none') continue;
        if (o.resourceType === 'page') excludedPageIds.push(o.resourceId);
        if (o.resourceType === 'directory')
          excludedDirectoryIds.push(o.resourceId);
      }
    }

    // Resolve current page if pageSlugId is provided
    let currentPageId: string | undefined;
    let pageSlugId = input.pageSlugId;
    if (pageSlugId) {
      const page = await this.db
        .selectFrom('pages')
        .select(['id', 'spaceId'])
        .where('slugId', '=', pageSlugId)
        .where('workspaceId', '=', input.workspaceId)
        .where('deletedAt', 'is', null)
        .where('spaceId', 'in', accessibleSpaceIds)
        .executeTakeFirst();

      if (page) {
        currentPageId = page.id;
      } else {
        pageSlugId = undefined; // page not accessible
      }
    }

    const scope: RetrievalScope = {
      isPublicWiki: true,
      allowedSpaceIds: accessibleSpaceIds,
      currentPageId,
      ...(excludedDirectoryIds.length > 0 && { excludedDirectoryIds }),
      ...(excludedPageIds.length > 0 && { excludedPageIds }),
    };

    let AiSearchService: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const aiModule = require('../../ee/ai/services/ai-search.service');
      AiSearchService = this.moduleRef.get(aiModule.AiSearchService, {
        strict: false,
      });
    } catch (err) {
      this.logger.debug('AI search module not available');
      yield JSON.stringify({ error: 'AI search is not available' });
      return;
    }

    this.logger.log(
      `Wiki AI request workspace=${input.workspaceId} page=${pageSlugId || '-'} user=${input.userId} session=${sessionId}`,
    );

    // Collect the full answer for saving to Redis after streaming
    let fullAnswer = '';
    for await (const chunk of AiSearchService.answerWithContext({
      query: input.query,
      workspaceId: input.workspaceId,
      pageSlugId,
      images: input.images,
      history,
      scope,
      deepResearch: input.deepResearch,
    })) {
      // Accumulate content chunks for conversation saving
      try {
        const parsed = JSON.parse(chunk);
        if (parsed.content) {
          fullAnswer += parsed.content;
        }
      } catch {
        // non-JSON chunk, ignore for accumulation
      }
      yield chunk;
    }

    // Save the conversation turn to Redis
    if (fullAnswer) {
      const updatedHistory: WikiConversationMessage[] = [
        ...history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: input.query },
        { role: 'assistant', content: fullAnswer },
      ];
      await this.conversationStore
        .save(sessionId, updatedHistory, input.userId)
        .catch((err) => {
          this.logger.warn(
            `Failed to save wiki conversation to Redis: ${err?.message}`,
          );
        });
    }
  }

  // ---------------------------------------------------------------------------
  // Attachment processing
  // ---------------------------------------------------------------------------

  private async updatePublicAttachments(page: Page): Promise<any> {
    const {
      getAttachmentIds,
      getProsemirrorContent,
      isAttachmentNode,
      removeMarkTypeFromDoc,
    } = await import('../../common/helpers/prosemirror/utils');
    const prosemirrorJson = getProsemirrorContent(page.content);
    const attachmentIds = getAttachmentIds(prosemirrorJson);
    const attachmentMap = new Map<string, string>();

    await Promise.all(
      attachmentIds.map(async (attachmentId: string) => {
        const token = await this.tokenService.generateAttachmentToken({
          attachmentId,
          pageId: page.id,
          workspaceId: page.workspaceId,
        });
        attachmentMap.set(attachmentId, token);
      }),
    );

    const { jsonToNode } = await import(
      '../../collaboration/collaboration.util'
    );
    const doc = jsonToNode(prosemirrorJson);

    doc?.descendants((node: Node) => {
      if (!isAttachmentNode(node.type.name)) return;

      const attachmentId = node.attrs.attachmentId;
      const token = attachmentMap.get(attachmentId);
      if (!token) return;

      updateAttachmentAttr(node, 'src', token);
      updateAttachmentAttr(node, 'url', token);
    });

    const removeCommentMarks = removeMarkTypeFromDoc(doc, 'comment');
    return removeCommentMarks.toJSON();
  }
}
