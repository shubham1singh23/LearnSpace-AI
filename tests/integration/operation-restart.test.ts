import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences } from '@learnspace/shared';
import { createDatabase } from '../../apps/api/src/db.js';
import { LessonService } from '../../apps/api/src/workspace/lesson-service.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const origin = 'http://127.0.0.1:3104'; let server: ChildProcess | undefined;
async function start() {
  server = spawn(process.execPath, ['dist/e2e/tests/support/server.js'], { env: { TEST_DATABASE_URL: url, TEST_API_PORT: '3104', PATH: process.env.PATH }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) { if (server.exitCode !== null) throw new Error('Fake restart server exited'); try { if ((await fetch(`${origin}/api/v1/health/ready`)).ok) return; } catch { /* Await owned fixture. */ } await delay(100); } throw new Error('Fake restart server not ready');
}
async function stop() { const child = server; if (!child || child.exitCode !== null) return; await new Promise<void>(done => { child.once('exit', () => done()); child.kill('SIGKILL'); }); server = undefined; }
afterAll(async () => { await stop(); await db.$disconnect(); });
it('a real process restart interrupts an expired durable execution without generating a lesson or replaying the model', async () => {
  const original = await db.workspaceSettings.findUnique({ where: { id: 1 } });
  const config = await db.aiProviderConfiguration.create({ data: { purpose: 'text', provider: 'ollama', modelId: 'fake-only', options: { maxOutputTokens: 2048, timeoutMs: 120000 }, credentialSource: 'none', capabilities: { structuredOutput: 'prompt_json', streaming: 'unknown', vision: 'unsupported', toolCalling: 'unknown', imageGeneration: 'unsupported', contextWindow: 16384, maxOutputTokens: 8192, registryVersion: 'text-v1', source: 'fixture' }, registryVersion: 'text-v1' } });
  await db.workspaceSettings.upsert({ where: { id: 1 }, create: { preferences: defaultPreferences, textConfigId: config.id }, update: { textConfigId: config.id } });
  const course = await db.course.create({ data: { title: 'Restart operation fixture', goal: 'Recover without replay', preferences: defaultPreferences } });
  const topic = await db.topic.create({ data: { courseId: course.id, title: 'Leaf', kind: 'topic', position: 0, objectives: ['Count'] } });
  try {
    await start(); const response = await fetch(`${origin}/api/v1/topics/${topic.id}/lesson-generations`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ instruction: 'slow fixture' }) }); expect(response.status).toBe(202);
    const started = await response.json() as { data: { operationId: string } }; await stop();
    await db.aiOperation.update({ where: { id: started.data.operationId }, data: { leaseUntil: new Date(0) } });
    await start(); const status = await (await fetch(`${origin}/api/v1/operations/${started.data.operationId}`)).json() as { data: { status: string } }; expect(status.data.status).toBe('interrupted');
    expect(await db.lesson.count({ where: { topicId: topic.id } })).toBe(0); expect(await db.modelUsage.count({ where: { operationId: started.data.operationId } })).toBe(0);
    const lesson = await new LessonService(db).create(topic.id, { mutationId: randomUUID(), documentSchemaVersion: 1, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Saved notes' }] }] } });
    const chat = await fetch(`${origin}/api/v1/lessons/${lesson.id}/chat-turns`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ baseRevision: 1, message: 'slow fixture', clientTurnId: randomUUID() }) }); expect(chat.status).toBe(202);
    const turn = await chat.json() as { data: { operationId: string } }; await stop();
    await db.aiOperation.update({ where: { id: turn.data.operationId }, data: { leaseUntil: new Date(0) } });
    await start(); const resumed = await (await fetch(`${origin}/api/v1/operations/${turn.data.operationId}`)).json() as { data: { status: string } }; expect(resumed.data.status).toBe('interrupted');
    expect(await db.chatMessage.findMany({ where: { lessonId: lesson.id } })).toMatchObject([{ role: 'user', status: 'interrupted' }]);
    expect(await db.modelUsage.count({ where: { operationId: turn.data.operationId } })).toBe(0); expect((await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).revision).toBe(1);
  } finally { await stop(); await db.lesson.deleteMany({ where: { topicId: topic.id } }); await db.course.delete({ where: { id: course.id } }); if (original) await db.workspaceSettings.update({ where: { id: 1 }, data: { textConfigId: original.textConfigId } }); await db.aiProviderConfiguration.delete({ where: { id: config.id } }); }
});
