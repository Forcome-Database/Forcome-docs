import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 先检查 pg_jieba 扩展是否在系统中可用（不触发事务中止）
  const available = await sql<{ cnt: string }>`
    SELECT COUNT(*)::text as cnt FROM pg_available_extensions WHERE name = 'pg_jieba'
  `.execute(db);

  if (!available.rows.length || available.rows[0].cnt === '0') {
    // pg_jieba 未安装，跳过中文分词升级
    return;
  }

  await sql`CREATE EXTENSION IF NOT EXISTS pg_jieba`.execute(db);

  // 双语 tsvector trigger：english + jiebacfg
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger() RETURNS trigger AS $$
    begin
        new.tsv :=
          setweight(to_tsvector('english', f_unaccent(coalesce(new.title, ''))), 'A') ||
          setweight(to_tsvector('jiebacfg', coalesce(new.title, '')), 'A') ||
          setweight(to_tsvector('english', f_unaccent(substring(coalesce(new.text_content, ''), 1, 1000000))), 'B') ||
          setweight(to_tsvector('jiebacfg', substring(coalesce(new.text_content, ''), 1, 1000000)), 'B');
        return new;
    end;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 恢复纯 english tsvector
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger() RETURNS trigger AS $$
    begin
        new.tsv :=
          setweight(to_tsvector('english', f_unaccent(coalesce(new.title, ''))), 'A') ||
          setweight(to_tsvector('english', f_unaccent(substring(coalesce(new.text_content, ''), 1, 1000000))), 'B');
        return new;
    end;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}
