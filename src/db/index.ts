/**
 * ROA Services — database connection (Supabase PostgreSQL via pg + Drizzle).
 * Credentials are loaded from process.env (Vercel env / .env, never committed).
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const connectionString = process.env['DATABASE_URL'] ?? '';

if (!connectionString) {
  // Fail loud in non-Vercel dev so misconfiguration is obvious.
  console.error('[db] DATABASE_URL is not set. Set it in .env or Vercel env vars.');
}

export const pool = new Pool({
  connectionString,
  max: 10,
  ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
export { schema };
