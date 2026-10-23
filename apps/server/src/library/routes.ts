import { isAbsolute, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIBRARY_KINDS } from '@popcorno/shared';
import type { EnrichReport, Library, Media, ScanReport } from '@popcorno/shared';
import { apiError, invalid, loadLibrary } from '../http.js';
import { LibraryBusyError } from './lock.js';
import type { LibraryLock } from './lock.js';
import { resolveUnderRoot } from './path-guard.js';
import type { LibraryRepository } from './repository.js';
import { RootUnreadableError } from './scanner.js';
import type { LibraryScanner } from './scanner.js';

/** What the library routes need; built by `buildApp`, replaced by tests at will. */
export interface LibraryRoutesDeps {
  readonly repository: LibraryRepository;
  readonly scanner: LibraryScanner;
  /** Shared with the metadata routes: a scan (plus its include) and an enrich never overlap. */
  readonly lock: LibraryLock;
  /** Absolute folder every `rootPath` must equal or live under (`ServerConfig.mediaRoot`). */
  readonly mediaRoot: string;
  /**
   * UC1's «include» of UC2: runs after a scan on the rows without metadata. Null when
   * `TMDB_API_KEY` is not configured (the report then carries `metadata: null`).
   */
  readonly enrich: ((library: Library) => Promise<EnrichReport>) | null;
}

/**
 * `POST /libraries` (201 | 400 `invalid_request`), `GET /libraries`,
 * `POST /libraries/:id/scan` (200 | 400 | 404 `library_not_found` | 409 `root_unreadable` /
 * `scan_running` — a scan *or an enrichment* of the library is in flight),
 * `GET /libraries/:id/media` (200 | 400 | 404).
 */
export function registerLibraryRoutes(app: FastifyInstance, deps: LibraryRoutesDeps): void {
  const createLibraryBody = z.object({
    name: z.string().trim().min(1).max(200),
    rootPath: z
      .string()
      .min(1)
      .max(4096)
      .refine(isAbsolute, 'rootPath must be absolute')
      .transform((path) => underMediaRoot(deps.mediaRoot, path))
      .refine((path) => path !== null, 'rootPath must be under MEDIA_ROOT'),
    kind: z.enum(LIBRARY_KINDS),
  });

  app.post('/libraries', async (request, reply) => {
    const body = createLibraryBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(invalid(body.error.issues));
    const library: Library = deps.repository.createLibrary(body.data);
    return reply.code(201).send(library);
  });

  app.get('/libraries', async (): Promise<Library[]> => deps.repository.listLibraries());

  app.post('/libraries/:id/scan', async (request, reply) => {
    const library = loadLibrary(request.params, deps.repository);
    if (!library.ok) return reply.code(library.status).send(library.body);
    try {
      // The lock spans the include too: the enrichment must see the rows this scan wrote.
      const report: ScanReport = await deps.lock.run(library.value.id, async () => {
        const scanned = await deps.scanner.scan(library.value);
        const metadata = await includeEnrich(deps.enrich, library.value, request.log);
        return { ...scanned, metadata };
      });
      return reply.code(200).send(report);
    } catch (error) {
      if (error instanceof RootUnreadableError)
        return reply.code(409).send(apiError('root_unreadable'));
      if (error instanceof LibraryBusyError) return reply.code(409).send(apiError('scan_running'));
      throw error;
    }
  });

  app.get('/libraries/:id/media', async (request, reply) => {
    const library = loadLibrary(request.params, deps.repository);
    if (!library.ok) return reply.code(library.status).send(library.body);
    const items: Media[] = deps.repository.listMedia(library.value.id);
    return reply.code(200).send(items);
  });
}

/** The scan's «include» of UC2: a metadata failure is logged, never fails the scan (spec UC2 *a). */
async function includeEnrich(
  enrich: LibraryRoutesDeps['enrich'],
  library: Library,
  log: FastifyInstance['log'],
): Promise<EnrichReport | null> {
  if (!enrich) return null;
  try {
    return await enrich(library);
  } catch (error) {
    log.warn(error, 'metadata enrichment skipped after scan');
    return null;
  }
}

/** The normalised absolute path when it is the media root or under it, else null. */
function underMediaRoot(mediaRoot: string, path: string): string | null {
  const normalised = resolve(path);
  return normalised === mediaRoot ? normalised : resolveUnderRoot(mediaRoot, normalised);
}
