# Wiki Permission Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Wiki frontend respect Docmost's existing permission system — same user sees same content in both interfaces.

**Architecture:** Wiki requests carry the user's existing JWT cookie to backend. Backend `public-wiki` endpoints extract user identity via JwtAuthGuard, then use `SpaceMemberRepo` + `ResourceAbilityFactory` + `ResourcePermissionRepo` (the same permission engine as internal API) to determine what the user can see. The independent `visibility` field / `findHiddenForPublic` / env variable system is removed from wiki filtering.

**Tech Stack:** NestJS 11 + Fastify + Kysely (PostgreSQL) + CASL; Vue 3 + VitePress (wiki frontend)

**Design spec:** `docs/superpowers/specs/2026-04-10-wiki-permission-unification-design.md`

---

## File Map

| File | Responsibility | Tasks |
|------|---------------|-------|
| `wiki/docs/.vitepress/theme/services/docmost.ts` | Wiki API client — add credentials + 401 handling | 1 |
| `apps/server/src/core/public-wiki/public-wiki.controller.ts` | Route handler — remove @Public, inject user | 2 |
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | Core wiki service — rewrite all methods to use user permissions | 2 |
| `apps/server/src/core/public-wiki/public-wiki.module.ts` | Module — add ResourcePermissionModule import | 2 |
| `apps/client/src/features/directory/` (6 files) | Revert directory.visibility feature | 3 |
| `apps/server/src/core/directory/` (2 files) | Revert directory.visibility DTO + service | 3 |
| `apps/server/src/database/types/db.d.ts` | Revert visibility in Directories interface | 3 |
| `apps/server/src/database/migrations/20260228T120000-directories-topics.ts` | Revert visibility column | 3 |
| `.env.prod` | Add COOKIE_DOMAIN | 4 |

**Key design decisions from review:**
- `user.workspaceId` is `string | null` — all methods use `workspaceId: string` from controller's `@AuthWorkspace()` instead
- `ResourceVisibilityService` injected via constructor, not `moduleRef.get()`
- Tasks 2 (controller + service rewrite) is ONE atomic commit — no intermediate broken state
- `getDirectorySidebarTree` keeps existing BFS/tree-building, only replaces the hidden set data source

---

### Task 1: Wiki Frontend — Carry Credentials + Handle 401

**Files:**
- Modify: `wiki/docs/.vitepress/theme/services/docmost.ts`

- [ ] **Step 1: Add `credentials: 'include'` to `post()` method**

```typescript
private async post<T>(endpoint: string, body: Record<string, any> = {}): Promise<T> {
  const response = await fetch(`${this.config.baseUrl}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
