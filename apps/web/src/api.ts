import { z } from 'zod';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable: boolean, public currentRevision?: number) { super(message); }
}
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), details: z.object({ currentRevision: z.number().optional(), currentTreeRevision: z.number().optional() }).optional() }), requestId: z.string() });
export async function api<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const error = errorSchema.parse(await response.json()).error;
    throw new ApiError(response.status, error.code, error.message, error.retryable, error.details?.currentRevision);
  }
  if (response.status === 204) return schema.parse(undefined);
  return schema.parse(await response.json());
}
export const envelope = <T>(schema: z.ZodType<T>) => z.object({ data: schema, requestId: z.string() });
