import { z } from 'zod';
import type { ApiError, ApiErrorCode, Library } from '@popcorno/shared';
import type { LibraryRepository } from './library/repository.js';

/** Helpers shared by every route module: library lookup and error bodies. */

const libraryParams = z.object({ id: z.uuid() });

/** Result of resolving `:id` to a library, or the error response to send. */
export type LoadedLibrary =
  | { readonly ok: true; readonly value: Library }
  | { readonly ok: false; readonly status: 400 | 404; readonly body: ApiError };

/** Validates the `:id` param (400 `invalid_request`) and loads the library (404 `library_not_found`). */
export function loadLibrary(params: unknown, repository: LibraryRepository): LoadedLibrary {
  const parsed = libraryParams.safeParse(params);
  if (!parsed.success) return { ok: false, status: 400, body: invalid(parsed.error.issues) };
  const library = repository.findLibrary(parsed.data.id);
  if (!library) return { ok: false, status: 404, body: apiError('library_not_found') };
  return { ok: true, value: library };
}

/** Only the path and message of each zod issue: enough for a client, nothing internal. */
export function invalid(issues: readonly z.core.$ZodIssue[]): ApiError {
  return {
    error: 'invalid_request',
    details: issues.map(({ path, message }) => ({ path, message })),
  };
}

/** A bare error body for a stable code. */
export function apiError(error: ApiErrorCode): ApiError {
  return { error };
}
