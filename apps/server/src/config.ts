import { resolve } from 'node:path';

/** Runtime configuration, read once from the environment (see `.env.example`). */
export interface ServerConfig {
  readonly port: number;
  /** Loopback by default: the API has no authentication yet; Docker sets `0.0.0.0`. */
  readonly host: string;
  readonly databasePath: string;
  /** Absolute folder every library root must live under (`POST /libraries` rejects the rest). */
  readonly mediaRoot: string;
  readonly ffprobePath: string;
}

/** Builds the configuration from an environment map; defaults match `.env.example`. */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    port: Number(env['PORT'] ?? 3000),
    host: env['HOST'] ?? '127.0.0.1',
    databasePath: env['DATABASE_PATH'] ?? 'data/popcorno.sqlite',
    mediaRoot: resolve(env['MEDIA_ROOT'] ?? 'media'),
    ffprobePath: env['FFPROBE_PATH'] ?? 'ffprobe',
  };
}
