// Add two clearly-labelled example facilities for trying the app locally.
// Do not run this on your live server.
import { randomUUID } from 'node:crypto';
import { loadEnv, getConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

loadEnv();
const db = openDb(getConfig().dbFile);
const now = Date.now();
const examples = [
  { name: 'Example Polyclinic', kind: 'Polyclinic', hours: 'Mon–Sat 7 AM – 10 PM', home: 1, video: 0,
    services: [['General consultation', '[PRICE]'], ['Full blood count', '[PRICE]'], ['Antenatal visit', '[PRICE]']],
    doctors: [['Dr. Example One', 'General practitioner'], ['Dr. Example Two', 'Obstetrician']] },
  { name: 'Example Hospital', kind: 'Hospital', hours: 'Open 24 hours', home: 0, video: 1,
    services: [['General consultation', '[PRICE]'], ['Ultrasound scan', '[PRICE]'], ['Dental check-up', '[PRICE]']],
    doctors: [['Dr. Example Three', 'Physician']] }
];
for (const e of examples) {
  if (db.prepare('SELECT 1 FROM facilities WHERE name = ?').get(e.name)) continue;
  const id = randomUUID();
  db.prepare(`INSERT INTO facilities (id, name, kind, address, hours, accepts_insurance, accepts_mobile, home_visits, video_visits, verified, created_at, updated_at)
    VALUES (?, ?, ?, '[ADDRESS]', ?, 1, 1, ?, ?, 1, ?, ?)`).run(id, e.name, e.kind, e.hours, e.home, e.video, now, now);
  e.services.forEach(([n, p], i) => db.prepare('INSERT INTO services (id, facility_id, name, price, position) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, n, p, i));
  e.doctors.forEach(([n, r], i) => db.prepare('INSERT INTO doctors (id, facility_id, name, role, position) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, n, r, i));
  console.log(`Added ${e.name}`);
}
