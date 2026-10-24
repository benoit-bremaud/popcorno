import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createFfprobe } from './library/ffprobe.js';
import { createTmdbClient } from './metadata/tmdb-client.js';
import { createTranscoder } from './playback/transcoder.js';

const config = loadConfig(process.env);
await mkdir(dirname(config.databasePath), { recursive: true });
// `@fastify/static` checks its root at start-up; the cache would only create it on first write.
await mkdir(config.artworkDir, { recursive: true });

const app = buildApp({
  version: process.env['npm_package_version'] ?? '0.0.0',
  db: openDatabase(config.databasePath),
  probe: createFfprobe(config.ffprobePath),
  mediaRoot: config.mediaRoot,
  tmdb: config.tmdbApiKey
    ? createTmdbClient({
        apiKey: config.tmdbApiKey,
        language: config.tmdbLanguage,
        fetch: globalThis.fetch,
      })
    : null,
  artworkDir: config.artworkDir,
  transcoder: createTranscoder(config.ffmpegPath),
  transcodeDir: config.transcodeDir,
  transcodeMaxSessions: config.transcodeMaxSessions,
  logger: true,
});

if (!config.tmdbApiKey) app.log.warn('TMDB_API_KEY not set: metadata enrichment disabled');

// Ctrl-C and `docker stop` close the app, so its onClose hook kills every FFmpeg child.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
