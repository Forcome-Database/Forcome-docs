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
import { TokenService } from '../auth/services/token.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { SearchService } from '../search/search.service';
import { updateAttachmentAttr } from '../share/share.util';
import { Node } from '@tiptap/pm/model';
import { Page } from '@docmost/db/types/entity.types';
import { ModuleRef } from '@nestjs/core';
import type {
  AiChatMessage,
  AiImagePayload,
  RetrievalScope,
} from '../../ee/ai/services/ai-search.service';

interface PublicWikiAiAnswerInput {
  query: string;
  workspaceId: string;
  pageSlugId?: string;
  images?: AiImagePayload[];
  history?: AiChatMessage[];
  requesterKey?: string;
}

interface PublicSpaceScopeEntry {
  id: string;
  slug: string;
}

interface PublicPageScopeEntry {
  id: string;
  slugId: string;
  spaceId: string;
  spaceSlug: string;
}

@Injectable()
export class PublicWikiService {
  private readonly logger = new Logger(PublicWikiService.name);
  private readonly publicAiRateLimitBuckets = new Map<string, number[]>();

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
    private readonly searchService: SearchService,
    private readonly moduleRef: ModuleRef,
  ) {}

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

  private getPublicSpaceSlugs(): string[] {
    return this.environmentService.getWikiPublicSpaceSlugs();
  }

  private isSpacePublic(slug: string): boolean {
    const slugs = this.getPublicSpaceSlugs();
    // 空列表 = 所有空间公开
    if (slugs.length === 0) return true;
    return slugs.map((s) => s.toLowerCase()).includes(slug.toLowerCase());
  }

  private async resolvePublicSpaces(
    workspaceId: string,
    requestedSpaceSlug?: string,
  ): Promise<PublicSpaceScopeEntry[]> {
    const requestedSlugs = requestedSpaceSlug
      ? [requestedSpaceSlug]
      : this.getPublicSpaceSlugs();

    let query = this.db
      .selectFrom('spaces')
      .select(['id', 'slug'])
      .where('workspaceId', '=', workspaceId);

    if (requestedSlugs.length > 0) {
      query = query.where((eb) =>
        eb.or(
          requestedSlugs.map((slug) =>
            eb(eb.fn('LOWER', ['slug']), '=', slug.toLowerCase()),
          ),
        ),
      );
    }

    return (await query.execute()) as PublicSpaceScopeEntry[];
  }

  private async resolvePublicPageScope(
    workspaceId: string,
    pageSlugId?: string,
  ): Promise<{
    spaces: PublicSpaceScopeEntry[];
    page: PublicPageScopeEntry | null;
    scope: RetrievalScope;
  }> {
    const spaces = await this.resolvePublicSpaces(workspaceId);
    const allowedSpaceIds = spaces.map((space) => space.id);

    if (allowedSpaceIds.length === 0) {
      throw new NotFoundException('No public spaces found');
    }

    let page: PublicPageScopeEntry | null = null;
    if (pageSlugId) {
      page = (await this.db
        .selectFrom('pages')
        .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
        .select([
          'pages.id as id',
          'pages.slugId as slugId',
          'pages.spaceId as spaceId',
          'spaces.slug as spaceSlug',
        ])
        .where('pages.workspaceId', '=', workspaceId)
        .where('pages.slugId', '=', pageSlugId)
        .where('pages.deletedAt', 'is', null)
        .where('pages.spaceId', 'in', allowedSpaceIds)
        .executeTakeFirst()) as PublicPageScopeEntry | null;

      if (!page) {
        throw new NotFoundException('Page not found');
      }
    }

    return {
      spaces,
      page,
      scope: {
        isPublicWiki: true,
        allowedSpaceIds,
        currentPageId: page?.id,
      },
    };
  }

  private enforcePublicAiLimits(input: PublicWikiAiAnswerInput): void {
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

  private enforcePublicAiRateLimit(
    workspaceId: string,
    requesterKey?: string,
  ): void {
    const key = `${workspaceId}:${requesterKey || 'anonymous'}`;
    const now = Date.now();
    const windowMs = this.environmentService.getPublicWikiAiRateLimitWindowMs();
    const maxRequests =
      this.environmentService.getPublicWikiAiRateLimitMaxRequests();

    const bucket = (
      this.publicAiRateLimitBuckets.get(key) || []
    ).filter((timestamp) => now - timestamp < windowMs);

    if (bucket.length >= maxRequests) {
      this.logger.warn(`Public wiki AI rate limited: ${key}`);
      throw new HttpException(
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.push(now);
    this.publicAiRateLimitBuckets.set(key, bucket);
  }

  async getPublicSpaces(workspaceId: string) {
    const slugs = this.getPublicSpaceSlugs();

    let query = this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug', 'description'])
      .where('workspaceId', '=', workspaceId);

    // 有白名单时只返回指定空间，否则返回所有空间
    if (slugs.length > 0) {
      query = query.where((eb) =>
        eb.or(
          slugs.map((slug) =>
            eb(eb.fn('LOWER', ['slug']), '=', slug.toLowerCase()),
          ),
        ),
      );
    }

    const spaces = await query.execute();

    // Check which spaces have directories
    const spaceIds = spaces.map((s) => s.id);
    const dirCounts = spaceIds.length > 0
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

  async getDirectories(spaceSlug: string, workspaceId: string) {
    if (!this.isSpacePublic(spaceSlug)) {
      throw new NotFoundException('Space not found');
    }

    const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const directories = await this.db
      .selectFrom('directories')
      .select(['id', 'name', 'slug', 'icon', 'position'])
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    return { items: directories };
  }

  async getSidebarTree(spaceSlug: string, workspaceId: string, directoryId?: string) {
    if (!this.isSpacePublic(spaceSlug)) {
      throw new NotFoundException('Space not found');
    }

    const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    // When directoryId is provided, build a mixed tree of topics and pages
    if (directoryId) {
      return this.getDirectorySidebarTree(space, directoryId);
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
        'textContent',
      ])
      .select((eb) => this.pageRepo.withHasChildren(eb))
      .where('spaceId', '=', space.id)
      .where('directoryId', 'is', null)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    // Build recursive tree
    const tree = this.buildTree(pages, null);

    return { space: { id: space.id, name: space.name, slug: space.slug }, items: tree };
  }

  private async getDirectorySidebarTree(
    space: { id: string; name: string; slug: string },
    directoryId: string,
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

    // Query topics in this directory
    const topics = await this.db
      .selectFrom('topics')
      .select(['id', 'name', 'icon', 'position'])
      .where('directoryId', '=', directoryId)
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    // Query all pages in the space, then filter for directory tree
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

    // Collect pages directly assigned to this directory + all their descendants
    const directIds = new Set(
      allPages.filter((p) => p.directoryId === directoryId).map((p) => p.id),
    );
    const relevantIds = new Set(directIds);
    let frontier = [...directIds];
    while (frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const p of allPages) {
        if (
          p.parentPageId &&
          frontier.includes(p.parentPageId) &&
          !relevantIds.has(p.id)
        ) {
          relevantIds.add(p.id);
          nextFrontier.push(p.id);
        }
      }
      frontier = nextFrontier;
    }
    const pages = allPages.filter((p) => relevantIds.has(p.id));

    // Build topic nodes with their pages
    const topicNodes = topics.map((topic) => {
      const topicPages = pages.filter((p) => p.topicId === topic.id && !p.parentPageId);
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
    // Use 'a0' as fallback for null position, consistent with frontend sortPositionKeys
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

  async getPage(
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

    // Verify page belongs to a public space
    const space = await this.db
      .selectFrom('spaces')
      .select(['id', 'slug', 'name'])
      .where('id', '=', page.spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!space || !this.isSpacePublic(space.slug)) {
      throw new NotFoundException('Page not found');
    }

    // Process attachments for public access
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
      const { jsonToHtml } = await import('../../collaboration/collaboration.util');
      content = jsonToHtml(processedContent);
    }

    // Get breadcrumbs
    const breadcrumbs = await this.getPageBreadcrumbs(page.id);

    return {
      id: page.id,
      slugId: page.slugId,
      title: page.title,
      icon: page.icon,
      content,
      breadcrumbs,
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

  async searchPublicPages(
    query: string,
    workspaceId: string,
    spaceSlug?: string,
    limit?: number,
  ) {
    if (query.length < 1) {
      return { items: [] };
    }

    const spaces = await this.resolvePublicSpaces(workspaceId, spaceSlug);

    if (spaces.length === 0) {
      return { items: [] };
    }

    // Search across all public spaces one by one and merge
    const allResults = [];
    for (const space of spaces) {
      const result = await this.searchService.searchPage(
        { query, spaceId: space.id, limit: limit || 25, offset: 0 },
        { workspaceId },
      );
      for (const item of result.items) {
        allResults.push({
          ...item,
          spaceSlug: item.space?.slug || space.slug,
        });
      }
    }

    // Sort by rank desc, limit
    allResults.sort((a, b) => (b as any).rank - (a as any).rank);
    return { items: allResults.slice(0, limit || 25) };
  }

  async *aiAnswers(input: PublicWikiAiAnswerInput): AsyncGenerator<string> {
    this.enforcePublicAiLimits(input);
    this.enforcePublicAiRateLimit(input.workspaceId, input.requesterKey);

    const { page, scope } = await this.resolvePublicPageScope(
      input.workspaceId,
      input.pageSlugId,
    );

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
      `Public wiki AI request workspace=${input.workspaceId} page=${page?.slugId || '-'} requester=${input.requesterKey || 'anonymous'}`,
    );

    for await (const chunk of AiSearchService.answerWithContext({
      query: input.query,
      workspaceId: input.workspaceId,
      pageSlugId: page?.slugId,
      images: input.images,
      history: input.history,
      scope,
    })) {
      yield chunk;
    }
  }

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

    const { jsonToNode } = await import('../../collaboration/collaboration.util');
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
