import { isAbsolute } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiError, Library, Media, ScanReport } from '@popcorno/shared';
import type { LibraryRepository } from './repository.js';
import { RootUnreadableError, ScanRunningError } from './scanner.js';
import type { LibraryScanner } from './scanner.js';

const createLibraryBody = z.object({
  name: z.string().trim().min(1).max(200),
  rootPath: z.string().min(1).refine(isAbsolute, 'rootPath must be absolute'),
  kind: z.enum(['films', 'series']),
});

const libraryParams = z.object({ id: z.uuid() });

export interface LibraryRoutesDeps {
  readonly repository: LibraryRepository;
  readonly scanner: LibraryScanner;
}

/** `POST /libraries`, `GET /libraries`, `POST /libraries/:id/scan`, `GET /libraries/:id/media`. */
export function registerLibraryRoutes(app: FastifyInstance, deps: LibraryRoutesDeps): void {
  app.post('/libraries', async (request, reply) => {
    const body = createLibraryBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(invalid(body.error.issues));
    }
    const library: Library = deps.repository.createLibrary(body.data);
    return reply.code(201).send(library);
  });

  app.get('/libraries', async (): Promise<Library[]> => deps.repository.listLibraries());

  app.post('/libraries/:id/scan', async (request, reply) => {
    const library = loadLibrary(request.params, deps.repository);
    if (!library.ok) return reply.code(library.status).send(library.body);
    try {
      const report: ScanReport = await deps.scanner.scan(library.value);
      return reply.code(200).send(report);
    } catch (error) {
      if (error instanceof RootUnreadableError)
        return reply.code(409).send(apiError('root_unreadable'));
      if (error instanceof ScanRunningError) return reply.code(409).send(apiError('scan_running'));
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

type Loaded =
  | { readonly ok: true; readonly value: Library }
  | { readonly ok: false; readonly status: 400 | 404; readonly body: ApiError };

function loadLibrary(params: unknown, repository: LibraryRepository): Loaded {
  const parsed = libraryParams.safeParse(params);
  if (!parsed.success) return { ok: false, status: 400, body: invalid(parsed.error.issues) };
  const library = repository.findLibrary(parsed.data.id);
  if (!library) return { ok: false, status: 404, body: apiError('library_not_found') };
  return { ok: true, value: library };
}

function invalid(details: unknown): ApiError {
  return { error: 'invalid_request', details };
}

function apiError(error: string): ApiError {
  return { error };
}
