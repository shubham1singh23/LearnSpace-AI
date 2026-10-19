import { z } from 'zod';
import { idSchema, revisionSchema, treeRevisionSchema, preferencesSchema } from './base-contracts.js';
import { tiptapDocumentSchema } from './document.js';
import { preparedEditSchema } from './edit-contracts.js';

export const textProviderSchema = z.enum(['openai', 'anthropic', 'google', 'ollama']);
export const providerOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(64).max(8192).default(2048),
  timeoutMs: z.number().int().min(1000).max(120000).default(120000), baseUrl: z.url().max(2048).optional()
}).strict();
const credentialSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('environment'), envName: z.enum(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY']) }).strict(),
  z.object({ source: z.literal('session'), secret: z.string().min(1).max(4096) }).strict(),
  z.object({ source: z.literal('none') }).strict()
]);
export const providerInputSchema = z.object({ purpose: z.literal('text'), provider: textProviderSchema, modelId: z.string().trim().min(1).max(160), options: providerOptionsSchema, credential: credentialSchema }).strict();
export const providerUpdateSchema = providerInputSchema.extend({ baseConfigRevision: revisionSchema });
const support = z.enum(['supported', 'unsupported', 'unknown']);
export const capabilitiesSchema = z.object({ structuredOutput: z.enum(['native_json_schema', 'tool_schema', 'prompt_json', 'none']), streaming: support, vision: support, toolCalling: support, imageGeneration: z.literal('unsupported'), contextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), registryVersion: z.string(), source: z.string() }).strict();
export const providerDTOSchema = z.object({ id: idSchema, revision: revisionSchema, purpose: z.literal('text'), provider: textProviderSchema, modelId: z.string(), options: providerOptionsSchema, credentialSource: z.enum(['environment', 'session', 'none']), configured: z.boolean(), capabilities: capabilitiesSchema, updatedAt: z.iso.datetime() }).strict();
export const modelSnapshotSchema = z.object({ version: z.literal(1), configId: idSchema, configRevision: revisionSchema, provider: textProviderSchema, modelId: z.string().min(1).max(160), options: providerOptionsSchema, capabilities: capabilitiesSchema }).strict();
export const settingsSchema = z.object({ preferences: preferencesSchema, textConfigId: idSchema.nullable(), imageConfigId: idSchema.nullable() }).strict();
export const settingsPatchSchema = z.object({ preferences: preferencesSchema.optional(), textConfigId: idSchema.nullable().optional() }).strict().refine(value => Object.keys(value).length > 0);
export const connectionTestSchema = z.object({ capability: z.enum(['text', 'structured']).default('structured') }).strict();
export const connectionResultSchema = z.object({ ok: z.boolean(), latencyMs: z.number().nonnegative(), capabilities: capabilitiesSchema, warnings: z.array(z.string()) }).strict();

