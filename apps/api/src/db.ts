import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 3000, query_timeout: 3000, max: 5 }), log: [] });
}
export type Database = ReturnType<typeof createDatabase>;
