import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { defaultPreferences, type TiptapDocument } from '@learnspace/shared';
import sharp from 'sharp';
const headers = { Origin: 'http://127.0.0.1:3101', 'Content-Type': 'application/json' };
async function setup(request: APIRequestContext) {
  const original = await (await request.get('/api/v1/settings')).json() as { data: { textConfigId: string | null } };
  const config = await (await request.post('/api/v1/provider-configurations', { headers, data: { purpose: 'text', provider: 'ollama', modelId: 'deterministic-browser', options: {}, credential: { source: 'none' } } })).json() as { data: { id: string } };
  await request.patch('/api/v1/settings', { headers, data: { textConfigId: config.data.id } });
  const course = await (await request.post('/api/v1/courses', { headers, data: { title: `Selection ${randomUUID()}`, goal: 'Teach safely', preferences: defaultPreferences } })).json() as { data: { id: string } };
  const topic = await (await request.post(`/api/v1/courses/${course.data.id}/topics`, { headers, data: { baseTreeRevision: 0, parentId: null, title: 'Notes', kind: 'topic', position: 0, objectives: [] } })).json() as { data: { id: string } };
  const document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID(), learningRole: 'reflection' }, content: [{ type: 'text', text: 'Original notes with 😀 Unicode.', marks: [{ type: 'bold' }] }] }, { type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Untouched content.' }] }] };
  const lesson = await (await request.post(`/api/v1/topics/${topic.data.id}/lessons`, { headers, data: { mutationId: randomUUID(), documentSchemaVersion: 1, document } })).json() as { data: { id: string } };
  return { courseId: course.data.id, topicId: topic.data.id, lessonId: lesson.data.id, document, path: `/courses/${course.data.id}/topics/${topic.data.id}`, cleanup: async () => {
    const tree = await (await request.get(`/api/v1/courses/${course.data.id}/tree`)).json() as { data: { treeRevision: number } };
    await request.delete(`/api/v1/courses/${course.data.id}`, { headers, data: { baseTreeRevision: tree.data.treeRevision, confirm: true } });
    await request.patch('/api/v1/settings', { headers, data: { textConfigId: original.data.textConfigId } }); await request.delete(`/api/v1/provider-configurations/${config.data.id}`, { headers, data: {} });
  } };
}
async function selectFirst(page: Page) {
  const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true });
  await expect(notes).toBeEditable();
  // Select an exact DOM range rather than depending on native word-navigation
  // timing while focus is returning from the toolbar. This exercises the real
  // browser selection/ProseMirror capture path without calling editor commands.
  await notes.evaluate(node => {
    node.focus(); const paragraph = node.querySelector('p'); if (!paragraph) throw new Error('Missing paragraph');
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT); const text = walker.nextNode(); if (!text) throw new Error('Missing text');
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 9);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Original '); return notes;
}
test('captures, previews and rejects without mutation; refresh recovery is view only', async ({ page, request }) => {
  const f = await setup(request);
  try {
    await page.goto(f.path); await selectFirst(page);
    await page.getByRole('button', { name: 'Generate selection proposal' }).click();
    const local = page.getByRole('region', { name: 'AI selection editing' });
    await expect(local.getByRole('region', { name: 'Selection proposal preview' })).toBeVisible();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { revision: number } }).data.revision).toBe(1);
    await local.getByRole('button', { name: 'Reject proposal' }).click(); await expect(local.getByText('edit: rejected', { exact: true })).toBeVisible();
    await selectFirst(page); await local.getByRole('button', { name: 'Generate selection proposal' }).click();
    await expect(local.getByRole('region', { name: 'Selection proposal preview' })).toBeVisible();
    await page.reload(); await page.getByText('Course generation activity', { exact: true }).click();
    await expect(page.getByRole('region', { name: 'Selection proposal preview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept selection edit', exact: true })).toHaveCount(0);
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: unknown } }).data.document).toEqual(f.document);
  } finally { await f.cleanup(); }
});
test('accepts an exact replacement without reload and retains one undo event and history', async ({ page, request }) => {
  const f = await setup(request);
  try {
    await page.goto(f.path); await page.getByRole('combobox', { name: 'Selection action', exact: true }).selectOption('simplify'); await selectFirst(page);
    const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click();
    await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeEnabled();
    // Moving the caret does not retarget or invalidate the captured proposal.
    await page.getByRole('textbox', { name: 'Lesson notes', exact: true }).click(); await page.keyboard.press('Control+End');
    page.once('dialog', dialog => dialog.accept()); await local.getByRole('button', { name: 'Accept selection edit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 2' })).toBeVisible();
    const current = await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: TiptapDocument } };
    expect(current.data.document.content[1]).toEqual(f.document.content[1]); expect(current.data.document.content[0]?.attrs).toEqual(f.document.content[0]?.attrs);
    expect(current.data.document.content[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Original notes');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 4' })).toBeVisible(); await page.reload();
    await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Proposed selection content.');
    await page.getByRole('button', { name: 'Version history', exact: true }).click(); await page.getByRole('button', { name: /Preview revision 1/ }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore this version' }).click();
    await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Original notes');
  } finally { await f.cleanup(); }
});
for (const action of ['explain', 'expand', 'rewrite', 'example', 'analogy', 'custom'] as const) test(`${action} accepts only its constrained insertion or replacement`, async ({ page, request }) => {
  const f = await setup(request);
  try {
    await page.goto(f.path); await page.getByRole('combobox', { name: 'Selection action', exact: true }).selectOption(action);
    if (action === 'custom') await page.getByRole('textbox', { name: 'Selection instructions', exact: true }).fill('Improve the wording');
    await selectFirst(page); const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click();
    await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeEnabled(); page.once('dialog', dialog => dialog.accept()); await local.getByRole('button', { name: 'Accept selection edit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 2' })).toBeVisible();
    const current = await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: typeof f.document } };
    expect(current.data.document.content.at(-1)).toEqual(f.document.content.at(-1)); expect(current.data.document.content[0]?.attrs).toEqual(f.document.content[0]?.attrs);
    if (['explain', 'example', 'analogy'].includes(action)) { expect(current.data.document.content[0]).toEqual(f.document.content[0]); expect(current.data.document.content).toHaveLength(3); }
    else expect(current.data.document.content).toHaveLength(2);
    await page.reload(); await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Proposed selection content.');
  } finally { await f.cleanup(); }
});
test('typing anywhere, undo and redo permanently invalidate the captured proposal', async ({ page, request }) => {
  const f = await setup(request);
  try {
    await page.goto(f.path); await page.getByRole('textbox', { name: 'Selection instructions', exact: true }).fill('slow fixture'); await selectFirst(page);
    const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click();
    await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeEnabled();
    const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toBeEditable(); await notes.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' outside');
    await expect(local.getByText('This selection proposal is stale. Generate a new proposal from saved notes.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeDisabled();
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  } finally { await f.cleanup(); }
});
test('lost acceptance acknowledgement survives refresh with its immutable body and blocks unsafe navigation', async ({ page, request }) => {
  const f = await setup(request); let firstBody: unknown; let sends = 0;
  try {
    await request.post(`/api/v1/courses/${f.courseId}/topics`, { headers, data: { baseTreeRevision: 1, parentId: null, title: 'Other topic', kind: 'topic', position: 1, objectives: [] } });
    await page.goto(f.path); await page.getByRole('combobox', { name: 'Selection action', exact: true }).selectOption('rewrite'); await selectFirst(page);
    const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click(); await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeEnabled();
    await page.route(`**/api/v1/lessons/${f.lessonId}`, async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      const body: unknown = route.request().postDataJSON(); if (!firstBody) firstBody = body; else expect(body).toEqual(firstBody);
      sends++; if (sends === 1) await route.fetch(); await route.abort();
    });
    page.once('dialog', dialog => dialog.accept()); await local.getByRole('button', { name: 'Accept selection edit' }).click();
    await expect.poll(() => sends).toBe(3); await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toHaveAttribute('contenteditable', 'false');
    await page.getByRole('button', { name: 'Other topic', exact: true }).click(); await expect(page.getByRole('region', { name: 'Navigation protection' })).toBeVisible();
    await page.getByRole('button', { name: 'Stay here', exact: true }).click();
    page.once('dialog', dialog => dialog.accept()); await page.reload();
    await page.getByRole('button', { name: 'Resume recovery draft', exact: true }).click();
    await page.unroute(`**/api/v1/lessons/${f.lessonId}`);
    await page.route(`**/api/v1/lessons/${f.lessonId}`, async route => { if (route.request().method() === 'PUT') expect(route.request().postDataJSON()).toEqual(firstBody); await route.continue(); });
    await page.getByRole('button', { name: 'Retry pending AI acceptance', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 2' })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toBeEditable();
    const value = await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { revision: number } }; expect(value.data.revision).toBe(2);
  } finally { await f.cleanup(); }
});
test('two tabs cannot accept a proposal over a newer revision', async ({ page, request, context }) => {
  const f = await setup(request); const second = await context.newPage();
  try {
    await page.goto(f.path); await page.getByRole('combobox', { name: 'Selection action', exact: true }).selectOption('rewrite'); await selectFirst(page);
    const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click(); await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeEnabled();
    await second.goto(f.path); const notes = second.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toBeEditable(); await notes.click(); await second.keyboard.press('Control+End'); await second.keyboard.type(' Newer tab edit'); await second.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(second.getByRole('status').filter({ hasText: 'Saved · revision 2' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await local.getByRole('button', { name: 'Accept selection edit' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Conflict · local notes retained' })).toBeVisible();
    await page.getByRole('button', { name: 'Compare server copy', exact: true }).click(); await expect(page.getByRole('button', { name: 'Save local copy over server' })).toBeDisabled();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Load server copy', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Lesson notes', exact: true })).toContainText('Newer tab edit');
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { revision: number } }).data.revision).toBe(2);
  } finally { await second.close(); await f.cleanup(); }
});
test('unsupported cursor selections, cancellation and invalid output never mutate notes', async ({ page, request }) => {
  const f = await setup(request);
  try {
    await page.goto(f.path); const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toBeEditable(); await notes.click();
    const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click(); await expect(local.getByRole('alert')).toContainText('nonempty');
    await local.getByRole('textbox', { name: 'Selection instructions', exact: true }).fill('slow fixture'); await selectFirst(page); await local.getByRole('button', { name: 'Generate selection proposal' }).click();
    await local.getByRole('button', { name: 'Cancel generation' }).click(); await expect(local.getByText('edit: cancelled', { exact: true })).toBeVisible();
    await local.getByRole('textbox', { name: 'Selection instructions', exact: true }).fill('invalid fixture'); await selectFirst(page); await local.getByRole('button', { name: 'Generate selection proposal' }).click(); await expect(local.getByText('edit: failed', { exact: true })).toBeVisible();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: unknown } }).data.document).toEqual(f.document);
  } finally { await f.cleanup(); }
});
test('selection edits keep image bytes available in snapshots and restoration', async ({ page, request }) => {
  const f = await setup(request);
  try {
    const buffer = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#408050' } }).png().toBuffer();
    const upload = await (await request.post(`/api/v1/courses/${f.courseId}/assets`, { headers: { Origin: headers.Origin, 'X-LearnSpace-Request': '1' }, multipart: { file: { name: 'selection.png', mimeType: 'image/png', buffer } } })).json() as { data: { id: string; url: string } };
    const document = { ...f.document, content: [...f.document.content, { type: 'image', attrs: { blockId: randomUUID(), assetId: upload.data.id, alt: 'Selection diagram', width: 8, height: 6 } }] };
    expect((await request.put(`/api/v1/lessons/${f.lessonId}`, { headers, data: { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document } })).ok()).toBe(true);
    await page.goto(f.path); await page.getByRole('combobox', { name: 'Selection action', exact: true }).selectOption('rewrite'); await selectFirst(page);
    const local = page.getByRole('region', { name: 'AI selection editing' }); await local.getByRole('button', { name: 'Generate selection proposal' }).click(); await expect(local.getByRole('button', { name: 'Accept selection edit' })).toBeEnabled();
    page.once('dialog', dialog => dialog.accept()); await local.getByRole('button', { name: 'Accept selection edit' }).click(); await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 3' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Selection diagram', exact: true })).toBeVisible(); expect((await request.get(upload.data.url)).status()).toBe(200);
    await page.getByRole('button', { name: 'Version history', exact: true }).click(); await page.getByRole('button', { name: /Preview revision 2/ }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore this version' }).click();
    await expect(page.getByRole('img', { name: 'Selection diagram', exact: true })).toBeVisible(); expect((await request.get(upload.data.url)).status()).toBe(200);
  } finally { await f.cleanup(); }
});
