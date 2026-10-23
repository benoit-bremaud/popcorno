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
      ffmpegPath: 'ffmpeg',
      transcodeDir: resolve('data/transcode'),
      transcodeMaxSessions: 1,
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
        FFMPEG_PATH: '/bin/ff',
        TRANSCODE_DIR: '/tmp/hls',
        TRANSCODE_MAX_SESSIONS: '3',
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
      ffmpegPath: '/bin/ff',
      transcodeDir: '/tmp/hls',
      transcodeMaxSessions: 3,
      tmdbApiKey: 'k3y',
      tmdbLanguage: 'fr-FR',
      artworkDir: '/tmp/art',
    });
  });

  it.each(['0', '-2', 'abc'])('falls back to one transcode at a time for %s', (value) => {
    expect(loadConfig({ TRANSCODE_MAX_SESSIONS: value }).transcodeMaxSessions).toBe(1);
  });

  it('treats an empty key or the .env.example placeholder as no key', () => {
    expect(loadConfig({ TMDB_API_KEY: '' }).tmdbApiKey).toBeNull();
    expect(loadConfig({ TMDB_API_KEY: 'your-tmdb-read-access-token' }).tmdbApiKey).toBeNull();
  });
});
