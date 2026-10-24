import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createTranscoder } from './transcoder.js';
import type { Spawn } from './transcoder.js';

/** A child process double: an emitter with a stderr stream and a recorded `kill`. */
class FakeChild extends EventEmitter {
  readonly stderr = new PassThrough();
  readonly kill = vi.fn<(signal: string) => boolean>(() => true);
}

function fakeSpawn(child: FakeChild) {
  const spawn = vi.fn(() => child);
  return { spawn, asSpawn: spawn as unknown as Spawn };
}

describe('createTranscoder', () => {
  it('spawns the binary with the arguments, no shell, stdout ignored', () => {
    const child = new FakeChild();
    const { spawn, asSpawn } = fakeSpawn(child);

    createTranscoder('/usr/bin/ffmpeg', asSpawn)(['-i', 'a.mkv'], vi.fn());

    expect(spawn).toHaveBeenCalledWith('/usr/bin/ffmpeg', ['-i', 'a.mkv'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  });

  it('reports the exit code and the stderr tail once', () => {
    const child = new FakeChild();
    const onExit = vi.fn();
    createTranscoder('ffmpeg', fakeSpawn(child).asSpawn)([], onExit);

    child.stderr.emit('data', Buffer.from('x'.repeat(3000)));
    child.stderr.emit('data', Buffer.from('Invalid data'));
    child.emit('exit', 1);
    child.emit('exit', 1);

    expect(onExit).toHaveBeenCalledTimes(1);
    const [code, tail] = onExit.mock.calls[0] as [number, string];
    expect(code).toBe(1);
    expect(tail).toHaveLength(2048);
    expect(tail.endsWith('Invalid data')).toBe(true);
  });

  it('reports a spawn error (missing binary) as an exit without code', () => {
    const child = new FakeChild();
    const onExit = vi.fn();
    createTranscoder('nope', fakeSpawn(child).asSpawn)([], onExit);

    child.emit('error', new Error('spawn nope ENOENT'));

    expect(onExit).toHaveBeenCalledWith(null, 'spawn nope ENOENT');
  });

  it('kills with SIGKILL while running, and not after exit', () => {
    const child = new FakeChild();
    const handle = createTranscoder('ffmpeg', fakeSpawn(child).asSpawn)([], vi.fn());

    handle.kill();
    child.emit('exit', null);
    handle.kill();

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
