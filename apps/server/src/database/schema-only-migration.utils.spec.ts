import {
  assertDistinctDatabaseTargets,
  buildMaintenanceDatabaseUrl,
  parseDatabaseTarget,
  quotePostgresIdentifier,
} from './schema-only-migration.utils';

describe('schema-only migration utils', () => {
  it('rejects when dev and prod point to the same database target', () => {
    const devUrl =
      'postgresql://dev_user:dev_pass@db.internal:5432/docmost?schema=public';
    const prodUrl =
      'postgresql://prod_user:prod_pass@db.internal:5432/docmost?schema=public';

    expect(() => assertDistinctDatabaseTargets(devUrl, prodUrl)).toThrow(
      'The development and production database targets are identical',
    );
  });

  it('allows distinct database names on the same postgres server', () => {
    const devUrl =
      'postgresql://dev_user:dev_pass@db.internal:5432/docmost_dev?schema=public';
    const prodUrl =
      'postgresql://prod_user:prod_pass@db.internal:5432/docmost_prod?schema=public';

    expect(() => assertDistinctDatabaseTargets(devUrl, prodUrl)).not.toThrow();
  });

  it('parses database targets without leaking credentials', () => {
    expect(
      parseDatabaseTarget(
        'postgresql://user:secret@192.168.1.10:5433/docmost_prod?schema=public',
      ),
    ).toEqual({
      host: '192.168.1.10',
      port: 5433,
      database: 'docmost_prod',
      schema: 'public',
    });
  });

  it('builds a maintenance database url and strips schema for postgres.js compatibility', () => {
    expect(
      buildMaintenanceDatabaseUrl(
        'postgresql://user:secret@db.internal:5432/docmost_prod?schema=public&sslmode=require',
        'postgres',
      ),
    ).toBe(
      'postgresql://user:secret@db.internal:5432/postgres?sslmode=require',
    );
  });

  it('quotes postgres identifiers safely', () => {
    expect(quotePostgresIdentifier('docmost')).toBe('"docmost"');
    expect(quotePostgresIdentifier('doc"most')).toBe('"doc""most"');
  });
});
