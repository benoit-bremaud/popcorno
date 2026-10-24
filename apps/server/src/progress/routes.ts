import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError, invalid } from '../http.js';
import type { ProgressRepository } from './repository.js';

const mediaParams = z.object({ id: z.uuid() });
/** A week of media time: far beyond any file, small enough to keep rows sane. */
export const MAX_POSITION_SEC = 7 * 86_400;
const progressBody = z.object({ positionSec: z.int().min(0).max(MAX_POSITION_SEC) });

/**
 * UC6 (spec resume-playback §2.2): `PUT /media/:id/progress` (204 | 400 | 404
 * `media_not_found`) and `GET /progress` (the default profile's positions).
 */
export function registerProgressRoutes(
  app: FastifyInstance,
  deps: { readonly progress: ProgressRepository },
): void {
  app.put('/media/:id/progress', async (request, reply) => {
    const params = mediaParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid(params.error.issues));
    const body = progressBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(invalid(body.error.issues));
    if (!deps.progress.save(params.data.id, body.data.positionSec)) {
      return reply.code(404).send(apiError('media_not_found'));
    }
    return reply.code(204).send();
  });

  app.get('/progress', (_request, reply) => reply.send(deps.progress.list()));
}
