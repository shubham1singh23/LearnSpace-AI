import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@learnspace/shared';
import { createApp } from './app.js';
import { parseEnvironment } from './config.js';

const env = parseEnvironment({ DATABASE_URL: 'postgresql://unused@127.0.0.1:5432/unused' });
const healthy = async () => ({ status: 'ok' as const, service: 'learnspace-api' as const, database: 'ready' as const, storage: 'ready' as const });
const app = createApp(env, healthy);
const host = '127.0.0.1:3001';
describe('API shell and local boundary', () => {
  it('returns validated health and versioned liveness', async () => {
    const result = await request(app).get('/api/health').set('Host', host).expect(200);
    expect(healthResponseSchema.parse(result.body).data.status).toBe('ok');
    expect(result.headers['x-powered-by']).toBeUndefined();
    await request(app).get('/api/v1/health/live').set('Host', host).expect(200);
  });
  it('reports readiness unavailable instead of pretending DB is ready', async () => {
    const unavailable = createApp(env, async () => ({ ...await healthy(), status: 'unavailable', database: 'unavailable' }));
    const result = await request(unavailable).get('/api/health').set('Host', host).expect(503);
    expect(healthResponseSchema.parse(result.body).data.database).toBe('unavailable');
  });
  it('accepts only exact local CORS origins and rejects rebinding hosts', async () => {
    const allowed = await request(app).get('/api/health').set('Host', host).set('Origin', env.WEB_ORIGIN).expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(env.WEB_ORIGIN);
    await request(app).get('/api/health').set('Host', host).set('Origin', 'http://evil.example').expect(403);
    await request(app).get('/api/health').set('Host', 'evil.example').expect(403);
    await request(app).get('/api/health').set('Host', host).set('Sec-Fetch-Site', 'cross-site').expect(403);
  });
  it('accepts Vite proxy host but excludes development origin in production', async () => {
    await request(app).get('/api/health').set('Host', '127.0.0.1:5173').expect(200);
    const localhost = await request(app).get('/api/health').set('Host', 'localhost:5173').set('Origin', 'http://localhost:5173').expect(200);
    expect(localhost.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    await request(app).get('/api/health').set('Host', 'localhost:5174').expect(403);
    await request(app).get('/api/health').set('Host', host).set('Origin', 'http://localhost:5174').expect(403);
    const production = createApp({ ...env, NODE_ENV: 'production' }, healthy);
    await request(production).get('/api/health').set('Host', host).set('Origin', env.WEB_ORIGIN).expect(403);
    await request(production).get('/api/health').set('Host', host).set('Origin', 'http://localhost:5173').expect(403);
  });
  it('handles malformed JSON and missing origin safely', async () => {
    await request(app).post('/api/missing').set('Host', host).set('Content-Type', 'application/json').send('{}').expect(403);
    const result = await request(app).post('/api/missing').set('Host', host).set('Origin', env.WEB_ORIGIN).set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(result.body.error.code).toBe('INVALID_JSON');
  });
  it('redacts unexpected errors and returns explicit API 404', async () => {
    const failing = createApp(env, () => Promise.reject(new Error('secret database password')));
    const result = await request(failing).get('/api/health').set('Host', host).expect(500);
    expect(JSON.stringify(result.body)).not.toContain('secret');
    await request(app).get('/api/v1/courses').set('Host', host).expect(404);
  });
});
