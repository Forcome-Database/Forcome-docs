import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  UserMFA,
  InsertableUserMFA,
  UpdatableUserMFA,
} from '@docmost/db/types/entity.types';

@Injectable()
export class MfaRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByUserId(
    userId: string,
    workspaceId: string,
  ): Promise<UserMFA | undefined> {
    return this.db
      .selectFrom('userMfa')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async insert(data: InsertableUserMFA): Promise<UserMFA> {
    return this.db
      .insertInto('userMfa')
      .values(data)
      .returningAll()
      .executeTakeFirst();
  }

  async update(
    userId: string,
    workspaceId: string,
    data: UpdatableUserMFA,
  ): Promise<UserMFA> {
    return this.db
      .updateTable('userMfa')
      .set({ ...data, updatedAt: new Date() })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(userId: string, workspaceId: string): Promise<void> {
    await this.db
      .deleteFrom('userMfa')
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
