// Live updates over Server-Sent Events.
//
// Why SSE rather than WebSockets/Socket.IO: updates only flow server → client (clients act through
// the REST API), it rides the same HTTPS origin and session cookie, browsers reconnect on their own,
// and it needs no extra dependency. Events are *signals*: clients refetch from the API, so a missed
// event only costs latency (slow polling remains as a fallback), never correctness.
//
// Limitation: connections live in this process. With several API instances, fan-out needs a shared
// channel (e.g. Postgres LISTEN/NOTIFY) — not needed for a single instance.
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { UserRole } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveries } from '../../db/schema.ts';

export type LiveEventType =
  | 'delivery' // a delivery's status or details changed
  | 'location' // the assigned rider moved
  | 'offer' // a rider's offer appeared, lapsed or was withdrawn
  | 'rider' // a rider's own profile/approval changed
  | 'ops'; // something on the admin operations board changed

export interface LiveEvent {
  type: LiveEventType;
  data: Record<string, unknown>;
}

interface Connection {
  id: number;
  res: ServerResponse;
  userId: string | null;
  sessionId: string | null;
  role: UserRole | null;
  /** Public tracking streams listen to one delivery code only. */
  publicCode: string | null;
}

export interface Audience {
  userIds?: Array<string | null | undefined>;
  admins?: boolean;
  publicCode?: string | null;
}

const HEARTBEAT_MS = 25_000;

export class RealtimeHub {
  private readonly conns = new Map<number, Connection>();
  private readonly db: Db;
  private readonly log: FastifyBaseLogger;
  private nextId = 1;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(db: Db, log: FastifyBaseLogger) {
    this.db = db;
    this.log = log;
    // Comment lines keep proxies and mobile carriers from closing idle streams.
    this.heartbeat = setInterval(() => {
      for (const c of this.conns.values()) c.res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Takes over a raw HTTP response and keeps it open as an event stream. */
  open(
    res: ServerResponse,
    who: {
      userId: string | null;
      sessionId: string | null;
      role: UserRole | null;
      publicCode?: string | null;
    },
  ): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable buffering in nginx-style proxies
    });
    res.write('retry: 3000\n\n');
    const id = this.nextId++;
    this.conns.set(id, { id, res, publicCode: null, ...who });
    this.send(res, { type: 'ops', data: { hello: true } });
    return () => this.conns.delete(id);
  }

  get size(): number {
    return this.conns.size;
  }

  publish(event: LiveEvent, audience: Audience): void {
    const users = new Set((audience.userIds ?? []).filter(Boolean));
    for (const c of this.conns.values()) {
      const match =
        (c.userId !== null && users.has(c.userId)) ||
        (audience.admins && c.role === 'admin') ||
        (audience.publicCode && c.publicCode === audience.publicCode);
      if (match) this.send(c.res, event);
    }
  }

  /** Signals everyone concerned with a delivery after its state changed (call after commit). */
  async deliveryChanged(deliveryId: string): Promise<void> {
    try {
      const [d] = await this.db
        .select({
          customerId: deliveries.customerId,
          riderId: deliveries.riderId,
          code: deliveries.publicCode,
          status: deliveries.status,
        })
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId));
      if (!d) return;
      this.publish(
        { type: 'delivery', data: { id: deliveryId, status: d.status } },
        { userIds: [d.customerId, d.riderId], admins: true, publicCode: d.code },
      );
    } catch (err) {
      this.log.warn({ err, deliveryId }, 'live delivery event failed');
    }
  }

  /** A previous rider (released / cancelled job) also needs to refresh. */
  notifyUser(userId: string, type: LiveEventType, data: Record<string, unknown> = {}): void {
    this.publish({ type, data }, { userIds: [userId] });
  }

  /** Ends all streams of a revoked session (logout, suspension). */
  closeSession(sessionId: string): void {
    for (const c of this.conns.values()) {
      if (c.sessionId === sessionId) {
        c.res.end();
        this.conns.delete(c.id);
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.conns.values()) c.res.end();
    this.conns.clear();
  }

  private send(res: ServerResponse, event: LiveEvent) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }
}

/** Used where no hub is wired (unit tests of services). */
export const noopRealtime = {
  deliveryChanged: async () => {},
  notifyUser: () => {},
  publish: () => {},
} satisfies Pick<RealtimeHub, 'deliveryChanged' | 'notifyUser' | 'publish'>;

export type Realtime = Pick<RealtimeHub, 'deliveryChanged' | 'notifyUser' | 'publish'>;
