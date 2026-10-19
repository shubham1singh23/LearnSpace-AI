import { z } from 'zod';
import { tiptapDocumentSchema } from './document.js';
export * from './document.js';

export const idSchema = z.uuid();
export const revisionSchema = z.number().int().min(1);
export const treeRevisionSchema = z.number().int().min(0);
export const preferencesSchema = z.object({
  depth: z.enum(['introductory', 'intermediate', 'deep']), style: z.enum(['first_principles', 'step_by_step']),
  examples: z.boolean(), analogies: z.boolean(), reflectionPauses: z.boolean(), pace: z.enum(['self_paced', 'guided']), background: z.string().max(4000)
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = { depth: 'introductory', style: 'first_principles', examples: true, analogies: true, reflectionPauses: false, pace: 'self_paced', background: '' };
export const createCourseSchema = z.object({ title: z.string().trim().min(1).max(240), goal: z.string().trim().min(1).max(8000), preferences: preferencesSchema }).strict();
export const courseSchema = createCourseSchema.extend({ id: idSchema, treeRevision: treeRevisionSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const topicSchema = z.object({
  id: idSchema, courseId: idSchema, parentId: idSchema.nullable(), title: z.string().trim().min(1).max(240),
  kind: z.enum(['module', 'topic', 'subtopic']), position: z.number().int().min(0), objectives: z.array(z.string().min(1).max(1000)).max(30),
  isLeaf: z.boolean(), lessonId: idSchema.optional()
}).strict();
export const lessonSchema = z.object({ id: idSchema, topicId: idSchema, revision: revisionSchema, documentSchemaVersion: z.literal(1), document: tiptapDocumentSchema, updatedAt: z.iso.datetime() }).strict();
export const saveLessonSchema = z.object({
  baseRevision: revisionSchema, mutationId: idSchema, documentSchemaVersion: z.literal(1), document: tiptapDocumentSchema,
  aiOperationId: idSchema.optional(), imageOperationId: idSchema.optional()
}).strict().refine(value => !(value.aiOperationId && value.imageOperationId), 'Only one operation may be applied per save');
export const healthSchema = z.object({
  status: z.enum(['ok', 'unavailable']), service: z.literal('learnspace-api'), database: z.enum(['ready', 'unavailable']),
  storage: z.enum(['ready', 'unavailable'])
}).strict();
export const healthResponseSchema = z.object({ data: healthSchema, requestId: idSchema }).strict();
export const errorResponseSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict(), requestId: idSchema }).strict();
export type Course = z.infer<typeof courseSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type SaveLesson = z.infer<typeof saveLessonSchema>;
export type Health = z.infer<typeof healthSchema>;

