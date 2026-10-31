// `npm run sms:check` — shows the AfroMessage balance (sends nothing).
// `npm run sms:check -- --send 0911234567` — also sends ONE test SMS to that number, then reports
// its delivery status. Costs one SMS; only run it for a number whose owner agreed to receive it.
import { maskPhone, normalizeEthiopianPhone } from '@dp/shared';
import { loadConfig, loadDotEnv } from '../../config/env.ts';
import { AfroMessageSmsProvider } from './afromessage.ts';
import { SmsSendError } from './types.ts';

loadDotEnv();
const config = loadConfig();
if (!config.AFROMESSAGE_TOKEN) {
  console.error('AFROMESSAGE_TOKEN is not set in apps/api/.env.');
  process.exit(1);
}

const sendIndex = process.argv.indexOf('--send');
const target = sendIndex >= 0 ? normalizeEthiopianPhone(process.argv[sendIndex + 1] ?? '') : null;
if (target && !target.ok) {
  console.error('Usage: npm run sms:check -- --send <Ethiopian mobile number>');
  process.exit(1);
}

const afro = new AfroMessageSmsProvider({
  baseUrl: config.AFROMESSAGE_BASE_URL,
  token: config.AFROMESSAGE_TOKEN,
  identifierId: config.AFROMESSAGE_IDENTIFIER_ID,
  sender: config.AFROMESSAGE_SENDER,
  timeoutMs: config.SMS_TIMEOUT_MS,
});

const fail = (err: unknown) => {
  const e = err instanceof SmsSendError ? `${err.code}: ${err.message}` : String(err);
  console.error(`✗ ${e}`);
  process.exit(1);
};

console.log(`Sender name: ${config.AFROMESSAGE_SENDER ?? '(AfroMessage default)'}`);
const balance = await afro.balance().catch(fail);
console.log(`✓ Token works. Balance ${balance.balance} ETB (≈ ${balance.estimatedMessages} SMS).`);

if (target?.ok) {
  const sent = await afro
    .send({ to: target.e164, text: 'Test message from the delivery platform. No action needed.' })
    .catch(fail);
  console.log(`✓ Accepted for ${maskPhone(target.e164)}, message id ${sent.providerMessageId}.`);
  if (sent.providerMessageId) {
    // Delivery reports arrive within seconds; /status is rate limited, so ask a few times only.
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const status = await afro.status(sent.providerMessageId).catch(fail);
      console.log(
        `  status: ${status.status}${status.description ? ` (${status.description})` : ''}`,
      );
      if (!['PENDING', 'SENT', 'QUEUED', 'Send in progress...'].includes(status.status)) break;
    }
  }
}
