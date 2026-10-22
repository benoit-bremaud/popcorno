import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  it('reports ok with the running version', async () => {
    const app = buildApp({ version: '0.0.0-test' });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '0.0.0-test' });
    await app.close();
  });
});
