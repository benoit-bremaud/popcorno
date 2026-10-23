/** Thrown when a scan or an enrichment of the same library is already in flight. */
export class LibraryBusyError extends Error {
  constructor(libraryId: string) {
    super(`Library ${libraryId} is busy: a scan or an enrichment is already running`);
    this.name = 'LibraryBusyError';
  }
}

/**
 * One exclusive section per library, shared by the scan route (which holds it across the
 * walk *and* the included enrichment) and the enrich route. Without it an enrichment in
 * flight could save a match for a file a concurrent scan has just re-parsed, then mark it
 * looked up, so the scan's own enrichment would skip the stale row (spec UC1 *a, UC2 2b).
 */
export class LibraryLock {
  private readonly held = new Set<string>();

  /** @throws {LibraryBusyError} when the library is already held. */
  async run<T>(libraryId: string, task: () => Promise<T>): Promise<T> {
    if (this.held.has(libraryId)) throw new LibraryBusyError(libraryId);
    this.held.add(libraryId);
    try {
      return await task();
    } finally {
      this.held.delete(libraryId);
    }
  }
}
