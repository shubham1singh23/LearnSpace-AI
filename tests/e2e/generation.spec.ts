import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { defaultPreferences } from '@learnspace/shared';
import sharp from 'sharp';
const headers = { Origin: 'http://127.0.0.1:3101', 'Content-Type': 'application/json' };
async function setup(request: APIRequestContext) {
  const original = await (await request.get('/api/v1/settings')).json() as { data: { textConfigId: string | null } };
  const config = await (await request.post('/api/v1/provider-configurations', { headers, data: { purpose: 'text', provider: 'ollama', modelId: 'deterministic-browser', options: {}, credential: { source: 'none' } } })).json() as { data: { id: string } };
  await request.patch('/api/v1/settings', { headers, data: { textConfigId: config.data.id } });
  const course = await (await request.post('/api/v1/courses', { headers, data: { title: `Generation fixture ${randomUUID().slice(0, 8)}`, goal: 'Count safely', preferences: defaultPreferences } })).json() as { data: { id: string } };
  return { id: course.data.id, cleanup: async () => {
    const tree = await (await request.get(`/api/v1/courses/${course.data.id}/tree`)).json() as { data: { treeRevision: number } };
    await request.delete(`/api/v1/courses/${course.data.id}`, { headers, data: { baseTreeRevision: tree.data.treeRevision, confirm: true } });
    await request.patch('/api/v1/settings', { headers, data: { textConfigId: original.data.textConfigId } }); await request.delete(`/api/v1/provider-configurations/${config.data.id}`, { headers, data: {} });
  } };
}
test('reviews and commits a syllabus, explicitly generates notes, rejects local staleness and retries a lost regeneration acknowledgement', async ({ page, request }) => {
  const fixture = await setup(request);
  try {
    await page.goto(`/courses/${fixture.id}`); await page.getByRole('button', { name: 'Generate syllabus draft', exact: true }).click();
    const draft = page.getByLabel('Syllabus draft JSON'); await expect(draft).toBeVisible();
    const invalid = await draft.inputValue(); await draft.fill('{}'); await expect(page.getByRole('button', { name: 'Commit reviewed syllabus' })).toBeDisabled(); await draft.fill(invalid);
    await page.getByRole('button', { name: 'Commit reviewed syllabus', exact: true }).click(); await page.getByRole('button', { name: 'Counting practice', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create blank notes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Generate lesson', exact: true }).click(); await page.getByRole('button', { name: 'Load generated notes', exact: true }).click();
    const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toContainText('Counting lesson');
    await page.getByText('Regenerate lesson', { exact: true }).click(); await page.getByRole('button', { name: 'Generate replacement preview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Replacement preview', exact: true })).toBeVisible();
    await page.reload(); await page.getByText('Course generation activity', { exact: true }).click(); await page.getByRole('link', { name: 'Open lesson to recover preview', exact: true }).click();
    await page.getByText('Regenerate lesson', { exact: true }).click(); await page.getByRole('button', { name: 'Recover regeneration proposal', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Replacement preview', exact: true })).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'Lesson notes', exact: true }).last(); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' New local edit');
    await expect(page.getByText('The document changed. This proposal cannot replace your notes.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Accept replacement', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Undo', exact: true }).last().click(); await expect(page.getByRole('button', { name: 'Accept replacement', exact: true })).toBeDisabled();
    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' A retained edit');
    await page.getByRole('button', { name: 'Generate replacement preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Accept replacement', exact: true })).toBeEnabled();
    let lost = false; let firstBody: unknown;
    await page.route('**/api/v1/lessons/*/regeneration-commits', async route => {
      const body: unknown = route.request().postDataJSON(); if (!lost) { lost = true; firstBody = body; await route.fetch(); await route.abort(); } else { expect(body).toEqual(firstBody); await route.continue(); }
    });
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Accept replacement', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry pending regeneration commit' })).toBeVisible(); await expect(editor).toHaveAttribute('contenteditable', 'false');
    await page.getByRole('button', { name: 'Retry pending regeneration commit' }).click(); await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Replacement counting lesson');
    const tree = await (await request.get(`/api/v1/courses/${fixture.id}/tree`)).json() as { data: { topics: { id: string; title: string }[] } }; const topic = tree.data.topics.find(topic => topic.title === 'Counting practice')!;
    const lesson = await (await request.get(`/api/v1/topics/${topic.id}/lesson`)).json() as { data: { id: string; revision: number } }; expect(lesson.data.revision).toBe(3);
    await page.reload(); await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Replacement counting lesson');
  } finally { await fixture.cleanup(); }
});
test('regeneration retains uploaded image bytes in history and restoration', async ({ page, request }) => {
  const fixture = await setup(request);
  try {
    const topic = await (await request.post(`/api/v1/courses/${fixture.id}/topics`, { headers, data: { baseTreeRevision: 0, parentId: null, title: 'Image lesson', kind: 'topic', position: 0, objectives: ['Count'] } })).json() as { data: { id: string } };
    const buffer = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#408050' } }).png().toBuffer();
    const upload = await (await request.post(`/api/v1/courses/${fixture.id}/assets`, { headers: { Origin: headers.Origin, 'X-LearnSpace-Request': '1' }, multipart: { file: { name: 'original.png', mimeType: 'image/png', buffer } } })).json() as { data: { id: string; url: string } };
    const document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'My illustrated notes' }] }, { type: 'image', attrs: { blockId: randomUUID(), assetId: upload.data.id, alt: 'Original diagram', width: 8, height: 6 } }] };
    await request.post(`/api/v1/topics/${topic.data.id}/lessons`, { headers, data: { mutationId: randomUUID(), documentSchemaVersion: 1, document } });
    await page.goto(`/courses/${fixture.id}/topics/${topic.data.id}`); await page.getByText('Regenerate lesson', { exact: true }).click(); await page.getByRole('button', { name: 'Generate replacement preview' }).click(); await expect(page.getByRole('heading', { name: 'Replacement preview' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Accept replacement', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Replacement counting lesson'); expect((await request.get(upload.data.url)).status()).toBe(200);
    await page.getByRole('button', { name: 'Version history', exact: true }).click(); await page.getByRole('button', { name: /Preview revision 1/ }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore this version' }).click(); await expect(page.getByRole('img', { name: 'Original diagram', exact: true })).toBeVisible(); expect((await request.get(upload.data.url)).status()).toBe(200);
  } finally { await fixture.cleanup(); }
});
test('lost syllabus start acknowledgement reuses its key, and cancellation or invalid output creates no topics', async ({ page, request }) => {
  const fixture = await setup(request); let lost = false; let body: unknown; let key: string | undefined;
  try {
    await page.route('**/syllabus-generations', async route => {
      if (!lost) { lost = true; body = route.request().postDataJSON(); key = route.request().headers()['idempotency-key']; await route.fetch(); await route.abort(); }
      else { expect(route.request().postDataJSON()).toEqual(body); expect(route.request().headers()['idempotency-key']).toBe(key); await route.continue(); }
    });
    await page.goto(`/courses/${fixture.id}`); await page.getByLabel('Syllabus instructions').fill('slow fixture'); await page.getByRole('button', { name: 'Generate syllabus draft', exact: true }).click();
    await page.getByRole('button', { name: 'Retry syllabus start', exact: true }).click(); await page.getByRole('button', { name: 'Cancel generation', exact: true }).click(); await expect(page.getByText('syllabus: cancelled', { exact: true })).toBeVisible();
    await page.unroute('**/syllabus-generations');
    await page.getByLabel('Syllabus instructions').fill('invalid fixture'); await page.getByRole('button', { name: 'Generate syllabus draft', exact: true }).click(); await expect(page.getByText('syllabus: failed', { exact: true })).toBeVisible();
    const operations = await (await request.get(`/api/v1/courses/${fixture.id}/operations`)).json() as { data: { operations: unknown[] } }; expect(operations.data.operations).toHaveLength(2);
    const tree = await (await request.get(`/api/v1/courses/${fixture.id}/tree`)).json() as { data: { topics: unknown[] } }; expect(tree.data.topics).toHaveLength(0);
  } finally { await fixture.cleanup(); }
});
