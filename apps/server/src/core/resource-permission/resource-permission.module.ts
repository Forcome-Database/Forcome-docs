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
