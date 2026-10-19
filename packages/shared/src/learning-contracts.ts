import { z } from 'zod';
import { idSchema, treeRevisionSchema } from './base-contracts.js';

export const progressStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export const progressPatchSchema = z.object({ status: progressStatusSchema }).strict();
export const leafProgressSchema = z.object({ topicId: idSchema, status: progressStatusSchema, completedAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime().nullable() }).strict().refine(value => (value.status === 'completed') === (value.completedAt !== null), 'Completion requires its timestamp.');
const counts = { completedLeaves: z.number().int().nonnegative(), totalLeaves: z.number().int().nonnegative() };
export const courseProgressSchema = z.object({ treeRevision: treeRevisionSchema, ...counts, topics: z.array(z.discriminatedUnion('isLeaf', [z.object({ isLeaf: z.literal(true), progress: leafProgressSchema, ...counts }).strict(), z.object({ isLeaf: z.literal(false), topicId: idSchema, ...counts }).strict()])).max(2000) }).strict().refine(value => value.completedLeaves <= value.totalLeaves && value.topics.every(topic => topic.completedLeaves <= topic.totalLeaves && (!topic.isLeaf || topic.totalLeaves === 1)), 'Invalid leaf totals.');
export type ProgressStatus = z.infer<typeof progressStatusSchema>;
export type LeafProgress = z.infer<typeof leafProgressSchema>;
export type CourseProgress = z.infer<typeof courseProgressSchema>;
