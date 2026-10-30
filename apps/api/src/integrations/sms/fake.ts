import type { SmsMessage, SmsProvider, SmsSendError, SmsSendResult } from './types.ts';

/** Test double: records messages and can be told to fail. */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly sent: SmsMessage[] = [];
  failNext: SmsSendError | null = null;

  async send(message: SmsMessage): Promise<SmsSendResult> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.sent.push(message);
    return { providerMessageId: `fake-${this.sent.length}`, status: 'sent' };
  }

  /** The 6-digit code in the most recent message to `to`. */
  lastCodeFor(to: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    const code = msg?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No code sent to ${to}`);
    return code;
  }

  countFor(to: string): number {
    return this.sent.filter((m) => m.to === to).length;
  }
}
