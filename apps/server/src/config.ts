/** Runtime configuration, read once from the environment (see `.env.example`). */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly databasePath: string;
  readonly mediaRoot: string;
  readonly ffprobePath: string;
}

/** Builds the configuration from an environment map; defaults match `.env.example`. */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    port: Number(env['PORT'] ?? 3000),
    host: env['HOST'] ?? '0.0.0.0',
    databasePath: env['DATABASE_PATH'] ?? 'data/popcorno.sqlite',
    mediaRoot: env['MEDIA_ROOT'] ?? 'media',
    ffprobePath: env['FFPROBE_PATH'] ?? 'ffprobe',
  };
}
