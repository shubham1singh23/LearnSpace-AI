import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { defaultPreferences } from '@learnspace/shared';
export const chatHeaders = { Origin: 'http://127.0.0.1:3101', 'Content-Type': 'application/json' };
export async function chatFixture(request: APIRequestContext) {
  const original = await (await request.get('/api/v1/settings')).json() as { data: { textConfigId: string | null } };
  const config = await (await request.post('/api/v1/provider-configurations', { headers: chatHeaders, data: { purpose: 'text', provider: 'ollama', modelId: 'deterministic-chat', options: {}, credential: { source: 'none' } } })).json() as { data: { id: string } };
  await request.patch('/api/v1/settings', { headers: chatHeaders, data: { textConfigId: config.data.id } });
  const course = await (await request.post('/api/v1/courses', { headers: chatHeaders, data: { title: `Chat ${randomUUID()}`, goal: 'Teach safely', preferences: defaultPreferences } })).json() as { data: { id: string } };
  const topic = await (await request.post(`/api/v1/courses/${course.data.id}/topics`, { headers: chatHeaders, data: { baseTreeRevision: 0, parentId: null, title: 'Notes', kind: 'topic', position: 0, objectives: [] } })).json() as { data: { id: string } };
  const document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Saved learner customization.' }] }] };
  const lesson = await (await request.post(`/api/v1/topics/${topic.data.id}/lessons`, { headers: chatHeaders, data: { mutationId: randomUUID(), documentSchemaVersion: 1, document } })).json() as { data: { id: string } };
  return { courseId: course.data.id, topicId: topic.data.id, lessonId: lesson.data.id, document, path: `/courses/${course.data.id}/topics/${topic.data.id}`, start: async (message: string) => {
    const response = await request.post(`/api/v1/lessons/${lesson.data.id}/chat-turns`, { headers: { ...chatHeaders, 'Idempotency-Key': randomUUID() }, data: { baseRevision: 1, message, clientTurnId: randomUUID() } }); expect(response.status()).toBe(202); return (await response.json() as { data: { operationId: string } }).data.operationId;
  }, cleanup: async () => {
    const tree = await (await request.get(`/api/v1/courses/${course.data.id}/tree`)).json() as { data: { treeRevision: number } };
    await request.delete(`/api/v1/courses/${course.data.id}`, { headers: chatHeaders, data: { baseTreeRevision: tree.data.treeRevision, confirm: true } });
    await request.patch('/api/v1/settings', { headers: chatHeaders, data: { textConfigId: original.data.textConfigId } }); await request.delete(`/api/v1/provider-configurations/${config.data.id}`, { headers: chatHeaders, data: {} });
  } };
}
