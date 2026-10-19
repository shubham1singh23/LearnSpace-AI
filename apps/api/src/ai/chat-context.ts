import { tiptapDocumentSchema, type ContextManifest, type DocumentNode, type ModelSnapshot } from '@learnspace/shared';
import { chatSystem } from '@learnspace/ai';
import { HttpError } from '../errors.js';
import { hashJSON } from '../workspace/lesson-service.js';
import type { Transaction } from '../workspace/transactions.js';

interface SavedSource { id: string; revision: number; document: unknown }
interface Block { id: string; type: string; text: string; index: number }
export interface ChatContextInput {
  question: string; selectedBlockIds: string[]; treeRevision: number; goal: string; preferences: unknown; path: string[]; objectives: unknown;
  current: SavedSource; prerequisites: { title: string; choice: string; lesson: SavedSource | null }[];
  history: { user: { id: string; content: string }; assistant: { id: string; content: string } }[];
}
export function selectChatContext(data: ChatContextInput, model: ModelSnapshot) {
  const budget = Math.min(12000, model.capabilities.contextWindow - model.options.maxOutputTokens - 1024);
  const omissions = new Set<'budget' | 'unsupported_media' | 'missing_prerequisite' | 'history_limit'>();
  const blocks = (source: SavedSource): Block[] => {
    const document = tiptapDocumentSchema.parse(source.document); const result: Block[] = [];
    const plain = (node: DocumentNode): string => node.type === 'image' ? '' : typeof node.attrs?.latex === 'string' ? node.attrs.latex : node.text ?? (node.type === 'hardBreak' ? '\n' : node.content?.map(plain).join('') ?? '');
    const visit = (node: DocumentNode) => {
      if (node.type === 'image') { omissions.add('unsupported_media'); return; }
      if (['paragraph', 'heading', 'codeBlock', 'mathBlock'].includes(node.type) && typeof node.attrs?.blockId === 'string') { result.push({ id: node.attrs.blockId, type: node.type, text: plain(node), index: result.length }); return; }
      node.content?.forEach(visit);
    };
    document.content.forEach(visit); return result;
  };
  const current = blocks(data.current); const byId = new Map(current.map(block => [block.id, block]));
  if (data.selectedBlockIds.some(id => !byId.has(id) || !['paragraph', 'heading'].includes(byId.get(id)!.type))) throw new HttpError(422, 'INVALID_SELECTION', 'Select eligible saved text blocks.');
  const payload = { question: data.question, goal: data.goal, preferences: data.preferences, path: data.path, objectives: data.objectives, capturedTreeRevision: data.treeRevision, unavailablePrerequisites: [] as { title: string; choice: string; reason: string }[], notes: [] as { lessonId: string; revision: number; title: string; choice: string; blocks: Block[] }[], history: [] as ChatContextInput['history'] };
  const size = () => Buffer.byteLength(chatSystem + JSON.stringify(payload));
  if (size() > budget) throw new HttpError(422, 'CONTEXT_BUDGET_EXCEEDED', 'Question and course context exceed the configured input budget. Shorten the question or background.');
  const main = { lessonId: data.current.id, revision: data.current.revision, title: 'Saved edited notes', choice: 'current', blocks: [] as Block[] }; payload.notes.push(main);
  if (size() > budget) throw new HttpError(422, 'CONTEXT_BUDGET_EXCEEDED', 'Required context labels exceed the input budget.');
  const included = new Set<string>();
  const add = (block: Block, destination: typeof main, mandatory = false) => {
    destination.blocks.push(block);
    if (size() > budget) { destination.blocks.pop(); omissions.add('budget'); if (mandatory) throw new HttpError(422, 'CONTEXT_BUDGET_EXCEEDED', 'The selected complete block exceeds the input budget. Select a smaller block.'); return false; }
    return true;
  };
  for (const id of data.selectedBlockIds) { const block = byId.get(id)!; add(block, main, true); included.add(id); }
  const words = new Set(data.question.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []);
  const selectedIndexes = data.selectedBlockIds.map(id => byId.get(id)!.index);
  const score = (block: Block) => (selectedIndexes.some(index => Math.abs(index - block.index) === 1) ? 1000 : 0) + (block.type === 'heading' ? 100 : 0) + (block.text.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => words.has(word)).length;
  for (const block of [...current].sort((a, b) => score(b) - score(a) || a.index - b.index || a.id.localeCompare(b.id))) if (!included.has(block.id) && add(block, main)) included.add(block.id);
  main.blocks.sort((a, b) => a.index - b.index);
  if (data.prerequisites.length > 3) omissions.add('budget');
  for (const edge of data.prerequisites.slice(0, 3)) {
    if (!edge.lesson) { omissions.add('missing_prerequisite'); payload.unavailablePrerequisites.push({ title: edge.title, choice: edge.choice, reason: 'No saved prerequisite notes' }); if (size() > budget) { payload.unavailablePrerequisites.pop(); omissions.add('budget'); } continue; }
    const source = { lessonId: edge.lesson.id, revision: edge.lesson.revision, title: edge.title, choice: edge.choice, blocks: [] as Block[] }; payload.notes.push(source);
    if (size() > budget) { payload.notes.pop(); omissions.add('budget'); continue; }
    for (const block of blocks(edge.lesson)) add(block, source);
  }
  if (data.history.length > 6) omissions.add('history_limit');
  // Most recent complete pairs have priority; serialize accepted pairs chronologically.
  for (const turn of data.history.slice(-6).reverse()) { payload.history.unshift(turn); if (size() > budget) { payload.history.shift(); omissions.add('budget'); } }
  const input = JSON.stringify(payload); const contextHash = hashJSON(input);
  const context: ContextManifest = { sources: payload.notes.map(source => ({ lessonId: source.lessonId, revision: source.revision, blockIds: source.blocks.map(block => block.id) })), omitted: omissions.size > 0, chat: { algorithm: 'chat-v1', treeRevision: data.treeRevision, historyMessageIds: payload.history.flatMap(turn => [turn.user.id, turn.assistant.id]), selectedBlockIds: data.selectedBlockIds, omissions: [...omissions], contextHash } };
  return { input, context };
}
export async function captureChatContext(tx: Transaction, lessonId: string, question: string, selectedBlockIds: string[], model: ModelSnapshot) {
  const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { topic: { include: { course: true } } } });
  const course = lesson.topic.course;
  const topics = await tx.topic.findMany({ where: { courseId: course.id }, take: 2001, select: { id: true, title: true, parentId: true } });
  if (topics.length > 2000) throw new HttpError(422, 'CONTEXT_BUDGET_EXCEEDED', 'Course exceeds the supported context traversal limit.');
  const byId = new Map(topics.map(topic => [topic.id, topic])); const path: string[] = []; const seen = new Set<string>(); let id: string | null = lesson.topicId;
  while (id) { const topic = byId.get(id); if (!topic || seen.has(id)) throw new HttpError(409, 'INVALID_TREE', 'Topic path is invalid.'); seen.add(id); path.unshift(topic.title); id = topic.parentId; }
  const prerequisites = await tx.topicPrerequisite.findMany({ where: { topicId: lesson.topicId }, take: 4, orderBy: { prerequisiteId: 'asc' }, include: { prerequisite: { include: { lesson: true } } } });
  const users = await tx.chatMessage.findMany({ where: { lessonId, role: 'user', status: 'completed' }, orderBy: { sequence: 'desc' }, take: 7 });
  const assistants = await tx.chatMessage.findMany({ where: { lessonId, role: 'assistant', status: 'completed', turnId: { in: users.map(user => user.turnId) } } });
  const history = users.reverse().flatMap(user => { const assistant = assistants.find(row => row.turnId === user.turnId); return assistant ? [{ user: { id: user.id, content: user.content }, assistant: { id: assistant.id, content: assistant.content } }] : []; });
  return { ...selectChatContext({ question, selectedBlockIds, treeRevision: course.treeRevision, goal: course.goal, preferences: course.preferences, path, objectives: lesson.topic.objectives, current: lesson, prerequisites: prerequisites.map(edge => ({ title: edge.prerequisite.title, choice: edge.choice, lesson: edge.prerequisite.lesson })), history }, model), topicId: lesson.topicId, lessonId, baseRevision: lesson.revision, baseTreeRevision: course.treeRevision };
}
