import { Module } from '@nestjs/common';
import { ResourcePermissionController } from './resource-permission.controller';
import { ResourcePermissionService } from './resource-permission.service';

@Module({
  controllers: [ResourcePermissionController],
  providers: [ResourcePermissionService],
  exports: [ResourcePermissionService],
})
export class ResourcePermissionModule {}