```

- [ ] **Step 2: Add 401 handling before the existing `!response.ok` check**

```typescript
  // JWT expired or missing — redirect to login
  if (response.status === 401) {
    if (typeof document !== 'undefined') {
      document.cookie = 'authMarker=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname)
    }
    throw AppError.api('未登录或登录已过期')
  }

  if (!response.ok) {
    // ...existing error handling
```

- [ ] **Step 3: Add `credentials: 'include'` + 401 handling to `aiAnswers()` SSE fetch**

In the `aiAnswers()` method, add `credentials: 'include'` to the fetch call, and add the same 401 check after the fetch response check.

- [ ] **Step 4: Commit**

```bash
git add wiki/docs/.vitepress/theme/services/docmost.ts
git commit -m "feat(wiki): carry auth credentials and handle 401 in wiki API client"
```

---

### Task 2: Backend — Authenticate Endpoints + Rewrite Service (Atomic)

This is the core task. Controller and ALL service methods are changed together as one atomic commit to avoid intermediate broken states.

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.controller.ts`
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`
- Modify: `apps/server/src/core/public-wiki/public-wiki.module.ts`

#### Part A: Module + Constructor

- [ ] **Step 1: Update module imports**

```typescript
// public-wiki.module.ts
import { ResourcePermissionModule } from '../resource-permission/resource-permission.module';

@Module({
  imports: [TokenModule, SearchModule, ResourcePermissionModule],
  controllers: [PublicWikiController],
  providers: [PublicWikiService, WikiConversationStore],
})
```

- [ ] **Step 2: Add new dependencies to service constructor**

Add imports:

```typescript
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ResourceAbilityFactory } from '../casl/abilities/resource-ability.factory';
import { ResourceVisibilityService } from '../resource-permission/resource-visibility.service';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { User } from '@docmost/db/types/entity.types';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
```

Add to constructor:

```typescript
private readonly spaceMemberRepo: SpaceMemberRepo,
private readonly resourceAbility: ResourceAbilityFactory,
private readonly resourceVisibility: ResourceVisibilityService,
```

#### Part B: Controller — Remove @Public, Inject User

- [ ] **Step 3: Update controller**

Add imports:

```typescript
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
```

Remove `@Public()` from ALL endpoints except `settings`. Add `@AuthUser() user: User` to each non-settings endpoint. Update method calls to pass `user` and use new method names:

- `getPublicSpaces(workspace.id)` → `getSpaces(user, workspace.id)`
- `getDirectories(dto.spaceSlug, workspace.id)` → `getDirectories(user, dto.spaceSlug, workspace.id)`
- `getSidebarTree(dto.spaceSlug, workspace.id, dto.directoryId)` → `getSidebarTree(user, dto.spaceSlug, workspace.id, dto.directoryId)`
- `getPage({...}, workspace.id)` → `getPage(user, {...}, workspace.id)`
- `searchPublicPages(dto.query, workspace.id, ...)` → `searchPages(user, dto.query, workspace.id, ...)`
- `aiAnswers({...requesterKey...})` → `aiAnswers({...userId: user.id...})`

For the `ai/answers` SSE endpoint, change `requesterKey` to `userId: user.id` in the input object.

#### Part C: Shared Helpers

- [ ] **Step 4: Add `resolveUserSpaceAccess` helper**

NOTE: Uses `workspaceId: string` parameter, NOT `user.workspaceId` (which is `string | null`).

```typescript
private async resolveUserSpaceAccess(
  user: User,
  spaceId: string,
  workspaceId: string,
): Promise<{ spaceRole: string; overrides: any[] } | null> {
  const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(user.id, spaceId);
  let spaceRole = findHighestUserSpaceRole(userSpaceRoles);

  if (!spaceRole) {
    // Not a member — check if space is open (discoverable)
    const space = await this.db
      .selectFrom('spaces')
      .select('visibility')
      .where('id', '=', spaceId)
      .executeTakeFirst();
    if (!space || space.visibility !== 'open') return null;
    spaceRole = 'reader';
  }

  const overrides = await this.resourcePermissionRepo.getUserOverridesInSpace(
    user.id, spaceId, workspaceId,
  );

  return { spaceRole, overrides };
}
```

- [ ] **Step 5: Add `buildHiddenPageIds` helper**

```typescript
private buildHiddenPageIds(
  pages: { id: string; directoryId?: string | null }[],
  access: { spaceRole: string; overrides: any[] },
): Set<string> {
  const { spaceRole, overrides } = access;

  if (spaceRole === 'none') {
    const allowedPageIds = new Set<string>();
    const allowedDirIds = new Set<string>();
    for (const o of overrides) {
      if (o.role === 'none') continue;
      if (o.resourceType === 'page') allowedPageIds.add(o.resourceId);
      if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
    }
    const hidden = new Set<string>();
    for (const p of pages) {
      if (!allowedPageIds.has(p.id) && !(p.directoryId && allowedDirIds.has(p.directoryId))) {
        hidden.add(p.id);
      }
    }
    return hidden;
  }

  const deniedPageIds = new Set<string>();
  const deniedDirIds = new Set<string>();
  for (const o of overrides) {
    if (o.role !== 'none') continue;
    if (o.resourceType === 'page') deniedPageIds.add(o.resourceId);
    if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
  }
  const hidden = new Set<string>();
  for (const p of pages) {
    if (deniedPageIds.has(p.id) || (p.directoryId && deniedDirIds.has(p.directoryId))) {
      hidden.add(p.id);
    }
  }
  return hidden;
}
```

#### Part D: Rewrite getSpaces

- [ ] **Step 6: Replace `getPublicSpaces` with `getSpaces`**

Delete `getPublicSpaces`, `isSpacePublic`, `resolvePublicSpaces`, `getPublicSpaceSlugs`. Replace with:

```typescript
async getSpaces(user: User, workspaceId: string) {
  const spaces = await this.db
    .selectFrom('spaces')
    .select(['id', 'name', 'slug', 'description'])
    .where('workspaceId', '=', workspaceId)
    .where('deletedAt', 'is', null)
    .where((eb) =>
      eb.or([
        eb('id', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(user.id)),
        eb('visibility', '=', 'open'),
      ]),
    )
    .execute();

  const uniqueSpaces = [...new Map(spaces.map(s => [s.id, s])).values()];

  const spaceIds = uniqueSpaces.map((s) => s.id);
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

  const dirCountMap = new Map(dirCounts.map((d) => [d.spaceId, Number(d.count)]));
  const items = uniqueSpaces.map((s) => ({
    ...s,
    hasDirectories: (dirCountMap.get(s.id) || 0) > 0,
  }));

  return { items };
}
```

#### Part E: Rewrite getDirectories

- [ ] **Step 7: Replace `getDirectories`**

```typescript
async getDirectories(user: User, spaceSlug: string, workspaceId: string) {
  const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
  if (!space) throw new NotFoundException('Space not found');

  const access = await this.resolveUserSpaceAccess(user, space.id, workspaceId);
  if (!access) throw new NotFoundException('Space not found');

  const directories = await this.db
    .selectFrom('directories')
    .select(['id', 'name', 'slug', 'icon', 'position'])
    .where('spaceId', '=', space.id)
    .where('deletedAt', 'is', null)
    .orderBy('position', 'asc')
    .execute();

  const { spaceRole, overrides } = access;

  if (spaceRole === 'none') {
    const allowedDirIds = new Set<string>();
    for (const o of overrides) {
      if (o.role === 'none') continue;
      if (o.resourceType === 'directory') allowedDirIds.add(o.resourceId);
      if (o.resourceType === 'page' && o.directoryId) allowedDirIds.add(o.directoryId);
    }
    return { items: directories.filter((d) => allowedDirIds.has(d.id)) };
  }

  const deniedDirIds = new Set<string>();
  for (const o of overrides) {
    if (o.role !== 'none') continue;
    if (o.resourceType === 'directory') deniedDirIds.add(o.resourceId);
  }
  return {
    items: deniedDirIds.size > 0
      ? directories.filter((d) => !deniedDirIds.has(d.id))
      : directories,
  };
}
```

#### Part F: Rewrite getSidebarTree + getDirectorySidebarTree

- [ ] **Step 8: Rewrite `getSidebarTree`**

Change signature to `(user: User, spaceSlug: string, workspaceId: string, directoryId?: string)`.

Replace the `findHiddenForPublic` block with `resolveUserSpaceAccess` + `buildHiddenPageIds`. Keep the existing orphan re-parenting and `buildTree` logic unchanged.

Specific replacement in the non-directory path:
- DELETE: lines calling `this.resourcePermissionRepo.findHiddenForPublic(...)` and the `hiddenPageIds` Set construction from those results
- REPLACE WITH: `const hiddenPageIds = this.buildHiddenPageIds(pages, access);`
- KEEP: the orphan re-parenting `pageMap` + `for` loop and `this.buildTree(visiblePages, null)`

Pass `(user, space, directoryId, access)` to `getDirectorySidebarTree` instead of `(space, directoryId, workspaceId)`.

- [ ] **Step 9: Rewrite `getDirectorySidebarTree`**

Change signature to `(user: User, space, directoryId: string, access)`.

Three specific changes:

1. **Directory access check**: Replace `directory.visibility !== 'open'` with user permission check:
   - Remove `'visibility'` from the directory SELECT
   - After fetching directory, check using `access.spaceRole` + `access.overrides` (same dual-mode logic as `getDirectories`)
   - If denied → throw NotFoundException

2. **Hidden page set**: Replace the `findHiddenForPublic` call + `hiddenPageIds`/`hiddenDirectoryIds` construction with:
   ```typescript
   const hiddenPageIds = this.buildHiddenPageIds(allPages, access);
   ```

3. **Hidden directory check for BFS**: The existing code checks `hiddenDirectoryIds.has(directoryId)` — this was already handled by the directory access check above, so this line can be removed.

Keep ALL existing code for: topic query, allPages query, BFS pass-through expansion, orphan re-parenting, topic/page node building, position sorting.

#### Part G: Rewrite getPage

- [ ] **Step 10: Rewrite `getPage`**

Change signature to `(user: User, opts, workspaceId: string)`.

Replace `isSpacePublic` + `findHiddenForPublic` with `ResourceAbilityFactory`:

```typescript
const ability = await this.resourceAbility.createForUser(
  user, 'page', page.id,
  { directoryId: page.directoryId ?? undefined, spaceId: page.spaceId },
);
if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
  throw new NotFoundException('Page not found');
}
```

Keep `updatePublicAttachments` and content rendering unchanged.

Breadcrumbs: filter using user overrides:

```typescript
const breadcrumbs = await this.getPageBreadcrumbs(page.id);
const access = await this.resolveUserSpaceAccess(user, page.spaceId, workspaceId);
let filteredBreadcrumbs = breadcrumbs;
if (access) {
  const deniedPageIds = new Set<string>();
  for (const o of access.overrides) {
    if (o.role === 'none' && o.resourceType === 'page') deniedPageIds.add(o.resourceId);
  }
  if (deniedPageIds.size > 0) {
    filteredBreadcrumbs = breadcrumbs.filter((crumb) => !deniedPageIds.has(crumb.id));
  }
}
```

#### Part H: Rewrite searchPages

- [ ] **Step 11: Replace `searchPublicPages` with `searchPages`**

```typescript
async searchPages(
  user: User, query: string, workspaceId: string,
  spaceSlug?: string, limit?: number,
) {
  if (query.length < 1) return { items: [] };

  // Get user's accessible space IDs + slugs
  const memberSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
  const openSpaces = await this.db
    .selectFrom('spaces')
    .select(['id', 'slug'])
    .where('workspaceId', '=', workspaceId)
    .where('visibility', '=', 'open')
    .where('deletedAt', 'is', null)
    .execute();
  const allAccessibleIds = [...new Set([...memberSpaceIds, ...openSpaces.map(s => s.id)])];
  if (allAccessibleIds.length === 0) return { items: [] };

  // Build slug map for all accessible spaces
  const slugRows = await this.db
    .selectFrom('spaces')
    .select(['id', 'slug'])
    .where('id', 'in', allAccessibleIds)
    .execute();
  const slugMap = new Map(slugRows.map(s => [s.id, s.slug]));

  let searchSpaceIds = allAccessibleIds;
  if (spaceSlug) {
    const space = await this.spaceRepo.findBySlug(spaceSlug, workspaceId);
    if (!space || !allAccessibleIds.includes(space.id)) return { items: [] };
    searchSpaceIds = [space.id];
  }

  const allResults = [];
  for (const spaceId of searchSpaceIds) {
    const result = await this.searchService.searchPage(
      { query, spaceId, limit: limit || 25, offset: 0 },
      { workspaceId },
    );
    for (const item of result.items) {
      allResults.push({
        ...item,
        spaceSlug: item.space?.slug || slugMap.get(spaceId) || '',
      });
    }
  }

  // Filter by user permissions
  const filteredResults = await this.resourceVisibility.filterByPermissions(
    allResults, user.id, workspaceId,
  );

  filteredResults.sort((a, b) => (b as any).rank - (a as any).rank);
  return { items: filteredResults.slice(0, limit || 25) };
}
```

#### Part I: Rewrite aiAnswers

- [ ] **Step 12: Update AI answers to use userId**

Change `PublicWikiAiAnswerInput` interface: `requesterKey` → `userId: string`.

In `aiAnswers()`:
- Rate limit bucket: `ratelimit:public-wiki-ai:${workspaceId}:${input.userId}`
- Conversation store: `this.conversationStore.load(sessionId, input.userId)` / `.save(sessionId, ..., input.userId)`
- Build user-scoped retrieval scope (same pattern as internal `/ai/answers`):

```typescript
const excludedPageIds: string[] = [];
const excludedDirectoryIds: string[] = [];
const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(input.userId);
await Promise.all(
  userSpaceIds.map(async (spaceId) => {
    const roles = await this.spaceMemberRepo.getUserSpaceRoles(input.userId, spaceId);
    const role = findHighestUserSpaceRole(roles);
    if (!role || role === 'none') return;
    const ov = await this.resourcePermissionRepo.getUserOverridesInSpace(
      input.userId, spaceId, input.workspaceId,
    );
    for (const o of ov) {
      if (o.role !== 'none') continue;
      if (o.resourceType === 'page') excludedPageIds.push(o.resourceId);
      if (o.resourceType === 'directory') excludedDirectoryIds.push(o.resourceId);
    }
  }),
);
const scope = {
  allowedSpaceIds: userSpaceIds,
  ...(excludedPageIds.length > 0 && { excludedPageIds }),
  ...(excludedDirectoryIds.length > 0 && { excludedDirectoryIds }),
  currentPageId: page?.id,
};
```

#### Part J: Delete Dead Code

- [ ] **Step 13: Delete these methods from public-wiki.service.ts**

- `isSpacePublic()` 
- `getPublicSpaceSlugs()`
- `resolvePublicSpaces()`
- `resolvePublicPageScope()`

Remove the `getWikiPublicSpaceSlugs` call from EnvironmentService import (keep the method in environment.service.ts — check if anything else uses it first with grep).

#### Part K: Compile + Commit

- [ ] **Step 14: Verify TypeScript compiles**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | tail -5
```

