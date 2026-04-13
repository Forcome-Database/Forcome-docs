import { Injectable, NotFoundException } from '@nestjs/common';
import { MongoAbility } from '@casl/ability';
import { User } from '@docmost/db/types/entity.types';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { ISpaceAbility } from '../interfaces/space-ability.type';
import {
  buildSpaceAdminAbility,
  buildSpaceWriterAbility,
  buildSpaceReaderAbility,
  buildNoneAbility,
} from './space-ability.factory';

export interface ResourceContext {
  directoryId?: string;
  spaceId: string;
}

@Injectable()
export class ResourceAbilityFactory {
  constructor(
    private readonly resourcePermRepo: ResourcePermissionRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async createForUser(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    context: ResourceContext,
  ): Promise<MongoAbility<ISpaceAbility>> {
    const role = await this.resolveRole(user, resourceType, resourceId, context);
    return this.buildAbilityByRole(role);
  }

  async resolveRole(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    context: ResourceContext,
  ): Promise<string> {
    // Step 1: Resource self override
    const selfRole = await this.findEffectiveRole(
      user,
      resourceType,
      resourceId,
    );
    // 'none' is an explicit deny — always wins immediately
    if (selfRole === 'none') return 'none';

    // Step 2: Page's directory override (skip if no directoryId)
    let dirRole: string | null = null;
    if (resourceType === 'page' && context.directoryId) {
      dirRole = await this.findEffectiveRole(
        user,
        'directory',
        context.directoryId,
      );
      if (dirRole === 'none') return 'none';
    }

    // Step 3: Space members role (always resolved — a group-level resource
    // override must not silently downgrade a user who holds a higher space role,
    // e.g. adding "Everyone reader" on a directory should not strip admin access)
    const spaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      context.spaceId,
    );
    const spaceRole = findHighestUserSpaceRole(spaceRoles);
    if (!spaceRole) throw new NotFoundException('Permissions not found');

    // Return the highest among resource override, directory override, and space role
    const candidates = [selfRole, dirRole, spaceRole]
      .filter(Boolean)
      .map((r) => ({ role: r }));
    return this.findHighestRole(candidates);
  }

  private async findEffectiveRole(
    user: User,
    resourceType: string,
    resourceId: string,
  ): Promise<string | null> {
    const roles = await this.resourcePermRepo.getUserResourceRoles(
      user.id,
      resourceType,
      resourceId,
    );
    if (!roles.length) return null;
    // None-priority: any 'none' record → immediate deny
    if (roles.some((r) => r.role === 'none')) return 'none';
    return this.findHighestRole(roles);
  }

  private findHighestRole(roles: { role: string }[]): string {
    const order: Record<string, number> = { admin: 3, writer: 2, reader: 1 };
    let highest = roles[0].role;
    for (const r of roles) {
      if ((order[r.role] ?? 0) > (order[highest] ?? 0)) {
        highest = r.role;
      }
    }
    return highest;
  }

  buildAbilityByRole(role: string): MongoAbility<ISpaceAbility> {
    switch (role) {
      case 'admin':
        return buildSpaceAdminAbility();
      case 'writer':
        return buildSpaceWriterAbility();
      case 'reader':
        return buildSpaceReaderAbility();
      case 'none':
        return buildNoneAbility();
      default:
        throw new NotFoundException(`Unknown role: ${role}`);
    }
  }
}
