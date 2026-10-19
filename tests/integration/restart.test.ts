import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences, tiptapDocumentSchema } from '@learnspace/shared';
import { allNodesFixture } from '../fixtures/document.js';
import sharp from 'sharp';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const origin = 'http://127.0.0.1:3102';
let server: ChildProcess | undefined;
async function start() {
  server = spawn(process.execPath, ['apps/api/dist/server.js'], { env: { ...process.env, DATABASE_URL: url, API_HOST: '127.0.0.1', API_PORT: '3102', NODE_ENV: 'production', WEB_ORIGIN: origin, DATA_DIR: './data/milestone2-restart' }, stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Restart fixture API exited.');
    try { if ((await fetch(`${origin}/api/v1/health/ready`)).ok) return; } catch { /* Wait for this owned server. */ }
    await delay(100);
  }
  throw new Error('Restart fixture API did not become ready.');
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
  server = undefined;
}
afterAll(stop);
async function post(path: string, body: unknown) {
  const response = await fetch(`${origin}/api/v1${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(201); return await response.json() as { data: { id: string } };
}
it('retains all saved JSON, immutable image bytes and creation receipts across an API process restart', async () => {
  await start();
  const course = (await post('/courses', { title: 'Restart fixture', goal: 'Verify committed persistence', preferences: defaultPreferences })).data;
  try {
    const topic = (await post(`/courses/${course.id}/topics`, { baseTreeRevision: 0, parentId: null, title: 'Notes', kind: 'topic', position: 0, objectives: [] })).data;
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#234567' } }).png().toBuffer();
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'fixture.png');
    const upload = await fetch(`${origin}/api/v1/courses/${course.id}/assets`, { method: 'POST', headers: { Origin: origin, 'X-LearnSpace-Request': '1' }, body: form });
    expect(upload.status).toBe(201); const asset = await upload.json() as { data: { id: string } };
    const document = tiptapDocumentSchema.parse(allNodesFixture());
    const image = document.content.find(node => node.type === 'image')!; image.attrs!.assetId = asset.data.id;
    const body = { mutationId: randomUUID(), documentSchemaVersion: 1, document };
    const lesson = await post(`/topics/${topic.id}/lessons`, body);
    await stop(); await start();
    const reopened = await fetch(`${origin}/api/v1/topics/${topic.id}/lesson`);
    const saved = await reopened.json() as { data: { document: unknown } };
    expect(saved.data.document).toEqual(document);
    const content = await fetch(`${origin}/api/v1/assets/${asset.data.id}/content`); expect(content.status).toBe(200); expect((await content.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await post(`/topics/${topic.id}/lessons`, body)).data.id).toBe(lesson.data.id);
  } finally {
    if (server) await fetch(`${origin}/api/v1/courses/${course.id}`, { method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseTreeRevision: 1, confirm: true }) });
    await stop();
  }
}, 20000);
