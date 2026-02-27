import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import {
  AiPromptTemplate,
  InsertableAiPromptTemplate,
  UpdatableAiPromptTemplate,
} from '@docmost/db/types/entity.types';
import { dbOrTx } from '@docmost/db/utils';

@Injectable()
export class AiTemplateRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<AiPromptTemplate | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('aiPromptTemplates')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findByKey(
    workspaceId: string,
    key: string,
    scope: string,
    creatorId?: string,
    trx?: KyselyTransaction,
  ): Promise<AiPromptTemplate | undefined> {
    const db = dbOrTx(this.db, trx);
    let query = db
      .selectFrom('aiPromptTemplates')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('key', '=', key)
      .where('scope', '=', scope)
      .where('deletedAt', 'is', null);

    if (scope === 'user' && creatorId) {
      query = query.where('creatorId', '=', creatorId);
    }

    return query.executeTakeFirst();
  }

  async findWorkspaceTemplates(
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<AiPromptTemplate[]> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('aiPromptTemplates')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('scope', '=', 'workspace')
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async findUserTemplates(
    workspaceId: string,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<AiPromptTemplate[]> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('aiPromptTemplates')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('scope', '=', 'user')
      .where('creatorId', '=', userId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async countWorkspaceTemplates(
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const db = dbOrTx(this.db, trx);
    const result = await db
      .selectFrom('aiPromptTemplates')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('scope', '=', 'workspace')
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async insertTemplate(
    data: InsertableAiPromptTemplate,
    trx?: KyselyTransaction,
  ): Promise<AiPromptTemplate> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('aiPromptTemplates')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertMany(
    data: InsertableAiPromptTemplate[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (data.length === 0) return;
    const db = dbOrTx(this.db, trx);
    await db.insertInto('aiPromptTemplates').values(data).execute();
  }

  async updateTemplate(
    data: UpdatableAiPromptTemplate,
    id: string,
    trx?: KyselyTransaction,
  ): Promise<AiPromptTemplate> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('aiPromptTemplates')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('aiPromptTemplates')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async softDeleteByKey(
    workspaceId: string,
    key: string,
    scope: string,
    creatorId?: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    let query = db
      .updateTable('aiPromptTemplates')
      .set({ deletedAt: new Date() })
      .where('workspaceId', '=', workspaceId)
      .where('key', '=', key)
      .where('scope', '=', scope)
      .where('deletedAt', 'is', null);

    if (scope === 'user' && creatorId) {
      query = query.where('creatorId', '=', creatorId);
    }

    await query.execute();
  }
}
