import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('spaces')
    .addColumn('position', 'varchar(20)')
    .execute();

  // Backfill existing spaces with sequential positions using fractional-indexing style.
  // Each workspace's spaces get ordered by created_at and assigned a0, a1, a2, ...
  await sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC) - 1 AS rn
      FROM spaces
      WHERE deleted_at IS NULL
    )
    UPDATE spaces
    SET position = 'a' || ranked.rn
    FROM ranked
    WHERE spaces.id = ranked.id
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('spaces')
    .dropColumn('position')
    .execute();
}
