import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ResourcePermissionModule } from '../resource-permission/resource-permission.module';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
  imports: [ResourcePermissionModule],
})
export class SearchModule {}
