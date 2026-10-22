import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { openDatabase } from './db/index.js';

describe('buildApp', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({
      version: '0.0.0-test',
      db: openDatabase(':memory:'),
      probe: async () => ({ durationSec: null, streams: [] }),
      mediaRoot: tmpdir(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health reports ok with the running version', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '0.0.0-test' });
  });

  it('answers 500 { error: internal } without echoing an unexpected error', async () => {
    app.get('/boom', async () => {
      throw new Error('SQLITE_CONSTRAINT: secret detail');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal' });
    expect(response.body).not.toContain('secret');
  });

  it('maps a malformed JSON body to 400 invalid_request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/libraries',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });
});
