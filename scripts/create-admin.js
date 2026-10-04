// Create the first platform administrator.
// Usage: npm run create-admin -- "Your Name" +2557XXXXXXXX "a-strong-password"
import { randomUUID } from 'node:crypto';
import { loadEnv, getConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { normalizePhone } from '../src/app.js';

loadEnv();
const config = getConfig();
const [name, rawPhone, password] = process.argv.slice(2);
if (!name || !rawPhone || !password) {
  console.error('Usage: npm run create-admin -- "Your Name" +2557XXXXXXXX "a-strong-password"');
  process.exit(1);
}
if (password.length < 10) { console.error('Use an admin password of at least 10 characters.'); process.exit(1); }
const phone = normalizePhone(rawPhone, config.countryCode);
if (!phone) { console.error('That phone number is not valid.'); process.exit(1); }

const db = openDb(config.dbFile);
const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', name = ?, password_hash = ? WHERE id = ?").run(name, hashPassword(password), existing.id);
  console.log(`Updated ${phone}: now an administrator.`);
} else {
  db.prepare("INSERT INTO users (id, name, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)").run(randomUUID(), name, phone, hashPassword(password), Date.now());
  console.log(`Created administrator ${name} (${phone}).`);
}