const shortText = z.string().trim().min(1).max(1000);
const draftNode = z.object({ tempId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), parentTempId: z.string().max(80).nullable(), title: z.string().trim().min(1).max(240), kind: z.enum(['module', 'topic', 'subtopic']), position: z.number().int().nonnegative(), objectives: z.array(shortText).max(30) }).strict();
export const syllabusShapeSchema = z.object({ nodes: z.array(draftNode).min(1).max(2000), prerequisites: z.array(z.object({ topicTempId: z.string().max(80), prerequisiteTempId: z.string().max(80) }).strict()).max(8000) }).strict();
export const syllabusDraftSchema = syllabusShapeSchema.superRefine((draft, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set(draft.nodes.map(node => node.tempId));
  if (ids.size !== draft.nodes.length) fail('Duplicate temporary topic IDs');
  const parents = new Map(draft.nodes.map(node => [node.tempId, node.parentTempId]));
  const siblings = new Map<string | null, number[]>();
  for (const node of draft.nodes) {
    if (node.parentTempId !== null && !ids.has(node.parentTempId)) fail('Unknown parent');
    const seen = new Set<string>(); let current: string | null | undefined = node.tempId;
    while (current) { if (seen.has(current)) { fail('Hierarchy cycle'); break; } seen.add(current); current = parents.get(current); }
    const positions = siblings.get(node.parentTempId) ?? []; positions.push(node.position); siblings.set(node.parentTempId, positions);
    if (!draft.nodes.some(child => child.parentTempId === node.tempId) && !node.objectives.length) fail('Teaching leaves need objectives');
  }
  for (const positions of siblings.values()) if (positions.sort((a, b) => a - b).some((position, index) => position !== index)) fail('Sibling positions must be contiguous');
  const edges = new Set<string>(); const dependencies = new Map<string, string[]>();
  for (const edge of draft.prerequisites) {
    if (!ids.has(edge.topicTempId) || !ids.has(edge.prerequisiteTempId)) fail('Unknown prerequisite');
    const key = `${edge.topicTempId}:${edge.prerequisiteTempId}`; if (edges.has(key)) fail('Duplicate prerequisite'); edges.add(key);
    dependencies.set(edge.topicTempId, [...(dependencies.get(edge.topicTempId) ?? []), edge.prerequisiteTempId]);
  }
  // Iterative DFS avoids recursive parsing of arbitrary topic depth.
  const complete = new Set<string>();
  for (const id of ids) {
    const active = new Set<string>(); const stack: { id: string; exit: boolean }[] = [{ id, exit: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.exit) { active.delete(item.id); complete.add(item.id); continue; }
      if (active.has(item.id)) { fail('Prerequisite cycle'); break; }
      if (complete.has(item.id)) continue;
      active.add(item.id); stack.push({ id: item.id, exit: true });
      for (const target of dependencies.get(item.id) ?? []) stack.push({ id: target, exit: false });
    }
  }
});
const paragraph = z.object({ type: z.literal('paragraph'), text: z.string().min(1).max(12000) }).strict();
export const teachingBlockSchema = z.discriminatedUnion('type', [paragraph,
  z.object({ type: z.literal('list'), ordered: z.boolean(), items: z.array(shortText).min(1).max(100) }).strict(),
  z.object({ type: z.literal('code'), language: z.string().regex(/^[\w+-]{0,40}$/), text: z.string().min(1).max(20000) }).strict(),
  z.object({ type: z.literal('math'), latex: z.string().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('example'), text: z.string().min(1).max(12000) }).strict(),
  z.object({ type: z.literal('analogy'), text: z.string().min(1).max(12000) }).strict(),
  z.object({ type: z.literal('reflection'), text: z.string().min(1).max(12000) }).strict(),
  z.object({ type: z.literal('table'), headers: z.array(shortText).min(1).max(50), rows: z.array(z.array(shortText).min(1).max(50)).min(1).max(199) }).strict()
]);
export const educationalLessonSchema = z.object({ title: z.string().min(1).max(240), objectives: z.array(shortText).min(1).max(30), prerequisiteNotes: z.array(shortText).max(30), sections: z.array(z.object({ heading: z.string().min(1).max(240), blocks: z.array(teachingBlockSchema).min(1).max(200) }).strict()).min(1).max(50), recall: z.array(z.object({ question: shortText, answer: z.string().min(1).max(4000) }).strict()).min(1).max(30), uncertainties: z.array(shortText).max(30), sources: z.array(z.object({ title: shortText, url: z.url().refine(value => /^https?:\/\//.test(value)) }).strict()).max(20).optional() }).strict().superRefine((lesson, ctx) => {
  if (!lesson.sections.some(section => section.blocks.some(block => block.type === 'example'))) ctx.addIssue({ code: 'custom', message: 'A worked example is required' });
  for (const section of lesson.sections) for (const block of section.blocks) if (block.type === 'table' && block.rows.some(row => row.length !== block.headers.length)) ctx.addIssue({ code: 'custom', message: 'Tables must be rectangular' });
});
export const operationKindSchema = z.enum(['syllabus', 'initial_lesson', 'regeneration', 'edit', 'chat']);
export const operationStatusSchema = z.enum(['pending', 'running', 'ready', 'applied', 'rejected', 'failed', 'cancelled', 'interrupted', 'expired']);
export const contextManifestSchema = z.object({ sources: z.array(z.object({ lessonId: idSchema, revision: revisionSchema, blockIds: z.array(idSchema) }).strict()).max(4), omitted: z.boolean(), chat: z.object({ algorithm: z.literal('chat-v1'), treeRevision: treeRevisionSchema, historyMessageIds: z.array(idSchema).max(12), selectedBlockIds: z.array(idSchema).max(100), omissions: z.array(z.enum(['budget', 'unsupported_media', 'missing_prerequisite', 'history_limit'])).max(4), contextHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict();
export const operationResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('applied_chat'), lessonId: idSchema, turnId: idSchema, messageId: idSchema, contextRevision: revisionSchema }).strict(),
  z.object({ type: z.literal('edit'), readyAt: z.iso.datetime(), prepared: preparedEditSchema }).strict(),
  z.object({ type: z.literal('syllabus'), readyAt: z.iso.datetime(), draft: syllabusDraftSchema }).strict(),
  z.object({ type: z.literal('lesson'), readyAt: z.iso.datetime(), documentSchemaVersion: z.literal(1), document: tiptapDocumentSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('applied_lesson'), lessonId: idSchema, revision: revisionSchema }).strict(),
  z.object({ type: z.literal('applied_syllabus'), courseId: idSchema, treeRevision: treeRevisionSchema, draftHash: z.string().regex(/^[a-f0-9]{64}$/), topicIds: z.array(idSchema).max(2000) }).strict()
]);
export const operationDTOSchema = z.object({ id: idSchema, courseId: idSchema, topicId: idSchema.nullable(), lessonId: idSchema.nullable(), kind: operationKindSchema, status: operationStatusSchema, baseRevision: revisionSchema.nullable(), baseTreeRevision: treeRevisionSchema.nullable(), model: modelSnapshotSchema, context: contextManifestSchema, result: operationResultSchema.nullable(), errorCode: z.string().max(60).nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
export const operationMetadataSchema = operationDTOSchema.omit({ result: true });
export const operationListSchema = z.object({ operations: z.array(operationMetadataSchema).max(100), page: z.object({ nextCursor: idSchema.nullable() }).strict() }).strict();
export const startOperationResponseSchema = z.object({ operationId: idSchema, status: operationStatusSchema, eventsUrl: z.string().regex(/^\/api\/v1\/operations\/[a-f0-9-]+\/events$/) }).strict();
const instruction = z.string().trim().min(1).max(4000).optional();
export const lessonGenerationSchema = z.object({ instruction, retryOfOperationId: idSchema.optional() }).strict();
export const syllabusGenerationSchema = lessonGenerationSchema.extend({ baseTreeRevision: treeRevisionSchema });
export const regenerationSchema = lessonGenerationSchema.extend({ baseRevision: revisionSchema });
export const syllabusCommitSchema = z.object({ operationId: idSchema, baseTreeRevision: treeRevisionSchema, draft: syllabusDraftSchema }).strict();
export const syllabusCommitResponseSchema = z.object({ type: z.literal('applied_syllabus'), courseId: idSchema, treeRevision: treeRevisionSchema, draftHash: z.string().regex(/^[a-f0-9]{64}$/), topicIds: z.array(idSchema).max(2000) }).strict();
export const regenerationCommitSchema = z.object({ operationId: idSchema, baseRevision: revisionSchema, mutationId: idSchema, confirmReplace: z.literal(true) }).strict();
export const operationEventSchema = z.object({ operationId: idSchema, sequence: z.number().int().nonnegative(), reset: z.boolean(), operation: operationDTOSchema }).strict();
export type TextProvider = z.infer<typeof textProviderSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ProviderDTO = z.infer<typeof providerDTOSchema>;
export type ModelSnapshot = z.infer<typeof modelSnapshotSchema>;
export type SyllabusDraft = z.infer<typeof syllabusDraftSchema>;
export type EducationalLesson = z.infer<typeof educationalLessonSchema>;
export type OperationDTO = z.infer<typeof operationDTOSchema>;
export type OperationKind = z.infer<typeof operationKindSchema>;
export type ContextManifest = z.infer<typeof contextManifestSchema>;
