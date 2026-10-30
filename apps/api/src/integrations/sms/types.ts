export interface SmsMessage {
  /** E.164, e.g. +251911234567 */
  to: string;
  text: string;
}

export interface SmsSendResult {
  providerMessageId: string | null;
  status: 'sent' | 'queued';
}

/**
 * `outcome` tells the caller whether a retry could produce a duplicate SMS:
 *  - 'not_sent': rejected before delivery (bad credentials, invalid number, connection refused).
 *  - 'unknown':  timed out or the provider failed after accepting — it may still arrive.
 */
export class SmsSendError extends Error {
  readonly outcome: 'not_sent' | 'unknown';
  readonly code: string;

  constructor(outcome: 'not_sent' | 'unknown', code: string, message: string) {
    super(message);
    this.outcome = outcome;
    this.code = code;
  }
}

/** Every SMS provider implements this; nothing outside `integrations/sms` knows which one is active. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}
