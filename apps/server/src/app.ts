import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiError, HealthResponse } from '@popcorno/shared';
import type { AppDatabase } from './db/index.js';
import type { Prober } from './library/ffprobe.js';
import { LibraryRepository } from './library/repository.js';
import { LibraryLock } from './library/lock.js';
import { registerLibraryRoutes } from './library/routes.js';
import { LibraryScanner } from './library/scanner.js';
import { ArtworkCache } from './metadata/artwork-cache.js';
import { MetadataRepository } from './metadata/repository.js';
import { registerMetadataRoutes } from './metadata/routes.js';
import { MetadataService } from './metadata/service.js';
import { ProgressRepository } from './progress/repository.js';
import { registerProgressRoutes } from './progress/routes.js';
import { registerPlaybackRoutes } from './playback/routes.js';
import { SessionManager } from './playback/session-manager.js';
import { registerSessionRoutes } from './playback/session-routes.js';
import type { Transcoder } from './playback/transcoder.js';
import type { TmdbClient } from './metadata/tmdb-client.js';

/** Everything `buildApp` needs; `index.ts` fills it from the config, tests from fakes. */
export interface AppOptions {
  readonly version: string;
  readonly db: AppDatabase;
  /** Process boundary, injected so tests never spawn ffprobe. */
  readonly probe: Prober;
  /** Absolute folder library roots must live under (`ServerConfig.mediaRoot`). */
  readonly mediaRoot: string;
  /** HTTP boundary to TMDB; null when no key is configured (UC2 disabled). */
  readonly tmdb: TmdbClient | null;
  /** Folder the artwork cache writes to and `GET /artwork/:file` serves from. */
  readonly artworkDir: string;
  /** Process boundary to FFmpeg, injected so tests never spawn it (ADR-0006). */
  readonly transcoder: Transcoder;
  /** Parent of the HLS session directories (`ServerConfig.transcodeDir`). */
  readonly transcodeDir: string;
  readonly transcodeMaxSessions?: number;
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
  const lock = new LibraryLock();
  const scanner = new LibraryScanner(repository, options.probe, options.mediaRoot);
  const metadata = options.tmdb
    ? new MetadataService({
        repository: new MetadataRepository(options.db),
        client: options.tmdb,
        artwork: new ArtworkCache(options.artworkDir, options.tmdb),
        logger: app.log,
      })
    : null;
  registerLibraryRoutes(app, {
    repository,
    scanner,
    lock,
    mediaRoot: options.mediaRoot,
    enrich: metadata ? (library) => metadata.enrich(library) : null,
  });
  registerMetadataRoutes(app, {
    repository,
    service: metadata,
    lock,
    artworkDir: options.artworkDir,
  });
  registerPlaybackRoutes(app, { repository, mediaRoot: options.mediaRoot });
  const sessions = new SessionManager({
    transcoder: options.transcoder,
    dir: options.transcodeDir,
    maxSessions: options.transcodeMaxSessions ?? 1,
    logger: app.log,
  });
  registerSessionRoutes(app, { repository, sessions, mediaRoot: options.mediaRoot });
  registerProgressRoutes(app, { progress: new ProgressRepository(options.db) });
  // Sessions live in memory: directories left by a previous run belong to no one.
  app.addHook('onReady', async () => sessions.clean());
  app.addHook('onClose', async () => sessions.closeAll());

  return app;
}
