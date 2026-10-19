import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Health } from '@learnspace/shared';
import type { Database } from './db.js';

export const requiredMigrations = ['20261018000100_initial', '20261018000200_credential_metadata', '20261019000100_progress_leaf_guard'] as const;
export function createReadiness(db: Database, assetRoot: string): () => Promise<Health> {
  return async () => {
    const checks = await Promise.allSettled([
      db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name IN (${requiredMigrations[0]}, ${requiredMigrations[1]}, ${requiredMigrations[2]}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      mkdir(assetRoot, { recursive: true }).then(() => access(assetRoot, constants.W_OK))
    ]);
    const database = checks[0].status === 'fulfilled' && checks[0].value.length === requiredMigrations.length ? 'ready' : 'unavailable';
    const storage = checks[1].status === 'fulfilled' ? 'ready' : 'unavailable';
    return { status: database === 'ready' && storage === 'ready' ? 'ok' : 'unavailable', service: 'learnspace-api', database, storage };
  };
}
