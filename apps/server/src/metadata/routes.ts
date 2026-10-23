import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EnrichReport } from '@popcorno/shared';
import { apiError, invalid, loadLibrary } from '../http.js';
import type { LibraryRepository } from '../library/repository.js';
import { ARTWORK_FILE } from './artwork-cache.js';
import { EnrichRunningError } from './service.js';
import type { MetadataService } from './service.js';

/** What the metadata routes need; `service` is null when `TMDB_API_KEY` is not configured. */
export interface MetadataRoutesDeps {
  readonly repository: LibraryRepository;
  readonly service: MetadataService | null;
  /** Absolute folder the artwork cache writes to; the only folder `GET /artwork/:file` reads. */
  readonly artworkDir: string;
}

const enrichBody = z.object({ refresh: z.boolean().optional() }).strict();
const artworkParams = z.object({ file: z.string().regex(ARTWORK_FILE) });

/**
 * `POST /libraries/:id/enrich` (200 | 400 `invalid_request` | 404 `library_not_found` |
 * 409 `tmdb_not_configured` / `enrich_running`) — synchronous, the response comes after
 * the last title — and `GET /artwork/:file` (200 | 400 | 404 `artwork_not_found`), served
 * by `@fastify/static` from `artworkDir` only, immutable for a year since a digest-named
 * file never changes content.
 */
export function registerMetadataRoutes(app: FastifyInstance, deps: MetadataRoutesDeps): void {
  app.post('/libraries/:id/enrich', async (request, reply) => {
    const library = loadLibrary(request.params, deps.repository);
    if (!library.ok) return reply.code(library.status).send(library.body);
    const body = enrichBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(invalid(body.error.issues));
    if (!deps.service) return reply.code(409).send(apiError('tmdb_not_configured'));
    try {
      const report: EnrichReport = await deps.service.enrich(library.value, body.data);
      return reply.code(200).send(report);
    } catch (error) {
      if (error instanceof EnrichRunningError)
        return reply.code(409).send(apiError('enrich_running'));
      throw error;
    }
  });

  // Own prefix so the plugin's "file not found" lands on this handler, not the global one.
  app.register(
    async (scope) => {
      await scope.register(fastifyStatic, {
        root: deps.artworkDir,
        serve: false, // Only the validated route below may hand out a file.
        maxAge: '1y',
        immutable: true,
      });
      scope.setNotFoundHandler(async (_request, reply) =>
        reply.code(404).send(apiError('artwork_not_found')),
      );
      scope.get('/:file', async (request, reply) => {
        const params = artworkParams.safeParse(request.params);
        if (!params.success) return reply.code(400).send(invalid(params.error.issues));
        // The regex only admits `<64 hex>.jpg|png`, so the name cannot leave the folder.
        return reply.sendFile(params.data.file);
      });
    },
    { prefix: '/artwork' },
  );
}
