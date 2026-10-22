/** Contracts shared by the server and the web player. */

/** Response of `GET /health` — liveness only, never depends on the database or FFmpeg. */
export interface HealthResponse {
  readonly status: 'ok';
  readonly version: string;
}
