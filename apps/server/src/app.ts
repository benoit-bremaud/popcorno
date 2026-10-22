import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiError, HealthResponse } from '@popcorno/shared';
import type { AppDatabase } from './db/index.js';
import type { Prober } from './library/ffprobe.js';
import { LibraryRepository } from './library/repository.js';
import { registerLibraryRoutes } from './library/routes.js';
import { LibraryScanner } from './library/scanner.js';

/** Everything `buildApp` needs; `index.ts` fills it from the config, tests from fakes. */
export interface AppOptions {
  readonly version: string;
  readonly db: AppDatabase;
  /** Process boundary, injected so tests never spawn ffprobe. */
  readonly probe: Prober;
  /** Absolute folder library roots must live under (`ServerConfig.mediaRoot`). */
  readonly mediaRoot: string;
  readonly logger?: boolean;
}

/** Builds the HTTP application without listening — the tests inject requests directly. */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  // Unexpected errors are logged with their cause but never echoed (SQLite messages, paths).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    const body: ApiError = { error: status >= 500 ? 'internal' : 'invalid_request' };
    return reply.code(status).send(body);
  });

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: options.version,
  }));

  const repository = new LibraryRepository(options.db);
  const scanner = new LibraryScanner(repository, options.probe, options.mediaRoot);
  registerLibraryRoutes(app, { repository, scanner, mediaRoot: options.mediaRoot });

  return app;
}
