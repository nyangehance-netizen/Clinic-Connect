import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, createLimiter } from './auth.js';
import { createSms } from './sms.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MODES = ['clinic', 'home', 'video'];
const MODE_LABEL = { clinic: 'at the facility', home: 'home visit', video: 'video call' };
const SLOTS = ['Morning (8–12)', 'Afternoon (12–5)', 'Evening (5–9)', 'Any time'];
const PAYMENTS = ['Mobile money', 'Health insurance', 'Pay at the facility'];
const KINDS = ['Polyclinic', 'Hospital', 'Dispensary', 'Health centre', 'Dental clinic', 'Eye clinic', 'Laboratory', 'Maternity home'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

/* ---------- validation helpers ---------- */
function str(v, field, { min = 0, max = 500, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required && min > 0) fail(400, `${field} is required.`);
    return '';
  }
  if (typeof v !== 'string') fail(400, `${field} must be text.`);
  const s = v.trim();
  if (s.length < min) fail(400, `${field} is too short.`);
  if (s.length > max) fail(400, `${field} is too long (max ${max} characters).`);
  return s;
}
function oneOf(v, list, field) {
  if (!list.includes(v)) fail(400, `${field} must be one of: ${list.join(', ')}.`);
  return v;
}
function dateStr(v, field) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(400, `${field} must be a date like 2026-10-05.`);
  return v;
}
function timeStr(v, field) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(400, `${field} must be a time like 14:30.`);
  return v;
}
export function normalizePhone(raw, countryCode) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0')) p = '+' + countryCode + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return /^\+\d{9,15}$/.test(p) ? p : null;
}
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ---------- serializers ---------- */
function facilityOut(f, services = [], doctors = []) {
  return {
    id: f.id, name: f.name, kind: f.kind, phone: f.phone, address: f.address, hours: f.hours,
    licenseNo: f.license_no, verified: !!f.verified,
    tags: { insurance: !!f.accepts_insurance, mobile: !!f.accepts_mobile, home: !!f.home_visits, video: !!f.video_visits },
    services: services.map((s) => ({ name: s.name, price: s.price })),
    doctors: doctors.map((d) => ({ name: d.name, role: d.role }))
  };
}
function requestOut(r, extra = {}) {
  return {
    id: r.id, facilityId: r.facility_id, facilityName: r.facility_name, patientName: r.patient_name,
    service: r.service, mode: r.mode, note: r.note, preferredDate: r.preferred_date, slot: r.slot,
    phone: r.phone, payment: r.payment, status: r.status,
    appointment: r.appt_date ? { date: r.appt_date, time: r.appt_time, doctor: r.doctor } : null,
    proposed: r.proposed_date ? { date: r.proposed_date, time: r.proposed_time, doctor: r.doctor } : null,
    createdAt: r.created_at, updatedAt: r.updated_at, ...extra
  };
}
const userOut = (u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, facilityId: u.facility_id });

