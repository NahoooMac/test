// AfroMessage adapter, per the official API reference (https://www.afromessage.com/developers):
// POST {base}/api/send with a Bearer token and a JSON body {from?, sender?, to, message};
// success is {"acknowledge":"success","response":{"message_id":…}}.
// Verified live (2026-10-31): the token authenticates (/api/balance). A real send is still pending.
// We generate and hash our own codes rather than using AfroMessage's /challenge, so rate limits,
// lockouts and expiry stay under our control and the code never leaves our system except in the SMS.
import { SmsSendError, type SmsMessage, type SmsProvider, type SmsSendResult } from './types.ts';

export interface AfroMessageOptions {
  baseUrl: string;
  token: string;
  identifierId?: string | undefined;
  sender?: string | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
}

// AfroMessage errors look like "Unauthorized (401-9) : Account balance is too low…". The code in
// brackets is safe to log; the free text is not (a rejection could echo the message, i.e. the OTP).
const KNOWN_ERRORS: Record<string, string> = {
  '401-9': 'AfroMessage account balance is too low',
};

function providerError(status: number, raw: string): { code: string; message: string } {
  const providerCode = /\((\d{3}-\d+)\)/.exec(raw)?.[1];
  if (!providerCode)
    return { code: `HTTP_${status}`, message: 'SMS provider rejected the message' };
  return {
    code: `AFRO_${providerCode}`,
    message: KNOWN_ERRORS[providerCode] ?? 'SMS provider rejected the message',
  };
}

export interface AfroMessageBalance {
  balance: string;
  estimatedMessages: string;
}

interface AfroMessageResponse {
  acknowledge?: string;
  response?: { message_id?: string | number; status?: string; errors?: unknown } | unknown;
}

export class AfroMessageSmsProvider implements SmsProvider {
  readonly name = 'afromessage';
  private readonly opts: AfroMessageOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AfroMessageOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async send({ to, text }: SmsMessage): Promise<SmsSendResult> {
    const body: Record<string, string> = { to, message: text };
    if (this.opts.identifierId) body.from = this.opts.identifierId;
    if (this.opts.sender) body.sender = this.opts.sender;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/api/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        // The request may have reached the provider: do not resend automatically.
        throw new SmsSendError('unknown', 'TIMEOUT', 'SMS provider did not respond in time');
      }
      const code = e.cause?.code ?? 'NETWORK';
      const definitelyNotSent =
        code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN';
      throw new SmsSendError(
        definitelyNotSent ? 'not_sent' : 'unknown',
        code,
        'SMS provider unreachable',
      );
    }

    const raw = await res.text().catch(() => '');
    const data = parseJson(raw);

    if (res.status >= 500) {
      throw new SmsSendError('unknown', `HTTP_${res.status}`, 'SMS provider error');
    }
    if (!res.ok || data?.acknowledge !== 'success') {
      // 4xx or explicit rejection: the message was not accepted. Never include the body text (it may
      // echo the message, which contains the code) — only AfroMessage's bracketed error code.
      const e = providerError(res.status, raw);
      throw new SmsSendError('not_sent', e.code, e.message);
    }

    const response = (data.response ?? {}) as { message_id?: string | number };
    return {
      providerMessageId: response.message_id != null ? String(response.message_id) : null,
      status: 'sent',
    };
  }

  /** Account balance (GET /api/balance). Sends nothing; used by `npm run sms:check`. */
  async balance(): Promise<AfroMessageBalance> {
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/api/balance`, {
      headers: { Authorization: `Bearer ${this.opts.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const raw = await res.text().catch(() => '');
    const data = parseJson(raw);
    if (!res.ok || data?.acknowledge !== 'success') {
      const e = providerError(res.status, raw);
      throw new SmsSendError('not_sent', e.code, e.message);
    }
    const r = (data.response ?? {}) as Partial<AfroMessageBalance>;
    return {
      balance: String(r.balance ?? '?'),
      estimatedMessages: String(r.estimatedMessages ?? '?'),
    };
  }

  /** Delivery status of a sent message (GET /api/status; rate limited to 30 calls a minute). */
  async status(messageId: string): Promise<{ status: string; description?: string }> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/api/status?id=${encodeURIComponent(messageId)}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.opts.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const raw = await res.text().catch(() => '');
    const data = parseJson(raw);
    if (!res.ok || data?.acknowledge !== 'success') {
      const e = providerError(res.status, raw);
      throw new SmsSendError('unknown', e.code, e.message);
    }
    const r = (data.response ?? {}) as { status?: string; description?: string };
    return {
      status: r.status ?? 'UNKNOWN',
      ...(r.description ? { description: r.description } : {}),
    };
  }
}

function parseJson(raw: string): AfroMessageResponse | null {
  try {
    return JSON.parse(raw) as AfroMessageResponse;
  } catch {
    return null;
  }
}
