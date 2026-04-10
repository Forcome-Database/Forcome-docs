# Permission Edge Case Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 12 edge-case vulnerabilities and inconsistencies in the hierarchical permission system (resource_permissions), covering security bypasses, logic gaps, and code hygiene.

**Architecture:** All fixes are additive patches to existing files — one new service file (ResourceVisibilityService). Security fixes (Tasks 1-4) add permission checks to existing endpoints. Cleanup fixes (Task 3) add event handlers. Consistency fixes (Tasks 5-6) adjust filtering logic in public-wiki service. Tech debt (Task 9) extracts shared code.

**Tech Stack:** NestJS 11 + Kysely (PostgreSQL) + CASL + Fastify; Vue 3 (VitePress wiki frontend)

**Key dependency:** `DatabaseModule` is `@Global()` — all repos (ResourcePermissionRepo, SpaceMemberRepo, PageRepo) are injectable anywhere without explicit module imports. `EventEmitterModule.forRoot()` is registered in `app.module.ts` — `EventEmitter2` is injectable anywhere.

---

## File Map

| File | Changes | Tasks |
|------|---------|-------|
| `apps/server/src/core/share/share.service.ts` | Add ResourcePermissionRepo injection + permission check in getSharedPage / getShareTree | 1 |
| `apps/server/src/integrations/export/export.controller.ts` | Add ResourcePermissionRepo + filter denied child pages before export | 2 |
| `apps/server/src/integrations/export/export.service.ts` | Add optional `excludedPageIds` parameter to `exportPages` | 2 |
| `apps/server/src/database/repos/page/page.repo.ts` | Add `findPageIdsByDirectoryIds` helper | 2 |
| `apps/server/src/common/events/event.contants.ts` | Add SPACE_MEMBER_REMOVED, WORKSPACE_USER_DELETED events | 3 |
| `apps/server/src/core/space/services/space-member.service.ts` | Inject EventEmitter2 + emit SPACE_MEMBER_REMOVED after removal | 3 |
| `apps/server/src/core/workspace/services/workspace.service.ts` | Inject EventEmitter2 + emit WORKSPACE_USER_DELETED after deletion | 3 |
| `apps/server/src/core/resource-permission/resource-permission.service.ts` | Handle new cleanup events | 3 |
| `apps/server/src/database/repos/resource-permission/resource-permission.repo.ts` | Add deleteByPrincipalInSpace, deleteByPrincipalInWorkspace methods | 3 |
| `apps/server/src/ee/ai/ai.controller.ts` | Add AuthUser + SpaceMemberRepo + ResourcePermissionRepo; pass user-scoped scope | 4 |
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | Filter hidden ancestors from breadcrumbs; re-parent orphaned children in sidebar | 5, 6 |
| `apps/server/src/core/page/page.controller.ts` | Filter denied ancestors from internal breadcrumbs; use ResourceVisibilityService | 5, 9 |
| `apps/server/src/core/search/search.controller.ts` | Use ResourceVisibilityService | 9 |
| `apps/server/src/core/resource-permission/resource-visibility.service.ts` | NEW: shared dual-mode filtering for recent pages + search | 9 |
| `apps/server/src/core/resource-permission/resource-permission.module.ts` | Add ResourceVisibilityService to providers/exports | 9 |

---

### Task 1: Share Link Permission Check (B1 — P0 Security)

**Files:**
- Modify: `apps/server/src/core/share/share.service.ts`

**Problem:** `getSharedPage` and `getShareTree` don't check `resource_permissions`. A page with group NONE is still accessible via share link.

**Note:** No changes needed in `share.module.ts` — `ResourcePermissionRepo` is exported by the global `DatabaseModule` and injectable directly.

- [ ] **Step 1: Add ResourcePermissionRepo to ShareService constructor**

```typescript
// share.service.ts — add to imports
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';

// Add as last constructor parameter
constructor(
  private readonly shareRepo: ShareRepo,
  private readonly pageRepo: PageRepo,
  @InjectKysely() private readonly db: KyselyDB,
  private readonly tokenService: TokenService,
  private readonly resourcePermRepo: ResourcePermissionRepo, // ADD
) {}
```

- [ ] **Step 2: Add helper method to check if a page is hidden from public**

```typescript
/**
 * Check if a page (or its directory) is hidden from public via group NONE permission.
 * Mirrors the logic in PublicWikiService.getPage().
 */
private async isPageHiddenFromPublic(
  page: { id: string; spaceId: string; directoryId?: string | null },
  workspaceId: string,
): Promise<boolean> {
  const hiddenResources = await this.resourcePermRepo.findHiddenForPublic(
    page.spaceId,
    workspaceId,
  );
  const hiddenPageIds = new Set(
    hiddenResources.filter(r => r.resourceType === 'page').map(r => r.resourceId),
  );
  const hiddenDirIds = new Set(
    hiddenResources.filter(r => r.resourceType === 'directory').map(r => r.resourceId),
  );
  return hiddenPageIds.has(page.id) ||
    !!(page.directoryId && hiddenDirIds.has(page.directoryId));
}
```

