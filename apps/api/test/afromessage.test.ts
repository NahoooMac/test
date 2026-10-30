// Adapter behaviour against a mocked HTTP layer. Does NOT prove the live AfroMessage contract.
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

  it('never puts the message text in error messages', async () => {
    const err = await provider(async () => json(400, {}))
      .send({ to: '+251911234567', text: 'secret 123456' })
      .catch((e) => e);
    expect(String(err.message)).not.toContain('123456');
  });
});
