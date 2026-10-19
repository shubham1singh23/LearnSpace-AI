import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { defaultPreferences } from '@learnspace/shared';
import { capabilities } from '@learnspace/ai';

test('recovers a course operation and falls back to polling without starting duplicate work', async ({ page, request }) => {
  const headers = { Origin: 'http://127.0.0.1:3101', 'Content-Type': 'application/json' };
  const created = await request.post('/api/v1/courses', { headers, data: { title: 'Operation browser fixture', goal: 'Recover status', preferences: defaultPreferences } });
  const course = await created.json() as { data: { id: string } }; const id = randomUUID(); let reads = 0;
  const operation = { id, courseId: course.data.id, topicId: null, lessonId: null, kind: 'syllabus', status: 'running', baseRevision: null, baseTreeRevision: 0, model: { version: 1, configId: randomUUID(), configRevision: 1, provider: 'openai', modelId: 'fake', options: { maxOutputTokens: 2048, timeoutMs: 120000 }, capabilities: capabilities() }, context: { sources: [], omitted: true }, result: null, errorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await page.route(`**/api/v1/courses/${course.data.id}/operations?*`, route => { const metadata = Object.fromEntries(Object.entries(operation).filter(([key]) => key !== 'result')); const next = new URL(route.request().url()).searchParams.has('cursor'); return route.fulfill({ json: { data: { operations: next ? [metadata] : [], page: { nextCursor: next ? null : randomUUID() } }, requestId: randomUUID() } }); });
  await page.route(`**/api/v1/operations/${id}`, route => { reads++; return route.fulfill({ json: { data: operation, requestId: randomUUID() } }); });
  await page.route(`**/api/v1/operations/${id}/events`, route => route.abort());
  await page.route(`**/api/v1/operations/${id}/cancel`, route => { operation.status = 'cancelled'; return route.fulfill({ json: { data: operation, requestId: randomUUID() } }); });
  try {
    await page.goto(`/courses/${course.data.id}`); await page.getByText('Course generation activity', { exact: true }).click();
    await page.getByRole('button', { name: 'More operation recovery results', exact: true }).click();
    await expect(page.getByText('syllabus: running', { exact: true })).toBeVisible(); await expect(page.getByText('Live progress disconnected. Using durable polling.')).toBeVisible();
    await expect.poll(() => reads).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Cancel generation', exact: true }).click(); await expect(page.getByText('syllabus: cancelled', { exact: true })).toBeVisible();
  } finally { await request.delete(`/api/v1/courses/${course.data.id}`, { headers, data: { baseTreeRevision: 0, confirm: true } }); }
});
