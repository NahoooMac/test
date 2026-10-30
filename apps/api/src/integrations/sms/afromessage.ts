// AfroMessage adapter.
// NOT YET VERIFIED against the live API. Built from third-party client libraries
// (POST {base}/api/send, Bearer token, JSON body with to/message and optional from/sender/callback).
// Confirm field names and the response shape with a real account before enabling in production.
import { SmsSendError, type SmsMessage, type SmsProvider, type SmsSendResult } from './types.ts';

export interface AfroMessageOptions {
  baseUrl: string;
  token: string;
  identifierId?: string | undefined;
  sender?: string | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
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

    const data = (await res.json().catch(() => null)) as AfroMessageResponse | null;

    if (res.status >= 500) {
      throw new SmsSendError('unknown', `HTTP_${res.status}`, 'SMS provider error');
    }
    if (!res.ok || data?.acknowledge !== 'success') {
      // 4xx or explicit rejection: the message was not accepted. Never include the body text (it has the code).
      throw new SmsSendError('not_sent', `HTTP_${res.status}`, 'SMS provider rejected the message');
    }

    const response = (data.response ?? {}) as { message_id?: string | number };
    return {
      providerMessageId: response.message_id != null ? String(response.message_id) : null,
      status: 'sent',
    };
  }
}
