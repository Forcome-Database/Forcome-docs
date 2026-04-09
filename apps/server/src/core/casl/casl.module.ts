import { Global, Module } from '@nestjs/common';
import SpaceAbilityFactory from './abilities/space-ability.factory';
import WorkspaceAbilityFactory from './abilities/workspace-ability.factory';
import { ResourceAbilityFactory } from './abilities/resource-ability.factory';

@Global()
@Module({
  providers: [WorkspaceAbilityFactory, SpaceAbilityFactory, ResourceAbilityFactory],
  exports: [WorkspaceAbilityFactory, SpaceAbilityFactory, ResourceAbilityFactory],
})
export class CaslModule {}
