import { test, expect } from '@playwright/test';
import { chatFixture, chatHeaders } from '../support/chat-fixture.js';
import { randomUUID } from 'node:crypto';
import { defaultPreferences } from '@learnspace/shared';

test('explicit progress and course preferences preserve notes and remain reversible', async ({ page, request }) => {
  const f = await chatFixture(request);
  try {
    await page.goto(f.path); await expect(page.getByRole('combobox', { name: 'Leaf progress' })).toHaveValue('not_started');
    await page.getByRole('combobox', { name: 'Leaf progress' }).selectOption('completed'); await expect(page.getByText('1/1 leaves completed', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('combobox', { name: 'Leaf progress' })).toHaveValue('completed');
    await page.getByRole('combobox', { name: 'Leaf progress' }).selectOption('in_progress'); await expect(page.getByText('0/1 leaves completed', { exact: true })).toBeVisible();
    await page.getByText('Teaching preferences for this course', { exact: true }).click(); const form = page.getByRole('form', { name: 'Course teaching preferences' });
    await form.getByLabel('Course depth').selectOption('deep'); await form.getByRole('button', { name: 'Save course preferences', exact: true }).click(); await expect(form.getByText('Course preferences saved.', { exact: false })).toBeVisible();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: unknown; revision: number } }).data).toMatchObject({ document: f.document, revision: 1 });
    const response = await request.post(`/api/v1/courses/${f.courseId}/topics`, { headers: chatHeaders, data: { baseTreeRevision: 2, parentId: f.topicId, title: 'Unsafe child', kind: 'topic', position: 0, objectives: [] } }); expect(response.status()).toBe(409);
  } finally { await f.cleanup(); }
});
test('reading, reflection and paired recall make no writes; scratch insertion is explicit and undoable', async ({ page, request }) => {
  const f = await chatFixture(request); const group = randomUUID();
  const text = (value: string, attrs: Record<string, string | number> = {}) => ({ type: 'paragraph', attrs: { blockId: randomUUID(), ...attrs }, content: [{ type: 'text', text: value }] });
  const document = { type: 'doc', content: [{ ...text('Foundations', { level: 2 }), type: 'heading' }, text('Reflect on the concept', { learningRole: 'reflection', learningGroupId: randomUUID() }), text('After reflection'), { ...text('Recall', { level: 2 }), type: 'heading' }, text('What stops recursion?', { learningRole: 'recall_question', learningGroupId: group }), text('A base case', { learningRole: 'recall_answer', learningGroupId: group })] };
  try {
    expect((await request.put(`/api/v1/lessons/${f.lessonId}`, { headers: chatHeaders, data: { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document } })).ok()).toBe(true);
    await request.patch(`/api/v1/courses/${f.courseId}`, { headers: chatHeaders, data: { baseTreeRevision: 1, preferences: { ...defaultPreferences, pace: 'guided', reflectionPauses: true } } });
    let writes = 0; page.on('request', req => { if (req.method() === 'PUT' && req.url().endsWith(`/lessons/${f.lessonId}`)) writes++; });
    await page.goto(f.path); const notes = page.getByRole('textbox', { name: 'Lesson notes', exact: true }); await expect(notes).toBeEditable();
    await page.getByRole('button', { name: 'Read and practice', exact: true }).click(); await expect(notes).not.toBeEditable();
    await expect(notes.getByText('After reflection', { exact: true })).not.toBeVisible(); await page.getByRole('button', { name: 'Continue after reflection 1' }).click(); await expect(notes.getByText('After reflection', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue section' }).click(); await expect(notes.getByText('A base case', { exact: true })).not.toBeVisible();
    await page.getByRole('textbox', { name: `Practice answer ${group}` }).fill('My own explanation'); await page.getByRole('button', { name: 'Reveal recall answer' }).click(); await expect(notes.getByText('A base case', { exact: true })).toBeVisible(); expect(writes).toBe(0);
    await page.getByRole('button', { name: 'Insert my answer' }).click(); await expect(notes).toBeEditable(); await notes.click(); await page.keyboard.press('Control+End');
    const preview = page.getByRole('region', { name: 'Plain text insertion preview' }); await preview.getByRole('button', { name: 'Preview at current cursor' }).click(); page.once('dialog', dialog => dialog.accept()); await preview.getByRole('button', { name: 'Confirm plain text insertion' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 3' })).toBeVisible(); await expect(notes).toContainText('My own explanation');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(notes).not.toContainText('My own explanation'); await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved · revision 4' })).toBeVisible();
    expect((await (await request.get(`/api/v1/topics/${f.topicId}/lesson`)).json() as { data: { document: unknown } }).data.document).toEqual(document);
  } finally { await f.cleanup(); }
});