- [ ] **Step 3: Add permission check to getSharedPage**

In `getSharedPage()`, after fetching `page` (after existing line `page.content = await this.updatePublicAttachments(page);`), add the check:

```typescript
async getSharedPage(dto: ShareInfoDto, workspaceId: string) {
  const share = await this.getShareForPage(dto.pageId, workspaceId);

  if (!share) {
    throw new NotFoundException('Shared page not found');
  }

  const page = await this.pageRepo.findById(dto.pageId, {
    includeContent: true,
    includeCreator: true,
  });

  if (!page || page.deletedAt) {
    throw new NotFoundException('Shared page not found');
  }

  // Check resource permissions — block access to hidden pages
  if (await this.isPageHiddenFromPublic(page, workspaceId)) {
    throw new NotFoundException('Shared page not found');
  }

  page.content = await this.updatePublicAttachments(page);

  return { page, share };
}
```

- [ ] **Step 4: Filter hidden children in getShareTree**

Replace the entire `if (share.includeSubPages)` block in `getShareTree()`:

```typescript
async getShareTree(shareId: string, workspaceId: string) {
  const share = await this.shareRepo.findById(shareId);
  if (!share || share.workspaceId !== workspaceId) {
    throw new NotFoundException('Share not found');
  }

  if (share.includeSubPages) {
    const pageList = await this.pageRepo.getPageAndDescendants(share.pageId, {
      includeContent: false,
    });

    // Filter out pages hidden via group NONE permission
    const hiddenResources = await this.resourcePermRepo.findHiddenForPublic(
      share.spaceId,
      share.workspaceId,
    );
    const hiddenPageIds = new Set(
      hiddenResources.filter(r => r.resourceType === 'page').map(r => r.resourceId),
    );
    const hiddenDirIds = new Set(
      hiddenResources.filter(r => r.resourceType === 'directory').map(r => r.resourceId),
    );
    const filteredPages = pageList.filter(p =>
      !hiddenPageIds.has(p.id) &&
      !(p.directoryId && hiddenDirIds.has(p.directoryId))
    );

    return { share, pageTree: filteredPages };
  } else {
    return { share, pageTree: [] };
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/share/share.service.ts
git commit -m "fix(security): check resource permissions in share link access"
```

---

### Task 2: Export Recursive Permission Check (B2 — P0 Security)

**Files:**
- Modify: `apps/server/src/integrations/export/export.controller.ts`
- Modify: `apps/server/src/integrations/export/export.service.ts`
- Modify: `apps/server/src/database/repos/page/page.repo.ts`

**Problem:** `exportPage` only checks root page permission, then exports all descendants including NONE children.

- [ ] **Step 1: Add dependencies to ExportController and add @AuthWorkspace**

```typescript
// export.controller.ts — add imports
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';

// Update constructor
constructor(
  private readonly exportService: ExportService,
  private readonly pageRepo: PageRepo,
  private readonly spaceAbility: SpaceAbilityFactory,
  private readonly resourceAbility: ResourceAbilityFactory,
  private readonly resourcePermRepo: ResourcePermissionRepo, // ADD
) {}
```

- [ ] **Step 2: Add findPageIdsByDirectoryIds to PageRepo**

```typescript
// page.repo.ts — add new method
async findPageIdsByDirectoryIds(directoryIds: string[]): Promise<string[]> {
  if (directoryIds.length === 0) return [];
  const rows = await this.db
    .selectFrom('pages')
    .select('id')
    .where('directoryId', 'in', directoryIds)
    .where('deletedAt', 'is', null)
    .execute();
  return rows.map(r => r.id);
}
```

- [ ] **Step 3: Filter denied children in exportPage**

Update the `exportPage` method to add `@AuthWorkspace()` and filter denied children:

