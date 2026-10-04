// Clinic Connect web app. Plain JavaScript, no build step.
const $app = document.getElementById('app');

const CATS = [
  ['all', 'All', []],
  ['general', 'General check-up', ['consult', 'general', 'check']],
  ['dental', 'Dental', ['dent', 'tooth', 'teeth']],
  ['maternity', 'Maternity', ['antenatal', 'maternity', 'obstet', 'pregnan', 'gyn']],
  ['lab', 'Lab tests', ['lab', 'blood', 'test', 'scan', 'x-ray', 'ultrasound']],
  ['eye', 'Eye care', ['eye', 'optic', 'vision']],
  ['home', 'Home visits', []]
];
const MODES = { clinic: 'At the facility', home: 'Home visit', video: 'Video call' };
const SLOTS = ['Morning (8–12)', 'Afternoon (12–5)', 'Evening (5–9)', 'Any time'];
const PAYMENTS = ['Mobile money', 'Health insurance', 'Pay at the facility'];
const KINDS = ['Polyclinic', 'Hospital', 'Dispensary', 'Health centre', 'Dental clinic', 'Eye clinic', 'Laboratory', 'Maternity home'];
const PST = { new: ['Waiting for the clinic', 'warn'], proposed: ['New time suggested', 'info'], confirmed: ['Confirmed', 'ok'], declined: ['Declined', 'bad'], cancelled: ['Cancelled', 'mute'], completed: ['Completed', 'mute'] };
const CST = { new: ['New', 'warn'], proposed: ['Awaiting patient', 'info'], confirmed: ['Confirmed', 'ok'], declined: ['Declined', 'bad'], cancelled: ['Cancelled by patient', 'mute'], completed: ['Completed', 'mute'] };
const ICON = {
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>'
};

const storage = makeStorage();
const S = {
  token: storage.get('cc_token'), me: null, route: [], loading: true, error: null,
  facilities: [], facility: null, mine: [], desk: null, deskReq: null, deskFac: null, deskFilter: 'open',
  adminFacilities: [], staff: [], manage: null,
  q: '', cat: 'all', draft: {}, busy: false, toast: null, confirm: null, returnTo: null
};

/* ---------- helpers ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fmtDate(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtTime(t) { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
function fmtStamp(ms) { const d = new Date(ms); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function initials(n) { return (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
function D(key) { return S.draft[key] || (S.draft[key] = {}); }
function go(hash) { if (location.hash === hash) { load(); } else { location.hash = hash; } }
function toast(msg) { S.toast = msg; render(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; render(); }, 3500); }
function role() { return S.me ? S.me.role : null; }

function makeStorage() {
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
  };
}

const PREVIEW = window.CC_PREVIEW === true;
let previewMod = null;

async function api(path, { method = 'GET', body } = {}) {
  if (PREVIEW) {
    previewMod = previewMod || await import('./preview-api.js');
    const out = previewMod.previewApi(path, { method, body: body || {} }, S.token);
    if (out.status === 401 && S.token) signOut(true);
    if (out.status >= 400) throw new Error(out.data.error || 'Something went wrong. Try again.');
    return out.data;
  }
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let res;
  try { res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Can’t reach the server. Check your internet connection.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { signOut(true); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function signOut(expired) {
  S.token = null; S.me = null; storage.set('cc_token', null); S.draft = {};
  if (expired) toast('Please sign in again.');
  go('#/');
}

/* ---------- loading per route ---------- */
async function load({ quiet = false } = {}) {
  S.route = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [r0, r1] = S.route;
  if (!quiet) { S.loading = true; S.error = null; S.confirm = null; render(); }
  try {
    if (S.token && !S.me) S.me = (await api('/api/me')).user;
    if (!r0 || r0 === 'f') {
      S.facilities = (await api('/api/facilities')).facilities;
      if (r0 === 'f' && r1) S.facility = (await api('/api/facilities/' + encodeURIComponent(r1))).facility;
    } else if (r0 === 'mine' && role() === 'patient') {
      S.mine = (await api('/api/requests/mine')).requests;
    } else if (r0 === 'desk' && (role() === 'staff' || role() === 'admin')) {
      if (role() === 'admin') {
        S.adminFacilities = (await api('/api/facilities?all=1')).facilities;
        if (!S.deskFac && S.adminFacilities[0]) S.deskFac = S.adminFacilities[0].id;
      } else {
        S.deskFac = S.me.facilityId;
      }
      if (S.deskFac) {
        S.desk = await api(`/api/desk/requests?status=${S.deskFilter}${role() === 'admin' ? '&facility=' + encodeURIComponent(S.deskFac) : ''}`);
        S.deskFacility = (await api('/api/facilities/' + encodeURIComponent(S.deskFac))).facility;
      } else S.desk = null;
      S.deskReq = r1 ? (await api('/api/requests/' + encodeURIComponent(r1))).request : null;
    } else if (r0 === 'profile' && role() === 'staff') {
      S.manage = (await api('/api/facilities/' + encodeURIComponent(S.me.facilityId))).facility;
      if (!quiet) S.draft.fac = facilityDraft(S.manage);
    } else if (r0 === 'manage' && role() === 'admin') {
      S.manage = r1 && r1 !== 'new' ? (await api('/api/facilities/' + encodeURIComponent(r1))).facility : null;
      if (!quiet) S.draft.fac = facilityDraft(S.manage);
    } else if (r0 === 'admin' && role() === 'admin') {
      S.adminFacilities = (await api('/api/facilities?all=1')).facilities;
      S.staff = (await api('/api/staff')).staff;
    }
  } catch (e) {
    if (!quiet) S.error = e.message;
  }
  S.loading = false;
  render();
}

