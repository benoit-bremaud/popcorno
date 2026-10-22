import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@popcorno/shared';

export interface AppOptions {
  readonly version: string;
  readonly logger?: boolean;
}

/** Builds the HTTP application without listening — the tests inject requests directly. */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: options.version,
  }));

  return app;
}
