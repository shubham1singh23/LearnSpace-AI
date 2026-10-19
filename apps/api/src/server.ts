import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadEnvironment, workspaceRoot } from './config.js';
import { createDatabase } from './db.js';
import { createReadiness } from './readiness.js';
import { ConfigurationService } from './ai/configuration.js';
import { OperationService } from './ai/operations.js';

try {
  const env = loadEnvironment();
  const db = createDatabase(env.DATABASE_URL);
  const assetRoot = resolve(workspaceRoot, env.DATA_DIR, 'assets');
  const configuration = new ConfigurationService(db, env);
  const operations = new OperationService(configuration);
  await configuration.initialize().catch(() => { console.warn('Model defaults could not be initialized; readiness will report database availability.'); });
  const app = createApp(env, createReadiness(db, assetRoot), env.NODE_ENV === 'production' ? resolve(workspaceRoot, 'apps/web/dist') : undefined, db, assetRoot, configuration, operations);
  const server = app.listen(env.API_PORT, env.API_HOST, () => { console.info(`LearnSpace API listening on loopback port ${env.API_PORT}`); });
  server.on('error', () => { console.error('API could not bind to the configured local address/port.'); process.exitCode = 1; void db.$disconnect(); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    configuration.credentials.clear();
    operations.stop();
    server.close(() => { void db.$disconnect().then(() => { process.exitCode = 0; }); });
    setTimeout(() => { server.closeAllConnections(); void db.$disconnect(); }, 5000).unref();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('Invalid environment fields:') ? error.message : 'API startup failed. Check local configuration.');
  process.exitCode = 1;
}