function facilityDraft(f) {
  if (!f) return { kind: KINDS[0], mobile: true, services: '', doctors: '' };
  return {
    name: f.name, kind: f.kind, phone: f.phone, address: f.address, hours: f.hours, licenseNo: f.licenseNo,
    insurance: f.tags.insurance, mobile: f.tags.mobile, home: f.tags.home, video: f.tags.video,
    services: f.services.map((s) => s.name + (s.price ? ' | ' + s.price : '')).join('\n'),
    doctors: f.doctors.map((d) => d.name + (d.role ? ' | ' + d.role : '')).join('\n')
  };
}

/* ---------- views ---------- */
function header() {
  const r0 = S.route[0] || '';
  const tabs = [['#/', 'Find care', !r0 || r0 === 'f']];
  const rl = role();
  if (rl === 'patient') {
    const waiting = S.mine.filter((x) => x.status === 'proposed').length;
    tabs.push(['#/mine', 'My requests' + (waiting ? ` <span class="count" aria-label="${waiting} need your reply">${waiting}</span>` : ''), r0 === 'mine']);
  }
  if (rl === 'staff' || rl === 'admin') tabs.push(['#/desk', 'Clinic desk', r0 === 'desk']);
  if (rl === 'staff') tabs.push(['#/profile', 'Facility profile', r0 === 'profile']);
  if (rl === 'admin') tabs.push(['#/admin', 'Admin', r0 === 'admin' || r0 === 'manage']);
  const auth = S.me
    ? `<button class="tab" data-a="signout">Sign out</button>`
    : `<a class="tab" href="#/signin"${r0 === 'signin' ? ' aria-current="page"' : ''}>Sign in</a>`;
  return `<header class="top"><div class="top-in"><a class="brand" href="#/"><span class="mark" aria-hidden="true">${ICON.plus}</span>Clinic Connect</a>
    <nav class="tabs" aria-label="Sections">${tabs.map(([h, l, on]) => `<a class="tab" href="${h}"${on ? ' aria-current="page"' : ''}>${l}</a>`).join('')}${auth}</nav></div></header>`;
}

function viewFind() {
  const q = S.q.trim().toLowerCase();
  const cat = CATS.find((c) => c[0] === S.cat);
  const list = S.facilities.filter((f) => {
    const hay = [f.name, f.kind, f.address, ...f.services.map((s) => s.name)].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (S.cat === 'home') return f.tags.home;
    if (cat && cat[2].length) return cat[2].some((w) => hay.includes(w));
    return true;
  });
  let h = `<div class="stack tight"><p class="muted">Verified hospitals, polyclinics and clinics</p><h1>What care do you need?</h1></div>
    <div class="field"><label for="q" class="label">Search services or facilities</label><div class="search">${ICON.search}
    <input id="q" data-d="_.q" value="${esc(S.q)}" placeholder="e.g. dentist, blood test, antenatal" autocomplete="off"></div></div>
    <div class="chips" role="group" aria-label="Filter by type of care">${CATS.map((c) => `<button class="chip" data-a="cat" data-v="${c[0]}" aria-pressed="${S.cat === c[0]}">${c[1]}</button>`).join('')}</div>`;
  h = installBanner() + (PREVIEW && !S.me ? '<p class="card pad small preview-note"><b>Preview mode.</b> Data stays on this phone. <a href="#/signin">Sign in</a> to try the clinic desk with a demo staff account.</p>' : '') + h;
  if (!S.facilities.length) return h + `<div class="card empty"><h2>No facilities listed yet</h2><p class="muted">Facilities appear here once they are verified.</p></div>`;
  if (!list.length) return h + `<div class="card empty"><h2>No matches</h2><p class="muted">Try another word or choose All.</p></div>`;
  return h + `<h2>${list.length} ${list.length === 1 ? 'facility' : 'facilities'}</h2><div class="facs">${list.map((f, i) => {
    const tags = [f.tags.home && 'Home visits', f.tags.video && 'Video calls', f.tags.insurance && 'Insurance'].filter(Boolean);
    return `<a class="fac" href="#/f/${encodeURIComponent(f.id)}"><span class="mono mono-${i % 3}">${esc(initials(f.name))}</span>
      <span class="stack tight"><b>${esc(f.name)}</b><span class="muted small">${esc(f.kind)}${f.hours ? ' · ' + esc(f.hours) : ''}</span>
      ${tags.length ? `<span class="row">${tags.map((t) => `<span class="tag">${t}</span>`).join('')}</span>` : ''}</span></a>`;
  }).join('')}</div>`;
}

