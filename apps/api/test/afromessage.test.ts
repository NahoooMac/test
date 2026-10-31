// Adapter behaviour against a mocked HTTP layer, shaped like the official API reference.
import { describe, expect, it } from 'vitest';
import { AfroMessageSmsProvider } from '../src/integrations/sms/afromessage.ts';
import { SmsSendError } from '../src/integrations/sms/types.ts';

function provider(fetchImpl: typeof fetch) {
  return new AfroMessageSmsProvider({
    baseUrl: 'https://api.afromessage.test',
    token: 'test-token',
    identifierId: 'ident-1',
    sender: 'Courier',
    timeoutMs: 50,
    fetch: fetchImpl,
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AfroMessageSmsProvider', () => {
  it('posts JSON with bearer auth and returns the message id', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = provider(async (url, init) => {
      seen = { url: String(url), init: init! };
      return json(200, { acknowledge: 'success', response: { message_id: 42 } });
    });
    const result = await p.send({ to: '+251911234567', text: 'hello' });
    expect(result).toEqual({ providerMessageId: '42', status: 'sent' });
    expect(seen!.url).toBe('https://api.afromessage.test/api/send');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      to: '+251911234567',
      message: 'hello',
      from: 'ident-1',
      sender: 'Courier',
    });
  });

  it('treats an explicit rejection as not sent (safe to retry)', async () => {
    const p = provider(async () =>
      json(200, { acknowledge: 'error', response: { errors: ['x'] } }),
    );
    await expect(p.send({ to: '+251911234567', text: 'x' })).rejects.toMatchObject({
      outcome: 'not_sent',
    });
  });

  it('treats 4xx as not sent and 5xx as unknown', async () => {
    await expect(
      provider(async () => json(401, {})).send({ to: '+251911234567', text: 'x' }),
    ).rejects.toMatchObject({
      outcome: 'not_sent',
      code: 'HTTP_401',
    });
    await expect(
      provider(async () => json(502, {})).send({ to: '+251911234567', text: 'x' }),
    ).rejects.toMatchObject({
      outcome: 'unknown',
    });
  });

  it('treats a timeout as unknown (might have been delivered)', async () => {
    const p = provider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
        }),
    );
    const err = await p.send({ to: '+251911234567', text: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err.outcome).toBe('unknown');
    expect(err.code).toBe('TIMEOUT');
  });

  it("reports AfroMessage's error code, e.g. a low balance, without the body text", async () => {
    // Exact response seen from the live API on 2026-10-31.
    const lowBalance = async () =>
      new Response(
        'Unauthorized (401-9) : Account balance is too low. Please refill or contact support.',
        {
          status: 401,
        },
      );
    await expect(
      provider(lowBalance).send({ to: '+251911234567', text: 'x' }),
    ).rejects.toMatchObject({
      outcome: 'not_sent',
      code: 'AFRO_401-9',
      message: 'AfroMessage account balance is too low',
    });
    // An unknown provider code is passed through with a generic message.
    const err = await provider(
      async () => new Response('Bad (400-3) : 123456 is your code', { status: 400 }),
    )
      .send({ to: '+251911234567', text: '123456 is your code' })
      .catch((e) => e);
    expect(err.code).toBe('AFRO_400-3');
    expect(err.message).not.toContain('123456');
  });

  it('reads the balance and message status', async () => {
    const urls: string[] = [];
    const p = provider(async (url) => {
      urls.push(String(url));
      return String(url).endsWith('/api/balance')
        ? json(200, {
            acknowledge: 'success',
            response: { balance: '205.65', estimatedMessages: '3577' },
          })
        : json(200, {
            acknowledge: 'success',
            response: { status: 'DELIVRD', description: 'Delivered' },
          });
    });
    expect(await p.balance()).toEqual({ balance: '205.65', estimatedMessages: '3577' });
    expect(await p.status('abc 1')).toEqual({ status: 'DELIVRD', description: 'Delivered' });
    expect(urls[1]).toBe('https://api.afromessage.test/api/status?id=abc%201');
  });

  it('never puts the message text in error messages', async () => {
    const err = await provider(async () => json(400, {}))
      .send({ to: '+251911234567', text: 'secret 123456' })
      .catch((e) => e);
    expect(String(err.message)).not.toContain('123456');
  });
});
