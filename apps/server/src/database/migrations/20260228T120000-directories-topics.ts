import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. directories table
  await db.schema
    .createTable('directories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'varchar')
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar')
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('uq_directory_slug_space', ['slug', 'space_id'])
    .execute();

  await db.schema
    .createIndex('idx_directories_space')
    .on('directories')
    .columns(['space_id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  // 2. topics table
  await db.schema
    .createTable('topics')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'varchar')
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar')
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('uq_topic_slug_directory', ['slug', 'directory_id'])
    .execute();

  await db.schema
    .createIndex('idx_topics_directory')
    .on('topics')
    .columns(['directory_id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  await db.schema
    .createIndex('idx_topics_space')
    .on('topics')
    .columns(['space_id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  // 3. Add columns to pages table
  await db.schema
    .alterTable('pages')
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('pages')
    .addColumn('topic_id', 'uuid', (col) =>
      col.references('topics.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_pages_directory_id')
    .on('pages')
    .columns(['directory_id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  await db.schema
    .createIndex('idx_pages_topic_id')
    .on('pages')
    .columns(['topic_id'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  // 4. DB-level consistency triggers
  await sql`
    CREATE OR REPLACE FUNCTION check_topic_space_consistency()
    RETURNS TRIGGER AS $$
    DECLARE dir_space_id UUID;
    BEGIN
      SELECT space_id INTO dir_space_id FROM directories WHERE id = NEW.directory_id;
      IF dir_space_id IS DISTINCT FROM NEW.space_id THEN
        RAISE EXCEPTION 'topic.space_id must match directory.space_id';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_topic_space_consistency
    BEFORE INSERT OR UPDATE ON topics
    FOR EACH ROW EXECUTE FUNCTION check_topic_space_consistency();
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION check_page_category_consistency()
    RETURNS TRIGGER AS $$
    DECLARE topic_dir_id UUID;
    BEGIN
      IF NEW.topic_id IS NOT NULL AND NEW.directory_id IS NOT NULL THEN
        SELECT directory_id INTO topic_dir_id FROM topics WHERE id = NEW.topic_id;
        IF topic_dir_id IS DISTINCT FROM NEW.directory_id THEN
          RAISE EXCEPTION 'page.directory_id must match topic.directory_id';
        END IF;
      END IF;
      IF NEW.topic_id IS NOT NULL AND NEW.directory_id IS NULL THEN
        SELECT directory_id INTO NEW.directory_id FROM topics WHERE id = NEW.topic_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_page_category_consistency
    BEFORE INSERT OR UPDATE ON pages
    FOR EACH ROW EXECUTE FUNCTION check_page_category_consistency();
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_page_category_consistency ON pages`.execute(db);
  await sql`DROP FUNCTION IF EXISTS check_page_category_consistency()`.execute(db);
  await sql`DROP TRIGGER IF EXISTS trg_topic_space_consistency ON topics`.execute(db);
  await sql`DROP FUNCTION IF EXISTS check_topic_space_consistency()`.execute(db);
  await db.schema.alterTable('pages').dropColumn('topic_id').execute();
  await db.schema.alterTable('pages').dropColumn('directory_id').execute();
  await db.schema.dropTable('topics').ifExists().execute();
  await db.schema.dropTable('directories').ifExists().execute();
}
