import { Module } from '@nestjs/common';
import { PublicWikiController } from './public-wiki.controller';
import { PublicWikiService } from './public-wiki.service';
import { WikiConversationStore } from './wiki-conversation.store';
import { TokenModule } from '../auth/token.module';
import { SearchModule } from '../search/search.module';
import { ResourcePermissionModule } from '../resource-permission/resource-permission.module';

@Module({
  imports: [TokenModule, SearchModule, ResourcePermissionModule],
  controllers: [PublicWikiController],
  providers: [PublicWikiService, WikiConversationStore],
})
export class PublicWikiModule {}