/* ---------- install on phone ---------- */
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installBanner() {
  if (isStandalone() || storage.get('cc_install_hidden')) return '';
  let how = '';
  if (S.installEvt) how = '<button class="btn primary" data-a="install">Install app</button>';
  else if (isIOS()) how = '<p class="small">In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>';
  else return '';
  return `<div class="card pad install"><div class="stack tight"><b>Get Clinic Connect on your home screen</b><p class="muted small">Opens like an app, with updates on your requests.</p></div>
    <div class="row">${how}<button class="btn" data-a="hideInstall">Not now</button></div></div>`;
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; render(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; toast('Clinic Connect is on your home screen'); });
if (!PREVIEW && 'serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

function previewNote() {
  if (!PREVIEW) return '';
  return `<div class="card pad stack preview-note"><b>Preview mode</b><p class="small">Everything you do is saved on this phone only. To see the clinic side, sign out and sign in with a demo account:</p>
    <div class="stack tight small">${[['Admin', '0700000001', 'admin123'], ['Clinic staff (Example Polyclinic)', '0700000002', 'staff123']].map(([l, p, w]) => `<span><b>${l}:</b> ${p} · password ${w}</span>`).join('')}</div>
    <div class="row">${[['0700000001', 'admin123', 'Sign in as admin'], ['0700000002', 'staff123', 'Sign in as clinic staff']].map(([p, w, l]) => `<button class="btn" data-a="demoLogin" data-v="${p}|${w}">${l}</button>`).join('')}
    <button class="btn danger" data-a="resetPreview">Reset preview data</button></div></div>`;
}

function viewFacility() {
  const f = S.facility;
  if (S.route[2] === 'request') return viewRequestForm(f);
  const chips = [f.tags.insurance && 'Accepts insurance', f.tags.mobile && 'Mobile money', f.tags.home && 'Home visits', f.tags.video && 'Video calls'].filter(Boolean);
  return `<div class="narrow"><a class="link" href="#/">${ICON.back}All facilities</a>
    <div class="hero-fac"><span class="muted small">${esc(f.kind)}${f.verified ? ' · Verified' : ''}</span><h1>${esc(f.name)}</h1>
      ${f.address ? `<p>${esc(f.address)}</p>` : ''}${f.hours ? `<p class="muted">${esc(f.hours)}</p>` : ''}
      ${f.phone ? `<p>Phone: <span class="selectable">${esc(f.phone)}</span></p>` : ''}
      ${chips.length ? `<div class="row">${chips.map((c) => `<span class="tag">${c}</span>`).join('')}</div>` : ''}</div>
    <section class="stack"><h2>Services</h2>${f.services.length ? `<div class="card list-rows">${f.services.map((s) => `<div><span class="strong">${esc(s.name)}</span><span class="price">${esc(s.price || 'Ask the clinic')}</span></div>`).join('')}</div>`
      : '<p class="muted">This facility hasn’t listed services yet. You can still describe what you need.</p>'}</section>
    ${f.doctors.length ? `<section class="stack"><h2>Doctors</h2><div class="grid2">${f.doctors.map((d) => `<div class="card pad"><b>${esc(d.name)}</b><p class="muted small">${esc(d.role)}</p></div>`).join('')}</div></section>` : ''}
    <a class="btn primary block" href="#/f/${encodeURIComponent(f.id)}/request">Request treatment</a></div>`;
}

function viewRequestForm(f) {
  const back = `<a class="link" href="#/f/${encodeURIComponent(f.id)}">${ICON.back}${esc(f.name)}</a>`;
  if (!S.me) {
    S.returnTo = location.hash;
    return `<div class="narrow">${back}<div class="card empty"><h2>Sign in to send a request</h2><p class="muted">Your account lets the clinic reply to you and keeps your requests in one place.</p>
      <div class="row"><a class="btn primary" href="#/signup">Create an account</a><a class="btn" href="#/signin">Sign in</a></div></div></div>`;
  }
  if (role() !== 'patient') return `<div class="narrow">${back}<div class="card empty"><h2>Staff accounts can’t send requests</h2><p class="muted">Sign in with a patient account to request treatment.</p></div></div>`;
  const d = D('req');
  if (d.fid !== f.id) Object.assign(d, { fid: f.id, service: f.services[0] ? f.services[0].name : 'Something else', mode: 'clinic', note: '', date: todayStr(), slot: SLOTS[0], phone: S.me.phone, pay: PAYMENTS[0], consent: false, err: null });
  const services = f.services.map((s) => s.name).concat(['Something else']);
  const modes = ['clinic', ...(f.tags.home ? ['home'] : []), ...(f.tags.video ? ['video'] : [])];
  const opt = (list, cur) => list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
  return `<div class="narrow">${back}<div class="stack tight"><h1>Request treatment</h1><p class="muted">${esc(f.name)} will review your request and reply here and by SMS.</p></div>
    <form class="card pad stack loose" data-f="req" novalidate>
      <label class="field"><span>Service</span><select id="r_service" class="input" data-d="req.service">${opt(services, d.service)}</select></label>
      <fieldset class="field"><legend>How would you like to be seen?</legend><div class="seg">${modes.map((m) => `<label><input type="radio" name="mode" id="r_mode_${m}" value="${m}" data-d="req.mode"${d.mode === m ? ' checked' : ''}><span>${MODES[m]}</span></label>`).join('')}</div></fieldset>
      <label class="field"><span>Describe what you need</span><textarea id="r_note" class="input" data-d="req.note" maxlength="1500" placeholder="Symptoms, how long you have had them, any medicine you take">${esc(d.note)}</textarea></label>
      <div class="grid2"><label class="field"><span>Preferred day</span><input id="r_date" type="date" class="input" min="${todayStr()}" value="${esc(d.date)}" data-d="req.date"></label>
        <label class="field"><span>Preferred time</span><select id="r_slot" class="input" data-d="req.slot">${opt(SLOTS, d.slot)}</select></label></div>
      <div class="grid2"><label class="field"><span>Phone for SMS updates</span><input id="r_phone" type="tel" class="input" value="${esc(d.phone)}" data-d="req.phone" autocomplete="tel"></label>
        <label class="field"><span>How will you pay?</span><select id="r_pay" class="input" data-d="req.pay">${opt(PAYMENTS, d.pay)}</select></label></div>
      <label class="check"><input type="checkbox" id="r_consent" data-d="req.consent"${d.consent ? ' checked' : ''}><span>I agree to share these details with ${esc(f.name)} so they can arrange my care.</span></label>
      ${d.err ? `<p class="error" role="alert">${esc(d.err)}</p>` : ''}
      <button class="btn primary block" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? 'Sending…' : 'Send request'}</button></form></div>`;
}

function thread(r, side) {
  const key = 'm_' + r.id;
  return `<div class="stack"><span class="label">Messages</span>
    ${r.messages && r.messages.length ? `<div class="thread">${r.messages.map((m) => {
      const me = m.side === side;
      return `<div class="bubble ${me ? 'me' : 'them'}">${me ? '' : `<b>${m.side === 'clinic' ? esc(r.facilityName) : esc(r.patientName || 'Patient')}</b>`}${esc(m.body)}<time>${fmtStamp(m.at)}</time></div>`;
    }).join('')}</div>` : '<p class="muted small">No messages yet.</p>'}
    <form class="msgform" data-f="msg" data-id="${esc(r.id)}"><label for="${key}" class="sr">Write a message</label>
      <input id="${key}" class="input" data-d="${key}.text" value="${esc(D(key).text || '')}" placeholder="Write a message" maxlength="1000" autocomplete="off">
      <button class="btn primary" type="submit" aria-label="Send message">${ICON.send}</button></form></div>`;
}

function viewMine() {
  const h = '<div class="narrow"><div class="stack tight"><h1>My requests</h1><p class="muted">Clinic replies appear here. This page refreshes on its own.</p></div>';
  if (!S.mine.length) return h + '<div class="card empty"><h2>No requests yet</h2><p class="muted">Find a facility and send your first treatment request.</p><a class="btn primary" href="#/">Find care</a></div></div>';
  return h + S.mine.map((r) => {
    const st = PST[r.status] || PST.new;
    let block = '';
    if (r.status === 'confirmed' && r.appointment) block = `<div class="notice ok"><span class="small strong">Your appointment</span><span class="big-time">${fmtDate(r.appointment.date)}, ${fmtTime(r.appointment.time)}</span>${r.appointment.doctor ? `<span>${esc(r.appointment.doctor)}</span>` : ''}</div>`;
    else if (r.status === 'proposed' && r.proposed) block = `<div class="notice info"><span class="strong">The clinic suggests a different time</span><span class="big-time">${fmtDate(r.proposed.date)}, ${fmtTime(r.proposed.time)}</span>
      <div class="row"><button class="btn primary" data-a="act" data-id="${esc(r.id)}" data-v="accept">Accept this time</button><span class="muted small">Or send a message to ask for another time.</span></div></div>`;
    else if (r.status === 'new') block = `<p class="muted">You asked for ${fmtDate(r.preferredDate)}, ${esc(r.slot.toLowerCase())}. The clinic will confirm or suggest a time.</p>`;
    else if (r.status === 'declined') block = '<div class="notice bad">The clinic can’t take this request. Check their message below, or try another facility.</div>';
    const canCancel = ['new', 'proposed', 'confirmed'].includes(r.status);
    const ck = 'cancel_' + r.id;
    return `<article class="card pad stack loose"><div class="row between top-align"><div class="stack tight"><h3>${esc(r.facilityName)}</h3><p class="muted small">${esc(r.service)} · ${MODES[r.mode]}</p></div><span class="pill ${st[1]}">${st[0]}</span></div>
      ${block}${thread(r, 'patient')}
      ${canCancel ? `<div class="row end">${S.confirm === ck
        ? `<span class="small">Cancel this request?</span><button class="btn" data-a="unconfirm">Keep it</button><button class="btn danger solid" data-a="act" data-id="${esc(r.id)}" data-v="cancel">Yes, cancel</button>`
        : `<button class="btn danger" data-a="confirm" data-v="${ck}">Cancel request</button>`}</div>` : ''}
      <p class="muted small">Sent ${fmtStamp(r.createdAt)}</p></article>`;
  }).join('') + '</div>';
}

function viewDesk() {
  const isAdmin = role() === 'admin';
  if (isAdmin && !S.adminFacilities.length) return '<div class="card empty"><h2>No facilities yet</h2><p class="muted">Add a facility in Admin first.</p><a class="btn primary" href="#/admin">Go to Admin</a></div>';
  if (!S.desk) return '<div class="card empty"><h2>No facility linked</h2><p class="muted">Ask an administrator to link your account to a facility.</p></div>';
  const c = S.desk.counts;
  const h = `<div class="row between bottom-align"><div class="stack tight"><p class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Clinic desk</h1>${!isAdmin && S.deskFacility ? `<p class="muted">${esc(S.deskFacility.name)}</p>` : ''}</div>
    ${isAdmin ? `<label class="field"><span>Facility</span><select id="deskFac" class="input" data-change="deskFac">${S.adminFacilities.map((x) => `<option value="${esc(x.id)}"${x.id === S.deskFac ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}</div>
    <div class="tiles">${[['New requests', c.new], ['Awaiting patient', c.proposed], ['Upcoming appointments', c.upcoming], ['Today', c.today]].map(([l, n]) => `<div class="card tile"><span>${l}</span><b>${n}</b></div>`).join('')}</div>`;
  const rows = S.desk.requests;
  const table = `<section class="card desk-list"><div class="filters" role="group" aria-label="Show">${[['open', 'Needs action'], ['confirmed', 'Confirmed'], ['closed', 'Closed'], ['all', 'All']].map(([v, l]) => `<button class="chip" data-a="deskFilter" data-v="${v}" aria-pressed="${S.deskFilter === v}">${l}</button>`).join('')}</div>
    ${rows.length ? `<div class="scroll"><table><thead><tr><th>Patient</th><th>Service</th><th>Visit</th><th>When</th><th>Status</th></tr></thead><tbody>${rows.map((r) => {
      const st = CST[r.status] || CST.new; const href = `#/desk/${encodeURIComponent(r.id)}`;
      const when = r.appointment && r.status === 'confirmed' ? `${fmtDate(r.appointment.date)}, ${fmtTime(r.appointment.time)}` : `${fmtDate(r.preferredDate)}, ${r.slot.split(' (')[0]}`;
      const cell = (inner, cls = '') => `<td><a href="${href}"${cls ? ` class="${cls}"` : ''}>${inner}</a></td>`;
      return `<tr${S.deskReq && S.deskReq.id === r.id ? ' class="sel"' : ''}>${cell(esc(r.patientName), 'strong')}${cell(esc(r.service))}${cell(MODES[r.mode])}${cell(`<span class="muted">${esc(when)}</span>`)}${cell(`<span class="pill ${st[1]}">${st[0]}</span>`)}</tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty"><p class="muted">Nothing in this list. New requests appear here automatically.</p></div>`}</section>`;
  return h + `<div class="desk">${table}<aside class="card pad desk-detail stack loose">${deskDetail()}</aside></div>`;
}

function deskDetail() {
  const r = S.deskReq;
  if (!r) return '<div class="empty"><h2>Request details</h2><p class="muted">Choose a request to review it, book a time and message the patient.</p></div>';
  const st = CST[r.status] || CST.new;
  const d = D('d_' + r.id);
  if (d.date == null) Object.assign(d, { date: (r.appointment && r.appointment.date) || r.preferredDate, time: (r.appointment && r.appointment.time) || '09:00', doctor: (r.appointment && r.appointment.doctor) || '' });
  const docs = (S.deskFacility ? S.deskFacility.doctors : []).map((x) => x.name);
  let actions = '';
  if (['new', 'proposed', 'confirmed'].includes(r.status)) {
    const dk = 'decline_' + r.id;
    actions = `<div class="stack divider"><span class="label">${r.status === 'confirmed' ? 'Change the booking' : 'Book a time'}</span>
      <div class="grid2 compact"><label class="field"><span class="small">Date</span><input id="dd_${esc(r.id)}" type="date" class="input" min="${todayStr()}" value="${esc(d.date)}" data-d="d_${esc(r.id)}.date"></label>
        <label class="field"><span class="small">Time</span><input id="dt_${esc(r.id)}" type="time" class="input" value="${esc(d.time)}" data-d="d_${esc(r.id)}.time"></label></div>
      <label class="field"><span class="small">Doctor</span><select id="ddoc_${esc(r.id)}" class="input" data-d="d_${esc(r.id)}.doctor"><option value="">Any available doctor</option>${docs.map((n) => `<option${d.doctor === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${r.status === 'confirmed'
        ? `<div class="grid2 compact"><button class="btn" data-a="act" data-id="${esc(r.id)}" data-v="propose">Suggest new time</button><button class="btn soft" data-a="act" data-id="${esc(r.id)}" data-v="complete">Mark completed</button></div>`
        : `<button class="btn primary block" data-a="act" data-id="${esc(r.id)}" data-v="confirm">Confirm this time</button>
           <div class="grid2 compact"><button class="btn" data-a="act" data-id="${esc(r.id)}" data-v="propose">Suggest this time</button>
           ${S.confirm === dk ? `<button class="btn danger solid" data-a="act" data-id="${esc(r.id)}" data-v="decline">Yes, decline</button>` : `<button class="btn danger" data-a="confirm" data-v="${dk}">Decline</button>`}</div>`}
      <p class="muted small">The patient gets an SMS and sees the change in the app.</p></div>`;
  }
  return `<div class="row between top-align"><div class="stack tight"><span class="eyebrow">Request</span><h2>${esc(r.patientName)}</h2></div><span class="pill ${st[1]}">${st[0]}</span></div>
    <div class="kv"><div><span>Service</span><b>${esc(r.service)}</b></div><div><span>Visit</span><b>${MODES[r.mode]}</b></div>
      <div><span>Preferred</span><b>${fmtDate(r.preferredDate)}, ${esc(r.slot.split(' (')[0])}</b></div><div><span>Payment</span><b>${esc(r.payment)}</b></div>
      <div><span>Phone</span><b class="selectable">${esc(r.phone)}</b></div><div><span>Received</span><b>${fmtStamp(r.createdAt)}</b></div>
      ${r.status === 'confirmed' && r.appointment ? `<div class="wide"><span>Booked</span><b>${fmtDate(r.appointment.date)}, ${fmtTime(r.appointment.time)}${r.appointment.doctor ? ' · ' + esc(r.appointment.doctor) : ''}</b></div>` : ''}
      ${r.status === 'proposed' && r.proposed ? `<div class="wide"><span>Suggested to patient</span><b>${fmtDate(r.proposed.date)}, ${fmtTime(r.proposed.time)}</b></div>` : ''}</div>
    <div class="notice plain"><span class="label">Patient’s note</span><p class="prewrap">${esc(r.note)}</p></div>
    ${actions}${thread(r, 'clinic')}`;
}

function viewFacilityForm(isAdminForm) {
  const d = D('fac');
  const inp = (id, label, ph = '', type = 'text') => `<label class="field"><span>${label}</span><input id="s_${id}" type="${type}" class="input" data-d="fac.${id}" value="${esc(d[id] || '')}" placeholder="${esc(ph)}"></label>`;
  const cb = (id, label) => `<label class="check"><input type="checkbox" id="s_${id}" data-d="fac.${id}"${d[id] ? ' checked' : ''}><span>${label}</span></label>`;
  const isNew = isAdminForm && !S.manage;
  return `<div class="narrow">${isAdminForm ? `<a class="link" href="#/admin">${ICON.back}Admin</a>` : ''}
    <div class="stack tight"><h1>${isNew ? 'Add a facility' : 'Facility profile'}</h1><p class="muted">This is what patients see when they look for care.${S.manage && !S.manage.verified ? ' Not visible to patients until an administrator verifies it.' : ''}</p></div>
    <form class="card pad stack loose" data-f="fac" novalidate>
      ${inp('name', 'Facility name', 'e.g. Upendo Polyclinic')}
      <div class="grid2"><label class="field"><span>Type</span><select id="s_kind" class="input" data-d="fac.kind">${KINDS.map((k) => `<option${d.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        ${inp('phone', 'Phone for new-request SMS', '+255…', 'tel')}</div>
      ${inp('address', 'Address', 'Street, area, city')}${inp('hours', 'Opening hours', 'e.g. Mon–Sat 7 AM – 10 PM')}${inp('licenseNo', 'License or registration number', 'Used for verification')}
      <fieldset class="field stack"><legend>Patients can</legend>${cb('insurance', 'Pay with health insurance')}${cb('mobile', 'Pay with mobile money')}${cb('home', 'Request home visits')}${cb('video', 'Request video consultations')}</fieldset>
      <label class="field"><span>Services and prices</span><textarea id="s_services" class="input tall" data-d="fac.services" placeholder="General consultation | TSh 20,000">${esc(d.services || '')}</textarea><span class="hint">One service per line. Put a | before the price.</span></label>
      <label class="field"><span>Doctors</span><textarea id="s_doctors" class="input" data-d="fac.doctors" placeholder="Dr. A. Mushi | General practitioner">${esc(d.doctors || '')}</textarea><span class="hint">One doctor per line. Put a | before the role.</span></label>
      ${d.err ? `<p class="error" role="alert">${esc(d.err)}</p>` : ''}
      <button class="btn primary block" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? 'Saving…' : isNew ? 'Add facility' : 'Save changes'}</button></form></div>`;
}

function viewAdmin() {
  const d = D('staff');
  const facs = S.adminFacilities;
  return `<div class="stack tight"><h1>Admin</h1><p class="muted">Verify facilities before patients can see them, and create staff accounts.</p></div>
    <section class="stack"><div class="row between"><h2>Facilities</h2><a class="btn primary" href="#/manage/new">${ICON.plus}Add facility</a></div>
      ${facs.length ? `<div class="card list-rows">${facs.map((f) => {
        const ck = 'del_' + f.id;
        return `<div><span class="stack tight"><b>${esc(f.name)}</b><span class="muted small">${esc(f.kind)}${f.licenseNo ? ' · License ' + esc(f.licenseNo) : ''}</span></span>
          <span class="row end"><span class="pill ${f.verified ? 'ok' : 'warn'}">${f.verified ? 'Verified' : 'Not verified'}</span>
          <button class="btn" data-a="verify" data-id="${esc(f.id)}" data-v="${f.verified ? '0' : '1'}">${f.verified ? 'Hide from patients' : 'Verify'}</button>
          <a class="btn" href="#/manage/${encodeURIComponent(f.id)}">Edit</a>
          ${S.confirm === ck ? `<button class="btn" data-a="unconfirm">Keep</button><button class="btn danger solid" data-a="delFac" data-id="${esc(f.id)}">Delete with all its requests</button>` : `<button class="btn danger" data-a="confirm" data-v="${ck}">Delete</button>`}</span></div>`;
      }).join('')}</div>` : '<div class="card empty"><p class="muted">No facilities yet.</p></div>'}</section>
    <section class="stack"><h2>Staff accounts</h2>
      ${S.staff.length ? `<div class="card list-rows">${S.staff.map((u) => `<div><span class="stack tight"><b>${esc(u.name)}</b><span class="muted small">${esc(u.phone)} · ${u.role === 'admin' ? 'Administrator' : esc(u.facilityName || 'No facility')}</span></span>
        ${u.role === 'staff' ? `<button class="btn danger" data-a="delStaff" data-id="${esc(u.id)}">Remove</button>` : ''}</div>`).join('')}</div>` : ''}
      <form class="card pad stack" data-f="staff" novalidate><h3>Add a staff member</h3>
        <div class="grid2"><label class="field"><span>Name</span><input id="st_name" class="input" data-d="staff.name" value="${esc(d.name || '')}"></label>
          <label class="field"><span>Phone (used to sign in)</span><input id="st_phone" type="tel" class="input" data-d="staff.phone" value="${esc(d.phone || '')}"></label></div>
        <div class="grid2"><label class="field"><span>Facility</span><select id="st_fac" class="input" data-d="staff.facilityId"><option value="">Choose…</option>${facs.map((f) => `<option value="${esc(f.id)}"${d.facilityId === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Temporary password</span><input id="st_pw" type="text" class="input" data-d="staff.password" value="${esc(d.password || '')}" autocomplete="off"><span class="hint">At least 8 characters. Share it privately.</span></label></div>
        ${d.err ? `<p class="error" role="alert">${esc(d.err)}</p>` : ''}
        <button class="btn primary" type="submit"${S.busy ? ' disabled' : ''}>Create staff account</button></form></section>`;
}

function viewAuth(mode) {
  const d = D('auth');
  const signup = mode === 'signup';
  return `<div class="auth stack loose"><div class="stack tight"><h1>${signup ? 'Create your account' : 'Sign in'}</h1><p class="muted">${signup ? 'Patients sign up here. Clinic staff get their account from an administrator.' : 'Use the phone number you signed up with.'}</p></div>
    <form class="card pad stack loose" data-f="${mode}" novalidate>
      ${signup ? `<label class="field"><span>Full name</span><input id="a_name" class="input" data-d="auth.name" value="${esc(d.name || '')}" autocomplete="name"></label>` : ''}
      <label class="field"><span>Phone number</span><input id="a_phone" type="tel" class="input" data-d="auth.phone" value="${esc(d.phone || '')}" placeholder="07XX XXX XXX" autocomplete="tel"></label>
      <label class="field"><span>Password</span><input id="a_pw" type="password" class="input" data-d="auth.password" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<span class="hint">At least 8 characters.</span>' : ''}</label>
      ${d.err ? `<p class="error" role="alert">${esc(d.err)}</p>` : ''}
      <button class="btn primary block" type="submit"${S.busy ? ' disabled' : ''}>${signup ? 'Create account' : 'Sign in'}</button>
      <p class="small muted">${signup ? 'Already have an account? <a href="#/signin">Sign in</a>' : 'New here? <a href="#/signup">Create an account</a>'}</p></form>${previewNote()}</div>`;
}

function body() {
  const [r0] = S.route;
  if (S.loading && !S.error) return '<p class="boot">Loading…</p>';
  if (S.error) return `<div class="card empty"><h2>Couldn’t load this page</h2><p class="muted">${esc(S.error)}</p><button class="btn" data-a="reload">Try again</button></div>`;
  if (r0 === 'signin' || r0 === 'signup') return viewAuth(r0);
  if (r0 === 'f' && S.facility) return viewFacility();
  const need = (ok) => ok ? null : `<div class="card empty"><h2>Sign in to continue</h2><a class="btn primary" href="#/signin">Sign in</a></div>`;
  if (r0 === 'mine') return need(role() === 'patient') || viewMine();
  if (r0 === 'desk') return need(role() === 'staff' || role() === 'admin') || viewDesk();
  if (r0 === 'profile') return need(role() === 'staff') || viewFacilityForm(false);
  if (r0 === 'manage') return need(role() === 'admin') || viewFacilityForm(true);
  if (r0 === 'admin') return need(role() === 'admin') || viewAdmin();
  return viewFind();
}

function render() {
  const a = document.activeElement; const fid = a && a.id; let ss = null, se = null;
  try { ss = a.selectionStart; se = a.selectionEnd; } catch { /* not a text field */ }
  $app.innerHTML = header() + `<main class="wrap">${body()}</main>` + (S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : '');
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch { /* ignore */ } } }
}

/* ---------- actions ---------- */
async function run(fn, ok, errKey) {
  if (S.busy) return;
  S.busy = true; if (errKey) D(errKey).err = null; render();
  try { await fn(); S.busy = false; if (ok) toast(ok); else render(); }
  catch (e) { S.busy = false; if (errKey) { D(errKey).err = e.message; render(); } else toast(e.message); }
}
const lines = (t) => (t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, ...b] = l.split('|'); return [a.trim(), b.join('|').trim()]; });

const forms = {
  async signin() {
    const d = D('auth');
    await run(async () => {
      const out = await api('/api/auth/login', { method: 'POST', body: { phone: d.phone, password: d.password } });
      afterAuth(out);
    }, 'Signed in', 'auth');
  },
  async signup() {
    const d = D('auth');
    await run(async () => {
      const out = await api('/api/auth/register', { method: 'POST', body: { name: d.name, phone: d.phone, password: d.password } });
      afterAuth(out);
    }, 'Account created', 'auth');
  },
  async req() {
    const d = D('req'); const f = S.facility;
    if (!d.consent) { d.err = 'Tick the box to agree to share your details with the clinic.'; render(); return; }
    await run(async () => {
      await api('/api/requests', { method: 'POST', body: { facilityId: f.id, service: d.service, mode: d.mode, note: d.note, preferredDate: d.date, slot: d.slot, phone: d.phone, payment: d.pay, consent: true } });
      S.draft.req = null; go('#/mine');
    }, 'Request sent to ' + f.name, 'req');
  },
  async msg(form) {
    const id = form.getAttribute('data-id'); const key = 'm_' + id; const text = (D(key).text || '').trim();
    if (!text) return;
    await run(async () => {
      const out = await api(`/api/requests/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body: text } });
      D(key).text = '';
      const target = S.deskReq && S.deskReq.id === id ? S.deskReq : S.mine.find((r) => r.id === id);
      if (target) target.messages = out.messages;
    });
  },
  async fac() {
    const d = D('fac');
    const body = { name: d.name, kind: d.kind, phone: d.phone, address: d.address, hours: d.hours, licenseNo: d.licenseNo,
      tags: { insurance: !!d.insurance, mobile: !!d.mobile, home: !!d.home, video: !!d.video },
      services: lines(d.services).map(([name, price]) => ({ name, price })), doctors: lines(d.doctors).map(([name, r]) => ({ name, role: r })) };
    const isNew = role() === 'admin' && !S.manage;
    await run(async () => {
      const id = isNew ? null : (S.manage ? S.manage.id : S.me.facilityId);
      const out = await api(isNew ? '/api/facilities' : '/api/facilities/' + encodeURIComponent(id), { method: isNew ? 'POST' : 'PUT', body });
      S.manage = out.facility; S.draft.fac = facilityDraft(out.facility);
      if (role() === 'admin') go('#/admin');
    }, isNew ? 'Facility added. Verify it so patients can see it.' : 'Changes saved', 'fac');
  },
  async staff() {
    const d = D('staff');
    await run(async () => {
      await api('/api/staff', { method: 'POST', body: { name: d.name, phone: d.phone, password: d.password, facilityId: d.facilityId } });
      S.draft.staff = {}; await load({ quiet: true });
    }, 'Staff account created', 'staff');
  }
};

function afterAuth(out) {
  S.token = out.token; S.me = out.user; storage.set('cc_token', out.token); S.draft.auth = {};
  const dest = S.returnTo || (out.user.role === 'patient' ? '#/' : '#/desk');
  S.returnTo = null; go(dest);
}

async function act(id, action) {
  const d = D('d_' + id);
  const body = { action };
  if (action === 'confirm' || action === 'propose') Object.assign(body, { date: d.date, time: d.time, doctor: d.doctor || '' });
  const labels = { confirm: 'Appointment confirmed. The patient has been notified.', propose: 'New time sent to the patient', decline: 'Request declined. Send the patient a message to explain.', complete: 'Marked as completed', accept: 'Appointment confirmed', cancel: 'Request cancelled' };
  S.confirm = null;
  await run(async () => {
    await api(`/api/requests/${encodeURIComponent(id)}/action`, { method: 'POST', body });
    await load({ quiet: true });
  }, labels[action]);
}

/* ---------- events ---------- */
document.addEventListener('input', (e) => {
  const k = e.target.getAttribute && e.target.getAttribute('data-d'); if (!k) return;
  const i = k.indexOf('.'); const form = k.slice(0, i), field = k.slice(i + 1);
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (form === '_') { S[field] = v; render(); return; }
  if (e.target.type === 'radio' && !e.target.checked) return;
  D(form)[field] = v;
});
document.addEventListener('change', (e) => {
  const t = e.target;
  const k = t.getAttribute && t.getAttribute('data-d');
  if (k && (t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT')) { const i = k.indexOf('.'); D(k.slice(0, i))[k.slice(i + 1)] = t.type === 'checkbox' ? t.checked : t.value; }
  if (t.getAttribute && t.getAttribute('data-change') === 'deskFac') { S.deskFac = t.value; go('#/desk'); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.getAttribute('data-f');
  if (forms[f]) forms[f](e.target);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.getAttribute('data-a'), v = b.getAttribute('data-v'), id = b.getAttribute('data-id');
  if (a === 'cat') { S.cat = v; render(); }
  else if (a === 'signout') signOut();
  else if (a === 'demoLogin') { const [phone, password] = v.split('|'); run(async () => { afterAuth(await api('/api/auth/login', { method: 'POST', body: { phone, password } })); }, 'Signed in'); }
  else if (a === 'resetPreview' && previewMod) { previewMod.resetPreview(); S.token = null; S.me = null; storage.set('cc_token', null); S.draft = {}; toast('Preview data reset'); go('#/'); }
  else if (a === 'install' && S.installEvt) { const ev = S.installEvt; S.installEvt = null; ev.prompt(); ev.userChoice.finally(render); }
  else if (a === 'hideInstall') { storage.set('cc_install_hidden', '1'); render(); }
  else if (a === 'reload') load();
  else if (a === 'confirm') { S.confirm = v; render(); }
  else if (a === 'unconfirm') { S.confirm = null; render(); }
  else if (a === 'act') act(id, v);
  else if (a === 'deskFilter') { S.deskFilter = v; load({ quiet: true }); }
  else if (a === 'verify') run(async () => { await api(`/api/facilities/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { verified: v === '1' } }); await load({ quiet: true }); }, v === '1' ? 'Facility verified. Patients can see it now.' : 'Facility hidden from patients');
  else if (a === 'delFac') { S.confirm = null; run(async () => { await api('/api/facilities/' + encodeURIComponent(id), { method: 'DELETE' }); await load({ quiet: true }); }, 'Facility deleted'); }
  else if (a === 'delStaff') run(async () => { await api('/api/staff/' + encodeURIComponent(id), { method: 'DELETE' }); await load({ quiet: true }); }, 'Staff account removed');
});

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); load(); });

// Keep requests and the desk fresh without a manual reload.
setInterval(() => {
  if (document.hidden || S.busy) return;
  const r0 = S.route[0];
  if ((r0 === 'mine' && role() === 'patient') || (r0 === 'desk' && S.me)) load({ quiet: true });
}, 10000);

load();
