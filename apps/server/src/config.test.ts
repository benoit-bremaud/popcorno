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
      tmdbApiKey: null,
      tmdbLanguage: 'en-US',
      artworkDir: resolve('data/artwork'),
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
        TMDB_API_KEY: ' k3y ',
        TMDB_LANGUAGE: 'fr-FR',
        ARTWORK_DIR: '/tmp/art',
      }),
    ).toEqual({
      port: 8080,
      host: '0.0.0.0',
      databasePath: '/tmp/x.db',
      mediaRoot: '/m',
      ffprobePath: '/bin/fp',
      tmdbApiKey: 'k3y',
      tmdbLanguage: 'fr-FR',
      artworkDir: '/tmp/art',
    });
  });

  it('treats an empty key or the .env.example placeholder as no key', () => {
    expect(loadConfig({ TMDB_API_KEY: '' }).tmdbApiKey).toBeNull();
    expect(loadConfig({ TMDB_API_KEY: 'your-tmdb-read-access-token' }).tmdbApiKey).toBeNull();
  });
});
