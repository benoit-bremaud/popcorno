import { describe, expect, it } from 'vitest';
import { LibraryBusyError, LibraryLock } from './lock.js';

describe('LibraryLock', () => {
  it('refuses a second section on the same library and frees it afterwards, even on failure', async () => {
    const lock = new LibraryLock();
    let release: () => void = () => undefined;
    const first = lock.run('a', () => new Promise<void>((done) => (release = done)));

    await expect(lock.run('a', async () => 1)).rejects.toBeInstanceOf(LibraryBusyError);
    await expect(lock.run('b', async () => 2)).resolves.toBe(2);
    release();
    await first;
    await expect(lock.run('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    await expect(lock.run('a', async () => 3)).resolves.toBe(3);
  });
});
