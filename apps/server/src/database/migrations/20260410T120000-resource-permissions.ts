import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('resource_permissions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('resource_type', 'varchar(20)', (col) => col.notNull())
    .addColumn('resource_id', 'uuid', (col) => col.notNull())
    .addColumn('principal_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('principal_id', 'uuid', (col) => col.notNull())
    .addColumn('role', 'varchar(20)', (col) => col.notNull())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_by', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('uq_resource_principal', [
      'resource_type',
      'resource_id',
      'principal_type',
      'principal_id',
    ])
    .addCheckConstraint(
      'chk_principal_type',
      sql`principal_type IN ('user', 'group')`,
    )
    .addCheckConstraint(
      'chk_resource_type',
      sql`resource_type IN ('directory', 'page')`,
    )
    .addCheckConstraint(
      'chk_role',
      sql`role IN ('admin', 'writer', 'reader', 'none')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_rp_principal')
    .on('resource_permissions')
    .columns(['principal_type', 'principal_id', 'workspace_id'])
    .execute();

  await db.schema
    .createIndex('idx_rp_resource')
    .on('resource_permissions')
    .columns(['resource_type', 'resource_id'])
    .execute();

  await db.schema
    .createIndex('idx_rp_workspace')
    .on('resource_permissions')
    .columns(['workspace_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('resource_permissions').ifExists().execute();
}