export function createApp(config) {
  const db = openDb(config.dbFile);
  const sms = createSms(db, config.sms);
  const loginLimiter = createLimiter({ max: 8, windowMs: 15 * 60 * 1000 });
  const signupLimiter = createLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
    insertUser: db.prepare('INSERT INTO users (id, name, phone, password_hash, role, facility_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    facility: db.prepare('SELECT * FROM facilities WHERE id = ?'),
    services: db.prepare('SELECT * FROM services WHERE facility_id = ? ORDER BY position'),
    doctors: db.prepare('SELECT * FROM doctors WHERE facility_id = ? ORDER BY position'),
    request: db.prepare(`SELECT r.*, f.name AS facility_name, f.phone AS facility_phone, u.name AS patient_name
      FROM requests r JOIN facilities f ON f.id = r.facility_id JOIN users u ON u.id = r.patient_id WHERE r.id = ?`),
    messages: db.prepare('SELECT * FROM messages WHERE request_id = ? ORDER BY created_at'),
    audit: db.prepare('INSERT INTO audit_log (user_id, action, target, created_at) VALUES (?, ?, ?, ?)')
  };
  const audit = (user, action, target) => q.audit.run(user ? user.id : null, action, target ?? null, Date.now());

  function loadFacility(id) {
    const f = q.facility.get(id);
    if (!f) fail(404, 'Facility not found.');
    return facilityOut(f, q.services.all(id), q.doctors.all(id));
  }
  function messagesOut(id) {
    return q.messages.all(id).map((m) => ({ id: m.id, side: m.sender_side, body: m.body, at: m.created_at }));
  }
  function issueToken(user) {
    return signToken({ sub: user.id, exp: Date.now() + config.tokenDays * 86400000 }, config.secret);
  }
  function requireUser(ctx, ...roles) {
    if (!ctx.user) fail(401, 'Please sign in.');
    if (roles.length && !roles.includes(ctx.user.role)) fail(403, 'You don’t have access to this.');
    return ctx.user;
  }
  // Staff may act only for their own facility; admins for any.
  function canManageFacility(user, facilityId) {
    return user && (user.role === 'admin' || (user.role === 'staff' && user.facility_id === facilityId));
  }
  function loadRequestFor(user, id) {
    const r = q.request.get(id);
    if (!r) fail(404, 'Request not found.');
    const isPatient = user.role === 'patient' && r.patient_id === user.id;
    const isClinic = canManageFacility(user, r.facility_id);
    if (!isPatient && !isClinic) fail(404, 'Request not found.');
    return { r, side: isPatient ? 'patient' : 'clinic' };
  }
  function saveFacility(id, b, isNew) {
    const now = Date.now();
    const data = {
      name: str(b.name, 'Facility name', { min: 2, max: 120 }),
      kind: oneOf(b.kind || KINDS[0], KINDS, 'Type'),
      phone: b.phone ? (normalizePhone(b.phone, config.countryCode) || fail(400, 'Enter a valid facility phone number.')) : '',
      address: str(b.address, 'Address', { max: 200 }),
      hours: str(b.hours, 'Opening hours', { max: 120 }),
      licenseNo: str(b.licenseNo, 'License number', { max: 60 })
    };
    const t = b.tags || {};
    const services = Array.isArray(b.services) ? b.services.slice(0, 100) : [];
    const doctors = Array.isArray(b.doctors) ? b.doctors.slice(0, 100) : [];
    tx(db, () => {
      if (isNew) {
        db.prepare(`INSERT INTO facilities (id, name, kind, phone, address, hours, accepts_insurance, accepts_mobile, home_visits, video_visits, license_no, verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(id, data.name, data.kind, data.phone, data.address, data.hours,
          t.insurance ? 1 : 0, t.mobile ? 1 : 0, t.home ? 1 : 0, t.video ? 1 : 0, data.licenseNo, now, now);
      } else {
        db.prepare(`UPDATE facilities SET name=?, kind=?, phone=?, address=?, hours=?, accepts_insurance=?, accepts_mobile=?, home_visits=?, video_visits=?, license_no=?, updated_at=? WHERE id=?`)
          .run(data.name, data.kind, data.phone, data.address, data.hours, t.insurance ? 1 : 0, t.mobile ? 1 : 0, t.home ? 1 : 0, t.video ? 1 : 0, data.licenseNo, now, id);
      }
      db.prepare('DELETE FROM services WHERE facility_id = ?').run(id);
      db.prepare('DELETE FROM doctors WHERE facility_id = ?').run(id);
      const is = db.prepare('INSERT INTO services (id, facility_id, name, price, position) VALUES (?, ?, ?, ?, ?)');
      services.forEach((s, i) => { const n = str(s && s.name, 'Service name', { max: 120 }); if (n) is.run(randomUUID(), id, n, str(s.price, 'Price', { max: 60 }), i); });
      const idoc = db.prepare('INSERT INTO doctors (id, facility_id, name, role, position) VALUES (?, ?, ?, ?, ?)');
      doctors.forEach((d, i) => { const n = str(d && d.name, 'Doctor name', { max: 120 }); if (n) idoc.run(randomUUID(), id, n, str(d.role, 'Doctor role', { max: 80 }), i); });
    });
    return loadFacility(id);
  }

  /* ---------- routes ---------- */
  const routes = [];
  const route = (method, path, handler) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/api/health', () => ({ ok: true }));

  // --- accounts
  route('POST', '/api/auth/register', (ctx) => {
    if (!signupLimiter.check(ctx.ip)) fail(429, 'Too many sign-ups from this network. Try again later.');
    const b = ctx.body;
    const name = str(b.name, 'Name', { min: 2, max: 80 });
    const phone = normalizePhone(b.phone, config.countryCode) || fail(400, 'Enter a valid phone number.');
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 8) fail(400, 'Password must be at least 8 characters.');
    if (q.userByPhone.get(phone)) fail(409, 'An account with this phone number already exists. Sign in instead.');
    const id = randomUUID();
    q.insertUser.run(id, name, phone, hashPassword(password), 'patient', null, Date.now());
    const user = q.userById.get(id);
    return { status: 201, body: { token: issueToken(user), user: userOut(user) } };
  });

  route('POST', '/api/auth/login', (ctx) => {
    const phone = normalizePhone(ctx.body.phone, config.countryCode);
    const key = `${ctx.ip}|${phone}`;
    if (!loginLimiter.check(key)) fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const user = phone && q.userByPhone.get(phone);
    if (!user || !verifyPassword(String(ctx.body.password || ''), user.password_hash)) fail(401, 'Phone number or password is incorrect.');
    loginLimiter.reset(key);
    audit(user, 'login', null);
    return { token: issueToken(user), user: userOut(user) };
  });

  route('GET', '/api/me', (ctx) => ({ user: userOut(requireUser(ctx)) }));

  // --- facilities
  route('GET', '/api/facilities', (ctx) => {
    const all = ctx.query.get('all') === '1' && ctx.user && ctx.user.role === 'admin';
    const rows = db.prepare(`SELECT * FROM facilities ${all ? '' : 'WHERE verified = 1'} ORDER BY name`).all();
    return { facilities: rows.map((f) => facilityOut(f, q.services.all(f.id), q.doctors.all(f.id))) };
  });

  route('GET', '/api/facilities/:id', (ctx) => {
    const f = loadFacility(ctx.params.id);
    if (!f.verified && !canManageFacility(ctx.user, f.id)) fail(404, 'Facility not found.');
    return { facility: f };
  });

  route('POST', '/api/facilities', (ctx) => {
    const user = requireUser(ctx, 'admin');
    const f = saveFacility(randomUUID(), ctx.body, true);
    audit(user, 'facility.create', f.id);
    return { status: 201, body: { facility: f } };
  });

  route('PUT', '/api/facilities/:id', (ctx) => {
    const user = requireUser(ctx, 'admin', 'staff');
    if (!canManageFacility(user, ctx.params.id)) fail(403, 'You can only edit your own facility.');
    loadFacility(ctx.params.id);
    const f = saveFacility(ctx.params.id, ctx.body, false);
    audit(user, 'facility.update', f.id);
    return { facility: f };
  });

  route('POST', '/api/facilities/:id/verify', (ctx) => {
    const user = requireUser(ctx, 'admin');
    loadFacility(ctx.params.id);
    db.prepare('UPDATE facilities SET verified = ?, updated_at = ? WHERE id = ?').run(ctx.body.verified ? 1 : 0, Date.now(), ctx.params.id);
    audit(user, ctx.body.verified ? 'facility.verify' : 'facility.unverify', ctx.params.id);
    return { facility: loadFacility(ctx.params.id) };
  });

  route('DELETE', '/api/facilities/:id', (ctx) => {
    const user = requireUser(ctx, 'admin');
    loadFacility(ctx.params.id);
    db.prepare('DELETE FROM facilities WHERE id = ?').run(ctx.params.id);
    audit(user, 'facility.delete', ctx.params.id);
    return { ok: true };
  });

  // --- staff accounts (admin)
  route('GET', '/api/staff', (ctx) => {
    requireUser(ctx, 'admin');
    const rows = db.prepare(`SELECT u.*, f.name AS facility_name FROM users u LEFT JOIN facilities f ON f.id = u.facility_id
      WHERE u.role IN ('staff','admin') ORDER BY u.name`).all();
    return { staff: rows.map((u) => ({ ...userOut(u), facilityName: u.facility_name })) };
  });

  route('POST', '/api/staff', (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const b = ctx.body;
    const name = str(b.name, 'Name', { min: 2, max: 80 });
    const phone = normalizePhone(b.phone, config.countryCode) || fail(400, 'Enter a valid phone number.');
    if (typeof b.password !== 'string' || b.password.length < 8) fail(400, 'Password must be at least 8 characters.');
    loadFacility(str(b.facilityId, 'Facility', { min: 1 }));
    if (q.userByPhone.get(phone)) fail(409, 'An account with this phone number already exists.');
    const id = randomUUID();
    q.insertUser.run(id, name, phone, hashPassword(b.password), 'staff', b.facilityId, Date.now());
    audit(admin, 'staff.create', id);
    return { status: 201, body: { user: userOut(q.userById.get(id)) } };
  });

  route('DELETE', '/api/staff/:id', (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const u = q.userById.get(ctx.params.id);
    if (!u || u.role !== 'staff') fail(404, 'Staff account not found.');
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    audit(admin, 'staff.delete', u.id);
    return { ok: true };
  });

  // --- treatment requests
  route('POST', '/api/requests', (ctx) => {
    const user = requireUser(ctx, 'patient');
    const b = ctx.body;
    const f = loadFacility(str(b.facilityId, 'Facility', { min: 1 }));
    if (!f.verified) fail(400, 'This facility is not accepting requests yet.');
    const mode = oneOf(b.mode || 'clinic', MODES, 'Visit type');
    if (mode === 'home' && !f.tags.home) fail(400, 'This facility does not offer home visits.');
    if (mode === 'video' && !f.tags.video) fail(400, 'This facility does not offer video calls.');
    const date = dateStr(b.preferredDate, 'Preferred day');
    if (date < localToday()) fail(400, 'Preferred day can’t be in the past.');
    if (b.consent !== true) fail(400, 'Agree to share your details with the facility to send a request.');
    const phone = normalizePhone(b.phone || user.phone, config.countryCode) || fail(400, 'Enter a valid phone number.');
    const open = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE patient_id = ? AND status IN ('new','proposed')").get(user.id).n;
    if (open >= 10) fail(429, 'You have 10 requests waiting for a reply. Cancel some before sending more.');
    const id = randomUUID(); const now = Date.now();
    db.prepare(`INSERT INTO requests (id, patient_id, facility_id, service, mode, note, preferred_date, slot, phone, payment, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`).run(id, user.id, f.id,
      str(b.service, 'Service', { min: 2, max: 120 }), mode, str(b.note, 'Description', { min: 5, max: 1500 }),
      date, oneOf(b.slot, SLOTS, 'Preferred time'), phone, oneOf(b.payment, PAYMENTS, 'Payment'), now, now);
    sms.send(f.phone, `Clinic Connect: new treatment request (${b.service}, ${MODE_LABEL[mode]}). Open the clinic desk to reply.`);
    return { status: 201, body: { request: requestOut(q.request.get(id), { messages: [] }) } };
  });

  route('GET', '/api/requests/mine', (ctx) => {
    const user = requireUser(ctx, 'patient');
    const rows = db.prepare(`SELECT r.*, f.name AS facility_name, u.name AS patient_name FROM requests r
      JOIN facilities f ON f.id = r.facility_id JOIN users u ON u.id = r.patient_id
      WHERE r.patient_id = ? ORDER BY r.updated_at DESC LIMIT 200`).all(user.id);
    return { requests: rows.map((r) => requestOut(r, { messages: messagesOut(r.id) })) };
  });

  route('GET', '/api/desk/requests', (ctx) => {
    const user = requireUser(ctx, 'staff', 'admin');
    const facilityId = user.role === 'staff' ? user.facility_id : ctx.query.get('facility');
    if (!facilityId) fail(400, 'Choose a facility.');
    loadFacility(facilityId);
    const groups = { open: "('new','proposed')", confirmed: "('confirmed')", closed: "('declined','cancelled','completed')" };
    const g = groups[ctx.query.get('status')];
    const rows = db.prepare(`SELECT r.*, f.name AS facility_name, u.name AS patient_name FROM requests r
      JOIN facilities f ON f.id = r.facility_id JOIN users u ON u.id = r.patient_id
      WHERE r.facility_id = ? ${g ? 'AND r.status IN ' + g : ''}
      ORDER BY CASE r.status WHEN 'new' THEN 0 WHEN 'proposed' THEN 1 WHEN 'confirmed' THEN 2 ELSE 3 END, r.created_at DESC LIMIT 500`).all(facilityId);
    const today = localToday();
    const c = db.prepare(`SELECT
        SUM(status = 'new') AS new, SUM(status = 'proposed') AS proposed,
        SUM(status = 'confirmed' AND appt_date >= ?) AS upcoming, SUM(status = 'confirmed' AND appt_date = ?) AS today
      FROM requests WHERE facility_id = ?`).get(today, today, facilityId);
    // The list shows names and services only; full details are opened (and audited) one at a time.
    return {
      facilityId,
      counts: { new: c.new || 0, proposed: c.proposed || 0, upcoming: c.upcoming || 0, today: c.today || 0 },
      requests: rows.map((r) => { const o = requestOut(r); delete o.note; delete o.phone; return o; })
    };
  });

  route('GET', '/api/requests/:id', (ctx) => {
    const user = requireUser(ctx);
    const { r, side } = loadRequestFor(user, ctx.params.id);
    if (side === 'clinic') audit(user, 'request.view', r.id);
    return { request: requestOut(r, { messages: messagesOut(r.id) }) };
  });

  route('POST', '/api/requests/:id/action', (ctx) => {
    const user = requireUser(ctx);
    const { r, side } = loadRequestFor(user, ctx.params.id);
    const b = ctx.body; const now = Date.now(); const action = b.action;
    const set = (sql, ...args) => db.prepare(`UPDATE requests SET ${sql}, updated_at = ? WHERE id = ?`).run(...args, now, r.id);
    const allowed = (list) => { if (!list.includes(r.status)) fail(409, `This request is ${r.status}, so it can’t be changed that way.`); };

    if (side === 'clinic') {
      if (action === 'confirm' || action === 'propose') {
        allowed(['new', 'proposed', 'confirmed']);
        const date = dateStr(b.date, 'Date'); const time = timeStr(b.time, 'Time');
        if (date < localToday()) fail(400, 'Date can’t be in the past.');
        if (date === localToday()) {
          const n = new Date();
          if (time <= `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`) fail(400, 'That time has already passed today. Choose a later time.');
        }
        const doctor = str(b.doctor, 'Doctor', { max: 120 });
        if (action === 'confirm') {
          set("status = 'confirmed', appt_date = ?, appt_time = ?, doctor = ?, proposed_date = NULL, proposed_time = NULL, reminder_sent = 0", date, time, doctor);
          sms.send(r.phone, `Clinic Connect: your appointment at ${r.facility_name} is confirmed for ${fmtDate(date)} at ${time}${doctor ? ' with ' + doctor : ''}.`);
        } else {
          set("status = 'proposed', proposed_date = ?, proposed_time = ?, doctor = ?", date, time, doctor);
          sms.send(r.phone, `Clinic Connect: ${r.facility_name} suggests ${fmtDate(date)} at ${time} for your ${r.service}. Open the app to accept.`);
        }
      } else if (action === 'decline') {
        allowed(['new', 'proposed']);
        set("status = 'declined'");
        sms.send(r.phone, `Clinic Connect: ${r.facility_name} can’t take your request for ${r.service}. Open the app to see their message.`);
      } else if (action === 'complete') {
        allowed(['confirmed']);
        set("status = 'completed'");
      } else fail(400, 'Unknown action.');
    } else {
      if (action === 'accept') {
        allowed(['proposed']);
        set("status = 'confirmed', appt_date = proposed_date, appt_time = proposed_time, proposed_date = NULL, proposed_time = NULL, reminder_sent = 0");
      } else if (action === 'cancel') {
        allowed(['new', 'proposed', 'confirmed']);
        set("status = 'cancelled'");
      } else fail(400, 'Unknown action.');
    }
    audit(user, `request.${action}`, r.id);
    return { request: requestOut(q.request.get(r.id), { messages: messagesOut(r.id) }) };
  });

  route('POST', '/api/requests/:id/messages', (ctx) => {
    const user = requireUser(ctx);
    const { r, side } = loadRequestFor(user, ctx.params.id);
    const body = str(ctx.body.body, 'Message', { min: 1, max: 1000 });
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE request_id = ?').get(r.id).n;
    if (count >= 300) fail(429, 'This conversation is full. Start a new request.');
    const now = Date.now();
    db.prepare('INSERT INTO messages (id, request_id, sender_id, sender_side, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), r.id, user.id, side, body, now);
    db.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').run(now, r.id);
    if (side === 'clinic') sms.send(r.phone, `Clinic Connect: new message from ${r.facility_name}. Open the app to read it.`);
    return { status: 201, body: { messages: messagesOut(r.id) } };
  });

  /* ---------- reminders ---------- */
  function sendDueReminders(now = new Date()) {
    const horizon = new Date(now.getTime() + config.reminderMinutes * 60000);
    const rows = db.prepare(`SELECT r.*, f.name AS facility_name FROM requests r JOIN facilities f ON f.id = r.facility_id
      WHERE r.status = 'confirmed' AND r.reminder_sent = 0 AND r.appt_date IS NOT NULL`).all();
    let sent = 0;
    for (const r of rows) {
      const [y, m, d] = r.appt_date.split('-').map(Number); const [hh, mm] = r.appt_time.split(':').map(Number);
      const at = new Date(y, m - 1, d, hh, mm);
      if (at > now && at <= horizon) {
        db.prepare('UPDATE requests SET reminder_sent = 1 WHERE id = ?').run(r.id);
        sms.send(r.phone, `Reminder: your appointment at ${r.facility_name} is today at ${r.appt_time}. Bring any previous results.`);
        sent++;
      }
    }
    return sent;
  }

  /* ---------- http plumbing ---------- */
  const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 100 * 1024) { reject(new HttpError(413, 'Request is too large.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); }
        catch { reject(new HttpError(400, 'Body must be JSON.')); }
      });
      req.on('error', reject);
    });
  }
  async function serveStatic(req, res, pathname) {
    let file = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    if (file === '/' || !extname(file)) file = '/index.html'; // single-page app fallback
    const full = join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found.' });
    try {
      const data = await readFile(full);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Cache-Control': ['/index.html', '/sw.js', '/manifest.webmanifest'].includes(file) ? 'no-cache' : 'public, max-age=3600' });
      res.end(data);
    } catch {
      send(res, 404, { error: 'Not found.' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
      return serveStatic(req, res, url.pathname);
    }
    const ip = (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    try {
      const match = routes.map((r) => ({ r, m: r.method === req.method && url.pathname.match(r.re) })).find((x) => x.m);
      if (!match) fail(404, 'Not found.');
      const params = {}; match.r.keys.forEach((k, i) => { params[k] = decodeURIComponent(match.m[i + 1]); });
      const auth = String(req.headers.authorization || '');
      const payload = auth.startsWith('Bearer ') ? verifyToken(auth.slice(7), config.secret) : null;
      const user = payload ? q.userById.get(payload.sub) || null : null;
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const out = await match.r.handler({ req, params, query: url.searchParams, body, user, ip });
      if (out && out.status) send(res, out.status, out.body); else send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong on the server. Try again.' });
    }
  });

  return { server, db, sendDueReminders, hashPassword };
}
