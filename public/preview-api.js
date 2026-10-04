// Preview mode: a stand-in for the server that runs inside the app and keeps
// data on this device only. Used by the Android APK when no server address is
// set, so the whole app can be tried without hosting anything.
// Not for real patients: nothing here is shared, encrypted or backed up.

const KEY = 'cc_preview_db_v1';
const SLOTS = ['Morning (8–12)', 'Afternoon (12–5)', 'Evening (5–9)', 'Any time'];
const PAYMENTS = ['Mobile money', 'Health insurance', 'Pay at the facility'];

export const DEMO_ACCOUNTS = [
  { label: 'Admin', phone: '0700000001', password: 'admin123' },
  { label: 'Clinic staff (Example Polyclinic)', phone: '0700000002', password: 'staff123' }
];

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
class Fail extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new Fail(s, m); };

function phoneOf(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0')) p = '+255' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return /^\+\d{9,15}$/.test(p) ? p : null;
}

function seed() {
  const now = Date.now();
  const f1 = { id: 'fexample1', name: 'Example Polyclinic', kind: 'Polyclinic', phone: '', address: '[ADDRESS]', hours: 'Mon–Sat 7 AM – 10 PM', licenseNo: '', verified: true,
    tags: { insurance: true, mobile: true, home: true, video: false },
    services: [{ name: 'General consultation', price: '[PRICE]' }, { name: 'Full blood count', price: '[PRICE]' }, { name: 'Antenatal visit', price: '[PRICE]' }, { name: 'Home nursing visit', price: '[PRICE]' }],
    doctors: [{ name: 'Dr. Example One', role: 'General practitioner' }, { name: 'Dr. Example Two', role: 'Obstetrician' }] };
  const f2 = { id: 'fexample2', name: 'Example Hospital', kind: 'Hospital', phone: '', address: '[ADDRESS]', hours: 'Open 24 hours', licenseNo: '', verified: true,
    tags: { insurance: true, mobile: true, home: false, video: true },
    services: [{ name: 'General consultation', price: '[PRICE]' }, { name: 'Ultrasound scan', price: '[PRICE]' }, { name: 'Dental check-up', price: '[PRICE]' }],
    doctors: [{ name: 'Dr. Example Three', role: 'Physician' }] };
  return {
    facilities: [f1, f2],
    users: [
      { id: 'uadmin', name: 'Demo Admin', phone: '+255700000001', password: 'admin123', role: 'admin', facilityId: null, createdAt: now },
      { id: 'ustaff', name: 'Demo Reception', phone: '+255700000002', password: 'staff123', role: 'staff', facilityId: 'fexample1', createdAt: now }
    ],
    requests: []
  };
}

function loadDb() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* fall through */ }
  const db = seed(); saveDb(db); return db;
}
function saveDb(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ } }

const userOut = (u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, facilityId: u.facilityId });
function reqOut(db, r, withMessages = true) {
  const f = db.facilities.find((x) => x.id === r.facilityId) || {};
  const u = db.users.find((x) => x.id === r.patientId) || {};
  const o = { ...r, facilityName: f.name || 'Facility', patientName: u.name || 'Patient' };
  delete o.patientId;
  if (!withMessages) delete o.messages;
  return o;
}

