import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createFfprobe } from './library/ffprobe.js';

const config = loadConfig(process.env);
await mkdir(dirname(config.databasePath), { recursive: true });

const app = buildApp({
  version: process.env['npm_package_version'] ?? '0.0.0',
  db: openDatabase(config.databasePath),
  probe: createFfprobe(config.ffprobePath),
  mediaRoot: config.mediaRoot,
  logger: true,
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
