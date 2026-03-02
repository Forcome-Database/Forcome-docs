import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 尝试创建 pg_jieba 扩展（如果已安装）
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pg_jieba`.execute(db);
  } catch {
    // pg_jieba 未安装，跳过中文分词升级
    return;
  }

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
