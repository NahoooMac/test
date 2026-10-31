// Live updates (SSE), public tracking privacy, and the admin operations board.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { riders, users } from '../src/db/schema.ts';
import { RealtimeHub } from '../src/modules/realtime/hub.ts';
import { createTestApp, ORIGIN, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let ip = 0;
const nextIp = () => `10.30.0.${++ip}`;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };

const call = (
  method: 'GET' | 'POST',
  url: string,
  cookie: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN, ...headers },
    ...(payload ? { payload: payload as object } : {}),
  });

async function customer(phone: string) {
  const s = await signIn(t, phone, nextIp());
  return { id: s.body.user.id as string, cookie: s.cookie };
}

async function onlineRider(phone: string) {
  const s = await signIn(t, phone, nextIp());
  await call('POST', '/api/rider/apply', s.cookie, {
    fullName: 'Dawit Mekonnen',
    vehicleType: 'motorcycle',
    plateNumber: '3-A55501',
  });
  await t.database.db
    .update(riders)
    .set({ approvalStatus: 'approved' })
    .where(eq(riders.userId, s.body.user.id));
  await call('POST', '/api/rider/status', s.cookie, { online: true });
  await call('POST', '/api/rider/location', s.cookie, MESKEL);
  return { id: s.body.user.id as string, cookie: s.cookie };
}

let n = 0;
async function book(c: { cookie: string }) {
  const res = await call(
    'POST',
    '/api/deliveries',
    c.cookie,
    {
      pickup: {
        ...MESKEL,
        address: 'Meskel Square',
        contactName: 'Hana',
        contactPhone: '0911111111',
      },
      dropoff: {
        ...PIASSA,
        address: 'Saint George Church',
        contactName: 'Abel',
        contactPhone: '0922222222',
      },
      vehicleType: 'motorcycle',
      payer: 'sender',
      preferredPaymentMethod: 'cash',
      parcel: { description: 'Documents', size: 'small' },
    },
    { 'idempotency-key': `rt-key-${++n}` },
  );
  return res.json() as { id: string; code: string };
}

/** Collects what the hub writes to a fake response. */
function fakeRes() {
  const chunks: string[] = [];
  const res = {
    writeHead: () => res,
    write: (c: string) => chunks.push(c),
    end: () => chunks.push('<end>'),
  } as unknown as ServerResponse;
  return {
    res,
    events: () =>
      chunks.filter((c) => c.startsWith('event:')).map((c) => c.split('\n')[0]!.slice(7)),
    chunks,
  };
}

describe('hub routing', () => {
  it('sends a delivery change to its customer, rider, admins and public page only', async () => {
    const c = await customer('0911000401');
    const other = await customer('0911000402');
    const r = await onlineRider('0944000401');
    const d = await book(c);
    const offer = (await call('GET', '/api/rider/home', r.cookie)).json().offer;
    await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);

    const hub = new RealtimeHub(t.database.db, t.app.log);
    const conns = {
      customer: fakeRes(),
      other: fakeRes(),
      rider: fakeRes(),
      admin: fakeRes(),
      publicSame: fakeRes(),
      publicOther: fakeRes(),
    };
    hub.open(conns.customer.res, { userId: c.id, sessionId: 's1', role: 'customer' });
    hub.open(conns.other.res, { userId: other.id, sessionId: 's2', role: 'customer' });
    hub.open(conns.rider.res, { userId: r.id, sessionId: 's3', role: 'rider' });
    hub.open(conns.admin.res, { userId: 'admin-1', sessionId: 's4', role: 'admin' });
    hub.open(conns.publicSame.res, {
      userId: null,
      sessionId: null,
      role: null,
      publicCode: d.code,
    });
    hub.open(conns.publicOther.res, {
      userId: null,
      sessionId: null,
      role: null,
      publicCode: 'ZZZZZZ',
    });

    await hub.deliveryChanged(d.id);
    const got = (k: keyof typeof conns) => conns[k].events().includes('delivery');
    expect([got('customer'), got('rider'), got('admin'), got('publicSame')]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([got('other'), got('publicOther')]).toEqual([false, false]);

    hub.closeSession('s1');
    expect(conns.customer.chunks.at(-1)).toBe('<end>');
    expect(hub.size).toBe(5);
    hub.close();
  });
});

