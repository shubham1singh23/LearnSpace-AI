import { z } from 'zod';
import { idSchema, revisionSchema } from './base-contracts.js';

// Plain text only. UTF-16 is the editor's offset unit; bytes bound transport cost.
export const chatTextSchema = z.string().min(1).max(16000).refine(value => value.trim().length > 0 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'Use nonempty, valid Unicode text.').refine(value => new TextEncoder().encode(value).length <= 65536, 'Text exceeds 64 KiB.');
export const chatStartSchema = z.object({ baseRevision: revisionSchema, message: chatTextSchema, clientTurnId: idSchema, selectedBlockIds: z.array(idSchema).max(100).refine(ids => new Set(ids).size === ids.length, 'Duplicate block IDs.').optional(), retryOfOperationId: idSchema.optional() }).strict();
export const chatMessageSchema = z.object({ id: idSchema, lessonId: idSchema, role: z.enum(['user', 'assistant']), content: chatTextSchema, sequence: z.number().int().nonnegative(), turnId: idSchema, operationId: idSchema.nullable(), status: z.enum(['pending', 'completed', 'failed', 'interrupted', 'cancelled']), contextRevision: revisionSchema, createdAt: z.iso.datetime() }).strict().superRefine((message, ctx) => {
  if (message.sequence % 2 !== (message.role === 'user' ? 0 : 1)) ctx.addIssue({ code: 'custom', message: 'Turn sequences must be paired.' });
  if (message.role === 'assistant' && message.status !== 'completed') ctx.addIssue({ code: 'custom', message: 'Only complete assistant messages are durable.' });
});
export const chatPageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: idSchema.optional(), after: idSchema.optional() }).strict().refine(value => !(value.before && value.after), 'Choose one pagination direction.');
export const chatPageSchema = z.object({ messages: z.array(chatMessageSchema).max(100), page: z.object({ olderCursor: idSchema.nullable(), newerCursor: idSchema.nullable() }).strict(), activeOperationId: idSchema.nullable() }).strict().refine(value => value.messages.every((message, index) => index === 0 || message.sequence > value.messages[index - 1]!.sequence), 'Messages must be strictly ordered.');
export const chatModelOutputSchema = z.object({ text: chatTextSchema }).strict();
export const chatStartJournalSchema = z.object({ version: z.literal(1), lessonId: idSchema, idempotencyKey: idSchema, body: chatStartSchema, createdAt: z.iso.datetime() }).strict();
export type ChatStart = z.infer<typeof chatStartSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatPage = z.infer<typeof chatPageSchema>;
export type ChatStartJournal = z.infer<typeof chatStartJournalSchema>;

