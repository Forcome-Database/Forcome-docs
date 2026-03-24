import { normalizePostgresUrl } from '../common/helpers';

export type DatabaseTarget = {
  host: string;
  port: number;
  database: string;
  schema: string | null;
};

export function parseDatabaseTarget(databaseUrl: string): DatabaseTarget {
  const parsed = new URL(databaseUrl);

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, ''),
    schema: parsed.searchParams.get('schema'),
  };
}

export function assertDistinctDatabaseTargets(
  devDatabaseUrl: string,
  prodDatabaseUrl: string,
): void {
  const devTarget = parseDatabaseTarget(devDatabaseUrl);
  const prodTarget = parseDatabaseTarget(prodDatabaseUrl);

  if (
    devTarget.host === prodTarget.host &&
    devTarget.port === prodTarget.port &&
    devTarget.database === prodTarget.database &&
    devTarget.schema === prodTarget.schema
  ) {
    throw new Error(
      'The development and production database targets are identical',
    );
  }
}

export function buildMaintenanceDatabaseUrl(
  databaseUrl: string,
  maintenanceDatabase: string,
): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${maintenanceDatabase}`;
  return normalizePostgresUrl(parsed.toString());
}

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
