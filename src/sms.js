// SMS sending. Supports Africa's Talking (widely used in East Africa) or a
// console logger for development. Every attempt is written to sms_log.

export function createSms(db, cfg) {
  const log = db.prepare('INSERT INTO sms_log (phone, body, status, error, created_at) VALUES (?, ?, ?, ?, ?)');

  async function deliver(phone, body) {
    if (cfg.provider !== 'africastalking') {
      console.log(`[sms] to ${phone}: ${body}`);
      return;
    }
    const host = cfg.sandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const form = new URLSearchParams({ username: cfg.username, to: phone, message: body });
    if (cfg.senderId) form.set('from', cfg.senderId);
    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey: cfg.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    if (!res.ok) throw new Error(`SMS provider answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  return {
    // Fire-and-forget: an SMS failure never blocks the patient or staff action.
    send(phone, body) {
      if (!phone) return Promise.resolve();
      return deliver(phone, body)
        .then(() => log.run(phone, body, cfg.provider === 'africastalking' ? 'sent' : 'logged', null, Date.now()))
        .catch((e) => {
          console.error('[sms] failed:', e.message);
          log.run(phone, body, 'failed', e.message, Date.now());
        });
    }
  };
}
