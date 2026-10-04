import { loadEnv, getConfig } from './config.js';
import { createApp } from './app.js';

loadEnv();
const config = getConfig();
const { server, sendDueReminders } = createApp(config);

server.listen(config.port, () => {
  console.log(`Clinic Connect is running on http://localhost:${config.port}`);
  if (config.sms.provider !== 'africastalking') console.log('SMS is in console mode: messages are printed here instead of sent.');
});

// Check for appointments that need an SMS reminder once a minute.
const timer = setInterval(() => {
  try { sendDueReminders(); } catch (e) { console.error('[reminders]', e); }
}, 60 * 1000);

function shutdown() {
  clearInterval(timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