```typescript
@UseGuards(JwtAuthGuard)
@HttpCode(HttpStatus.OK)
@Post('pages/export')
async exportPage(
  @Body() dto: ExportPageDto,
  @AuthUser() user: User,
  @AuthWorkspace() workspace: Workspace, // ADD
  @Res() res: FastifyReply,
) {
  const page = await this.pageRepo.findById(dto.pageId, {
    includeContent: true,
  });

  if (!page || page.deletedAt) {
    throw new NotFoundException('Page not found');
  }

  const ability = await this.resourceAbility.createForUser(
    user, 'page', page.id,
    { directoryId: page.directoryId, spaceId: page.spaceId },
  );
  if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
    throw new ForbiddenException();
  }

  // Build denied set for child page filtering
  let excludedPageIds: Set<string> | undefined;
  if (dto.includeChildren) {
    const overrides = await this.resourcePermRepo.getUserOverridesInSpace(
      user.id, page.spaceId, workspace.id,
    );
    const deniedPageIds = new Set<string>();
    const deniedDirIds = new Set<string>();
    for (const o of overrides) {
      if (o.role !== 'none') continue;
      if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
      if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
    }
    if (deniedPageIds.size > 0 || deniedDirIds.size > 0) {
      excludedPageIds = new Set(deniedPageIds);
      if (deniedDirIds.size > 0) {
        const pagesInDeniedDirs = await this.pageRepo.findPageIdsByDirectoryIds(
          [...deniedDirIds],
        );
        for (const pid of pagesInDeniedDirs) {
          excludedPageIds.add(pid);
        }
      }
    }
  }

  const zipFileStream = await this.exportService.exportPages(
    dto.pageId, dto.format, dto.includeAttachments, dto.includeChildren,
    excludedPageIds,
  );

  const fileName = sanitize(page.title || 'untitled') + '.zip';
  res.headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fileName) + '"',
  });
  res.send(zipFileStream);
}
```

- [ ] **Step 4: Update exportPages to accept and apply excludedPageIds**

```typescript
// export.service.ts — update signature and add filter
async exportPages(
  pageId: string,
  format: string,
  includeAttachments: boolean,
  includeChildren: boolean,
  excludedPageIds?: Set<string>, // ADD — undefined = no filtering
) {
  let pages: Page[];

  if (includeChildren) {
    //@ts-ignore
    pages = await this.pageRepo.getPageAndDescendants(pageId, {
      includeContent: true,
    });
    // Filter out denied pages
    if (excludedPageIds?.size) {
      pages = pages.filter(p => !excludedPageIds.has(p.id));
    }
  } else {
    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });
    if (page) {
      pages = [page];
    }
  }
  // ...rest unchanged
```

Note: `exportSpace` also calls `exportPages` internally — verify its call signature still works. Since `excludedPageIds` defaults to `undefined` (no filtering), existing call sites are unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/integrations/export/export.controller.ts \
  apps/server/src/integrations/export/export.service.ts \
  apps/server/src/database/repos/page/page.repo.ts
git commit -m "fix(security): filter denied child pages from export"
```

---

### Task 3: Cleanup resource_permissions on Member Deletion (B3 — P0 Security)

**Files:**
- Modify: `apps/server/src/common/events/event.contants.ts`
- Modify: `apps/server/src/core/space/services/space-member.service.ts`
- Modify: `apps/server/src/core/workspace/services/workspace.service.ts`
- Modify: `apps/server/src/core/resource-permission/resource-permission.service.ts`
- Modify: `apps/server/src/database/repos/resource-permission/resource-permission.repo.ts`

**Problem:** Removing a space member, group member, or workspace user doesn't clean up their resource_permissions records.

- [ ] **Step 1: Add new event names**

In `event.contants.ts`, add to the enum:

```typescript
export enum EventName {
  // ...existing events...

  SPACE_MEMBER_REMOVED = 'space-member.removed',
  WORKSPACE_USER_DELETED = 'workspace-user.deleted',
}
```

- [ ] **Step 2: Add cleanup query methods to ResourcePermissionRepo**

Use the two-step pattern (select IDs → delete by IDs) to avoid complex subquery issues in Kysely's `deleteFrom`:

```typescript
// resource-permission.repo.ts — add methods

/**
 * Delete all resource permissions for a principal within a space.
 * Uses select+delete pattern to avoid complex subquery in deleteFrom.
 */
async deleteByPrincipalInSpace(
  principalType: 'user' | 'group',
  principalId: string,
  spaceId: string,
  workspaceId: string,
): Promise<void> {
  // Collect IDs of resource_permissions to delete
  const dirPerms = await this.db
    .selectFrom('resourcePermissions')
    .innerJoin('directories', 'directories.id', 'resourcePermissions.resourceId')
    .select('resourcePermissions.id')
    .where('resourcePermissions.principalType', '=', principalType)
    .where('resourcePermissions.principalId', '=', principalId)
    .where('resourcePermissions.workspaceId', '=', workspaceId)
    .where('resourcePermissions.resourceType', '=', 'directory')
    .where('directories.spaceId', '=', spaceId)
    .execute();

  const pagePerms = await this.db
    .selectFrom('resourcePermissions')
    .innerJoin('pages', 'pages.id', 'resourcePermissions.resourceId')
    .select('resourcePermissions.id')
    .where('resourcePermissions.principalType', '=', principalType)
    .where('resourcePermissions.principalId', '=', principalId)
    .where('resourcePermissions.workspaceId', '=', workspaceId)
    .where('resourcePermissions.resourceType', '=', 'page')
    .where('pages.spaceId', '=', spaceId)
    .execute();

  const idsToDelete = [
    ...dirPerms.map(r => r.id),
    ...pagePerms.map(r => r.id),
  ];

  if (idsToDelete.length > 0) {
    await this.db
      .deleteFrom('resourcePermissions')
      .where('id', 'in', idsToDelete)
      .execute();
  }
}

