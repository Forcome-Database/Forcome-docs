import { Module } from '@nestjs/common';
import { PublicWikiController } from './public-wiki.controller';
import { PublicWikiService } from './public-wiki.service';
import { WikiConversationStore } from './wiki-conversation.store';
import { TokenModule } from '../auth/token.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [TokenModule, SearchModule],
  controllers: [PublicWikiController],
  providers: [PublicWikiService, WikiConversationStore],
})
export class PublicWikiModule {}
