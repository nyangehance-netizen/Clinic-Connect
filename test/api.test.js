import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

let app, base, adminToken;
const sent = [];

before(async () => {
  app = createApp({ dbFile: ':memory:', secret: 'test-secret', tokenDays: 1, countryCode: '255', reminderMinutes: 120, sms: { provider: 'console' }, trustProxy: false });
  // Capture SMS instead of printing them.
  const orig = console.log; console.log = (...a) => { if (String(a[0]).startsWith('[sms]')) sent.push(a.join(' ')); else orig(...a); };
  app.db.prepare("INSERT INTO users (id, name, phone, password_hash, role, created_at) VALUES (?, 'Admin', '+255700000001', ?, 'admin', ?)").run(randomUUID(), hashPassword('admin-password'), Date.now());
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  adminToken = (await call('POST', '/api/auth/login', { phone: '0700000001', password: 'admin-password' })).body.token;
});
after(() => app.server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
function tomorrow() { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

test('full flow: facility, staff, patient request, booking, messages, privacy', async () => {
  // Admin creates a facility; it stays hidden until verified.
  const fac = await call('POST', '/api/facilities', { name: 'Upendo Polyclinic', kind: 'Polyclinic', phone: '0711000000', tags: { home: true, mobile: true },
    services: [{ name: 'General consultation', price: 'TSh 20,000' }], doctors: [{ name: 'Dr. A. Mushi', role: 'GP' }] }, adminToken);
  assert.equal(fac.status, 201);
  const fid = fac.body.facility.id;
  assert.equal((await call('GET', '/api/facilities')).body.facilities.length, 0);
  await call('POST', `/api/facilities/${fid}/verify`, { verified: true }, adminToken);
  assert.equal((await call('GET', '/api/facilities')).body.facilities.length, 1);

  // Staff account linked to the facility.
  const st = await call('POST', '/api/staff', { name: 'Reception', phone: '0722000000', password: 'staff-password', facilityId: fid }, adminToken);
  assert.equal(st.status, 201);
  const staffToken = (await call('POST', '/api/auth/login', { phone: '+255722000000', password: 'staff-password' })).body.token;

  // Patient signs up and sends a request.
  const reg = await call('POST', '/api/auth/register', { name: 'Amina Hassan', phone: '0733000000', password: 'patient-pass' });
  assert.equal(reg.status, 201);
  const pt = reg.body.token;
  const bad = await call('POST', '/api/requests', { facilityId: fid, service: 'General consultation', mode: 'clinic', note: 'Fever for three days', preferredDate: tomorrow(), slot: 'Morning (8–12)', payment: 'Mobile money' }, pt);
  assert.equal(bad.status, 400, 'consent is required');
  const req = await call('POST', '/api/requests', { facilityId: fid, service: 'General consultation', mode: 'home', note: 'Fever for three days', preferredDate: tomorrow(), slot: 'Morning (8–12)', payment: 'Mobile money', consent: true }, pt);
  assert.equal(req.status, 201);
  const rid = req.body.request.id;
  assert.ok(sent.some((s) => s.includes('+255711000000')), 'facility gets a new-request SMS');

  // Staff sees it on the desk (list hides notes), opens it, proposes a time.
  const desk = await call('GET', '/api/desk/requests?status=open', null, staffToken);
  assert.equal(desk.body.requests.length, 1);
  assert.equal(desk.body.requests[0].note, undefined);
  assert.equal(desk.body.counts.new, 1);
  assert.equal((await call('GET', `/api/requests/${rid}`, null, staffToken)).body.request.note, 'Fever for three days');
  const prop = await call('POST', `/api/requests/${rid}/action`, { action: 'propose', date: tomorrow(), time: '10:30', doctor: 'Dr. A. Mushi' }, staffToken);
  assert.equal(prop.body.request.status, 'proposed');
  assert.ok(sent.some((s) => s.includes('+255733000000') && s.includes('10:30')));

  // Patient accepts; both sides message.
  const acc = await call('POST', `/api/requests/${rid}/action`, { action: 'accept' }, pt);
  assert.equal(acc.body.request.status, 'confirmed');
  assert.equal(acc.body.request.appointment.time, '10:30');
  await call('POST', `/api/requests/${rid}/messages`, { body: 'Please bring your insurance card.' }, staffToken);
  const msgs = await call('POST', `/api/requests/${rid}/messages`, { body: 'Thank you, I will.' }, pt);
  assert.deepEqual(msgs.body.messages.map((m) => m.side), ['clinic', 'patient']);

  // Patients can't change clinic-only state, and can't see others' requests.
  assert.equal((await call('POST', `/api/requests/${rid}/action`, { action: 'complete' }, pt)).status, 400);
  const other = (await call('POST', '/api/auth/register', { name: 'Other Person', phone: '0744000000', password: 'other-pass' })).body.token;
  assert.equal((await call('GET', `/api/requests/${rid}`, null, other)).status, 404);
  assert.equal((await call('GET', '/api/desk/requests', null, other)).status, 403);

  // Staff of another facility can't see it either.
  const fac2 = (await call('POST', '/api/facilities', { name: 'Other Clinic' }, adminToken)).body.facility.id;
  await call('POST', '/api/staff', { name: 'Other staff', phone: '0755000000', password: 'staff2-password', facilityId: fac2 }, adminToken);
  const st2 = (await call('POST', '/api/auth/login', { phone: '0755000000', password: 'staff2-password' })).body.token;
  assert.equal((await call('GET', `/api/requests/${rid}`, null, st2)).status, 404);
  assert.equal((await call('PUT', `/api/facilities/${fid}`, { name: 'Hijack' }, st2)).status, 403);

  // Viewing patient details is audited.
  const audits = app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'request.view'").get().n;
  assert.ok(audits >= 1);
});

test('reminders go out once for appointments within the window', async () => {
  const fid = (await call('POST', '/api/facilities', { name: 'Reminder Clinic' }, adminToken)).body.facility.id;
  await call('POST', `/api/facilities/${fid}/verify`, { verified: true }, adminToken);
  const pt = (await call('POST', '/api/auth/register', { name: 'Rehema', phone: '0766000000', password: 'rehema-pass' })).body.token;
  const rid = (await call('POST', '/api/requests', { facilityId: fid, service: 'Check-up', mode: 'clinic', note: 'Routine check-up', preferredDate: tomorrow(), slot: 'Any time', payment: 'Pay at the facility', consent: true }, pt)).body.request.id;
  app.db.prepare("UPDATE requests SET status = 'confirmed', appt_date = ?, appt_time = '09:00' WHERE id = ?").run(tomorrow(), rid);
  const [y, m, d] = tomorrow().split('-').map(Number);
  const now = new Date(y, m - 1, d, 8, 0);
  assert.equal(app.sendDueReminders(now), 1);
  assert.equal(app.sendDueReminders(now), 0);
});

test('login is rate-limited and bad tokens are rejected', async () => {
  for (let i = 0; i < 8; i++) await call('POST', '/api/auth/login', { phone: '0799999999', password: 'wrong' });
  assert.equal((await call('POST', '/api/auth/login', { phone: '0799999999', password: 'wrong' })).status, 429);
  assert.equal((await call('GET', '/api/me', null, 'forged.token')).status, 401);
});

test('serves the web app and blocks path traversal', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Clinic Connect/);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal((await fetch(base + '/..%2F..%2Fpackage.json')).status, 404);
});
