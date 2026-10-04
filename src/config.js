import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Load a simple KEY=value .env file if present (no external packages needed).
export function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function getConfig(overrides = {}) {
  const env = process.env;
  const secret = overrides.secret ?? env.AUTH_SECRET;
  if (!secret && env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return {
    port: Number(overrides.port ?? env.PORT ?? 3000),
    dbFile: overrides.dbFile ?? env.DATABASE_FILE ?? 'data/clinic-connect.db',
    secret: secret || randomBytes(32).toString('hex'),
    tokenDays: Number(env.TOKEN_DAYS ?? 30),
    countryCode: overrides.countryCode ?? env.DEFAULT_COUNTRY_CODE ?? '255',
    reminderMinutes: Number(env.REMINDER_MINUTES_BEFORE ?? 120),
    sms: overrides.sms ?? {
      provider: env.SMS_PROVIDER || 'console', // 'africastalking' or 'console'
      username: env.AT_USERNAME || '',
      apiKey: env.AT_API_KEY || '',
      senderId: env.AT_SENDER_ID || '',
      sandbox: env.AT_SANDBOX === 'true'
    },
    trustProxy: env.TRUST_PROXY === 'true'
  };
}
