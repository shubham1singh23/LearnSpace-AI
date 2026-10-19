import { Router } from 'express';
import { z } from 'zod';
import { connectionTestSchema, idSchema, providerUpdateSchema } from '@learnspace/shared';
import type { ConfigurationService } from './configuration.js';
import type { OperationService } from './operations.js';
import { GenerationService } from './generation.js';

export function aiRouter(service: ConfigurationService, operations: OperationService) {
  const router = Router();
  const generation = new GenerationService(operations);
  router.post('/lessons/:id/regenerations', async (req, res) => {
    const operation = await generation.regenerate(idSchema.parse(req.params.id), idSchema.parse(req.header('Idempotency-Key')), req.body);
    res.status(202).json({ data: { operationId: operation.id, status: operation.status, eventsUrl: `/api/v1/operations/${operation.id}/events` }, requestId: res.locals.requestId });
  });
  router.post('/lessons/:id/regeneration-commits', async (req, res) => { res.json({ data: await generation.commitRegeneration(idSchema.parse(req.params.id), req.body), requestId: res.locals.requestId }); });
  router.post('/topics/:id/lesson-generations', async (req, res) => {
    const result = await generation.initial(idSchema.parse(req.params.id), idSchema.parse(req.header('Idempotency-Key')), req.body);
    if (result.lesson) { res.json({ data: result.lesson, requestId: res.locals.requestId }); return; }
    const operation = result.operation!;
    res.status(202).json({ data: { operationId: operation.id, status: operation.status, eventsUrl: `/api/v1/operations/${operation.id}/events` }, requestId: res.locals.requestId });
  });
  router.post('/courses/:id/syllabus-commits', async (req, res) => { res.status(201).json({ data: await generation.commitSyllabus(idSchema.parse(req.params.id), req.body), requestId: res.locals.requestId }); });
  router.post('/courses/:id/syllabus-generations', async (req, res) => {
    const operation = await generation.syllabus(idSchema.parse(req.params.id), idSchema.parse(req.header('Idempotency-Key')), req.body);
    res.status(202).json({ data: { operationId: operation.id, status: operation.status, eventsUrl: `/api/v1/operations/${operation.id}/events` }, requestId: res.locals.requestId });
  });
  router.get('/settings', async (_req, res) => { res.json({ data: await service.settings(), requestId: res.locals.requestId }); });
  router.patch('/settings', async (req, res) => { res.json({ data: await service.patchSettings(req.body), requestId: res.locals.requestId }); });
  router.get('/provider-configurations', async (_req, res) => { res.json({ data: await service.list(), requestId: res.locals.requestId }); });
  router.post('/provider-configurations', async (req, res) => { res.status(201).json({ data: await service.write(req.body), requestId: res.locals.requestId }); });
  router.put('/provider-configurations/:id', async (req, res) => {
    const { baseConfigRevision, ...input } = providerUpdateSchema.parse(req.body);
    res.json({ data: await service.write(input, idSchema.parse(req.params.id), baseConfigRevision), requestId: res.locals.requestId });
  });
  router.delete('/provider-configurations/:id', async (req, res) => { await service.remove(idSchema.parse(req.params.id)); res.status(204).end(); });
  router.post('/provider-configurations/:id/test', async (req, res) => { const input = connectionTestSchema.parse(req.body); res.json({ data: await service.test(idSchema.parse(req.params.id), input.capability === 'structured'), requestId: res.locals.requestId }); });
  router.get('/courses/:id/operations', async (req, res) => {
    const query = z.object({ cursor: idSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query);
    res.json({ data: await operations.list(idSchema.parse(req.params.id), query.cursor, query.limit), requestId: res.locals.requestId });
  });
  router.get('/operations/:id', async (req, res) => { res.json({ data: await operations.get(idSchema.parse(req.params.id)), requestId: res.locals.requestId }); });
  router.post('/operations/:id/cancel', async (req, res) => { z.object({}).strict().parse(req.body); res.json({ data: await operations.cancel(idSchema.parse(req.params.id)), requestId: res.locals.requestId }); });
  router.post('/operations/:id/rejections', async (req, res) => { z.object({}).strict().parse(req.body); res.json({ data: await operations.cancel(idSchema.parse(req.params.id), true), requestId: res.locals.requestId }); });
  router.get('/operations/:id/events', async (req, res) => {
    const id = idSchema.parse(req.params.id); const initial = await operations.get(id);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    let closed = false; let sequence = Date.now(); let last = ''; let reading = false;
    const send = (operation: typeof initial, reset: boolean) => {
      if (closed) return;
      const current = JSON.stringify(operation); if (!reset && current === last) return; last = current;
      const event = operation.status === 'ready' ? 'ready' : operation.status === 'applied' ? 'done' : operation.status === 'cancelled' ? 'cancelled' : ['failed', 'interrupted', 'expired'].includes(operation.status) ? 'error' : 'status';
      sequence = Math.max(sequence + 1, Date.now());
      res.write(`id: ${sequence}\nevent: ${event}\ndata: ${JSON.stringify({ operationId: id, sequence, reset, operation })}\n\n`);
      if (!['pending', 'running'].includes(operation.status)) res.end();
    };
    const poll = setInterval(() => {
      if (closed || reading) return; reading = true;
      void operations.get(id).then(value => send(value, false)).catch(() => { if (!closed) { res.write('event: error\ndata: {"code":"STATUS_UNAVAILABLE"}\n\n'); res.end(); } }).finally(() => { reading = false; });
    }, 1000);
    const heartbeat = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 15000);
    res.on('close', () => { closed = true; clearInterval(poll); clearInterval(heartbeat); }); send(initial, true);
  });
  return router;
}
