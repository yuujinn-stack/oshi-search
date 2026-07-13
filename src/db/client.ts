import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// drizzle-orm/neon-http は db.transaction() を非対応。
// トランザクションが必要な場合は neonSql.transaction() を使う（HTTP バッチ API）。
export const neonSql = neon(process.env.DATABASE_URL!);
export const db = drizzle(neonSql, { schema });
export type DB = typeof db;