Must be zero errors before committing.

- [ ] **Step 15: Commit as atomic unit**

```bash
git add apps/server/src/core/public-wiki/
git commit -m "feat(wiki): unify wiki permissions with Docmost auth — user-based filtering for all endpoints"
```

---

### Task 3: Revert directory.visibility Feature

The `directory.visibility` feature (commit `9d21273`) is no longer needed since wiki visibility is now controlled by `resource_permissions` + user auth.

**Files:** 8 files across frontend and backend (NOT including `public-wiki.service.ts` — already rewritten in Task 2).

- [ ] **Step 1: Revert frontend files**

- `apps/client/src/features/directory/components/directory-list.tsx`: Remove Wiki Switch column, `useUpdateDirectoryMutation` import, `Switch` import
- `apps/client/src/features/directory/types/directory.types.ts`: Remove `visibility?: string`
- `apps/client/src/features/directory/services/directory-service.ts`: Remove `visibility?: string` from update data
- `apps/client/src/features/directory/queries/directory-query.ts`: Remove `visibility?: string` from mutation type

- [ ] **Step 2: Revert backend files**

- `apps/server/src/core/directory/dto/directory.dto.ts`: Remove `@IsOptional() @IsString() visibility?: string`
- `apps/server/src/core/directory/directory.service.ts`: Remove `if (dto.visibility !== undefined) updateData.visibility = dto.visibility;`
- `apps/server/src/database/types/db.d.ts`: Remove `visibility: Generated<string>` from Directories interface
- `apps/server/src/database/migrations/20260228T120000-directories-topics.ts`: Remove `.addColumn('visibility', 'varchar', ...)` 

