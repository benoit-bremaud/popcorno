import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses the .env.example defaults when nothing is set, listening on loopback only', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '127.0.0.1',
      databasePath: 'data/popcorno.sqlite',
      mediaRoot: resolve('media'),
      ffprobePath: 'ffprobe',
    });
  });

  it('reads every variable from the environment', () => {
    expect(
      loadConfig({
        PORT: '8080',
        HOST: '0.0.0.0',
        DATABASE_PATH: '/tmp/x.db',
        MEDIA_ROOT: '/m/../m',
        FFPROBE_PATH: '/bin/fp',
      }),
    ).toEqual({
      port: 8080,
      host: '0.0.0.0',
      databasePath: '/tmp/x.db',
      mediaRoot: '/m',
      ffprobePath: '/bin/fp',
    });
  });
});
