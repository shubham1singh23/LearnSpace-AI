// Dedicated browser-test entry point. Production never imports this factory.
import { resolve } from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { createDatabase } from '../../apps/api/src/db.js';
import { createReadiness } from '../../apps/api/src/readiness.js';
import { ConfigurationService, type AdapterFactory } from '../../apps/api/src/ai/configuration.js';
import { OperationService } from '../../apps/api/src/ai/operations.js';
import { ModelError } from '@learnspace/ai';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Browser fixture requires an isolated test database.');
const env = parseEnvironment({ DATABASE_URL: url, NODE_ENV: 'production', API_PORT: process.env.TEST_API_PORT ?? 3101, API_HOST: '127.0.0.1', WEB_ORIGIN: 'http://127.0.0.1:3101', DATA_DIR: './data/milestone3-e2e' });
const db = createDatabase(url);
const factory: AdapterFactory = () => ({ async generate(system, input, schema, signal) {
  if (input.includes('slow fixture')) await new Promise<void>((done, reject) => { const timer = setTimeout(done, 1500); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new ModelError('CANCELLED')); }, { once: true }); });
  if (signal.aborted) throw new ModelError('CANCELLED');
  if (input.includes('invalid fixture')) throw new ModelError('INVALID_OUTPUT');
  const result: unknown = system.includes('Create a syllabus only') ? {
    nodes: [{ tempId: 'module', parentTempId: null, title: 'Foundations', kind: 'module', position: 0, objectives: [] }, { tempId: 'leaf', parentTempId: 'module', title: 'Counting practice', kind: 'topic', position: 0, objectives: ['Add two numbers'] }], prerequisites: []
  } : {
    title: system.includes('Propose a complete replacement') ? 'Replacement counting lesson' : 'Counting lesson', objectives: ['Add two numbers'], prerequisiteNotes: [],
    sections: [{ heading: 'Adding groups', blocks: [{ type: 'paragraph', text: 'Count both groups together.' }, { type: 'example', text: 'One apple and one apple make two apples.' }, { type: 'reflection', text: 'Where could you use counting?' }] }], recall: [{ question: 'One plus one?', answer: 'Two' }], uncertainties: ['This is deterministic test content, not live model output.']
  };
  return schema.parse(result);
} });
const models = new ConfigurationService(db, env, factory); const operations = new OperationService(models);
const assetRoot = resolve(env.DATA_DIR, 'assets');
const server = createApp(env, createReadiness(db, assetRoot), resolve('apps/web/dist'), db, assetRoot, models, operations).listen(env.API_PORT, env.API_HOST);
const stop = () => { operations.stop(); models.credentials.clear(); server.closeAllConnections(); server.close(() => { void db.$disconnect(); }); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
