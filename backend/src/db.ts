import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
pg.types.setTypeParser(1082, value => value); // PostgreSQL DATE stays YYYY-MM-DD in JSON and date inputs.
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';