/**
 * Delete all resource permissions for a principal across the workspace.
 */
async deleteByPrincipalInWorkspace(
  principalType: 'user' | 'group',
  principalId: string,
  workspaceId: string,
): Promise<void> {
  await this.db
    .deleteFrom('resourcePermissions')
    .where('principalType', '=', principalType)
    .where('principalId', '=', principalId)
    .where('workspaceId', '=', workspaceId)
    .execute();
}
```

- [ ] **Step 3: Inject EventEmitter2 and emit event in SpaceMemberService**

`EventEmitter2` is globally available via `EventEmitterModule.forRoot()` in app.module.ts.

```typescript
// space-member.service.ts — add imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';

// Add to constructor (currently has: spaceMemberRepo, groupUserRepo, spaceRepo, watcherRepo, db)
constructor(
  private spaceMemberRepo: SpaceMemberRepo,
  private groupUserRepo: GroupUserRepo,
  private spaceRepo: SpaceRepo,
  private watcherRepo: WatcherRepo,
  @InjectKysely() private readonly db: KyselyDB,
  private readonly eventEmitter: EventEmitter2, // ADD
) {}

// In removeMemberFromSpace(), AFTER the executeTx block (after line 232):
this.eventEmitter.emit(EventName.SPACE_MEMBER_REMOVED, {
  principalType: dto.userId ? 'user' : 'group',
  principalId: dto.userId || dto.groupId,
  spaceId: dto.spaceId,
  workspaceId,
});
```

- [ ] **Step 4: Inject EventEmitter2 and emit event in WorkspaceService**

```typescript
// workspace.service.ts — add imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';

// Add to constructor
private readonly eventEmitter: EventEmitter2, // ADD

// In deleteUser(), AFTER the executeTx block:
this.eventEmitter.emit(EventName.WORKSPACE_USER_DELETED, {
  principalType: 'user' as const,
  principalId: userId,
  workspaceId,
});
```

- [ ] **Step 5: Handle new events in ResourcePermissionService**

```typescript
// resource-permission.service.ts — add event interfaces and handlers

export interface SpaceMemberRemovedEvent {
  principalType: 'user' | 'group';
  principalId: string;
  spaceId: string;
  workspaceId: string;
}

export interface WorkspaceUserDeletedEvent {
  principalType: 'user' | 'group';
  principalId: string;
  workspaceId: string;
}

@OnEvent(EventName.SPACE_MEMBER_REMOVED)
async handleSpaceMemberRemoved(event: SpaceMemberRemovedEvent): Promise<void> {
  await this.resourcePermRepo.deleteByPrincipalInSpace(
    event.principalType,
    event.principalId,
    event.spaceId,
    event.workspaceId,
  );
}

