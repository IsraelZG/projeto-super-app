import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './server.js';
import type { FastifyInstance } from 'fastify';

describe('HTTP Server (Seed)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('should respond 200 on GET /health', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    });
    
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('should serve static files for wildcard routes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/'
    });
    
    // We expect 200 and some HTML content if static serving is working
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });
});
