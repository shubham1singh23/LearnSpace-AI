import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { healthSchema, type Health } from '@learnspace/shared';
import { ZodError } from 'zod';
import type { Environment } from './config.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) { super(message); }
}

export function createApp(env: Environment, readiness: () => Promise<Health>, webDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const apiOrigin = `http://${env.API_HOST === '::1' ? '[::1]' : env.API_HOST}:${env.API_PORT}`;
  const developmentOrigins: string[] = [];
  if (env.NODE_ENV !== 'production') {
    const web = new URL(env.WEB_ORIGIN);
    developmentOrigins.push(web.origin);
    // localhost and 127.0.0.1 are the same supported local development surface.
    // Keep the exact configured port; never allow arbitrary origins or ports.
    if (['localhost', '127.0.0.1'].includes(web.hostname)) {
      const alias = new URL(web.origin);
      alias.hostname = web.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      developmentOrigins.push(alias.origin);
    }
  }
  const allowedOrigins = new Set([apiOrigin, ...developmentOrigins]);
  const allowedHosts = new Set([...allowedOrigins].map(origin => new URL(origin).host));

  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.set({ 'X-Request-Id': requestId, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' });
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!req.headers.host || !allowedHosts.has(req.headers.host.toLowerCase())) return next(new HttpError(403, 'HOST_NOT_ALLOWED', 'Host is not allowed.'));
    if (req.headers['sec-fetch-site'] === 'cross-site') return next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Cross-site requests are not allowed.'));
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.'));
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
    }
    if (req.method === 'OPTIONS') {
      res.set({ 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-LearnSpace-Request', 'Access-Control-Max-Age': '600' });
      res.status(204).end(); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!origin) return next(new HttpError(403, 'ORIGIN_REQUIRED', 'A local origin is required.'));
      if (!req.is('application/json')) return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  const health: express.RequestHandler = async (_req, res) => {
    const data = healthSchema.parse(await readiness());
    res.status(data.status === 'ok' ? 200 : 503).json({ data, requestId: res.locals.requestId });
  };
  app.get('/api/health', health); // Explicit Milestone 1 endpoint, alongside versioned design routes.
  app.get('/api/v1/health/ready', health);
  app.get('/api/v1/health/live', (_req, res) => { res.json({ data: { status: 'ok', service: 'learnspace-api' }, requestId: res.locals.requestId }); });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API endpoint not found.')));
  if (webDirectory) {
    app.use(express.static(webDirectory, { index: false, dotfiles: 'deny' }));
    app.get('/{*path}', (_req, res) => { res.sendFile(resolve(webDirectory, 'index.html')); });
  }
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found.')));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    let safe = new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    if (error instanceof HttpError) safe = error;
    else if (error instanceof ZodError) safe = new HttpError(422, 'VALIDATION_ERROR', 'Request validation failed.');
    else if (error && typeof error === 'object' && 'type' in error) {
      if (error.type === 'entity.parse.failed') safe = new HttpError(400, 'INVALID_JSON', 'Malformed JSON.');
      if (error.type === 'entity.too.large') safe = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the size limit.');
    }
    res.status(safe.status).json({ error: { code: safe.code, message: safe.message, retryable: safe.retryable }, requestId: res.locals.requestId });
  };
  app.use(errorHandler);
  return app;
}
