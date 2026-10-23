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
  /** TMDB v3 key or v4 read token; null disables UC2 (ADR-0003). Never logged. */
  readonly tmdbApiKey: string | null;
  /** `language` sent on every TMDB request, e.g. `en-US`, `fr-FR`. */
  readonly tmdbLanguage: string;
  /** Absolute folder the artwork cache writes to and `GET /artwork/:file` serves from. */
  readonly artworkDir: string;
}

/** Builds the configuration from an environment map; defaults match `.env.example`. */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const tmdbApiKey = env['TMDB_API_KEY']?.trim();
  return {
    port: Number(env['PORT'] ?? 3000),
    host: env['HOST'] ?? '127.0.0.1',
    databasePath: env['DATABASE_PATH'] ?? 'data/popcorno.sqlite',
    mediaRoot: resolve(env['MEDIA_ROOT'] ?? 'media'),
    ffprobePath: env['FFPROBE_PATH'] ?? 'ffprobe',
    // The .env.example placeholder must not count as a key.
    tmdbApiKey: tmdbApiKey && tmdbApiKey !== 'your-tmdb-api-key' ? tmdbApiKey : null,
    tmdbLanguage: env['TMDB_LANGUAGE'] ?? 'en-US',
    artworkDir: resolve(env['ARTWORK_DIR'] ?? 'data/artwork'),
  };
}
