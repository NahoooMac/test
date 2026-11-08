import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NearbyRider, Place, PlaceSuggestion } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { GeoProviderError, type GeoProvider } from '../../integrations/maps/index.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import { nearbyRiders } from './nearbyRiders.ts';

const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });
const reverseQuery = z.object({ lat: z.coerce.number(), lng: z.coerce.number() });
const resolveQuery = z.object({ ref: z.string().min(3).max(500) });
const nearQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** Server-side proxy so the geocoder key is never exposed and usage can be capped per user. */
export async function geoRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; geo: GeoProvider },
) {
  const { db, clock, auth, geo } = deps;

  const guard = async (userId: string) => {
    const r = await consume(db, { key: `geo:1m:${userId}`, windowSec: 60, limit: 60 }, clock.now());
    if (!r.allowed) throw tooManyRequests(r.retryAfterSec);
  };

  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GeoProviderError) {
        app.log.warn({ code: err.code, provider: geo.name }, 'geocoder failed');
        throw new AppError(
          503,
          'GEO_UNAVAILABLE',
          'Address search is unavailable. Use the map pin instead.',
        );
      }
      throw err;
    }
  };

  app.get('/geo/search', async (req, reply): Promise<PlaceSuggestion[]> => {
    const { user } = await auth.require(req, reply);
    const { q } = parseInput(searchQuery, req.query);
    await guard(user.id);
    return call(() => geo.suggest(q));
  });

  app.get('/geo/resolve', async (req, reply): Promise<Place | null> => {
    const { user } = await auth.require(req, reply);
    const { ref } = parseInput(resolveQuery, req.query);
    await guard(user.id);
    return call(() => geo.resolve(ref));
  });

  app.get('/geo/reverse', async (req, reply): Promise<Place | null> => {
    const { user } = await auth.require(req, reply);
    const point = parseInput(reverseQuery, req.query);
    await guard(user.id);
    return call(() => geo.reverse(point));
  });

  // Anonymous, approximate positions of free riders near a point (booking map). Customers only.
  app.get('/geo/nearby-riders', async (req, reply): Promise<NearbyRider[]> => {
    const { user } = await auth.require(req, reply, 'customer');
    const at = parseInput(nearQuery, req.query);
    await guard(user.id);
    reply.header('Cache-Control', 'no-store');
    return nearbyRiders(db, at, clock.now());
  });
}
