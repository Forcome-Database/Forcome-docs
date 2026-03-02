import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';

@Injectable()
export class AuthAccountRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByProviderUserId(
    providerUserId: string,
    authProviderId: string,
    workspaceId: string,
  ) {
    return this.db
      .selectFrom('authAccounts')
      .selectAll()
      .where('providerUserId', '=', providerUserId)
      .where('authProviderId', '=', authProviderId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findByUserId(userId: string, authProviderId: string) {
    return this.db
      .selectFrom('authAccounts')
      .selectAll()
      .where('userId', '=', userId)
      .where('authProviderId', '=', authProviderId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async insertAuthAccount(
    data: {
      userId: string;
      providerUserId: string;
      authProviderId: string;
      workspaceId: string;
    },
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('authAccounts')
      .values({
        userId: data.userId,
        providerUserId: data.providerUserId,
        authProviderId: data.authProviderId,
        workspaceId: data.workspaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
