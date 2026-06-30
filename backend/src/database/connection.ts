import pg from 'pg';

const { Pool } = pg;

function getPoolConfig(): pg.PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const config: pg.PoolConfig = { connectionString };

  // Supabase (and most hosted Postgres) require SSL
  const useSsl =
    process.env.DATABASE_SSL === 'true' || connectionString.includes('supabase.co');

  if (useSsl) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

export const pool = new Pool(getPoolConfig());

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
