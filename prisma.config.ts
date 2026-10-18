import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
config({ path: '.env', quiet: true });
// A fallback permits generation/validation without a database or secret .env.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://learnspace:unused@127.0.0.1:5432/learnspace' }
});