- [ ] **Step 3: Verify both compile**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | tail -5
cd apps/client && npx tsc --noEmit 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "revert: remove directory.visibility feature (replaced by user-based wiki auth)"
```

---

### Task 4: Environment Config + Final Verification

- [ ] **Step 1: Add COOKIE_DOMAIN to production config**

Add to `.env.prod`:
```
COOKIE_DOMAIN=.forcome.com
```

This enables the `authToken` cookie (set at `docs-admin.forcome.com`) to be sent with wiki requests to `docs-admin.forcome.com` when the wiki page is at `docs.forcome.com`.

- [ ] **Step 2: Full compile check**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | tail -5
cd apps/client && npx tsc --noEmit 2>&1 | tail -5
```

- [ ] **Step 3: Verify commit log**

```bash
git log --oneline -5
```

- [ ] **Step 4: Commit**

```bash
git add .env.prod
git commit -m "config: add COOKIE_DOMAIN for wiki cross-subdomain auth"
```

---

## Summary

| Task | Description | Commit |
|------|------------|--------|
| 1 | Wiki frontend: credentials + 401 handling | Independent |
| 2 | Backend: controller auth + service rewrite (ALL methods) | **Atomic** — one commit |
| 3 | Revert directory.visibility | Independent |
| 4 | Production COOKIE_DOMAIN | Independent |

**Total: 4 commits, ~10 files modified, ~200 lines deleted (old visibility system), ~300 lines rewritten (service methods).**
