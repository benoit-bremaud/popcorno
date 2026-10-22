import { isAbsolute, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIBRARY_KINDS } from '@popcorno/shared';
import type { ApiError, ApiErrorCode, Library, Media, ScanReport } from '@popcorno/shared';
import { resolveUnderRoot } from './path-guard.js';
import type { LibraryRepository } from './repository.js';
import { RootUnreadableError, ScanRunningError } from './scanner.js';
import type { LibraryScanner } from './scanner.js';

const libraryParams = z.object({ id: z.uuid() });

/** What the library routes need; built by `buildApp`, replaced by tests at will. */
export interface LibraryRoutesDeps {
  readonly repository: LibraryRepository;
  readonly scanner: LibraryScanner;
  /** Absolute folder every `rootPath` must equal or live under (`ServerConfig.mediaRoot`). */
  readonly mediaRoot: string;
}

/**
 * `POST /libraries` (201 | 400 `invalid_request`), `GET /libraries`,
 * `POST /libraries/:id/scan` (200 | 400 | 404 `library_not_found` | 409 `root_unreadable` /
 * `scan_running`), `GET /libraries/:id/media` (200 | 400 | 404).
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

/** The normalised absolute path when it is the media root or under it, else null. */
function underMediaRoot(mediaRoot: string, path: string): string | null {
  const normalised = resolve(path);
  return normalised === mediaRoot ? normalised : resolveUnderRoot(mediaRoot, normalised);
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

/** Only the path and message of each zod issue: enough for a client, nothing internal. */
function invalid(issues: readonly z.core.$ZodIssue[]): ApiError {
  return {
    error: 'invalid_request',
    details: issues.map(({ path, message }) => ({ path, message })),
  };
}

function apiError(error: ApiErrorCode): ApiError {
  return { error };
}
