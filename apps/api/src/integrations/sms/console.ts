import { maskPhone } from '@dp/shared';
import type { SmsMessage, SmsProvider, SmsSendResult } from './types.ts';

/**
 * Development only: prints the message to this terminal instead of sending it, so sign-in can be
 * tested without spending SMS credit. Configuration refuses this provider in production.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';

  async send({ to, text }: SmsMessage): Promise<SmsSendResult> {
    console.log(`\n  [dev sms → ${maskPhone(to)}] ${text}\n`);
    return { providerMessageId: null, status: 'sent' };
  }
}
