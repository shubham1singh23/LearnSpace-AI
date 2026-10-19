import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { defaultPreferences, tiptapDocumentSchema, type TiptapDocument } from '@learnspace/shared';
import { allNodesFixture } from '../fixtures/document.js';
import sharp from 'sharp';

const origin = 'http://127.0.0.1:3101';
const courses: string[] = [];
async function send(request: APIRequestContext, path: string, data: unknown, method = 'POST') {
  const response = await request.fetch(`/api/v1${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, data });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.status() === 204 ? undefined : await response.json() as { data: Record<string, unknown> };
}
async function setup(request: APIRequestContext, document: TiptapDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Original notes' }] }] }) {
  const course = await send(request, '/courses', { title: `Browser fixture ${randomUUID().slice(0, 6)}`, goal: 'Verify preservation', preferences: defaultPreferences });
  const courseId = String(course!.data.id); courses.push(courseId);
  for (const node of document.content) if (node.type === 'image' && node.attrs) {
    const buffer = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#8fbc8f' } }).png().toBuffer();
    const uploaded = await request.post(`/api/v1/courses/${courseId}/assets`, { headers: { Origin: origin, 'X-LearnSpace-Request': '1' }, multipart: { file: { name: 'fixture.png', mimeType: 'image/png', buffer } } });
    expect(uploaded.status()).toBe(201); const asset = await uploaded.json() as { data: { id: string } }; node.attrs.assetId = asset.data.id;
  }
  const tree = await send(request, `/courses/${courseId}/topics`, { baseTreeRevision: 0, parentId: null, title: 'First lesson', kind: 'topic', position: 0, objectives: [] });
  const topicId = String(tree!.data.id);
  const next = await send(request, `/courses/${courseId}/topics`, { baseTreeRevision: 1, parentId: null, title: 'Second lesson', kind: 'topic', position: 1, objectives: [] });
  void next;
  const lesson = await send(request, `/topics/${topicId}/lessons`, { mutationId: randomUUID(), documentSchemaVersion: 1, document });
  return { courseId, topicId, lessonId: String(lesson!.data.id), path: `/courses/${courseId}/topics/${topicId}` };
}
async function open(page: Page, path: string) { await page.goto(path); await expect(page.getByRole('textbox', { name: 'Lesson notes' })).toBeEditable(); }
async function saved(page: Page) { await expect(page.getByRole('status').filter({ hasText: /Saved · revision [2-9]/ })).toBeVisible(); }
test.afterEach(async ({ request }) => {
  for (const id of courses.splice(0)) {
    const response = await request.get(`/api/v1/courses/${id}`); if (response.status() === 404) continue;
    const course = await response.json() as { data: { treeRevision: number } };
    await send(request, `/courses/${id}`, { baseTreeRevision: course.data.treeRevision, confirm: true }, 'DELETE');
  }
});
test('manual course creation, blank notes, formatting, autosave and reload', async ({ page }) => {
  await page.goto('/');
  let prompt = 0; const createDialog = (dialog: import('@playwright/test').Dialog) => dialog.accept(prompt++ === 0 ? 'Browser-created course' : 'Learn data integrity');
  page.on('dialog', createDialog);
  await page.getByRole('button', { name: 'New course', exact: true }).click();
  await page.waitForURL(/\/courses\//);
  page.off('dialog', createDialog);
  const id = page.url().split('/courses/')[1]!; courses.push(id);
  page.once('dialog', dialog => dialog.accept('Manual topic'));
  await page.getByRole('button', { name: 'Add root topic' }).click();
  await page.getByRole('button', { name: 'Manual topic', exact: true }).click();
  await page.getByRole('button', { name: 'Create blank notes' }).click();
  const notes = page.getByRole('textbox', { name: 'Lesson notes' }); await expect(notes).toBeEditable();
  await notes.fill('My saved manual explanation 🙂');
  await notes.press('ControlOrMeta+a'); await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await saved(page); await page.reload(); await expect(notes).toContainText('My saved manual explanation 🙂');
  await expect(notes.locator('strong')).toContainText('My saved');
});
test('typing during an in-flight save and route navigation flushes the newest edit', async ({ page, request }) => {
  const fixture = await setup(request); await open(page, fixture.path);
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); let intercepted!: () => void; const started = new Promise<void>(resolve => { intercepted = resolve; }); let first = true;
  await page.route(`**/api/v1/lessons/${fixture.lessonId}`, async route => {
    if (route.request().method() !== 'PUT' || !first) return route.continue();
    first = false; intercepted(); await wait; await route.continue();
  });
  const notes = page.getByRole('textbox', { name: 'Lesson notes' }); await notes.fill('First snapshot'); await started;
  await notes.press('End'); await notes.pressSequentially(' plus newest typing');
  await page.getByRole('button', { name: 'Second lesson', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Navigation protection' })).toBeVisible();
  release(); await expect(page.getByRole('heading', { name: 'Second lesson' })).toBeVisible();
  await page.getByRole('button', { name: 'First lesson', exact: true }).click();
  await expect(notes).toContainText('First snapshot plus newest typing'); await saved(page);
});
test('a lost save acknowledgement replays the same mutation and creates one snapshot', async ({ page, request }) => {
  const fixture = await setup(request); await open(page, fixture.path);
  const bodies: unknown[] = []; let first = true;
  await page.route(`**/api/v1/lessons/${fixture.lessonId}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    bodies.push(route.request().postDataJSON());
    if (first) { first = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Lesson notes' }).fill('Acknowledgement lost but saved'); await saved(page);
  expect(bodies.length).toBeGreaterThanOrEqual(2); expect(bodies[0]).toEqual(bodies[1]);
  const versions = await request.get(`/api/v1/lessons/${fixture.lessonId}/versions`); const result = await versions.json() as { data: { currentRevision: number; versions: unknown[] } };
  expect(result.data.currentRevision).toBe(2); expect(result.data.versions).toHaveLength(1);
});
test('two tabs conflict without overwriting local notes and explicit overwrite retains server history', async ({ page, context, request }) => {
  const fixture = await setup(request); const other = await context.newPage();
  await open(page, fixture.path); await open(other, fixture.path);
  await page.getByRole('textbox', { name: 'Lesson notes' }).fill('First tab wins'); await saved(page);
  await other.getByRole('textbox', { name: 'Lesson notes' }).fill('Second tab local copy');
  await expect(other.getByRole('status').filter({ hasText: 'Conflict' })).toBeVisible();
  await expect(other.getByRole('textbox', { name: 'Lesson notes' })).toContainText('Second tab local copy');
  await other.getByRole('button', { name: 'Compare server copy' }).click();
  await expect(other.getByRole('region', { name: 'Conflict comparison' })).toContainText('First tab wins');
  other.once('dialog', dialog => dialog.accept()); await other.getByRole('button', { name: 'Save local copy over server' }).click(); await saved(other);
  const result = await (await request.get(`/api/v1/lessons/${fixture.lessonId}/versions/2`)).json() as { data: { document: unknown } };
  expect(JSON.stringify(result.data.document)).toContain('First tab wins'); await other.close();
});
test('IndexedDB recovery survives reload after failed saves and resumes only by explicit choice', async ({ page, request }) => {
  const fixture = await setup(request); await open(page, fixture.path);
  await page.route(`**/api/v1/lessons/${fixture.lessonId}`, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await page.getByRole('textbox', { name: 'Lesson notes' }).fill('Recovered after browser reload');
  await expect(page.getByRole('status').filter({ hasText: 'Save failed' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(page.getByRole('region', { name: 'Recovery draft' })).toBeVisible();
  await page.unroute(`**/api/v1/lessons/${fixture.lessonId}`);
  await page.getByRole('button', { name: 'Resume recovery draft' }).click();
  await expect(page.getByRole('textbox', { name: 'Lesson notes' })).toContainText('Recovered after browser reload');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click(); await saved(page);
});
test('failed navigation stays on the lesson, supports browser back, and warns on unload', async ({ page, request }) => {
  const fixture = await setup(request); await page.goto(`/courses/${fixture.courseId}`); await page.getByRole('button', { name: 'First lesson', exact: true }).click();
  const notes = page.getByRole('textbox', { name: 'Lesson notes' }); await expect(notes).toBeEditable();
  await page.route(`**/api/v1/lessons/${fixture.lessonId}`, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await notes.fill('Keep these notes'); await page.goBack();
  await expect(page.getByRole('region', { name: 'Navigation protection' })).toContainText(/Failed to fetch|fetch|failed/i);
  expect(page.url()).toContain(fixture.topicId);
  await page.getByRole('button', { name: 'Stay here' }).click(); await expect(notes).toBeEditable();
  const warned = page.waitForEvent('dialog'); const reload = page.evaluate(() => { window.location.reload(); });
  const dialog = await warned; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); await reload;
  await page.unroute(`**/api/v1/lessons/${fixture.lessonId}`); await page.getByRole('button', { name: 'Retry save', exact: true }).click(); await saved(page);
});
test('all-node JSON survives editing, version preview, restoration, and reload', async ({ page, request }) => {
  const fixture = await setup(request, tiptapDocumentSchema.parse(allNodesFixture())); await open(page, fixture.path);
  await page.getByRole('textbox', { name: 'Lesson notes' }).locator('h6').click();
  await page.keyboard.press('Home'); await page.keyboard.type('Edited '); await saved(page);
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByRole('button', { name: /Preview revision 1/ }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByRole('textbox', { name: 'Lesson notes' }).locator('h6')).toHaveText('Heading');
  const result = await (await request.get(`/api/v1/topics/${fixture.topicId}/lesson`)).json() as { data: { revision: number } };
  expect(result.data.revision).toBe(3);
});
test('uploaded images stay readable from historical revisions and restore through the UI', async ({ page, request }) => {
  const fixture = await setup(request); await open(page, fixture.path);
  const buffer = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#408050' } }).png().toBuffer();
  await page.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('img', { name: 'Upload preview' })).toBeVisible();
  await page.getByLabel('Image description', { exact: true }).fill('Retained diagram');
  await page.getByLabel('Image caption', { exact: true }).fill('Historical caption');
  await page.getByRole('button', { name: 'Insert image at captured cursor' }).click();
  const image = page.getByRole('textbox', { name: 'Lesson notes' }).getByRole('img', { name: 'Retained diagram' });
  await expect(image).toBeVisible(); await saved(page);
  const src = await image.getAttribute('src'); expect(src).toBeTruthy();
  await image.click(); await page.getByRole('button', { name: 'Remove selected image', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lesson notes' }).fill('Image removed from current notes'); await saved(page);
  await expect(image).toHaveCount(0);
  expect((await request.get(src!)).status()).toBe(200);
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByRole('button', { name: /Preview revision 2/ }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(image).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Lesson notes' })).toContainText('Historical caption');
  expect((await request.get(src!)).status()).toBe(200);
});
test('a lost restore acknowledgement retries the identical mutation without making another revision', async ({ page, request }) => {
  const fixture = await setup(request); await open(page, fixture.path);
  await page.getByRole('textbox', { name: 'Lesson notes' }).fill('Changed before restore'); await saved(page);
  await page.getByRole('button', { name: 'Version history', exact: true }).click(); await page.getByRole('button', { name: /Preview revision 1/ }).click();
  let first = true; const bodies: unknown[] = [];
  await page.route(`**/api/v1/lessons/${fixture.lessonId}/restores`, async route => {
    bodies.push(route.request().postDataJSON());
    if (first) { first = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByRole('textbox', { name: 'Lesson notes' })).not.toBeEditable();
  await page.getByRole('button', { name: 'Retry pending restore' }).click();
  await expect(page.getByRole('textbox', { name: 'Lesson notes' })).toContainText('Original notes');
  expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
  const result = await (await request.get(`/api/v1/topics/${fixture.topicId}/lesson`)).json() as { data: { revision: number } };
  expect(result.data.revision).toBe(3);
});

