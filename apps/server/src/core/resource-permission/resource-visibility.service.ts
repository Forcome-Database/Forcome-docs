import { Injectable } from '@nestjs/common';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';

export interface VisibleItem {
  id: string;
  spaceId?: string | null;
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
   * NOTE: Does NOT handle sidebar container-directory-promotion logic.
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
      if (!item.spaceId) return true;

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
