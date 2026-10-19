import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences } from '@learnspace/shared';
import { ConfigurationService } from '../../apps/api/src/ai/configuration.js';
import { OperationService, type StartOperation, type OperationResult } from '../../apps/api/src/ai/operations.js';
import { createDatabase } from '../../apps/api/src/db.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { createApp } from '../../apps/api/src/app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const env = parseEnvironment({ DATABASE_URL: url });
const configs = new ConfigurationService(db, env, () => ({ async generate(_system, _input, schema) { return schema.parse({}); } }));
const operations = new OperationService(configs); const courses: string[] = []; const configIds: string[] = [];
const original = await db.workspaceSettings.findUnique({ where: { id: 1 } });
afterAll(async () => {
  operations.stop(); await db.course.deleteMany({ where: { id: { in: courses } } });
  if (original) await db.workspaceSettings.update({ where: { id: 1 }, data: { textConfigId: original.textConfigId } });
  await db.aiProviderConfiguration.deleteMany({ where: { id: { in: configIds } } }); await db.$disconnect();
});
const result: OperationResult = { type: 'syllabus', readyAt: new Date().toISOString(), draft: { nodes: [{ tempId: 'a', parentTempId: null, title: 'A', kind: 'topic', position: 0, objectives: ['Understand A'] }], prerequisites: [] } };
async function setup(): Promise<StartOperation> {
  const config = await configs.write({ purpose: 'text', provider: 'openai', modelId: 'fixture', options: {}, credential: { source: 'session', secret: 'never-persist' } }); configIds.push(config.id); await configs.patchSettings({ textConfigId: config.id });
  const course = await db.course.create({ data: { title: 'Operation fixture', goal: 'Ownership tests', preferences: defaultPreferences } }); courses.push(course.id);
  return { courseId: course.id, kind: 'syllabus', ownerId: course.id, idempotencyKey: randomUUID(), request: { instruction: 'fixture' }, capture: async () => ({ baseTreeRevision: 0, context: { sources: [], omitted: false }, input: 'immutable input' }) };
}
function deferred() { let resolve!: (result: OperationResult) => void; const promise = new Promise<OperationResult>(done => { resolve = done; }); return { promise, resolve }; }
async function settled(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) { const row = await db.aiOperation.findUniqueOrThrow({ where: { id } }); if (row.status !== 'running') return row; await new Promise(done => setTimeout(done, 10)); }
  throw new Error('Operation did not settle');
}
it('replays durable starts before credential lookup, protects immutable snapshots and validates retries', async () => {
  const input = await setup(); const pending = deferred(); let executions = 0;
  const started = await operations.start(input, async () => { executions++; return pending.promise; });
  configs.credentials.clear();
  expect((await operations.start(input, async () => result)).id).toBe(started.id); expect(executions).toBe(1);
  await expect(operations.start({ ...input, request: { instruction: 'changed' } }, async () => result)).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  expect(JSON.stringify(await db.aiOperation.findUnique({ where: { id: started.id } }))).not.toContain('never-persist');
  pending.resolve(result); expect((await settled(started.id)).status).toBe('ready');
  expect((await operations.list(input.courseId)).operations.map(row => row.id)).toContain(started.id);
  expect((await operations.get(started.id)).model.modelId).toBe('fixture');
});
it('cancellation wins over late provider results and lease expiry interrupts rather than resumes execution', async () => {
  const input = await setup(); const pending = deferred();
  const started = await operations.start(input, async () => pending.promise);
  expect((await operations.cancel(started.id)).status).toBe('cancelled'); pending.resolve(result);
  await new Promise(done => setTimeout(done, 30)); expect((await operations.get(started.id)).status).toBe('cancelled');
  const expired = deferred(); const next = await operations.start({ ...input, idempotencyKey: randomUUID(), retryOfOperationId: started.id }, async () => expired.promise);
  await db.aiOperation.update({ where: { id: next.id }, data: { leaseUntil: new Date(0) } });
  const restarted = new OperationService(configs); expect((await restarted.get(next.id)).status).toBe('interrupted');
  expired.resolve(result); await new Promise(done => setTimeout(done, 30)); expect((await operations.get(next.id)).status).toBe('interrupted');
});
it('bounds admission to two durable executions and rejects foreign recovery cursors', async () => {
  const input = await setup(); const pending = deferred();
  const first = await operations.start(input, async () => pending.promise);
  const second = await operations.start({ ...input, idempotencyKey: randomUUID() }, async () => pending.promise);
  await expect(operations.start({ ...input, idempotencyKey: randomUUID() }, async () => result)).rejects.toMatchObject({ code: 'MODEL_CAPACITY' });
  const secondRuntime = new OperationService(new ConfigurationService(db, env, configs.factory));
  await expect(secondRuntime.start({ ...input, idempotencyKey: randomUUID() }, async () => result)).rejects.toMatchObject({ code: 'MODEL_CAPACITY' });
  const foreign = await db.course.create({ data: { title: 'Other', goal: 'Other', preferences: defaultPreferences } }); courses.push(foreign.id);
  await expect(operations.list(foreign.id, first.id)).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  await operations.cancel(first.id); await operations.cancel(second.id); pending.resolve(result);
  await new Promise(done => setTimeout(done, 30));
});
it('SSE reconnect resets to durable status and a disconnected client does not cancel execution', async () => {
  const input = await setup(); const pending = deferred(); const operation = await operations.start(input, async () => pending.promise);
  const server = createServer(); server.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
  const app = createApp({ ...env, API_PORT: address.port }, async () => ({ status: 'ok', service: 'learnspace-api', database: 'ready', storage: 'ready' }), undefined, db, undefined, configs, operations); server.on('request', app);
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/operations/${operation.id}/events`;
  try {
    const response = await fetch(endpoint); expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader(); const first = new TextDecoder().decode((await reader.read()).value); expect(first).toContain('event: status'); expect(first).toContain('"reset":true'); await reader.cancel();
    expect((await operations.get(operation.id)).status).toBe('running');
    pending.resolve(result); await settled(operation.id);
    const reconnect = await fetch(endpoint, { headers: { 'Last-Event-ID': '1' } }); const text = await reconnect.text(); expect(text).toContain('event: ready'); expect(text).toContain('"reset":true');
    expect(text).not.toContain('never-persist');
  } finally { pending.resolve(result); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
