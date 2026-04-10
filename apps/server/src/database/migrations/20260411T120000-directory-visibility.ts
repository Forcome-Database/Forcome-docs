import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('directories')
    .addColumn('visibility', 'varchar', (col) =>
      col.notNull().defaultTo('private'),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('directories')
    .dropColumn('visibility')
    .execute();
}
