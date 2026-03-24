import * as path from 'path';
import { promises as fs } from 'fs';
import * as dotenv from 'dotenv';
import { FileMigrationProvider, Kysely, Migrator } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';
import { normalizePostgresUrl } from '../common/helpers';
import {
  assertDistinctDatabaseTargets,
  buildMaintenanceDatabaseUrl,
  parseDatabaseTarget,
  quotePostgresIdentifier,
} from './schema-only-migration.utils';

export type SchemaOnlyMigrationOptions = {
  repoRoot: string;
  maintenanceDatabase: string;
};

type AdminClient = {
  execute: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

type SchemaOnlyMigrationDependencies = {
  readFile: (filePath: string) => Promise<string>;
  createAdminClient: (databaseUrl: string) => Promise<AdminClient>;
  migrateToLatest: (databaseUrl: string) => Promise<void>;
  log: (message: string) => void;
};

function getDatabaseUrlFromEnvContent(
  fileContent: string,
  fileLabel: string,
): string {
  const parsed = dotenv.parse(fileContent);
  const databaseUrl = parsed.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(`${fileLabel} does not define DATABASE_URL`);
  }

  return databaseUrl;
}

function escapePostgresLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function isPgHbaConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no pg_hba.conf entry');
}

function isTlsConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error && 'code' in error ? error.code : '';

  return (
    message.includes('before secure TLS connection was established') ||
    code === 'ECONNRESET'
  );
}

function isRetryableMaintenanceConnectionError(error: unknown): boolean {
  return isPgHbaConnectionError(error) || isTlsConnectionError(error);
}

async function createRealAdminClient(databaseUrl: string): Promise<AdminClient> {
  const client = postgres(normalizePostgresUrl(databaseUrl), {
    max: 1,
    onnotice: () => {},
  });

  return {
    async execute(sql: string) {
      await client.unsafe(sql);
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}

async function runRealMigrations(databaseUrl: string): Promise<void> {
  const db = new Kysely<any>({
    dialect: new PostgresJSDialect({
      postgres: postgres(normalizePostgresUrl(databaseUrl), {
        onnotice: () => {},
      }),
    }),
  });

  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.join(__dirname, './migrations'),
      }),
    });

    const { error } = await migrator.migrateToLatest();

    if (error) {
      throw error;
    }
  } finally {
    await db.destroy();
  }
}

function createDefaultDependencies(): SchemaOnlyMigrationDependencies {
  return {
    readFile: (filePath: string) => fs.readFile(filePath, 'utf8'),
    createAdminClient: createRealAdminClient,
    migrateToLatest: runRealMigrations,
    log: (message: string) => console.log(message),
  };
}

export async function runSchemaOnlyMigration(
  options: SchemaOnlyMigrationOptions,
  dependencies: SchemaOnlyMigrationDependencies = createDefaultDependencies(),
): Promise<void> {
  const devEnvPath = path.join(options.repoRoot, '.env.dev');
  const prodEnvPath = path.join(options.repoRoot, '.env.prod');

  const [devEnvContent, prodEnvContent] = await Promise.all([
    dependencies.readFile(devEnvPath),
    dependencies.readFile(prodEnvPath),
  ]);

  const devDatabaseUrl = getDatabaseUrlFromEnvContent(devEnvContent, '.env.dev');
  const prodDatabaseUrl = getDatabaseUrlFromEnvContent(
    prodEnvContent,
    '.env.prod',
  );

  assertDistinctDatabaseTargets(devDatabaseUrl, prodDatabaseUrl);

  const devTarget = parseDatabaseTarget(devDatabaseUrl);
  const prodTarget = parseDatabaseTarget(prodDatabaseUrl);
  const maintenanceCandidates = [
    options.maintenanceDatabase,
    ...(devTarget.host === prodTarget.host &&
    devTarget.port === prodTarget.port &&
    devTarget.database !== prodTarget.database &&
    devTarget.database !== options.maintenanceDatabase
      ? [devTarget.database]
      : []),
  ];

  dependencies.log(
    `Resetting ${prodTarget.host}:${prodTarget.port}/${prodTarget.database}`,
  );

  let adminClient: AdminClient | null = null;
  let lastConnectionError: unknown;
  let resetCompleted = false;

  for (let i = 0; i < maintenanceCandidates.length; i++) {
    const maintenanceDatabase = maintenanceCandidates[i];
    const maintenanceUrl = buildMaintenanceDatabaseUrl(
      prodDatabaseUrl,
      maintenanceDatabase,
    );

    try {
      adminClient = await dependencies.createAdminClient(maintenanceUrl);
      await adminClient.execute(`SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${escapePostgresLiteral(prodTarget.database)}'
  AND pid <> pg_backend_pid()`);
      await adminClient.execute(
        `DROP DATABASE IF EXISTS ${quotePostgresIdentifier(prodTarget.database)}`,
      );
      await adminClient.execute(
        `CREATE DATABASE ${quotePostgresIdentifier(prodTarget.database)}`,
      );

      if (i > 0) {
        dependencies.log(
          `Connected through fallback maintenance database "${maintenanceDatabase}".`,
        );
      }
      resetCompleted = true;
      break;
    } catch (error) {
      lastConnectionError = error;

      const nextDatabase = maintenanceCandidates[i + 1];
      if (isRetryableMaintenanceConnectionError(error)) {
        if (nextDatabase) {
          dependencies.log(
            `Maintenance database "${maintenanceDatabase}" was unavailable. Retrying with "${nextDatabase}".`,
          );
          continue;
        }

        break;
      }

      throw error;
    } finally {
      if (adminClient) {
        await adminClient.close();
      }
      adminClient = null;
    }
  }

  if (!resetCompleted) {
    if (lastConnectionError && isTlsConnectionError(lastConnectionError)) {
      throw new Error(
        'TLS handshake failed. The PostgreSQL server is likely not configured for SSL. Remove sslmode=require from DATABASE_URL or enable SSL on the server.',
      );
    }

    throw lastConnectionError instanceof Error
      ? lastConnectionError
      : new Error(String(lastConnectionError));
  }

  dependencies.log(`Running migrations on ${prodTarget.database}`);
  await dependencies.migrateToLatest(prodDatabaseUrl);
}

function parseCliArgs(argv: string[]): SchemaOnlyMigrationOptions {
  let maintenanceDatabase = 'postgres';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--maintenance-db' && argv[i + 1]) {
      maintenanceDatabase = argv[i + 1];
      i += 1;
    }
  }

  return {
    repoRoot: path.resolve(__dirname, '..', '..', '..', '..'),
    maintenanceDatabase,
  };
}

if (require.main === module) {
  runSchemaOnlyMigration(parseCliArgs(process.argv.slice(2))).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
