import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses the .env.example defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      databasePath: 'data/popcorno.sqlite',
      mediaRoot: 'media',
      ffprobePath: 'ffprobe',
    });
  });

  it('reads every variable from the environment', () => {
    expect(
      loadConfig({
        PORT: '8080',
        HOST: '127.0.0.1',
        DATABASE_PATH: '/tmp/x.db',
        MEDIA_ROOT: '/m',
        FFPROBE_PATH: '/bin/fp',
      }),
    ).toEqual({
      port: 8080,
      host: '127.0.0.1',
      databasePath: '/tmp/x.db',
      mediaRoot: '/m',
      ffprobePath: '/bin/fp',
    });
  });
});
