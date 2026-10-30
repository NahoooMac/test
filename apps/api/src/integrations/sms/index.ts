import type { Config } from '../../config/env.ts';
import { AfroMessageSmsProvider } from './afromessage.ts';
import { ConsoleSmsProvider } from './console.ts';
import type { SmsProvider } from './types.ts';

export * from './types.ts';

export function createSmsProvider(config: Config): SmsProvider {
  switch (config.SMS_PROVIDER) {
    case 'afromessage':
      return new AfroMessageSmsProvider({
        baseUrl: config.AFROMESSAGE_BASE_URL,
        token: config.AFROMESSAGE_TOKEN!,
        identifierId: config.AFROMESSAGE_IDENTIFIER_ID,
        sender: config.AFROMESSAGE_SENDER,
        timeoutMs: config.SMS_TIMEOUT_MS,
      });
    case 'console':
      return new ConsoleSmsProvider();
  }
}