@OnEvent(EventName.WORKSPACE_USER_DELETED)
async handleWorkspaceUserDeleted(event: WorkspaceUserDeletedEvent): Promise<void> {
  await this.resourcePermRepo.deleteByPrincipalInWorkspace(
    event.principalType,
    event.principalId,
    event.workspaceId,
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/common/events/event.contants.ts \
  apps/server/src/core/space/services/space-member.service.ts \
  apps/server/src/core/workspace/services/workspace.service.ts \
  apps/server/src/core/resource-permission/resource-permission.service.ts \
  apps/server/src/database/repos/resource-permission/resource-permission.repo.ts
git commit -m "fix(security): cleanup resource_permissions on member/user deletion"
```

---

### Task 4: Authenticated AI Search Permission Filtering (B4 — P1)

**Files:**
- Modify: `apps/server/src/ee/ai/ai.controller.ts`

**Problem:** The authenticated `/ai/answers` endpoint passes no `scope` to `answerWithContext`, so RAG retrieval doesn't filter by user's resource permissions.

**Note:** `SpaceMemberRepo.getUserSpaceIds(userId)` exists at line 277 of `space-member.repo.ts`, returns `string[]`. All repos injectable via global `DatabaseModule`.

- [ ] **Step 1: Add dependencies to AiController**

```typescript
// ai.controller.ts — add imports
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';

// Update constructor
constructor(
  private readonly aiService: AiService,
  private readonly aiSearchService: AiSearchService,
  private readonly spaceMemberRepo: SpaceMemberRepo,       // ADD
  private readonly resourcePermRepo: ResourcePermissionRepo, // ADD
) {}
```

- [ ] **Step 2: Build user-scoped scope and pass to answerWithContext**

```typescript
@UseGuards(JwtAuthGuard)
@Post('answers')
async aiAnswers(
  @Body() dto: AiAnswerDto,
  @AuthUser() user: User, // ADD
  @AuthWorkspace() workspace: Workspace,
  @Res() res: FastifyReply,
) {
  this.checkAiSearchEnabled(workspace);

  // Build user-scoped retrieval scope: collect denied resources
  const excludedPageIds: string[] = [];
  const excludedDirectoryIds: string[] = [];

  const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
  await Promise.all(
    userSpaceIds.map(async (spaceId) => {
      const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(user.id, spaceId);
      const spaceRole = findHighestUserSpaceRole(userSpaceRoles);
      if (!spaceRole || spaceRole === 'none') return;

      const overrides = await this.resourcePermRepo.getUserOverridesInSpace(
        user.id, spaceId, workspace.id,
      );
      for (const o of overrides) {
        if (o.role !== 'none') continue;
        if (o.resourceType === 'page') excludedPageIds.push(o.resourceId);
        if (o.resourceType === 'directory') excludedDirectoryIds.push(o.resourceId);
      }
    }),
  );

  const scope = (excludedPageIds.length > 0 || excludedDirectoryIds.length > 0)
    ? {
        ...(excludedPageIds.length > 0 && { excludedPageIds }),
        ...(excludedDirectoryIds.length > 0 && { excludedDirectoryIds }),
      }
    : undefined;

  res.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    for await (const chunk of this.aiSearchService.answerWithContext({
      query: dto.query,
      workspaceId: workspace.id,
      scope,
    })) {
      res.raw.write(`data: ${chunk}\n\n`);
    }
    res.raw.write('data: [DONE]\n\n');
  } catch (error: any) {
    res.raw.write(
      `data: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`,
    );
  } finally {
    res.raw.end();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/ai.controller.ts
git commit -m "fix(security): filter denied resources from authenticated AI search"
```

---

### Task 5: Breadcrumb Information Leak (B7/B8 — P1)

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`
- Modify: `apps/server/src/core/page/page.controller.ts`

**Problem:** Breadcrumbs expose hidden ancestor page titles in both Wiki and internal paths.

- [ ] **Step 1: Filter hidden ancestors from Wiki breadcrumbs**

In `public-wiki.service.ts` `getPage()` method, `hiddenPageIds` is already computed (around line 669-672) and in scope when breadcrumbs are returned (around line 697). Modify the return to filter:

```typescript
// In getPage(), after: const breadcrumbs = await this.getPageBreadcrumbs(page.id);
// Replace the breadcrumbs in the return object:
return {
  id: page.id,
  slugId: page.slugId,
  title: page.title,
  icon: page.icon,
  content,
  breadcrumbs: breadcrumbs.filter(crumb => !hiddenPageIds.has(crumb.id)),
  spaceSlug: space.slug,
  spaceName: space.name,
  updatedAt: page.updatedAt,
  createdAt: page.createdAt,
  creator: (page as any).creator,
};
```

- [ ] **Step 2: Filter denied ancestors from internal breadcrumbs**

In `page.controller.ts`, the breadcrumbs endpoint is at lines 608-624:

```typescript
@HttpCode(HttpStatus.OK)
@Post('/breadcrumbs')
async getPageBreadcrumbs(
  @Body() dto: PageIdDto,
  @AuthUser() user: User,
  @AuthWorkspace() workspace: Workspace, // ADD
) {
  const page = await this.pageRepo.findById(dto.pageId);
  if (!page) {
    throw new NotFoundException('Page not found');
  }

  const ability = await this.resourceAbility.createForUser(
    user, 'page', page.id,
    { directoryId: page.directoryId, spaceId: page.spaceId },
  );
  if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
    throw new ForbiddenException();
  }

  const ancestors = await this.pageService.getPageBreadCrumbs(page.id);

  // Filter out denied ancestors
  const overrides = await this.resourcePermRepo.getUserOverridesInSpace(
    user.id, page.spaceId, workspace.id,
  );
  const deniedPageIds = new Set<string>();
  for (const o of overrides) {
    if (o.role !== 'none') continue;
    if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
  }

  return deniedPageIds.size > 0
    ? ancestors.filter((a: any) => !deniedPageIds.has(a.id))
    : ancestors;
}
```

Note: `@AuthWorkspace()` requires adding the `Workspace` import if not already present. The `Workspace` type and `AuthWorkspace` decorator are already imported in page.controller.ts (used by other methods).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/core/public-wiki/public-wiki.service.ts \
  apps/server/src/core/page/page.controller.ts
git commit -m "fix(security): filter hidden ancestors from breadcrumbs"
```

---

### Task 6: Wiki Sidebar Subtree Orphan Handling (B5/B6 — P1)

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`

**Problem:** When a parent page is hidden, its children disappear from the Wiki sidebar because `buildTree` can't find the parent node. Children become invisible even though they aren't explicitly hidden.

**Note:** Kysely `.execute()` returns plain JS objects — `.parentPageId` can be safely mutated.

**Critical subtlety (directory path):** In `getDirectorySidebarTree`, the BFS at lines 524-546 already excludes hidden pages from `relevantIds`. This means children of hidden parents are never discovered by the BFS and thus absent from the `pages` array. Re-parenting after the BFS is a **no-op**. The fix must modify the BFS itself to "pass through" hidden pages during expansion (so their non-hidden children are discovered) without including the hidden pages in the final result.

- [ ] **Step 1: Add re-parenting logic in getSidebarTree (non-directory mode)**

After line 445 (`const visiblePages = pages.filter(...)`) and before `buildTree`. The non-directory path fetches ALL pages first then filters, so orphaned children ARE present in the filtered list — they just have dangling `parentPageId`. Re-parenting works here:

```typescript
const visiblePages = pages.filter((p) => !hiddenPageIds.has(p.id));

// Re-parent orphans: if a page's parent was hidden, promote to nearest visible ancestor
// Use Map for O(1) lookup instead of Array.find()
const pageMap = new Map(pages.map(p => [p.id, p])); // original unfiltered pages
for (const page of visiblePages) {
  if (page.parentPageId && hiddenPageIds.has(page.parentPageId)) {
    let ancestor = pageMap.get(page.parentPageId);
    while (ancestor && hiddenPageIds.has(ancestor.id)) {
      ancestor = ancestor.parentPageId ? pageMap.get(ancestor.parentPageId) : undefined;
    }
    (page as any).parentPageId = ancestor ? ancestor.id : null;
  }
}

const tree = this.buildTree(visiblePages, null);
```

- [ ] **Step 2: Fix BFS in getDirectorySidebarTree to pass through hidden pages**

The existing BFS (lines 524-546) must be modified. Hidden pages should participate in BFS expansion (so their children are found) but NOT be included in `relevantIds`:

Replace the entire BFS block (lines 524-547):

```typescript
// Collect pages directly assigned to this directory + all their descendants
// Hidden pages participate in BFS expansion as "pass-through" nodes
// but are excluded from the final result.
const directIds = new Set(
  allPages
    .filter((p) => p.directoryId === directoryId)
    .map((p) => p.id),
);
// relevantIds = visible pages in the result; frontierIds = all traversed (including hidden)
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

// Re-parent orphans whose parent was hidden (now they ARE in pages)
const allPageMap = new Map(allPages.map(p => [p.id, p]));
for (const page of pages) {
  if (page.parentPageId && hiddenPageIds.has(page.parentPageId)) {
    let ancestor = allPageMap.get(page.parentPageId);
    while (ancestor && hiddenPageIds.has(ancestor.id)) {
      ancestor = ancestor.parentPageId ? allPageMap.get(ancestor.parentPageId) : undefined;
    }
    (page as any).parentPageId = ancestor ? ancestor.id : null;
  }
}
```

Key changes vs original:
- `directIds` now includes hidden pages (removed `!hiddenPageIds.has(p.id)` from initial filter)
- Split tracking into `visitedIds` (all traversed) and `relevantIds` (visible only)
- BFS frontier includes hidden pages (they "pass through" so their children are found)
- Hidden pages are added to `visitedIds` and frontier but NOT to `relevantIds`
- After BFS, `pages` now correctly contains visible children of hidden parents
- Re-parenting loop now has actual orphans to fix

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/core/public-wiki/public-wiki.service.ts
git commit -m "fix(ui): re-parent orphaned children when ancestor page is hidden in wiki"
```

---

### Task 7: (SKIPPED) Child Page URL Access with Hidden Parent

**Decision:** The intent of resource permissions is per-resource, not inherited down the page tree. Task 6 fixes the sidebar consistency. A child page that isn't explicitly NONE should remain accessible via direct URL.

---

### Task 8: Document Directory NONE Wiki Semantics

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`

**Decision:** Directory NONE blocks all pages in that directory from the public wiki — this is by design. Add a code comment.

- [ ] **Step 1: Add documentation comment in getPage()**

At `public-wiki.service.ts`, before the hidden resource check (around line 675):

```typescript
// Design decision: directory NONE hides ALL contained pages from public wiki,
// even if individual pages have explicit non-NONE overrides via resource_permissions.
// This differs from the internal API where page-level overrides take precedence
// (ResourceAbilityFactory.resolveRole Step 1 returns page override before checking directory).
// Rationale: the public wiki treats directories as atomic visibility units for anonymous access.
if (hiddenPageIds.has(page.id) || (page.directoryId && hiddenDirIds.has(page.directoryId))) {
  throw new NotFoundException('Page not found');
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/core/public-wiki/public-wiki.service.ts
git commit -m "docs: clarify directory NONE blocks all pages in public wiki by design"
```

---

### Task 9: Extract ResourceVisibilityService (B13 — P3 Tech Debt)

**Files:**
- Create: `apps/server/src/core/resource-permission/resource-visibility.service.ts`
- Modify: `apps/server/src/core/resource-permission/resource-permission.module.ts`
- Modify: `apps/server/src/core/page/page.controller.ts`
- Modify: `apps/server/src/core/search/search.controller.ts`

**Problem:** The dual-mode filtering logic is duplicated in `filterRecentPagesByPermission` (page.controller.ts:627-684) and `filterSearchResultsByPermission` (search.controller.ts:~145-194).

**Scope limitation:** The sidebar filtering at page.controller.ts:390-490 CANNOT be replaced — it has additional container-directory-promotion logic (`allowedDirectoryIds.add(override.directoryId)` from page overrides) that the generic service doesn't replicate. Only the recent-pages and search filtering are targets.

- [ ] **Step 1: Create ResourceVisibilityService**

```typescript
// resource-visibility.service.ts
import { Injectable } from '@nestjs/common';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';

export interface VisibleItem {
  id: string;
  spaceId: string | null | undefined; // nullable to match search result types
  directoryId?: string | null;
}

@Injectable()
export class ResourceVisibilityService {
  constructor(
    private readonly resourcePermRepo: ResourcePermissionRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  /**
   * Filter items by resource-level permissions for a given user.
   * - restricted (spaceRole='none'): only return items with explicit non-none override
   * - normal users: filter out items with 'none' override
   *
   * NOTE: This does NOT handle sidebar container-directory-promotion logic.
   * Only use for flat result lists (recent pages, search results).
   */
  async filterByPermissions<T extends VisibleItem>(
    items: T[],
    userId: string,
    workspaceId: string,
  ): Promise<T[]> {
    if (items.length === 0) return items;

    const spaceIds = [...new Set(
      items.map(item => item.spaceId).filter((s): s is string => Boolean(s)),
    )];
    if (spaceIds.length === 0) return items;

    const spaceOverridesMap = new Map<string, {
      spaceRole: string | undefined;
      overrides: { resourceType: string; resourceId: string; role: string; directoryId: string | null }[];
    }>();

    await Promise.all(
      spaceIds.map(async (spaceId) => {
        const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(userId, spaceId);
        const spaceRole = findHighestUserSpaceRole(userSpaceRoles);
        const overrides = await this.resourcePermRepo.getUserOverridesInSpace(userId, spaceId, workspaceId);
        spaceOverridesMap.set(spaceId, { spaceRole, overrides });
      }),
    );

    return items.filter(item => {
      if (!item.spaceId) return true; // No spaceId, can't filter

      const entry = spaceOverridesMap.get(item.spaceId);
      if (!entry) return true;

      const { spaceRole, overrides } = entry;

      if (spaceRole === 'none') {
        const allowedPageIds = new Set<string>();
        const allowedDirIds = new Set<string>();
        for (const o of overrides) {
          if (o.role === 'none') continue;
          if (o.resourceType === 'page') allowedPageIds.add(o.resourceId);
          if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
        }
        return allowedPageIds.has(item.id) ||
          !!(item.directoryId && allowedDirIds.has(item.directoryId));
      } else {
        const deniedPageIds = new Set<string>();
        const deniedDirIds = new Set<string>();
        for (const o of overrides) {
          if (o.role !== 'none') continue;
          if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
          if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
        }
        if (deniedPageIds.has(item.id)) return false;
        if (item.directoryId && deniedDirIds.has(item.directoryId)) return false;
        return true;
      }
    });
  }
}
```

- [ ] **Step 2: Register in ResourcePermissionModule**

```typescript
// resource-permission.module.ts
import { Module } from '@nestjs/common';
import { ResourcePermissionController } from './resource-permission.controller';
import { ResourcePermissionService } from './resource-permission.service';
import { ResourceVisibilityService } from './resource-visibility.service';

@Module({
  controllers: [ResourcePermissionController],
  providers: [ResourcePermissionService, ResourceVisibilityService],
  exports: [ResourcePermissionService, ResourceVisibilityService],
})
export class ResourcePermissionModule {}
```

- [ ] **Step 3: Replace filterRecentPagesByPermission in page.controller.ts**

Inject `ResourceVisibilityService` in `PageController` constructor, then replace the private method:

```typescript
// Add import
import { ResourceVisibilityService } from '../resource-permission/resource-visibility.service';

// Add to constructor
private readonly resourceVisibility: ResourceVisibilityService, // ADD

// Replace the filterRecentPagesByPermission method (lines 627-684) with:
private async filterRecentPagesByPermission<T extends { id: string; spaceId: string; directoryId?: string | null }>(
  items: T[], userId: string, workspaceId: string,
): Promise<T[]> {
  return this.resourceVisibility.filterByPermissions(items, userId, workspaceId);
}
```

- [ ] **Step 4: Replace inline filter in search.controller.ts**

Inject `ResourceVisibilityService` in `SearchController`, then replace the inline `filterResultsByPermission` logic with a call:

```typescript
// Add import
import { ResourceVisibilityService } from '../resource-permission/resource-visibility.service';

// Add to constructor
private readonly resourceVisibility: ResourceVisibilityService, // ADD

// Replace the inline filtering method with delegation:
private async filterResultsByPermission<T extends { id: string; spaceId?: string; directoryId?: string | null }>(
  items: T[], userId: string, workspaceId: string,
): Promise<T[]> {
  return this.resourceVisibility.filterByPermissions(items, userId, workspaceId);
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/resource-permission/resource-visibility.service.ts \
  apps/server/src/core/resource-permission/resource-permission.module.ts \
  apps/server/src/core/page/page.controller.ts \
  apps/server/src/core/search/search.controller.ts
git commit -m "refactor: extract ResourceVisibilityService from duplicated filtering logic"
```

---

### Task 10: Document Known Limitations (B9/B10 — P2)

**Files:**
- Modify: `docs/superpowers/specs/2026-04-09-hierarchical-permission-system-design.md`

- [ ] **Step 1: Append Known Limitations section**

```markdown
## Known Limitations

### None-Priority Rule
When a user has multiple resource permissions on the same resource (direct + via groups), any `none` role causes immediate deny, even if a higher role (e.g. `writer`) exists via another path. To restore access, the `none` record must be explicitly removed from the `resource_permissions` table — adding a higher role via another group does not override it. This is by design (fail-closed security model). See `ResourceAbilityFactory.findEffectiveRole()`.

### Real-Time Permission Revocation (Hocuspocus)
Hocuspocus checks permissions at WebSocket connection time only (`AuthenticationExtension.onAuthenticate`). If a user's permission is downgraded to NONE while they have an active editing session, they are NOT disconnected. Changes made during this window are persisted via Yjs. Users must refresh to see updated permissions. Implementing real-time revocation would require periodic re-auth or a permission-change event → disconnect mechanism.

### Wiki Directory NONE Semantics
In the public wiki, directory-level group NONE hides ALL pages in that directory, even if individual pages have explicit non-NONE group overrides. This differs from the internal API where page-level overrides take precedence over directory (ResourceAbilityFactory.resolveRole Step 1). This is intentional — the public wiki treats directories as atomic visibility units for anonymous access.

### Topic Visibility
Topics have no independent permission control. A topic is visible whenever its parent directory is visible. To hide content within a visible directory, set NONE on individual pages, not topics.

### WebSocket Sidebar Sync
When resource permissions change, no real-time WebSocket event is emitted to update other users' sidebars. Users must refresh to see permission changes reflected in their navigation. The `ResourcePermissionController` does not emit socket events after CRUD operations.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-09-hierarchical-permission-system-design.md
git commit -m "docs: add known limitations for none-priority, Hocuspocus, wiki semantics"
```

---

## Summary

| Task | Issue | Priority | Type | Status |
|------|-------|----------|------|--------|
| 1 | Share link bypasses resource permissions | P0 | Security | Ready |
| 2 | Export doesn't check child page permissions | P0 | Security | Ready |
| 3 | Member deletion doesn't clean resource_permissions | P0 | Security | Ready |
| 4 | Authenticated AI search doesn't filter | P1 | Security | Ready |
| 5 | Breadcrumbs leak hidden ancestor titles | P1 | Security | Ready |
| 6 | Wiki sidebar orphan children handling | P1 | UX | Ready |
| 7 | Child page URL access with hidden parent | — | SKIPPED | By design |
| 8 | Directory NONE + page override semantics | P2 | Docs | Ready |
| 9 | Extract ResourceVisibilityService | P3 | Refactor | Ready (scope: recent pages + search only) |
| 10 | Document known limitations | P2 | Docs | Ready |
