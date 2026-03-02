import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';

@Injectable()
export class AuthProviderRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByType(type: string, workspaceId: string) {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('type', '=', type)
      .where('workspaceId', '=', workspaceId)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findById(id: string, workspaceId: string) {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async upsertDingtalkProvider(
    workspaceId: string,
    settings: Record<string, any>,
  ) {
    const existing = await this.findByType('dingtalk', workspaceId);
    if (existing) {
      return this.db
        .updateTable('authProviders')
        .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return this.db
      .insertInto('authProviders')
      .values({
        name: '钉钉登录',
        type: 'dingtalk',
        isEnabled: true,
        allowSignup: true,
        workspaceId,
        settings: JSON.stringify(settings),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
