import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE ai_prompt_templates (
      id           UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
      key          VARCHAR NOT NULL,
      name         VARCHAR NOT NULL,
      description  TEXT,
      icon         VARCHAR,
      prompt       TEXT NOT NULL,
      scope        VARCHAR NOT NULL CHECK (scope IN ('workspace', 'user')),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      creator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_default   BOOLEAN DEFAULT false,
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now(),
      deleted_at   TIMESTAMPTZ
    )
  `.execute(db);

  // Unique workspace-level template per key
  await sql`
    CREATE UNIQUE INDEX uq_ai_template_workspace_key
      ON ai_prompt_templates (workspace_id, key)
      WHERE scope = 'workspace' AND deleted_at IS NULL
  `.execute(db);

  // Unique user-level template per key per user
  await sql`
    CREATE UNIQUE INDEX uq_ai_template_user_key
      ON ai_prompt_templates (workspace_id, creator_id, key)
      WHERE scope = 'user' AND deleted_at IS NULL
  `.execute(db);

  // General lookup index
  await sql`
    CREATE INDEX idx_ai_template_workspace_scope
      ON ai_prompt_templates (workspace_id, scope)
      WHERE deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS ai_prompt_templates CASCADE`.execute(db);
}
