import * as dotenv from 'dotenv';
import { CamelCasePlugin, Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';
import { createYdocFromJson } from '../../common/helpers/prosemirror/utils';
import { envPath, normalizePostgresUrl } from '../../common/helpers';
import { canonicalizeAttachmentImageNodes } from './attachment-image-canonicalizer';

dotenv.config({ path: envPath });

interface PageRow {
  id: string;
  content: any;
}

interface AttachmentRow {
  id: string;
  fileName: string;
}

interface CliOptions {
  pageIds: string[];
  includeAllPages: boolean;
  write: boolean;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  const db = new Kysely<any>({
    dialect: new PostgresJSDialect({
      postgres: postgres(normalizePostgresUrl(databaseUrl)),
    }),
    plugins: [new CamelCasePlugin()],
  });

  try {
    const pages = await loadCandidatePages(db, options);
    let scannedPages = 0;
    let repairedPages = 0;
    let repairedImages = 0;

    for (const page of pages) {
      scannedPages += 1;

      if (!page.content || !JSON.stringify(page.content).includes('/api/files/')) {
        continue;
      }

      const attachments = await db
        .selectFrom('attachments')
        .select(['id', 'fileName'])
        .where('pageId', '=', page.id)
        .where('deletedAt', 'is', null)
        .execute() as AttachmentRow[];

      if (!attachments.length) {
        continue;
      }

      const documentCopy = JSON.parse(JSON.stringify(page.content));
      const result = canonicalizeAttachmentImageNodes(documentCopy, attachments);
      if (!result.changedCount) {
        continue;
      }

      repairedPages += 1;
      repairedImages += result.changedCount;
      console.log(
        `${options.write ? 'REPAIRED' : 'DRY-RUN'} page=${page.id} images=${result.changedCount}`,
      );

      if (!options.write) {
        continue;
      }

      await db
        .updateTable('pages')
        .set({
          content: result.document,
          ydoc: createYdocFromJson(result.document),
          updatedAt: new Date(),
        })
        .where('id', '=', page.id)
        .executeTakeFirst();
    }

    console.log(
      `SUMMARY scannedPages=${scannedPages} repairedPages=${repairedPages} repairedImages=${repairedImages} mode=${options.write ? 'write' : 'dry-run'}`,
    );
  } finally {
    await db.destroy();
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    pageIds: [],
    includeAllPages: false,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--all') {
      options.includeAllPages = true;
      continue;
    }

    if (arg === '--write') {
      options.write = true;
      continue;
    }

    if (arg === '--page-id') {
      const pageId = args[index + 1];
      if (!pageId) {
        throw new Error('Missing value for --page-id');
      }
      options.pageIds.push(pageId);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.includeAllPages && !options.pageIds.length) {
    throw new Error('Pass --page-id <id> or --all');
  }

  return options;
}

async function loadCandidatePages(
  db: Kysely<any>,
  options: CliOptions,
): Promise<PageRow[]> {
  let query = db
    .selectFrom('pages')
    .select(['id', 'content'])
    .where('deletedAt', 'is', null);

  if (options.pageIds.length) {
    query = query.where('id', 'in', options.pageIds);
  }

  return query.execute() as Promise<PageRow[]>;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