export function previewApi(path, { method = 'GET', body = {} } = {}, token) {
  const db = loadDb();
  const url = new URL(path, 'https://preview.local');
  const p = url.pathname;
  const me = token ? db.users.find((u) => u.id === token) : null;
  const need = (...roles) => { if (!me) fail(401, 'Please sign in.'); if (roles.length && !roles.includes(me.role)) fail(403, 'You don’t have access to this.'); return me; };
  const fac = (fid) => db.facilities.find((f) => f.id === fid) || fail(404, 'Facility not found.');
  const canManage = (fid) => me && (me.role === 'admin' || (me.role === 'staff' && me.facilityId === fid));
  const reqFor = (rid) => {
    const r = db.requests.find((x) => x.id === rid) || fail(404, 'Request not found.');
    const side = me && me.role === 'patient' && r.patientId === me.id ? 'patient' : canManage(r.facilityId) ? 'clinic' : null;
    if (!side) fail(404, 'Request not found.');
    return { r, side };
  };
  const done = (data, status = 200) => { saveDb(db); return { status, data }; };
  let m;

  try {
    if (p === '/api/auth/register' && method === 'POST') {
      if (!body.name || body.name.trim().length < 2) fail(400, 'Name is required.');
      const phone = phoneOf(body.phone) || fail(400, 'Enter a valid phone number.');
      if (!body.password || body.password.length < 8) fail(400, 'Password must be at least 8 characters.');
      if (db.users.some((u) => u.phone === phone)) fail(409, 'An account with this phone number already exists. Sign in instead.');
      const u = { id: 'u' + id(), name: body.name.trim(), phone, password: body.password, role: 'patient', facilityId: null, createdAt: Date.now() };
      db.users.push(u);
      return done({ token: u.id, user: userOut(u) }, 201);
    }
    if (p === '/api/auth/login' && method === 'POST') {
      const phone = phoneOf(body.phone);
      const u = db.users.find((x) => x.phone === phone && x.password === body.password) || fail(401, 'Phone number or password is incorrect.');
      return done({ token: u.id, user: userOut(u) });
    }
    if (p === '/api/me') return done({ user: userOut(need()) });

    if (p === '/api/facilities' && method === 'GET') {
      const all = url.searchParams.get('all') === '1' && me && me.role === 'admin';
      return done({ facilities: db.facilities.filter((f) => all || f.verified).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (p === '/api/facilities' && method === 'POST') {
      need('admin');
      const f = facilityFrom(body, { id: 'f' + id(), verified: false });
      db.facilities.push(f);
      return done({ facility: f }, 201);
    }
    if ((m = p.match(/^\/api\/facilities\/([^/]+)$/))) {
      const f = fac(m[1]);
      if (method === 'GET') { if (!f.verified && !canManage(f.id)) fail(404, 'Facility not found.'); return done({ facility: f }); }
      if (method === 'PUT') { need('admin', 'staff'); if (!canManage(f.id)) fail(403, 'You can only edit your own facility.'); Object.assign(f, facilityFrom(body, f)); return done({ facility: f }); }
      if (method === 'DELETE') { need('admin'); db.facilities = db.facilities.filter((x) => x.id !== f.id); db.requests = db.requests.filter((r) => r.facilityId !== f.id); return done({ ok: true }); }
    }
    if ((m = p.match(/^\/api\/facilities\/([^/]+)\/verify$/))) { need('admin'); fac(m[1]).verified = !!body.verified; return done({ facility: fac(m[1]) }); }

    if (p === '/api/staff' && method === 'GET') {
      need('admin');
      return done({ staff: db.users.filter((u) => u.role !== 'patient').map((u) => ({ ...userOut(u), facilityName: (db.facilities.find((f) => f.id === u.facilityId) || {}).name })) });
    }
    if (p === '/api/staff' && method === 'POST') {
      need('admin');
      const phone = phoneOf(body.phone) || fail(400, 'Enter a valid phone number.');
      if (!body.name) fail(400, 'Name is required.');
      if (!body.password || body.password.length < 8) fail(400, 'Password must be at least 8 characters.');
      fac(body.facilityId || '');
      if (db.users.some((u) => u.phone === phone)) fail(409, 'An account with this phone number already exists.');
      const u = { id: 'u' + id(), name: body.name.trim(), phone, password: body.password, role: 'staff', facilityId: body.facilityId, createdAt: Date.now() };
      db.users.push(u);
      return done({ user: userOut(u) }, 201);
    }
    if ((m = p.match(/^\/api\/staff\/([^/]+)$/)) && method === 'DELETE') { need('admin'); db.users = db.users.filter((u) => !(u.id === m[1] && u.role === 'staff')); return done({ ok: true }); }

    if (p === '/api/requests' && method === 'POST') {
      const u = need('patient');
      const f = fac(body.facilityId);
      if (!f.verified) fail(400, 'This facility is not accepting requests yet.');
      if (body.consent !== true) fail(400, 'Agree to share your details with the facility to send a request.');
      if (!body.note || body.note.trim().length < 5) fail(400, 'Describe what you need in a few words.');
      if (!body.preferredDate || body.preferredDate < today()) fail(400, 'Choose a preferred day from today onwards.');
      const phone = phoneOf(body.phone || u.phone) || fail(400, 'Enter a valid phone number.');
      const now = Date.now();
      const r = { id: 'r' + id(), patientId: u.id, facilityId: f.id, service: body.service, mode: body.mode || 'clinic', note: body.note.trim(),
        preferredDate: body.preferredDate, slot: SLOTS.includes(body.slot) ? body.slot : SLOTS[3], phone, payment: PAYMENTS.includes(body.payment) ? body.payment : PAYMENTS[0],
        status: 'new', appointment: null, proposed: null, createdAt: now, updatedAt: now, messages: [] };
      db.requests.push(r);
      return done({ request: reqOut(db, r) }, 201);
    }
    if (p === '/api/requests/mine') {
      const u = need('patient');
      return done({ requests: db.requests.filter((r) => r.patientId === u.id).sort((a, b) => b.updatedAt - a.updatedAt).map((r) => reqOut(db, r)) });
    }
    if (p === '/api/desk/requests') {
      const u = need('staff', 'admin');
      const fid = u.role === 'staff' ? u.facilityId : url.searchParams.get('facility');
      fac(fid || '');
      const groups = { open: ['new', 'proposed'], confirmed: ['confirmed'], closed: ['declined', 'cancelled', 'completed'] };
      const g = groups[url.searchParams.get('status')];
      const all = db.requests.filter((r) => r.facilityId === fid);
      const rank = { new: 0, proposed: 1, confirmed: 2 };
      const t = today();
      return done({
        facilityId: fid,
        counts: {
          new: all.filter((r) => r.status === 'new').length, proposed: all.filter((r) => r.status === 'proposed').length,
          upcoming: all.filter((r) => r.status === 'confirmed' && r.appointment && r.appointment.date >= t).length,
          today: all.filter((r) => r.status === 'confirmed' && r.appointment && r.appointment.date === t).length
        },
        requests: all.filter((r) => !g || g.includes(r.status))
          .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.createdAt - a.createdAt)
          .map((r) => { const o = reqOut(db, r, false); delete o.note; delete o.phone; return o; })
      });
    }
    if ((m = p.match(/^\/api\/requests\/([^/]+)$/)) && method === 'GET') { need(); return done({ request: reqOut(db, reqFor(m[1]).r) }); }
    if ((m = p.match(/^\/api\/requests\/([^/]+)\/action$/))) {
      need();
      const { r, side } = reqFor(m[1]);
      const a = body.action;
      const allowed = (list) => { if (!list.includes(r.status)) fail(409, `This request is ${r.status}, so it can’t be changed that way.`); };
      if (side === 'clinic' && (a === 'confirm' || a === 'propose')) {
        allowed(['new', 'proposed', 'confirmed']);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !/^\d{2}:\d{2}$/.test(body.time || '')) fail(400, 'Choose a date and time.');
        if (body.date < today()) fail(400, 'Date can’t be in the past.');
        const slot = { date: body.date, time: body.time, doctor: body.doctor || '' };
        if (a === 'confirm') { r.status = 'confirmed'; r.appointment = slot; r.proposed = null; } else { r.status = 'proposed'; r.proposed = slot; }
      } else if (side === 'clinic' && a === 'decline') { allowed(['new', 'proposed']); r.status = 'declined'; }
      else if (side === 'clinic' && a === 'complete') { allowed(['confirmed']); r.status = 'completed'; }
      else if (side === 'patient' && a === 'accept') { allowed(['proposed']); r.status = 'confirmed'; r.appointment = r.proposed; r.proposed = null; }
      else if (side === 'patient' && a === 'cancel') { allowed(['new', 'proposed', 'confirmed']); r.status = 'cancelled'; }
      else fail(400, 'Unknown action.');
      r.updatedAt = Date.now();
      return done({ request: reqOut(db, r) });
    }
    if ((m = p.match(/^\/api\/requests\/([^/]+)\/messages$/)) && method === 'POST') {
      need();
      const { r, side } = reqFor(m[1]);
      const text = String(body.body || '').trim();
      if (!text) fail(400, 'Message is required.');
      r.messages.push({ id: 'm' + id(), side, body: text.slice(0, 1000), at: Date.now() });
      r.updatedAt = Date.now();
      return done({ messages: r.messages }, 201);
    }
    fail(404, 'Not found.');
  } catch (e) {
    if (e instanceof Fail) return { status: e.status, data: { error: e.message } };
    return { status: 500, data: { error: 'Something went wrong in preview mode.' } };
  }
}

function facilityFrom(b, base) {
  if (!b.name || b.name.trim().length < 2) fail(400, 'Facility name is required.');
  const t = b.tags || {};
  const list = (arr, key2) => (Array.isArray(arr) ? arr : []).filter((x) => x && x.name).map((x) => ({ name: String(x.name).trim(), [key2]: String(x[key2] || '').trim() }));
  return { ...base, name: b.name.trim(), kind: b.kind || 'Polyclinic', phone: b.phone || '', address: b.address || '', hours: b.hours || '', licenseNo: b.licenseNo || '',
    tags: { insurance: !!t.insurance, mobile: !!t.mobile, home: !!t.home, video: !!t.video },
    services: list(b.services, 'price'), doctors: list(b.doctors, 'role') };
}

export function resetPreview() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
