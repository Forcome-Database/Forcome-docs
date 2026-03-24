import { runSchemaOnlyMigration } from './schema-only-migration';

describe('runSchemaOnlyMigration', () => {
  it('fails fast when dev and prod still point to the same database target', async () => {
    const readFile = jest.fn(async () =>
      'DATABASE_URL="postgresql://user:pass@db.internal:5432/docmost?schema=public"',
    );
    const createAdminClient = jest.fn();
    const migrateToLatest = jest.fn();

    await expect(
      runSchemaOnlyMigration(
        {
          repoRoot: 'E:/test/Docmost',
          maintenanceDatabase: 'postgres',
        },
        {
          readFile,
          createAdminClient,
          migrateToLatest,
          log: jest.fn(),
        },
      ),
    ).rejects.toThrow('The development and production database targets are identical');

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(migrateToLatest).not.toHaveBeenCalled();
  });

  it('drops and recreates the prod database before running migrations', async () => {
    const events: string[] = [];
    const readFile = jest.fn(async (filePath: string) => {
      if (filePath.endsWith('.env.dev')) {
        return 'DATABASE_URL="postgresql://dev:pass@db.internal:5432/docmost_dev?schema=public"';
      }

      return 'DATABASE_URL="postgresql://prod:pass@db.internal:5432/docmost_prod?schema=public"';
    });

    const adminClient = {
      execute: jest.fn(async (sql: string) => {
        events.push(sql);
      }),
      close: jest.fn(async () => {
        events.push('close');
      }),
    };

    const createAdminClient = jest.fn(async (databaseUrl: string) => {
      events.push(`admin:${databaseUrl}`);
      return adminClient;
    });

    const migrateToLatest = jest.fn(async (databaseUrl: string) => {
      events.push(`migrate:${databaseUrl}`);
    });

    await runSchemaOnlyMigration(
      {
        repoRoot: 'E:/test/Docmost',
        maintenanceDatabase: 'postgres',
      },
      {
        readFile,
        createAdminClient,
        migrateToLatest,
        log: jest.fn(),
      },
    );

    expect(createAdminClient).toHaveBeenCalledWith(
      'postgresql://prod:pass@db.internal:5432/postgres',
    );
    expect(adminClient.execute).toHaveBeenCalledTimes(3);
    expect(adminClient.execute.mock.calls[0][0]).toContain(
      "WHERE datname = 'docmost_prod'",
    );
    expect(adminClient.execute.mock.calls[1][0]).toBe(
      'DROP DATABASE IF EXISTS "docmost_prod"',
    );
    expect(adminClient.execute.mock.calls[2][0]).toBe(
      'CREATE DATABASE "docmost_prod"',
    );
    expect(events).toEqual([
      'admin:postgresql://prod:pass@db.internal:5432/postgres',
      expect.stringContaining('SELECT pg_terminate_backend(pid)') as unknown as string,
      'DROP DATABASE IF EXISTS "docmost_prod"',
      'CREATE DATABASE "docmost_prod"',
      'close',
      'migrate:postgresql://prod:pass@db.internal:5432/docmost_prod?schema=public',
    ]);
  });

  it('falls back to a same-cluster development database when postgres maintenance db is blocked', async () => {
    const readFile = jest.fn(async (filePath: string) => {
      if (filePath.endsWith('.env.dev')) {
        return 'DATABASE_URL="postgresql://dev:pass@db.internal:5432/docmost?schema=public"';
      }

      return 'DATABASE_URL="postgresql://prod:pass@db.internal:5432/forcomedocs_prod?schema=public"';
    });

    const adminClient = {
      execute: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    };

    const createAdminClient = jest.fn(async (databaseUrl: string) => {
      if (databaseUrl.endsWith('/postgres')) {
        throw new Error(
          'no pg_hba.conf entry for host "192.168.17.26", user "postgres", database "postgres", no encryption',
        );
      }

      return adminClient;
    });

    const migrateToLatest = jest.fn(async () => undefined);
    const log = jest.fn();

    await runSchemaOnlyMigration(
      {
        repoRoot: 'E:/test/Docmost',
        maintenanceDatabase: 'postgres',
      },
      {
        readFile,
        createAdminClient,
        migrateToLatest,
        log,
      },
    );

    expect(createAdminClient).toHaveBeenNthCalledWith(
      1,
      'postgresql://prod:pass@db.internal:5432/postgres',
    );
    expect(createAdminClient).toHaveBeenNthCalledWith(
      2,
      'postgresql://prod:pass@db.internal:5432/docmost',
    );
    expect(log).toHaveBeenCalledWith(
      'Maintenance database "postgres" was unavailable. Retrying with "docmost".',
    );
  });

  it('falls back when the first maintenance database fails lazily on its first query', async () => {
    const readFile = jest.fn(async (filePath: string) => {
      if (filePath.endsWith('.env.dev')) {
        return 'DATABASE_URL="postgresql://dev:pass@db.internal:5432/docmost?schema=public"';
      }

      return 'DATABASE_URL="postgresql://prod:pass@db.internal:5432/forcomedocs_prod?schema=public"';
    });

    const blockedAdminClient = {
      execute: jest.fn(async () => {
        throw new Error(
          'no pg_hba.conf entry for host "192.168.17.26", user "postgres", database "postgres", no encryption',
        );
      }),
      close: jest.fn(async () => undefined),
    };

    const workingAdminClient = {
      execute: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    };

    const createAdminClient = jest
      .fn()
      .mockResolvedValueOnce(blockedAdminClient)
      .mockResolvedValueOnce(workingAdminClient);

    const migrateToLatest = jest.fn(async () => undefined);
    const log = jest.fn();

    await runSchemaOnlyMigration(
      {
        repoRoot: 'E:/test/Docmost',
        maintenanceDatabase: 'postgres',
      },
      {
        readFile,
        createAdminClient,
        migrateToLatest,
        log,
      },
    );

    expect(createAdminClient).toHaveBeenNthCalledWith(
      1,
      'postgresql://prod:pass@db.internal:5432/postgres',
    );
    expect(createAdminClient).toHaveBeenNthCalledWith(
      2,
      'postgresql://prod:pass@db.internal:5432/docmost',
    );
    expect(blockedAdminClient.close).toHaveBeenCalled();
    expect(workingAdminClient.execute).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith(
      'Maintenance database "postgres" was unavailable. Retrying with "docmost".',
    );
  });

  it('surfaces a clear hint when sslmode=require is set but the server does not support TLS', async () => {
    const readFile = jest.fn(async (filePath: string) => {
      if (filePath.endsWith('.env.dev')) {
        return 'DATABASE_URL="postgresql://dev:pass@db.internal:5432/docmost?schema=public"';
      }

      return 'DATABASE_URL="postgresql://prod:pass@db.internal:5432/forcomedocs_prod?schema=public&sslmode=require"';
    });

    const tlsError = Object.assign(
      new Error(
        'Client network socket disconnected before secure TLS connection was established',
      ),
      { code: 'ECONNRESET' },
    );

    const brokenAdminClient = {
      execute: jest.fn(async () => {
        throw tlsError;
      }),
      close: jest.fn(async () => undefined),
    };

    const createAdminClient = jest
      .fn()
      .mockResolvedValueOnce(brokenAdminClient)
      .mockResolvedValueOnce(brokenAdminClient);

    await expect(
      runSchemaOnlyMigration(
        {
          repoRoot: 'E:/test/Docmost',
          maintenanceDatabase: 'postgres',
        },
        {
          readFile,
          createAdminClient,
          migrateToLatest: jest.fn(async () => undefined),
          log: jest.fn(),
        },
      ),
    ).rejects.toThrow(
      'TLS handshake failed. The PostgreSQL server is likely not configured for SSL. Remove sslmode=require from DATABASE_URL or enable SSL on the server.',
    );
  });
});