describe('event stream over HTTP', () => {
  it('requires a session', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(401);
  });

  it('pushes a signal when the delivery changes, and closes on logout', async () => {
    const c = await customer('0911000410');
    const d = await book(c);
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.server.address() as { port: number };

    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { cookie: c.cookie },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!buffer.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer.includes(needle);
    };

    expect(await readUntil('"hello":true')).toBe(true);
    await call('POST', `/api/deliveries/${d.id}/cancel`, c.cookie, {});
    expect(await readUntil('event: delivery')).toBe(true);
    expect(buffer).toContain(`"id":"${d.id}"`);
    expect(buffer).toContain('"status":"cancelled"');

    await call('POST', '/api/auth/logout', c.cookie);
    const { done } = await reader.read().then(async (r) => (r.done ? r : reader.read()));
    expect(done).toBe(true);
  });
});

describe('public tracking', () => {
  it('shows progress without sender or receiver phone numbers', async () => {
    const c = await customer('0911000420');
    const d = await book(c);
    const res = await t.app.inject({ method: 'GET', url: `/api/track/${d.code.toLowerCase()}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      code: d.code,
      status: 'requested',
      rider: null,
      riderLocation: null,
    });
    expect(body.timeline.map((e: { status: string }) => e.status)).toEqual(['requested']);
    const raw = res.body;
    expect(raw).not.toContain('+251911111111');
    expect(raw).not.toContain('+251922222222');
    expect(raw).not.toContain('fare');
  });

  it("shows the rider, their phone and position only while they're on the job", async () => {
    const c = await customer('0911000430');
    const r = await onlineRider('0944000430');
    const d = await book(c);
    const offer = (await call('GET', '/api/rider/home', r.cookie)).json().offer;
    await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
    await call('POST', '/api/rider/location', r.cookie, { lat: 9.015, lng: 38.759 });

    const active = (await t.app.inject({ method: 'GET', url: `/api/track/${d.code}` })).json();
    expect(active.rider).toEqual({
      firstName: 'Dawit',
      vehicleType: 'motorcycle',
      plate: '3-A55501',
      phone: '+251944000430',
    });
    expect(active.riderLocation).toMatchObject({ lat: 9.015, lng: 38.759 });

    // The customer's own view carries the live position too.
    const mine = (await call('GET', `/api/deliveries/${d.id}`, c.cookie)).json();
    expect(mine.riderLocation).toMatchObject({ lat: 9.015, lng: 38.759 });

    for (const to of ['arrived_pickup', 'picked_up', 'arrived_dropoff', 'delivered']) {
      await call('POST', `/api/rider/jobs/${d.id}/step`, r.cookie, { to });
    }
    const done = (await t.app.inject({ method: 'GET', url: `/api/track/${d.code}` })).json();
    expect(done.status).toBe('delivered');
    expect(done.rider.phone).toBeNull();
    expect(done.riderLocation).toBeNull();
  });

  it('unknown or malformed codes are 404; the endpoint is rate limited', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/track/ABCDEF' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/track/x' })).statusCode).toBe(404);
    let last = 0;
    for (let i = 0; i < 61; i++)
      last = (
        await t.app.inject({ method: 'GET', url: '/api/track/ABCDEF', remoteAddress: '10.99.0.1' })
      ).statusCode;
    expect(last).toBe(429);
  });
});

describe('admin operations board', () => {
  it('lists online riders and open deliveries, and flags long waits', async () => {
    const adminS = await signIn(t, '0955000440', nextIp());
    await t.database.db
      .update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, adminS.body.user.id));
    const c = await customer('0911000440');
    const d = await book(c); // no rider online yet → requested
    const r = await onlineRider('0944000440');

    t.clock.advanceSeconds(6 * 60);
    const ops = (await call('GET', '/api/admin/ops', adminS.cookie)).json();
    expect(ops.deliveries).toEqual([
      expect.objectContaining({ id: d.id, status: 'requested', needsAttention: true }),
    ]);
    expect(ops.riders).toEqual([
      expect.objectContaining({ id: r.id, state: 'idle', isOnline: true, plate: '3-A55501' }),
    ]);

    expect((await call('GET', '/api/admin/ops', c.cookie)).statusCode).toBe(403);
  });
});
