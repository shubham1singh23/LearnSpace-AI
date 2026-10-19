import { test, expect } from '@playwright/test';
import { chatFixture, chatHeaders } from '../support/chat-fixture.js';
import { randomUUID } from 'node:crypto';

test('recovers durable chat after refresh with polling fallback and never modifies notes', async ({ page, request }) => {
  const f = await chatFixture(request);
  try {
    await f.start('slow fixture: explain saved notes');
    await page.route('**/operations/*/events', route => route.abort());
    await page.goto(f.path); await page.getByText('Lesson chat', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Lesson chat', exact: true });
    await expect(panel.getByText('A complete plain-text tutoring answer.', { exact: false })).toBeVisible();
    await expect(panel.getByText('tokens do not stream.', { exact: false })).toBeVisible();
    await page.reload(); await page.getByText('Lesson chat', { exact: true }).click();
    await expect(panel.getByText('A complete plain-text tutoring answer.', { exact: false })).toBeVisible();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: unknown; revision: number } }).data).toMatchObject({ document: f.document, revision: 1 });
    await expect(panel.getByRole('listitem')).toHaveCount(2);
  } finally { await f.cleanup(); }
});
test('journals a confirmed manual insertion, blocks downgrade and replays its exact PUT after refresh', async ({ page, request }) => {
  const f = await chatFixture(request); const bodies: string[] = [];
  try {
    await f.start('Explain notes'); await page.goto(f.path); await page.getByText('Lesson chat', { exact: true }).click();
    await page.getByRole('button', { name: 'Insert answer into notes' }).click(); const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await notes.click(); await page.keyboard.press('Control+End');
    const preview = page.getByRole('region', { name: 'Plain text insertion preview' }); await preview.getByRole('button', { name: 'Preview at current cursor' }).click();
    await page.route(`**/api/v1/lessons/${f.lessonId}`, async route => { if (route.request().method() !== 'PUT') return route.continue(); bodies.push(route.request().postData()!); await route.fetch(); await route.abort(); });
    page.once('dialog', dialog => dialog.accept()); await preview.getByRole('button', { name: 'Confirm plain text insertion' }).click();
    await expect.poll(() => bodies.length).toBe(3); await expect(notes).not.toBeEditable();
    expect(new Set(bodies).size).toBe(1); const body = JSON.parse(bodies[0]!) as Record<string, unknown>; expect(body.aiOperationId).toBeUndefined(); expect(body.imageOperationId).toBeUndefined();
    await page.unroute(`**/api/v1/lessons/${f.lessonId}`); await page.reload(); await page.getByRole('button', { name: 'Resume recovery draft', exact: true }).click();
    await expect(notes).not.toBeEditable(); await page.getByRole('button', { name: 'Retry pending insertion', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 2' })).toBeVisible(); await expect(notes).toBeEditable();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { revision: number } }).data.revision).toBe(2);
  } finally { await f.cleanup(); }
});
test('stale cursor previews and a competing saved revision cannot overwrite notes', async ({ page, request }) => {
  const f = await chatFixture(request);
  try {
    await f.start('Explain notes'); await page.goto(f.path); await page.getByText('Lesson chat', { exact: true }).click(); const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true });
    await page.getByRole('button', { name: 'Insert answer into notes' }).click(); await notes.click(); await page.keyboard.press('Control+End'); const preview = page.getByRole('region', { name: 'Plain text insertion preview' }); await preview.getByRole('button', { name: 'Preview at current cursor' }).click();
    await notes.click(); await page.keyboard.type('New typing'); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 1' })).toBeVisible(); page.once('dialog', dialog => dialog.accept()); await preview.getByRole('button', { name: 'Confirm plain text insertion' }).click(); await expect(preview.getByRole('alert')).toContainText('stale');
    await notes.click(); await page.keyboard.press('Control+End'); await preview.getByRole('button', { name: 'Preview at current cursor' }).click();
    const other = { ...f.document, content: [{ ...f.document.content[0]!, content: [{ type: 'text', text: 'Other tab saved this' }] }] };
    expect((await request.put(`/api/v1/lessons/${f.lessonId}`, { headers: chatHeaders, data: { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: other } })).ok()).toBe(true);
    page.once('dialog', dialog => dialog.accept()); await preview.getByRole('button', { name: 'Confirm plain text insertion' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Conflict · local notes retained' })).toBeVisible(); await expect(notes).not.toBeEditable();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: unknown } }).data.document).toEqual(other);
  } finally { await f.cleanup(); }
});
test('flushes edited notes before Send and replays an unknown start after refresh without duplicate turns', async ({ page, request }) => {
  const f = await chatFixture(request);
  try {
    await page.goto(f.path); const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toBeEditable();
    await notes.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Updated saved context.');
    await page.getByText('Lesson chat', { exact: true }).click(); const panel = page.getByRole('region', { name: 'Lesson chat', exact: true });
    await panel.getByRole('textbox', { name: 'Chat question' }).fill('Explain the updated context');
    let lost = false; await page.route('**/chat-turns', async route => { if (!lost) { lost = true; await route.fetch(); await route.abort(); } else await route.continue(); });
    await panel.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(panel.getByText('Send outcome is unknown.', { exact: false })).toBeVisible();
    await page.reload(); await page.getByText('Lesson chat', { exact: true }).click();
    await panel.getByRole('button', { name: 'Retry original Send', exact: true }).click();
    await expect(panel.getByText('A complete plain-text tutoring answer.', { exact: false })).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await expect(panel.getByText('Saved context revision 2', { exact: true })).toHaveCount(2);
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { revision: number } }).data.revision).toBe(2);
  } finally { await f.cleanup(); }
});
test('previews without mutation, explicitly inserts literal text with one undo event and history', async ({ page, request }) => {
  const f = await chatFixture(request);
  try {
    await f.start('Explain notes'); await page.goto(f.path); const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toBeEditable();
    await page.getByText('Lesson chat', { exact: true }).click(); const panel = page.getByRole('region', { name: 'Lesson chat', exact: true });
    await panel.getByRole('button', { name: 'Insert answer into notes' }).click();
    await notes.click(); await page.keyboard.press('Control+End');
    const preview = page.getByRole('region', { name: 'Plain text insertion preview' }); await preview.getByRole('button', { name: 'Preview at current cursor' }).click();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { revision: number } }).data.revision).toBe(1);
    await preview.getByRole('button', { name: 'Reject insertion' }).click(); await expect(notes).not.toContainText('A complete plain-text');
    await panel.getByRole('button', { name: 'Insert answer into notes' }).click(); await notes.click(); await page.keyboard.press('Control+End');
    await preview.getByRole('button', { name: 'Preview at current cursor' }).click(); page.once('dialog', dialog => dialog.accept()); await preview.getByRole('button', { name: 'Confirm plain text insertion' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 2' })).toBeVisible(); await expect(notes).toContainText('A complete plain-text tutoring answer.');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(notes).not.toContainText('A complete plain-text'); await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 3' })).toBeVisible(); await expect(notes).toContainText('Saved learner customization.');
    const messages = await (await request.get(`/api/v1/lessons/${f.lessonId}/messages`)).json() as { data: { messages: unknown[] } }; expect(messages.data.messages).toHaveLength(2);
  } finally { await f.cleanup(); }
});
