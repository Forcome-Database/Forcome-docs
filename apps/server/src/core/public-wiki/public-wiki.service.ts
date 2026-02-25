import {
  BadRequestException,
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
import { jsonToHtml, jsonToNode } from '../../collaboration/collaboration.util';
import {
  getAttachmentIds,
  getProsemirrorContent,
  isAttachmentNode,
  removeMarkTypeFromDoc,
} from '../../common/helpers/prosemirror/utils';
import { updateAttachmentAttr } from '../share/share.util';
import { Node } from '@tiptap/pm/model';
import { Page } from '@docmost/db/types/entity.types';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class PublicWikiService {
  private readonly logger = new Logger(PublicWikiService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
    private readonly searchService: SearchService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private getPublicSpaceSlugs(): string[] {
    return this.environmentService.getWikiPublicSpaceSlugs();
  }

  private isSpacePublic(slug: string): boolean {
    const slugs = this.getPublicSpaceSlugs();
    // 空列表 = 所有空间公开
    if (slugs.length === 0) return true;
    return slugs.map((s) => s.toLowerCase()).includes(slug.toLowerCase());
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
    return { items: spaces };
  }

  async getSidebarTree(spaceSlug: string, workspaceId: string) {
    if (!this.isSpacePublic(spaceSlug)) {
      throw new NotFoundException('Space not found');
    }

    const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
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
      ])
      .select((eb) => this.pageRepo.withHasChildren(eb))
      .where('spaceId', '=', space.id)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();

    // Build recursive tree
    const tree = this.buildTree(pages, null);

    return { space: { id: space.id, name: space.name, slug: space.slug }, items: tree };
  }

  private buildTree(pages: any[], parentId: string | null): any[] {
    return pages
      .filter((p) => p.parentPageId === parentId)
      .map((p) => ({
        id: p.id,
        slugId: p.slugId,
        title: p.title,
        icon: p.icon,
        position: p.position,
        hasChildren: p.hasChildren,
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

    // Get public space IDs
    const slugs = spaceSlug ? [spaceSlug] : this.getPublicSpaceSlugs();

    let spaceQuery = this.db
      .selectFrom('spaces')
      .select(['id', 'slug'])
      .where('workspaceId', '=', workspaceId);

    if (slugs.length > 0) {
      spaceQuery = spaceQuery.where((eb) =>
        eb.or(
          slugs.map((slug) =>
            eb(eb.fn('LOWER', ['slug']), '=', slug.toLowerCase()),
          ),
        ),
      );
    }

    const spaces = await spaceQuery.execute();

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

  async *aiAnswers(
    query: string,
    workspaceId: string,
    pageSlugId?: string,
    images?: { data: string; mimeType: string }[],
  ): AsyncGenerator<string> {
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

    for await (const chunk of AiSearchService.answerWithContext(
      query,
      workspaceId,
      pageSlugId,
      images,
    )) {
      yield chunk;
    }
  }

  private async updatePublicAttachments(page: Page): Promise<any> {
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
