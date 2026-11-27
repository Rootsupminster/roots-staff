// Roots Checks: staff checks, temperature logs, records and compliance documents.
// Staff sign in with their rota PIN (rota_login). Managers sign in with their bookings login.
(() => {
'use strict';
const SB_URL = 'https://vvhrtizoncwbuynbrczg.supabase.co';
const SB_KEY = 'sb_publishable_xOqrqL8x9zRexvIXeUZORg_NVw4vOMM';
const TOKEN_KEY = 'roots-checks-token';
const MODE_KEY = 'roots-checks-mode';
// The rota app on this same site keeps its sign-in under 'token' and 'me' (JSON). Share it both ways.
const rotaGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const rotaSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const BUCKET = 'roots-docs';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'roots-manager-auth' } });

const FOLDERS = ['Pest control', 'Gas safety', 'Electrical & PAT testing', 'Fire safety', 'Extraction & ventilation', 'Water & legionella',
  'HACCP & food safety', 'Allergens', 'Risk assessments', 'Training certificates', 'Insurance & licences', 'Previous records (Leafe)', 'Other'];
const KIND_LABEL = { opening: 'Opening', closing: 'Closing', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const LOGS = [
  { k: 'temps', name: 'Fridge & freezer temps', ic: '❄︎', sub: 'Spot check any fridge or freezer' },
  { k: 'delivery', name: 'Deliveries', ic: '⇣', sub: 'Supplier, temps, accepted?' },
  { k: 'cooking', name: 'Cooking', ic: '♨︎', sub: 'Core temp 75°C or above' },
  { k: 'cooling', name: 'Cooling', ic: '↘︎', sub: 'Down to 8°C within 90 mins' },
  { k: 'reheat', name: 'Reheating', ic: '↻', sub: 'Core temp 75°C or above' },
  { k: 'hothold', name: 'Hot holding', ic: '▤', sub: 'Keep at 63°C or above' },
  { k: 'probe', name: 'Probe check', ic: '⌀', sub: 'Iced water and boiling water' },
  { k: 'washer', name: 'Dishwasher temps', ic: '≋', sub: 'Wash and rinse temperatures' }
];
const LOG_NAME = Object.fromEntries(LOGS.map(l => [l.k, l.name]));

const app = document.getElementById('app');
const sheet = document.getElementById('sheet');
let S = { token: null, mode: null, boot: null, mgrName: '' };

// ---------- helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const TZ = 'Europe/London';
const fmtTime = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtDate = (d, o) => new Date(d + (String(d).length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', Object.assign({ weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }, o || {}));
const fmtLong = d => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const londonDay = (dt = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(dt);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = iso => { const d = new Date(iso + 'T12:00:00Z'); const w = (d.getUTCDay() + 6) % 7; return addDays(iso, -w); };
const periodOf = (kind, iso) => kind === 'weekly' ? 'W' + mondayOf(iso) : kind === 'monthly' ? 'M' + iso.slice(0, 7) : iso;
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); }
function openSheet(html, onReady) {
  sheet.innerHTML = '<div class="sc"></div><div class="sp">' + html + '</div>';
  sheet.classList.add('on'); $('.sc', sheet).onclick = closeSheet; if (onReady) onReady($('.sp', sheet));
}
function closeSheet() { sheet.classList.remove('on'); sheet.innerHTML = ''; }
function confirmSheet(title, body, okText) {
  return new Promise(res => openSheet('<h3>' + esc(title) + '</h3><p class="mut">' + esc(body) + '</p><div class="row" style="margin-top:16px"><button class="btn ghost" id="no">Cancel</button><button class="btn" id="yes">' + esc(okText || 'OK') + '</button></div>', sp => {
    $('#no', sp).onclick = () => { closeSheet(); res(false); }; $('#yes', sp).onclick = () => { closeSheet(); res(true); };
  }));
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  if (data && data.ok === false && data.error === 'session') { signOut(true); throw new Error('Please sign in again.'); }
  return data;
}
function errMsg(e) { return (e && (e.message || e.error_description)) || 'Something went wrong. Check your connection and try again.'; }

// ---------- limits / problem checks ----------
const L = () => (S.boot && S.boot.settings) || {};
function unitOk(kind, t) { if (t == null) return null; return kind === 'freezer' ? t <= Number(L().freezerMax ?? -18) : t <= Number(L().fridgeMax ?? 5); }
function limitText(kind) { return kind === 'freezer' ? 'at or below ' + (L().freezerMax ?? -18) + '°C' : 'at or below ' + (L().fridgeMax ?? 5) + '°C'; }

// ---------- routing ----------
function go(h) { if (location.hash === h) route(); else location.hash = h; }
window.addEventListener('hashchange', route);
async function route() {
  closeSheet();
  if (!S.mode) return;
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  window.scrollTo(0, 0);
  try {
    if (a === 'list') return viewList(b);
    if (a === 'log') return viewLog(b);
    if (a === 'today-log') return viewTodayLog();
    if (a === 'docs') return b ? viewFolder(decodeURIComponent(b)) : viewDocs();
    if (S.mode === 'manager') {
      if (a === 'dash') return viewDash();
      if (a === 'records') return viewRecords(b);
      if (a === 'setup') return viewSetup(b);
    }
    return viewHome();
  } catch (e) { console.error(e); app.innerHTML = shell('Roots Checks', '<div class="warnbox">' + esc(errMsg(e)) + '</div>', 'home'); }
}

function shell(title, body, tab, opts = {}) {
  const me = S.boot && S.boot.me;
  const nav = S.mode === 'manager'
    ? [['home', '✓', 'Checks', '#/'], ['dash', '▤', 'Overview', '#/dash'], ['records', '☰', 'Records', '#/records'], ['docs', '▣', 'Documents', '#/docs'], ['setup', '⚙︎', 'Setup', '#/setup']]
    : [['home', '✓', 'Checks', '#/'], ['today-log', '☰', 'Today', '#/today-log'], ['docs', '▣', 'Documents', '#/docs'], ['rota', '▦', 'Rota', 'rota'], ['me', '◯', 'Sign out', 'signout']];
  return '<header class="top">' + (opts.back ? '<button class="back" data-back="' + esc(opts.back) + '" aria-label="Back">‹</button><h1>' + esc(title) + '</h1>'
    : '<img class="logo" src="logo-white.png" alt="Roots">') +
    (opts.back ? '' : '<div class="who">' + (me ? (S.mode === 'manager' ? 'Manager' : 'Signed in') + '<b>' + esc(me.name) + '</b>' : '') + '</div>') + '</header>' +
    '<main class="' + (opts.wide ? 'wide' : '') + (opts.back ? ' nonav' : '') + '">' + body + '</main>' +
    (opts.back ? '' : '<nav class="nav">' + nav.map(n => '<button data-nav="' + n[3] + '" class="' + (tab === n[0] ? 'on' : '') + '"><span class="i">' + n[1] + '</span>' + n[2] + '</button>').join('') + '</nav>');
}
document.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]');
  if (n) { const v = n.dataset.nav; if (v === 'signout') return askSignOut(); if (v === 'rota') { location.href = '../'; return; } go(v); return; }
  const b = e.target.closest('[data-back]'); if (b) { go(b.dataset.back); return; }
  const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
});

// ---------- sign in ----------
async function start() {
  S.token = localStorage.getItem(TOKEN_KEY) || rotaGet('token');
  const { data } = await sb.auth.getSession();
  // A manager login on this device wins, unless someone chose to sign in here with a staff PIN.
  const wantStaff = !!S.token && (localStorage.getItem(MODE_KEY) === 'staff' || !data.session);
  if (!wantStaff && data.session) {
    try { await loadBoot('manager'); return route(); } catch (e) { /* not a manager */ }
  }
  if (wantStaff) {
    try { await loadBoot('staff'); localStorage.setItem(TOKEN_KEY, S.token); return route(); } catch (e) { localStorage.removeItem(TOKEN_KEY); S.token = null; }
  }
  showNames();
}
async function loadBoot(mode) {
  const d = await rpc('chk_boot', { p_token: mode === 'staff' ? S.token : null });
  if (!d || !d.ok) throw new Error('session');
  if (mode === 'manager' && !d.me.manager) throw new Error('not manager');
  S.boot = d; S.mode = mode;
}
async function refresh() { await loadBoot(S.mode); }

async function showNames() {
  S.mode = null;
  app.innerHTML = '<div class="login"><div class="hd"><img src="logo-white.png" alt="Roots"><div>DAILY CHECKS</div></div><div class="bd">' +
    '<h2>Tap your name</h2><input class="in" id="q" placeholder="Search names" autocomplete="off" style="margin-bottom:12px"><div class="names" id="names"><div class="mut">Loading…</div></div>' +
    '<p style="text-align:center;margin-top:28px"><button class="lnk" id="mgr">Manager sign in</button></p></div></div>';
  $('#mgr').onclick = showManagerLogin;
  let people = [];
  try { people = await rpc('rota_people', {}); } catch (e) { $('#names').innerHTML = '<div class="warnbox">Couldn’t load the staff list. Check your connection.</div>'; return; }
  const draw = q => {
    const list = people.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()));
    $('#names').innerHTML = list.map(p => '<button class="name" data-id="' + esc(p.id) + '"><span class="av">' + esc(initials(p.name)) + '</span>' + esc(p.name) + '</button>').join('') || '<div class="empty">No one found</div>';
    $$('#names .name').forEach(b => b.onclick = () => showPin(people.find(p => p.id === b.dataset.id)));
  };
  draw(''); $('#q').oninput = e => draw(e.target.value);
}
function showPin(p) {
  let pin = '';
  app.innerHTML = '<div class="login"><div class="hd"><img src="logo-white.png" alt="Roots"><div>DAILY CHECKS</div></div><div class="bd pin">' +
    '<h3>Hi ' + esc(p.name.split(' ')[0]) + '</h3><p class="mut">Enter your 4-digit PIN. It’s the same as your clock-in PIN.</p>' +
    '<div class="dots" id="dots"><i></i><i></i><i></i><i></i></div><div class="err" id="err"></div>' +
    '<div class="keys">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<button data-k="' + n + '">' + n + '</button>').join('') +
    '<button class="k2" data-k="back">Not you?</button><button data-k="0">0</button><button class="k2" data-k="del">Delete</button></div></div></div>';
  const dots = $('#dots'), err = $('#err');
  const paint = () => $$('i', dots).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  $$('.keys button').forEach(b => b.onclick = async () => {
    const k = b.dataset.k;
    if (k === 'back') return showNames();
    if (k === 'del') { pin = pin.slice(0, -1); return paint(); }
    if (pin.length >= 4) return;
    pin += k; paint();
    if (pin.length === 4) {
      err.textContent = 'Checking…';
      try {
        const r = await rpc('rota_login', { p_staff: p.id, p_pin: pin });
        if (!r.ok) {
          err.textContent = r.error === 'locked' ? 'Too many tries. Wait ' + r.wait + ' minutes or ask a manager.' : r.error === 'pin' ? 'Wrong PIN. ' + r.left + ' tries left.' : 'Can’t sign in. Ask a manager.';
          pin = ''; paint(); dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); return;
        }
        S.token = r.token; localStorage.setItem(TOKEN_KEY, r.token); localStorage.setItem(MODE_KEY, 'staff'); rotaSet('token', r.token); rotaSet('me', { id: r.id, name: r.name });
        await loadBoot('staff'); location.hash = '#/'; route();
      } catch (e) { err.textContent = errMsg(e); pin = ''; paint(); }
    }
  });
}
function showManagerLogin() {
  app.innerHTML = '<div class="login"><div class="hd"><img src="logo-white.png" alt="Roots"><div>MANAGER</div></div><div class="bd">' +
    '<h2>Manager sign in</h2><p class="mut">Use the same login as the table bookings and rota manager pages.</p>' +
    '<form id="f"><label class="f" for="em">Email</label><input class="in" id="em" type="email" autocomplete="username" required>' +
    '<label class="f" for="pw">Password</label><input class="in" id="pw" type="password" autocomplete="current-password" required>' +
    '<div class="err" id="err"></div><button class="btn" type="submit">Sign in</button></form>' +
    '<p style="text-align:center;margin-top:22px"><button class="lnk" id="bk">← Staff sign in</button></p></div></div>';
  $('#bk').onclick = showNames;
  $('#f').onsubmit = async e => {
    e.preventDefault(); const err = $('#err'); err.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) { err.textContent = 'That email or password didn’t work.'; return; }
    try { localStorage.setItem(MODE_KEY, 'manager'); S.token = null; await loadBoot('manager'); location.hash = '#/dash'; route(); }
    catch (x) { err.textContent = 'This login isn’t set up as a manager.'; await sb.auth.signOut(); }
  };
}
async function askSignOut() { if (await confirmSheet('Sign out?', 'This signs you out of the rota too. You’ll need your PIN to sign back in.', 'Sign out')) signOut(); }
async function signOut(expired) {
  if (S.mode === 'staff' && S.token && !expired) { try { await sb.rpc('rota_logout', { p_token: S.token }); } catch (e) { } }
  if (S.mode === 'manager') await sb.auth.signOut();
  if (S.mode === 'staff') { rotaSet('token', null); rotaSet('me', null); localStorage.removeItem(TOKEN_KEY); }
  localStorage.removeItem(MODE_KEY); S = { token: null, mode: null, boot: null };
  location.hash = ''; showNames();
}

// ---------- status helpers ----------
function listStatus(l) {
  const per = S.boot.periods[l.kind === 'weekly' ? 'weekly' : l.kind === 'monthly' ? 'monthly' : 'daily'];
  const recs = S.boot.done.filter(r => r.list === l.id && r.period === per);
  const ticks = {}, issues = {};
  recs.sort((a, b) => a.at < b.at ? -1 : 1).forEach(r => {
    Object.keys(r.ticks || {}).forEach(id => { if (r.ticks[id] && !ticks[id]) ticks[id] = { by: r.by, at: r.at }; });
    Object.keys(r.issues || {}).forEach(id => { issues[id] = { note: r.issues[id], by: r.by, at: r.at }; });
  });
  const total = l.items.length, done = l.items.filter(i => ticks[i.id]).length;
  return { recs, ticks, issues, total, done, full: total > 0 && done >= total, problems: recs.reduce((s, r) => s + (r.problems || 0), 0) };
}
function pill(st) {
  if (st.problems) return '<span class="pill warn">! ' + st.done + '/' + st.total + '</span>';
  if (st.full) return '<span class="pill full">✓ Done</span>';
  if (st.done) return '<span class="pill part">' + st.done + '/' + st.total + '</span>';
  return '<span class="pill none">To do</span>';
}

// ---------- staff home ----------
function viewHome() {
  const B = S.boot, hr = +new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ });
  const greet = hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening';
  const group = (kinds, title, sub) => {
    const ls = B.lists.filter(l => kinds.includes(l.kind));
    if (!ls.length) return '';
    return '<h2>' + title + (sub ? ' <span class="mut sm" style="text-transform:none;letter-spacing:0;font-weight:400">· ' + sub + '</span>' : '') + '</h2><div class="grid">' + ls.map(l => {
      const st = listStatus(l);
      return '<button class="card ' + (st.full && !st.problems ? 'done' : '') + '" data-go="#/list/' + l.id + '"><div class="t"><b>' + esc(l.name) + '</b><span>' + esc(l.area) + ' · ' + l.items.length + ' checks</span></div>' + pill(st) + '</button>';
    }).join('') + '</div>';
  };
  const open = B.log.filter(r => r.open);
  const body = '<div class="hello">' + greet + ', ' + esc(B.me.name.split(' ')[0]) + '</div><div class="date">' + esc(fmtLong(B.today)) + '</div>' +
    (open.length ? '<div class="warnbox">' + open.length + ' item' + (open.length > 1 ? 's' : '') + ' still cooling or hot holding. <button class="lnk" data-go="#/log/' + open[0].kind + '">Check now ›</button></div>' : '') +
    group(['opening'], 'Opening') + group(['closing'], 'Closing') + group(['daily'], 'Daily') +
    group(['weekly'], 'This week', 'w/c ' + fmtDate(B.periods.weekly.slice(1), { weekday: undefined })) +
    group(['monthly'], 'This month', new Date(B.today + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: TZ })) +
    '<h2>Temperature &amp; food logs</h2><div class="grid">' + LOGS.map(l => {
      const n = B.log.filter(r => r.kind === l.k).length, bad = B.log.filter(r => r.kind === l.k && r.problems).length;
      return '<button class="card" data-go="#/log/' + l.k + '"><span class="ic">' + l.ic + '</span><div class="t"><b>' + l.name + '</b><span>' + l.sub + '</span></div>' +
        (bad ? '<span class="pill warn">!' + bad + '</span>' : n ? '<span class="pill part">' + n + ' today</span>' : '') + '</button>';
    }).join('') + '</div>';
  app.innerHTML = shell('Checks', body, 'home');
}

// ---------- checklist ----------
function viewList(id) {
  const l = S.boot.lists.find(x => x.id === id);
  if (!l) return go('#/');
  const st = listStatus(l);
  const units = l.temps_area ? S.boot.units.filter(u => u.area === l.temps_area) : [];
  const ticks = {}, issues = {};
  const per = KIND_LABEL[l.kind] + ' · ' + (l.kind === 'weekly' ? 'week of ' + fmtDate(S.boot.periods.weekly.slice(1)) : l.kind === 'monthly' ? new Date(S.boot.today + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : fmtDate(S.boot.today));
  const body = '<h3>' + esc(l.name) + '</h3><div class="mut">' + esc(per) + '</div>' +
    '<div class="prog"><i id="pg" style="width:' + (st.total ? st.done / st.total * 100 : 0) + '%"></i></div><div class="mut sm" id="pgt"></div>' +
    (units.length ? '<h2>Fridge &amp; freezer temperatures</h2><p class="mut sm" style="margin-top:-4px">Fridges ' + limitText('fridge') + ', freezers ' + limitText('freezer') + '. Leave blank if you’ve already done them.</p>' +
      units.map(u => '<div class="temp" data-u="' + u.id + '"><div class="nm"><b>' + esc(u.name) + '</b><span>' + (u.kind === 'freezer' ? 'Freezer' : 'Fridge') + '</span></div><span class="st"></span><input class="in" inputmode="decimal" placeholder="°C" aria-label="' + esc(u.name) + ' temperature"></div>').join('') : '') +
    '<h2>Checks</h2>' + l.items.map(it => {
      const t = st.ticks[it.id], is = st.issues[it.id];
      return '<div class="item ' + (t ? 'on locked' : '') + (is ? ' issue' : '') + '" data-i="' + esc(it.id) + '"><button class="tick" aria-label="Tick">✓</button><div class="tx">' + esc(it.text) +
        (t ? '<span class="by">Done by ' + esc(t.by) + ' at ' + fmtTime(t.at) + '</span>' : '') + (is ? '<span class="note">! ' + esc(is.note) + ' — ' + esc(is.by) + '</span>' : '') +
        '<span class="nw"></span></div><button class="flag" aria-label="Report a problem" title="Report a problem">!</button></div>';
    }).join('') +
    '<label class="f" for="cm">Notes (optional)</label><textarea class="in" id="cm" placeholder="Anything the manager should know"></textarea>' +
    '<div class="bar"><button class="btn" id="save" disabled>Save</button></div>';
  app.innerHTML = shell(l.name, body, 'home', { back: '#/' });
  const upd = () => {
    const nNew = Object.keys(ticks).length, nIss = Object.keys(issues).length;
    const temps = $$('.temp').filter(t => num($('input', t).value) != null).length;
    const done = st.done + nNew;
    $('#pg').style.width = (st.total ? done / st.total * 100 : 0) + '%';
    $('#pgt').textContent = done + ' of ' + st.total + ' done' + (st.recs.length ? ' · started by ' + st.recs[0].by : '');
    const any = nNew + nIss + temps > 0 || $('#cm').value.trim();
    $('#save').disabled = !any;
    $('#save').textContent = any ? 'Save' + (nNew ? ' ' + nNew + ' tick' + (nNew > 1 ? 's' : '') : '') + (temps ? (nNew ? ' + ' : ' ') + temps + ' temp' + (temps > 1 ? 's' : '') : '') : 'Tick items to save';
  };
  $$('.item').forEach(el => {
    const iid = el.dataset.i;
    $('.tick', el).onclick = () => {
      if (st.ticks[iid]) return toast('Already done by ' + st.ticks[iid].by);
      if (ticks[iid]) delete ticks[iid]; else ticks[iid] = true;
      el.classList.toggle('on', !!ticks[iid]); upd();
    };
    $('.flag', el).onclick = () => openSheet('<h3>Report a problem</h3><p class="mut">' + esc(l.items.find(i => i.id === iid).text) + '</p><textarea class="in" id="nt" placeholder="What’s wrong, and what did you do about it?">' + esc(issues[iid] || '') + '</textarea>' +
      '<div class="row" style="margin-top:14px">' + (issues[iid] ? '<button class="btn ghost" id="rm">Remove</button>' : '<button class="btn ghost" id="cx">Cancel</button>') + '<button class="btn" id="ok">Save problem</button></div>', sp => {
        $('#nt', sp).focus();
        if ($('#cx', sp)) $('#cx', sp).onclick = closeSheet;
        if ($('#rm', sp)) $('#rm', sp).onclick = () => { delete issues[iid]; el.classList.toggle('issue', !!st.issues[iid]); $('.nw', el).textContent = ''; closeSheet(); upd(); };
        $('#ok', sp).onclick = () => { const v = $('#nt', sp).value.trim(); if (!v) return toast('Write a short note first'); issues[iid] = v.slice(0, 500); el.classList.add('issue'); $('.nw', el).innerHTML = '<span class="note">! ' + esc(v) + '</span>'; closeSheet(); upd(); };
      });
  });
  $$('.temp').forEach(t => { const u = units.find(x => x.id === t.dataset.u); $('input', t).oninput = e => { const v = num(e.target.value); const ok = unitOk(u.kind, v); t.classList.toggle('bad', ok === false); $('.st', t).textContent = ok == null ? '' : ok ? '✓' : '!'; upd(); }; });
  $('#cm').oninput = upd; upd();
  $('#save').onclick = async () => {
    const temps = $$('.temp').map(t => { const u = units.find(x => x.id === t.dataset.u), v = num($('input', t).value); return v == null ? null : { unit: u.id, name: u.name, kind: u.kind, temp: v, ok: unitOk(u.kind, v) }; }).filter(Boolean);
    const bad = temps.filter(t => !t.ok);
    if (bad.length && !await confirmSheet('Temperature out of range', bad.map(b => b.name + ' ' + b.temp + '°C').join(', ') + '. Tell a manager straight away and move food if needed. Save anyway?', 'Save')) return;
    const data = { ticks, issues, comment: $('#cm').value.trim().slice(0, 1000) || undefined, temps: temps.length ? temps : undefined };
    $('#save').disabled = true; $('#save').textContent = 'Saving…';
    try { await rpc('chk_submit', { p_token: S.token, p_kind: 'checklist', p_list: l.id, p_data: data }); await refresh(); toast('Saved'); go('#/'); }
    catch (e) { toast(errMsg(e)); upd(); }
  };
}

// ---------- logs ----------
function viewLog(kind) {
  const meta = LOGS.find(l => l.k === kind); if (!meta) return go('#/');
  const lim = L(), entries = S.boot.log.filter(r => r.kind === kind);
  let form = '';
  const food = '<label class="f" for="food">Food</label><input class="in" id="food" maxlength="80" placeholder="e.g. Chicken thighs">';
  const tIn = (id, lab, ph) => '<label class="f" for="' + id + '">' + lab + '</label><input class="in" id="' + id + '" inputmode="decimal" placeholder="' + (ph || '°C') + '">';
  if (kind === 'temps') {
    const areas = [...new Set(S.boot.units.map(u => u.area))];
    form = '<p class="mut sm">Fridges ' + limitText('fridge') + ', freezers ' + limitText('freezer') + '. Fill in the ones you’re checking.</p>' + areas.map(a => '<h2>' + esc(a) + '</h2>' + S.boot.units.filter(u => u.area === a).map(u =>
      '<div class="temp" data-u="' + u.id + '"><div class="nm"><b>' + esc(u.name) + '</b><span>' + (u.kind === 'freezer' ? 'Freezer' : 'Fridge') + '</span></div><span class="st"></span><input class="in" inputmode="decimal" placeholder="°C" aria-label="' + esc(u.name) + '"></div>').join('')).join('');
  } else if (kind === 'delivery') {
    form = '<label class="f" for="sup">Supplier</label><input class="in" id="sup" maxlength="80" placeholder="e.g. Brakes">' +
      '<label class="f" for="its">What came in</label><input class="in" id="its" maxlength="200" placeholder="e.g. Dairy, chicken, veg">' +
      '<div class="row"><div>' + tIn('tc', 'Chilled temp', 'e.g. 4') + '</div><div>' + tIn('tf', 'Frozen temp', 'e.g. -18') + '</div></div>' +
      '<p class="mut sm">Chilled at or below ' + (lim.chilledMax ?? 8) + '°C, frozen at or below ' + (lim.frozenMax ?? -15) + '°C. Leave blank if none.</p>' +
      '<label class="f">Packaging undamaged and in date?</label><div class="seg" id="pk"><button data-v="yes" class="on">Yes</button><button data-v="no">No</button></div>' +
      '<label class="f">Delivery accepted?</label><div class="seg" id="ac"><button data-v="yes" class="on">Accepted</button><button data-v="no">Rejected</button></div>';
  } else if (kind === 'cooking' || kind === 'reheat') {
    form = food + tIn('t', 'Core temperature') + '<p class="mut sm">Must reach ' + (kind === 'cooking' ? lim.cookMin ?? 75 : lim.reheatMin ?? 75) + '°C or above.</p>';
  } else if (kind === 'cooling') {
    form = food + tIn('t', 'Starting temperature') + '<p class="mut sm">Starts a timer. Add the final temperature once it’s at ' + (lim.coolTarget ?? 8) + '°C or below, within ' + (lim.coolMins ?? 90) + ' minutes.</p>';
  } else if (kind === 'hothold') {
    form = food + tIn('t', 'Starting temperature') + '<p class="mut sm">Keep at ' + (lim.hotholdMin ?? 63) + '°C or above. Check every 2 hours, and bin it after 4 hours unless your HACCP plan says otherwise.</p>';
  } else if (kind === 'probe') {
    form = '<label class="f" for="pn">Probe</label><input class="in" id="pn" maxlength="40" placeholder="e.g. Kitchen probe 1">' +
      '<div class="row"><div>' + tIn('ti', 'Iced water', 'e.g. 0.2') + '</div><div>' + tIn('tb', 'Boiling water', 'e.g. 99.8') + '</div></div><p class="mut sm">Pass: iced water -1 to 1°C, boiling water 99 to 101°C.</p>';
  } else if (kind === 'washer') {
    form = '<label class="f">Machine</label><div class="seg" id="mc"><button data-v="Dishwasher" class="on">Dishwasher</button><button data-v="Glasswasher">Glasswasher</button></div>' +
      '<div class="row"><div>' + tIn('tw', 'Wash temp', 'e.g. 60') + '</div><div>' + tIn('tr', 'Rinse temp', 'e.g. 82') + '</div></div><p class="mut sm">Dishwasher rinse should reach ' + (lim.washRinseMin ?? 82) + '°C.</p>';
  }
  const openOnes = entries.filter(r => r.open);
  const body = '<h3>' + esc(meta.name) + '</h3><div class="mut">' + esc(fmtLong(S.boot.today)) + '</div>' +
    (openOnes.length ? '<h2>' + (kind === 'cooling' ? 'Cooling now' : 'Holding now') + '</h2>' + openOnes.map(r => openCard(r)).join('') : '') +
    '<h2>New entry</h2>' + form + '<label class="f" for="nt">Notes (optional)</label><textarea class="in" id="nt" maxlength="500" placeholder="Action taken if anything was wrong"></textarea>' +
    '<div class="bar"><button class="btn" id="save">' + (kind === 'cooling' ? 'Start cooling' : kind === 'hothold' ? 'Start hot holding' : 'Save') + '</button></div>' +
    '<h2>Today</h2>' + logList(entries.filter(r => !r.open), true);
  app.innerHTML = shell(meta.name, body, 'home', { back: '#/' });
  $$('.seg').forEach(s => $$('button', s).forEach(b => b.onclick = () => { $$('button', s).forEach(x => x.classList.remove('on')); b.classList.add('on'); }));
  const segv = id => { const b = $('#' + id + ' .on'); return b && b.dataset.v; };
  if (kind === 'temps') $$('.temp').forEach(t => { const u = S.boot.units.find(x => x.id === t.dataset.u); $('input', t).oninput = e => { const ok = unitOk(u.kind, num(e.target.value)); t.classList.toggle('bad', ok === false); $('.st', t).textContent = ok == null ? '' : ok ? '✓' : '!'; }; });
  $$('[data-open]').forEach(b => b.onclick = () => addReading(entries.find(r => r.id === b.dataset.open), b.dataset.close === '1'));
  $('#save').onclick = async () => {
    const note = $('#nt').value.trim() || undefined; let data, warn = [];
    const need = (v, what) => { if (v == null) throw new Error('Enter the ' + what + '.'); return v; };
    try {
      if (kind === 'temps') {
        const temps = $$('.temp').map(t => { const u = S.boot.units.find(x => x.id === t.dataset.u), v = num($('input', t).value); return v == null ? null : { unit: u.id, name: u.name, kind: u.kind, temp: v, ok: unitOk(u.kind, v) }; }).filter(Boolean);
        if (!temps.length) throw new Error('Enter at least one temperature.');
        temps.filter(t => !t.ok).forEach(t => warn.push(t.name + ' ' + t.temp + '°C'));
        data = { temps, note };
      } else if (kind === 'delivery') {
        const sup = $('#sup').value.trim(); if (!sup) throw new Error('Enter the supplier.');
        const tc = num($('#tc').value), tf = num($('#tf').value), pk = segv('pk') === 'yes', ac = segv('ac') === 'yes';
        const okc = tc == null || tc <= (lim.chilledMax ?? 8), okf = tf == null || tf <= (lim.frozenMax ?? -15);
        if (!okc) warn.push('Chilled ' + tc + '°C'); if (!okf) warn.push('Frozen ' + tf + '°C'); if (!pk) warn.push('Packaging/dates');
        data = { supplier: sup, items: $('#its').value.trim() || undefined, chilled: tc, frozen: tf, packaging: pk, accepted: ac, ok: okc && okf && pk && ac, note };
      } else if (kind === 'cooking' || kind === 'reheat') {
        const f = $('#food').value.trim(); if (!f) throw new Error('Enter the food.');
        const t = need(num($('#t').value), 'temperature'), min = kind === 'cooking' ? lim.cookMin ?? 75 : lim.reheatMin ?? 75;
        if (t < min) warn.push(f + ' ' + t + '°C');
        data = { food: f, temp: t, ok: t >= min, note };
      } else if (kind === 'cooling' || kind === 'hothold') {
        const f = $('#food').value.trim(); if (!f) throw new Error('Enter the food.');
        const t = need(num($('#t').value), 'temperature');
        const ok = kind === 'hothold' ? t >= (lim.hotholdMin ?? 63) : true;
        if (!ok) warn.push(f + ' ' + t + '°C');
        data = { food: f, readings: [{ at: new Date().toISOString(), temp: t, ok, by: S.boot.me.name, start: true }], note };
      } else if (kind === 'probe') {
        const p = $('#pn').value.trim() || 'Probe', ti = need(num($('#ti').value), 'iced water reading'), tb = need(num($('#tb').value), 'boiling water reading');
        const ok = ti >= -1 && ti <= 1 && tb >= 99 && tb <= 101; if (!ok) warn.push(p + ' failed');
        data = { probe: p, ice: ti, boil: tb, ok, note };
      } else if (kind === 'washer') {
        const m = segv('mc'), tw = num($('#tw').value), tr = need(num($('#tr').value), 'rinse temperature');
        const ok = m === 'Glasswasher' || tr >= (lim.washRinseMin ?? 82); if (!ok) warn.push(m + ' rinse ' + tr + '°C');
        data = { machine: m, wash: tw, rinse: tr, ok, note };
      }
    } catch (e) { return toast(e.message); }
    if (warn.length && !await confirmSheet('Out of range', warn.join(', ') + '. Tell a manager and write what you did in the notes. Save anyway?', 'Save')) return;
    $('#save').disabled = true;
    try { await rpc('chk_submit', { p_token: S.token, p_kind: kind, p_list: null, p_data: data }); await refresh(); toast('Saved'); viewLog(kind); }
    catch (e) { toast(errMsg(e)); $('#save').disabled = false; }
  };
}
function openCard(r) {
  const d = r.data || {}, rd = d.readings || [], first = rd[0], last = rd[rd.length - 1];
  const mins = first ? Math.round((Date.now() - new Date(first.at)) / 60000) : 0;
  const label = r.kind === 'cooling' ? 'Cooling for ' : 'Holding for ';
  return '<div class="card" style="flex-wrap:wrap"><div class="t"><b>' + esc(d.food) + '</b><span>' + label + (mins >= 60 ? Math.floor(mins / 60) + 'h ' : '') + (mins % 60) + 'm · last ' + (last ? last.temp + '°C at ' + fmtTime(last.at) : '') + '</span></div>' +
    '<div class="row" style="flex:1 1 100%;margin-top:8px"><button class="btn ghost sm" data-open="' + r.id + '">Add reading</button><button class="btn sm" data-open="' + r.id + '" data-close="1">' + (r.kind === 'cooling' ? 'Finished cooling' : 'Finish / bin') + '</button></div></div>';
}
function addReading(r, close) {
  const lim = L(), isCool = r.kind === 'cooling';
  openSheet('<h3>' + esc(r.data.food) + '</h3><p class="mut">' + (close ? (isCool ? 'Final temperature once cooled.' : 'Final temperature before serving or binning.') : 'Current core temperature.') + '</p>' +
    '<input class="in" id="t" inputmode="decimal" placeholder="°C" style="font-size:24px;text-align:center">' +
    '<div class="row" style="margin-top:14px"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Save</button></div>', sp => {
      $('#t', sp).focus(); $('#cx', sp).onclick = closeSheet;
      $('#ok', sp).onclick = async () => {
        const t = num($('#t', sp).value); if (t == null) return toast('Enter the temperature');
        const first = (r.data.readings || [])[0], mins = first ? (Date.now() - new Date(first.at)) / 60000 : 0;
        const okFinal = isCool ? (close ? t <= (lim.coolTarget ?? 8) && mins <= (lim.coolMins ?? 90) : true) : t >= (lim.hotholdMin ?? 63);
        closeSheet();
        if (!okFinal && !await confirmSheet('Out of range', isCool ? 'Not cooled to ' + (lim.coolTarget ?? 8) + '°C within ' + (lim.coolMins ?? 90) + ' minutes. Tell a manager and bin the food if unsafe. Save anyway?' : t + '°C is below ' + (lim.hotholdMin ?? 63) + '°C. Reheat to 75°C or bin it, and tell a manager. Save anyway?', 'Save')) return;
        try { await rpc('chk_reading', { p_token: S.token, p_id: r.id, p_temp: t, p_ok: okFinal, p_close: !!close }); await refresh(); toast('Saved'); viewLog(r.kind); }
        catch (e) { toast(errMsg(e)); }
      };
    });
}
function describe(r) {
  const d = r.data || {};
  switch (r.kind) {
    case 'temps': return (d.temps || []).map(t => (t.ok ? '' : '! ') + esc(t.name) + ' <b>' + t.temp + '°C</b>').join(', ');
    case 'delivery': return '<b>' + esc(d.supplier) + '</b>' + (d.items ? ' · ' + esc(d.items) : '') + (d.chilled != null ? ' · chilled ' + d.chilled + '°C' : '') + (d.frozen != null ? ' · frozen ' + d.frozen + '°C' : '') + (d.packaging === false ? ' · ! packaging/dates' : '') + ' · ' + (d.accepted ? 'accepted' : '<b>rejected</b>');
    case 'cooking': case 'reheat': return '<b>' + esc(d.food) + '</b> ' + d.temp + '°C';
    case 'cooling': case 'hothold': return '<b>' + esc(d.food) + '</b> ' + (d.readings || []).map(x => (x.ok === false ? '! ' : '') + x.temp + '°C ' + fmtTime(x.at)).join(' → ') + (d.closedAt ? ' · finished ' + fmtTime(d.closedAt) : ' · in progress');
    case 'probe': return '<b>' + esc(d.probe) + '</b> ice ' + d.ice + '°C, boil ' + d.boil + '°C · ' + (d.ok ? 'pass' : '<b>fail</b>');
    case 'washer': return '<b>' + esc(d.machine) + '</b>' + (d.wash != null ? ' wash ' + d.wash + '°C,' : '') + ' rinse ' + d.rinse + '°C';
    case 'checklist': {
      const n = Object.keys(d.ticks || {}).length, iss = Object.keys(d.issues || {}).length;
      return '<b>' + esc(r.list_name || 'Checklist') + '</b> · ' + n + ' ticked' + (iss ? ' · ' + iss + ' problem' + (iss > 1 ? 's' : '') : '') + ((d.temps || []).length ? ' · ' + d.temps.length + ' temps' : '');
    }
  }
  return '';
}
function logList(rows, compact) {
  if (!rows.length) return '<div class="empty">Nothing yet</div>';
  return '<div class="log">' + rows.map(r => '<div class="e"><span class="tm">' + fmtTime(r.at || r.created_at) + '</span><div class="d">' + (compact ? '' : '<b>' + esc(LOG_NAME[r.kind] || '') + '</b> · ') + describe(r) +
    (r.data && r.data.note ? '<div class="mut sm">' + esc(r.data.note) + '</div>' : '') + '<div class="mut sm">' + esc(r.by || r.by_name) + '</div></div>' + (r.problems ? '<span class="x pill warn">!</span>' : '') + '</div>').join('') + '</div>';
}
function viewTodayLog() {
  const B = S.boot;
  const lists = B.lists.map(l => ({ l, st: listStatus(l) })).filter(x => x.st.recs.length);
  const body = '<h3>Today’s records</h3><div class="mut">' + esc(fmtLong(B.today)) + '</div><h2>Checklists</h2>' +
    (lists.length ? '<div class="log">' + lists.map(x => '<div class="e"><div class="d"><b>' + esc(x.l.name) + '</b> · ' + x.st.done + '/' + x.st.total + '<div class="mut sm">' + [...new Set(x.st.recs.map(r => r.by))].map(esc).join(', ') + '</div></div>' + pill(x.st) + '</div>').join('') + '</div>' : '<div class="empty">No checklists started yet</div>') +
    '<h2>Temperatures &amp; food</h2>' + logList(B.log);
  app.innerHTML = shell('Today', body, 'today-log');
}

// ---------- manager: overview ----------
async function fetchRecords(from, to) {
  const { data, error } = await sb.from('chk_records').select('*').gte('day', from).lte('day', to).order('created_at');
  if (error) throw error; return data;
}
function missedFor(lists, recs, today, startDate, days) {
  const out = [], from = addDays(today, -days) > startDate ? addDays(today, -days) : startDate;
  const byKey = {};
  recs.filter(r => r.kind === 'checklist').forEach(r => { const k = r.list_id + '|' + r.period; (byKey[k] = byKey[k] || []).push(r); });
  const status = (l, per) => { const rs = byKey[l.id + '|' + per] || []; const t = new Set(); rs.forEach(r => Object.keys(r.data.ticks || {}).forEach(i => t.add(i))); return { n: rs.length, done: l.items.filter(i => t.has(i.id)).length, total: l.items.length }; };
  for (let d = from; d < today; d = addDays(d, 1)) {
    lists.filter(l => ['opening', 'closing', 'daily'].includes(l.kind)).forEach(l => { const s = status(l, d); if (s.done < s.total) out.push({ l, label: fmtDate(d), sort: d, ...s }); });
    if (new Date(d + 'T12:00:00Z').getUTCDay() === 0 && mondayOf(d) >= startDate) lists.filter(l => l.kind === 'weekly').forEach(l => { const s = status(l, 'W' + mondayOf(d)); if (s.done < s.total) out.push({ l, label: 'Week of ' + fmtDate(mondayOf(d)), sort: d, ...s }); });
    if (addDays(d, 1).slice(8) === '01' && d.slice(0, 7) + '-01' >= startDate) lists.filter(l => l.kind === 'monthly').forEach(l => { const s = status(l, 'M' + d.slice(0, 7)); if (s.done < s.total) out.push({ l, label: new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), sort: d, ...s }); });
  }
  return out.sort((a, b) => a.sort < b.sort ? 1 : -1);
}
async function viewDash() {
  app.innerHTML = shell('Overview', '<div class="mut">Loading…</div>', 'dash', { wide: true });
  await refresh();
  const B = S.boot, today = B.today, start = (B.settings && B.settings.startDate) || today;
  const [recs, docsRes, listsRes] = await Promise.all([
    fetchRecords(addDays(today, -40), today),
    sb.from('chk_docs').select('id,folder,title,expires_on,done_on').eq('deleted', false),
    sb.from('chk_lists').select('*').eq('active', true)
  ]);
  if (docsRes.error) throw docsRes.error;
  const lists = listsRes.data || [];
  const missed = missedFor(lists, recs, today, start, 14);
  const wk = missedFor(lists, recs, today, start, 7);
  const dueWk = (() => { let n = 0; for (let d = addDays(today, -7) > start ? addDays(today, -7) : start; d < today; d = addDays(d, 1)) n += lists.filter(l => ['opening', 'closing', 'daily'].includes(l.kind)).length; return n; })();
  const score = dueWk ? Math.round((1 - wk.filter(m => ['opening', 'closing', 'daily'].includes(m.l.kind)).length / dueWk) * 100) : null;
  const probs = recs.filter(r => r.problems && r.day >= addDays(today, -7)).sort((a, b) => a.created_at < b.created_at ? 1 : -1);
  const soon = addDays(today, 30);
  const exp = docsRes.data.filter(d => d.expires_on && d.expires_on <= soon).sort((a, b) => a.expires_on < b.expires_on ? -1 : 1);
  const todayLists = B.lists.filter(l => ['opening', 'closing', 'daily'].includes(l.kind)).map(l => ({ l, st: listStatus(l) }));
  const body = '<div class="hello">Overview</div><div class="date">' + esc(fmtLong(today)) + '</div>' +
    '<div class="stats" style="margin-top:14px">' +
    '<div class="stat dark"><b>' + (score == null ? '–' : score + '%') + '</b><span>Daily checks done, last 7 days</span></div>' +
    '<div class="stat"><b>' + todayLists.filter(x => x.st.full).length + '/' + todayLists.length + '</b><span>Today’s checklists done</span></div>' +
    '<div class="stat"><b>' + probs.length + '</b><span>Problems logged, last 7 days</span></div>' +
    '<div class="stat"><b>' + exp.length + '</b><span>Certificates due within 30 days</span></div></div>' +
    '<h2>Today</h2><div class="grid">' + todayLists.map(x => '<button class="card ' + (x.st.full ? 'done' : '') + '" data-go="#/list/' + x.l.id + '"><div class="t"><b>' + esc(x.l.name) + '</b><span>' + (x.st.recs.length ? esc([...new Set(x.st.recs.map(r => r.by))].join(', ')) : 'Not started') + '</span></div>' + pill(x.st) + '</button>').join('') + '</div>' +
    '<h2>Problems, last 7 days</h2>' + (probs.length ? '<div class="log">' + probs.map(r => '<div class="e"><span class="tm">' + esc(fmtDate(r.day, { weekday: undefined })) + '</span><div class="d"><b>' + esc(r.kind === 'checklist' ? r.list_name : LOG_NAME[r.kind]) + '</b> · ' + problemText(r) + '<div class="mut sm">' + esc(r.by_name) + ' at ' + fmtTime(r.created_at) + '</div></div></div>').join('') + '</div>' : '<div class="empty">No problems logged</div>') +
    '<h2>Certificates &amp; documents due</h2>' + (exp.length ? exp.map(d => docRow(d)).join('') : '<div class="empty">Nothing due in the next 30 days</div>') +
    '<h2>Missed or unfinished, last 14 days</h2>' + (missed.length ? '<table class="t"><tr><th>When</th><th>Not done</th><th>Unfinished</th></tr>' + groupMissed(missed).map(g => '<tr><td style="white-space:nowrap">' + esc(g.label) + '</td><td>' + (g.none.map(esc).join(', ') || '–') + '</td><td>' + (g.part.map(esc).join(', ') || '–') + '</td></tr>').join('') + '</table>' : '<div class="empty">Nothing missed since the app started on ' + esc(fmtDate(start)) + '</div>');
  app.innerHTML = shell('Overview', body, 'dash', { wide: true });
}
function groupMissed(missed) {
  const g = []; const by = {};
  missed.forEach(m => { let x = by[m.label]; if (!x) { x = by[m.label] = { label: m.label, none: [], part: [] }; g.push(x); } (m.n ? x.part : x.none).push(m.l.name + (m.n ? ' (' + m.done + '/' + m.total + ')' : '')); });
  return g;
}
function problemText(r) {
  const d = r.data || {};
  if (r.kind === 'checklist') {
    const l = S.boot.lists.find(x => x.id === r.list_id); const txt = id => { const it = l && l.items.find(i => i.id === id); return it ? it.text : 'Item'; };
    return Object.keys(d.issues || {}).map(id => '“' + esc(txt(id)) + '”: ' + esc(d.issues[id])).concat((d.temps || []).filter(t => !t.ok).map(t => esc(t.name) + ' ' + t.temp + '°C')).join('; ');
  }
  return describe(r) + (d.note ? ' · ' + esc(d.note) : '');
}

// ---------- manager: records ----------
async function viewRecords(arg) {
  const today = S.boot.today;
  let [from, to] = (arg || '').split('_');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) from = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to || '')) to = from;
  app.innerHTML = shell('Records', '<div class="mut">Loading…</div>', 'records', { wide: true });
  const recs = await fetchRecords(from, to);
  const days = {}; recs.forEach(r => (days[r.day] = days[r.day] || []).push(r));
  const head = '<div class="noprint"><div class="hello">Records</div><p class="mut">Everything staff have logged, with names and times. Print or save as PDF for an inspector.</p>' +
    '<div class="row" style="align-items:flex-end;flex-wrap:wrap"><div><label class="f" for="fr">From</label><input class="in" type="date" id="fr" value="' + from + '" max="' + today + '"></div>' +
    '<div><label class="f" for="to">To</label><input class="in" type="date" id="to" value="' + to + '" max="' + today + '"></div>' +
    '<div style="flex:0 0 auto"><button class="btn sm" id="show">Show</button></div></div>' +
    '<div class="chips"><button class="chip" data-r="0">Today</button><button class="chip" data-r="1">Yesterday</button><button class="chip" data-r="7">Last 7 days</button><button class="chip" data-r="m">This month</button><button class="chip" data-r="pm">Last month</button>' +
    '<button class="chip on" id="pr">Print / save PDF</button></div></div>' +
    '<div class="print-only"><h2>Roots · Food safety &amp; hygiene records</h2><p>' + esc(fmtLong(from)) + (to !== from ? ' to ' + esc(fmtLong(to)) : '') + ' · printed ' + esc(new Date().toLocaleString('en-GB', { timeZone: TZ })) + '</p></div>';
  const body = head + (Object.keys(days).length ? Object.keys(days).sort().reverse().map(d => '<h2>' + esc(fmtLong(d)) + '</h2>' + days[d].map(recCard).join('')).join('') : '<div class="empty" style="margin-top:16px">No records for these dates</div>');
  app.innerHTML = shell('Records', body, 'records', { wide: true });
  $('#show').onclick = () => go('#/records/' + $('#fr').value + '_' + $('#to').value);
  $('#pr').onclick = () => window.print();
  $$('[data-r]').forEach(c => c.onclick = () => {
    const r = c.dataset.r; let f = today, t = today;
    if (r === '1') f = t = addDays(today, -1); else if (r === '7') f = addDays(today, -6); else if (r === 'm') f = today.slice(0, 8) + '01';
    else if (r === 'pm') { t = addDays(today.slice(0, 8) + '01', -1); f = t.slice(0, 8) + '01'; }
    go('#/records/' + f + '_' + t);
  });
  $$('.rec .rh').forEach(h => h.onclick = () => { const b = h.nextElementSibling; b.hidden = !b.hidden; });
}
function recCard(r) {
  const d = r.data || {}; let inner = '';
  if (r.kind === 'checklist') {
    const l = S.boot.lists.find(x => x.id === r.list_id);
    const txt = id => { const it = l && l.items.find(i => i.id === id); return it ? it.text : '(item since removed)'; };
    inner = '<ul>' + Object.keys(d.ticks || {}).map(id => '<li>✓ ' + esc(txt(id)) + '</li>').join('') + Object.keys(d.issues || {}).map(id => '<li><b>! ' + esc(txt(id)) + ':</b> ' + esc(d.issues[id]) + '</li>').join('') + '</ul>' +
      ((d.temps || []).length ? '<p><b>Temperatures:</b> ' + d.temps.map(t => (t.ok ? '' : '! ') + esc(t.name) + ' ' + t.temp + '°C').join(', ') + '</p>' : '') + (d.comment ? '<p><b>Notes:</b> ' + esc(d.comment) + '</p>' : '');
  } else inner = '<p>' + describe(r) + '</p>' + (d.note ? '<p><b>Notes:</b> ' + esc(d.note) + '</p>' : '');
  const title = r.kind === 'checklist' ? r.list_name : LOG_NAME[r.kind];
  return '<div class="rec"><button class="rh"><b>' + esc(title) + '</b><span class="mut sm">' + esc(r.by_name) + ' · ' + fmtTime(r.created_at) + '</span>' + (r.problems ? '<span class="pill warn">! ' + r.problems + '</span>' : '') + '</button><div class="rb">' + inner + '</div></div>';
}

// ---------- manager: documents ----------
function docStatus(d) {
  if (!d.expires_on || !S.boot) return '';
  const today = S.boot.today;
  if (d.expires_on < today) return '<span class="pill warn">Expired</span>';
  if (d.expires_on <= addDays(today, 30)) return '<span class="pill part">Due ' + esc(fmtDate(d.expires_on, { weekday: undefined })) + '</span>';
  return '<span class="pill none">Valid</span>';
}
function docRow(d) {
  return '<div class="doc"><div class="t"><b>' + esc(d.title) + '</b><span>' + esc(d.folder) + (d.done_on ? ' · done ' + esc(fmtDate(d.done_on, { weekday: undefined, year: 'numeric' })) : '') + (d.expires_on ? ' · renew by ' + esc(fmtDate(d.expires_on, { weekday: undefined, year: 'numeric' })) : '') + '</span></div>' + docStatus(d) + '</div>';
}
async function loadDocs(folder) {
  if (S.mode !== 'manager') {
    const r = await rpc('chk_docs_list', { p_token: S.token });
    return (r.docs || []).filter(d => !folder || d.folder === folder);
  }
  let q = sb.from('chk_docs').select('*').eq('deleted', false);
  if (folder) q = q.eq('folder', folder);
  const { data, error } = await q.order('done_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
  if (error) throw error; return data;
}
async function openDoc(d) {
  const w = window.open('', '_blank');
  let url = null, err = null;
  if (S.mode === 'manager') {
    const { data: s, error: e } = await sb.storage.from(BUCKET).createSignedUrl(d.file_path, 300); url = s && s.signedUrl; err = e;
  } else {
    const { data: s, error: e } = await sb.functions.invoke('chk-doc-url', { body: { token: S.token, id: d.id } });
    url = s && s.ok && s.url; err = e || (!url && new Error(s && s.error === 'session' ? 'Please sign in again.' : 'Couldn’t open that file.'));
  }
  if (!url) { if (w) w.close(); return toast(errMsg(err)); }
  if (w) w.location = url; else location.href = url;
}
async function viewDocs() {
  const mgr = S.mode === 'manager';
  app.innerHTML = shell('Documents', '<div class="mut">Loading…</div>', 'docs', { wide: mgr });
  const data = await loadDocs();
  const today = S.boot.today, soon = addDays(today, 30);
  const body = '<div class="hello">Documents</div><p class="mut">' + (mgr ? 'Pest control reports, safety certificates and tests. Add a renewal date and the overview will warn you before it runs out.' : 'Pest control reports, safety certificates, tests and past records. Tap a folder to open a file.') + '</p><div class="grid" style="margin-top:12px">' +
    FOLDERS.map(f => { const ds = data.filter(d => d.folder === f); const ex = ds.filter(d => d.expires_on && d.expires_on < today).length, due = ds.filter(d => d.expires_on && d.expires_on >= today && d.expires_on <= soon).length;
      return '<button class="card" data-go="#/docs/' + encodeURIComponent(f) + '"><span class="ic">▣</span><div class="t"><b>' + esc(f) + '</b><span>' + ds.length + ' file' + (ds.length === 1 ? '' : 's') + '</span></div>' + (ex ? '<span class="pill warn">' + ex + ' expired</span>' : due ? '<span class="pill part">' + due + ' due</span>' : '') + '</button>'; }).join('') + '</div>';
  app.innerHTML = shell('Documents', body, 'docs', { wide: mgr });
}
async function viewFolder(folder) {
  if (!FOLDERS.includes(folder)) return go('#/docs');
  const mgr = S.mode === 'manager';
  app.innerHTML = shell(folder, '<div class="mut">Loading…</div>', 'docs', { back: '#/docs', wide: mgr });
  const data = await loadDocs(folder);
  const body = '<div class="row" style="align-items:center"><h3 style="flex:1">' + esc(folder) + '</h3>' + (mgr ? '<button class="btn sm" id="add" style="flex:0 0 auto">+ Add</button>' : '') + '</div>' +
    (folder === 'Previous records (Leafe)' && mgr ? '<p class="mut">Upload the monthly “AllRecords” PDFs from your Downloads folder here. You can select them all at once.</p>' : '') +
    '<div style="margin-top:12px">' + (data.length ? data.map(d => '<div class="doc"><div class="t"><b>' + esc(d.title) + '</b><span>' + (d.done_on ? 'Done ' + esc(fmtDate(d.done_on, { weekday: undefined, year: 'numeric' })) : 'Added ' + esc(fmtDate(d.created_at.slice(0, 10), { weekday: undefined, year: 'numeric' }))) +
      (d.expires_on ? ' · renew by ' + esc(fmtDate(d.expires_on, { weekday: undefined, year: 'numeric' })) : '') + (d.by_name ? ' · ' + esc(d.by_name) : '') + '</span>' + (d.notes ? '<span>' + esc(d.notes) + '</span>' : '') + '</div>' + docStatus(d) +
      ((d.file_path || d.has_file) ? '<button class="btn ghost sm" data-open="' + d.id + '">Open</button>' : '') + (mgr ? '<button class="btn ghost sm" data-del="' + d.id + '" aria-label="Delete">✕</button>' : '') + '</div>').join('') : '<div class="empty">No files yet</div>') + '</div>';
  app.innerHTML = shell(folder, body, 'docs', { back: '#/docs', wide: mgr });
  if (mgr) $('#add').onclick = () => addDoc(folder);
  $$('[data-open]').forEach(b => b.onclick = () => openDoc(data.find(x => x.id === b.dataset.open)));
  $$('[data-del]').forEach(b => b.onclick = async () => {
    const d = data.find(x => x.id === b.dataset.del);
    if (!await confirmSheet('Delete “' + d.title + '”?', 'The file will be removed permanently and can’t be recovered.', 'Delete')) return;
    if (d.file_path) { const { error: e } = await sb.storage.from(BUCKET).remove([d.file_path]); if (e) return toast(errMsg(e)); }
    const { error: e2 } = await sb.from('chk_docs').update({ deleted: true, file_path: null }).eq('id', d.id); if (e2) return toast(errMsg(e2));
    toast('Deleted'); viewFolder(folder);
  });
}
function leafeMonth(name) {
  const m = /^(January|February|March|April|May|June|July|August|September|October|November|December)-(\d{4})/i.exec(name || '');
  if (!m) return null; const mi = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(m[1].toLowerCase()) + 1;
  return { done: m[2] + '-' + String(mi).padStart(2, '0') + '-01', title: 'Leafe records – ' + m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2] };
}
function addDoc(folder) {
  const leafe = folder === 'Previous records (Leafe)';
  openSheet('<h3>Add to ' + esc(folder) + '</h3>' +
    '<label class="f" for="fl">File' + (leafe ? 's' : '') + ' (PDF or photo)</label><input class="in" id="fl" type="file" accept="application/pdf,image/*" ' + (leafe ? 'multiple' : 'capture="environment"') + '>' +
    (leafe ? '<p class="mut sm">Each file is named from its month automatically.</p>' :
      '<label class="f" for="ti">Title</label><input class="in" id="ti" maxlength="120" placeholder="e.g. Pest control visit – Rentokil">' +
      '<div class="row"><div><label class="f" for="dn">Date done</label><input class="in" type="date" id="dn" value="' + S.boot.today + '"></div><div><label class="f" for="ex">Renew by (optional)</label><input class="in" type="date" id="ex"></div></div>' +
      '<label class="f" for="no">Notes (optional)</label><textarea class="in" id="no" maxlength="2000" placeholder="Findings, actions, contractor name"></textarea>') +
    '<div class="err" id="er"></div><div class="row" style="margin-top:10px"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Upload</button></div>', sp => {
      $('#cx', sp).onclick = closeSheet;
      $('#ok', sp).onclick = async () => {
        const files = [...$('#fl', sp).files], er = $('#er', sp);
        const title = leafe ? null : $('#ti', sp).value.trim();
        if (!leafe && !title) { er.textContent = 'Add a title.'; return; }
        if (leafe && !files.length) { er.textContent = 'Choose the PDFs.'; return; }
        if (files.some(f => f.size > 25 * 1024 * 1024)) { er.textContent = 'Files must be under 25 MB.'; return; }
        $('#ok', sp).disabled = true;
        const seen = new Set();
        try {
          if (!files.length) files.push(null);
          let i = 0;
          for (const f of files) {
            i++; er.textContent = files.length > 1 ? 'Uploading ' + i + ' of ' + files.length + '…' : 'Uploading…';
            const lm = leafe && f ? leafeMonth(f.name) : null;
            if (lm && seen.has(lm.title)) continue; if (lm) seen.add(lm.title);
            let path = null;
            if (f) {
              const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80);
              path = folder.replace(/[^\w]+/g, '-').toLowerCase() + '/' + crypto.randomUUID() + '-' + safe;
              const { error: e } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
              if (e) throw e;
            }
            const row = { folder, title: lm ? lm.title : (title || (f && f.name) || 'Document'), done_on: lm ? lm.done : (leafe ? null : $('#dn', sp).value || null),
              expires_on: leafe ? null : ($('#ex', sp).value || null), notes: leafe ? null : ($('#no', sp).value.trim() || null),
              file_path: path, file_name: f && f.name, mime: f && f.type, size: f && f.size, by_name: S.boot.me.name };
            const { error: e2 } = await sb.from('chk_docs').insert(row); if (e2) throw e2;
          }
          closeSheet(); toast('Uploaded'); viewFolder(folder);
        } catch (e) { er.textContent = errMsg(e); $('#ok', sp).disabled = false; }
      };
    });
}

// ---------- manager: setup ----------
async function viewSetup(which) {
  app.innerHTML = shell('Setup', '<div class="mut">Loading…</div>', 'setup', { wide: true });
  const [lr, ur, sr] = await Promise.all([sb.from('chk_lists').select('*').order('sort'), sb.from('chk_units').select('*').order('sort'), sb.from('chk_settings').select('*').eq('id', 1).single()]);
  if (lr.error || ur.error || sr.error) throw (lr.error || ur.error || sr.error);
  const lists = lr.data, units = ur.data, set = sr.data.data;
  const areas = [...new Set(units.map(u => u.area))];
  const body = '<div class="hello">Setup</div><p class="mut">Change checklists, fridges and safe temperatures. Staff see changes next time they open the app. Staff PINs are set in the rota manager.</p>' +
    '<div class="chips"><button class="chip ' + (which !== 'units' && which !== 'limits' ? 'on' : '') + '" data-go="#/setup">Checklists</button><button class="chip ' + (which === 'units' ? 'on' : '') + '" data-go="#/setup/units">Fridges &amp; freezers</button><button class="chip ' + (which === 'limits' ? 'on' : '') + '" data-go="#/setup/limits">Temperatures</button></div>' +
    (which === 'units' ? '<div id="ul">' + units.map(u => unitRow(u, areas)).join('') + '</div><button class="btn ghost" id="addu">+ Add fridge or freezer</button>'
      : which === 'limits' ? limitsForm(set)
        : '<button class="btn ghost" id="addl" style="margin:8px 0 14px">+ New checklist</button>' + ['opening', 'closing', 'daily', 'weekly', 'monthly'].map(k => '<h2>' + KIND_LABEL[k] + '</h2>' +
          lists.filter(l => l.kind === k).map(l => '<button class="card ' + (l.active ? '' : 'done') + '" data-edit="' + l.id + '" style="margin-bottom:8px"><div class="t"><b>' + esc(l.name) + (l.active ? '' : ' (hidden)') + '</b><span>' + esc(l.area) + ' · ' + l.items.length + ' checks' + (l.temps_area ? ' · temps: ' + esc(l.temps_area) : '') + '</span></div><span class="pill none">Edit</span></button>').join('')).join(''));
  app.innerHTML = shell('Setup', body, 'setup', { wide: true });
  if (which === 'units') {
    $('#addu').onclick = async () => { const { error } = await sb.from('chk_units').insert({ name: 'New fridge', area: areas[0] || 'Kitchen', kind: 'fridge', sort: units.length }); if (error) return toast(errMsg(error)); viewSetup('units'); };
    $$('.ed[data-u]').forEach(el => {
      $('[data-save]', el).onclick = async () => {
        const row = { name: $('[name=n]', el).value.trim(), area: $('[name=a]', el).value.trim() || 'Kitchen', kind: $('[name=k]', el).value, active: $('[name=on]', el).checked };
        if (!row.name) return toast('Give it a name');
        const { error } = await sb.from('chk_units').update(row).eq('id', el.dataset.u); if (error) return toast(errMsg(error)); toast('Saved'); await refresh();
      };
    });
  } else if (which === 'limits') {
    $('#savel').onclick = async () => {
      const d = Object.assign({}, set); let bad = false;
      $$('[data-k]').forEach(i => { const v = num(i.value); if (v == null) bad = true; else d[i.dataset.k] = v; });
      if (bad) return toast('Fill in every temperature');
      const { error } = await sb.from('chk_settings').update({ data: d, updated_at: new Date().toISOString() }).eq('id', 1); if (error) return toast(errMsg(error));
      await refresh(); toast('Saved');
    };
  } else {
    $('#addl').onclick = () => editList(null, areas);
    $$('[data-edit]').forEach(b => b.onclick = () => editList(lists.find(l => l.id === b.dataset.edit), areas));
  }
}
function unitRow(u, areas) {
  return '<div class="ed" data-u="' + u.id + '"><div class="row" style="flex-wrap:wrap"><div style="flex:2 1 180px"><label class="f">Name</label><input class="in" name="n" value="' + esc(u.name) + '" maxlength="60"></div>' +
    '<div style="flex:1 1 120px"><label class="f">Area</label><input class="in" name="a" value="' + esc(u.area) + '" list="areas" maxlength="40"></div>' +
    '<div style="flex:1 1 110px"><label class="f">Type</label><select class="in" name="k"><option value="fridge"' + (u.kind === 'fridge' ? ' selected' : '') + '>Fridge</option><option value="freezer"' + (u.kind === 'freezer' ? ' selected' : '') + '>Freezer</option></select></div></div>' +
    '<div class="row" style="align-items:center;margin-top:8px"><label class="sw"><input type="checkbox" name="on"' + (u.active ? ' checked' : '') + '> In use</label><div style="flex:0 0 auto"><button class="btn sm" data-save>Save</button></div></div>' +
    '<datalist id="areas">' + areas.map(a => '<option value="' + esc(a) + '">').join('') + '</datalist></div>';
}
function limitsForm(s) {
  const f = (k, lab) => '<div><label class="f">' + lab + '</label><input class="in" data-k="' + k + '" inputmode="decimal" value="' + esc(s[k]) + '"></div>';
  return '<div class="row" style="flex-wrap:wrap">' + f('fridgeMax', 'Fridges at or below (°C)') + f('freezerMax', 'Freezers at or below (°C)') + '</div>' +
    '<div class="row" style="flex-wrap:wrap">' + f('cookMin', 'Cooking at least (°C)') + f('reheatMin', 'Reheating at least (°C)') + '</div>' +
    '<div class="row" style="flex-wrap:wrap">' + f('hotholdMin', 'Hot holding at least (°C)') + f('washRinseMin', 'Dishwasher rinse at least (°C)') + '</div>' +
    '<div class="row" style="flex-wrap:wrap">' + f('coolTarget', 'Cooled to (°C)') + f('coolMins', 'Cooling within (minutes)') + '</div>' +
    '<div class="row" style="flex-wrap:wrap">' + f('chilledMax', 'Chilled deliveries at or below (°C)') + f('frozenMax', 'Frozen deliveries at or below (°C)') + '</div>' +
    '<div class="bar"><button class="btn" id="savel">Save temperatures</button></div>';
}
function editList(l, areas) {
  const isNew = !l; l = l || { name: '', kind: 'daily', area: 'Kitchen', items: [], temps_area: null, active: true };
  let items = l.items.map(i => ({ ...i }));
  const draw = () => '<h3>' + (isNew ? 'New checklist' : 'Edit checklist') + '</h3>' +
    '<label class="f">Name</label><input class="in" id="ln" maxlength="80" value="' + esc(l.name) + '">' +
    '<div class="row"><div><label class="f">How often</label><select class="in" id="lk">' + Object.keys(KIND_LABEL).map(k => '<option value="' + k + '"' + (l.kind === k ? ' selected' : '') + '>' + KIND_LABEL[k] + '</option>').join('') + '</select></div>' +
    '<div><label class="f">Area</label><input class="in" id="la" maxlength="40" value="' + esc(l.area) + '"></div></div>' +
    '<label class="f">Also take fridge temps for</label><select class="in" id="lt"><option value="">No temperatures</option>' + areas.map(a => '<option' + (l.temps_area === a ? ' selected' : '') + '>' + esc(a) + '</option>').join('') + '</select>' +
    '<label class="f">Checks</label><div class="ed" id="its">' + items.map((it, i) => '<div class="it" data-i="' + i + '"><input class="in" value="' + esc(it.text) + '" maxlength="300"><button data-up title="Move up">↑</button><button data-dn title="Move down">↓</button><button data-rm title="Remove">✕</button></div>').join('') +
    '<button class="lnk" id="addi">+ Add a check</button></div>' +
    '<label class="sw"><input type="checkbox" id="lon"' + (l.active ? ' checked' : '') + '> Show to staff</label>' +
    '<div class="row" style="margin-top:12px"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Save</button></div>';
  const sync = sp => $$('.it', sp).forEach(r => { items[+r.dataset.i].text = $('input', r).value; });
  const render = () => openSheet(draw(), sp => {
    const keep = () => { l.name = $('#ln', sp).value; l.kind = $('#lk', sp).value; l.area = $('#la', sp).value; l.temps_area = $('#lt', sp).value || null; l.active = $('#lon', sp).checked; sync(sp); };
    $('#cx', sp).onclick = closeSheet;
    $('#addi', sp).onclick = () => { keep(); items.push({ id: crypto.randomUUID().replace(/-/g, '').slice(0, 10), text: '' }); render(); setTimeout(() => { const ins = $$('#its .it input', sheet); ins[ins.length - 1].focus(); }, 30); };
    $$('.it', sp).forEach(r => { const i = +r.dataset.i;
      $('[data-up]', r).onclick = () => { keep(); if (i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); };
      $('[data-dn]', r).onclick = () => { keep(); if (i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); };
      $('[data-rm]', r).onclick = () => { keep(); items.splice(i, 1); render(); };
    });
    $('#ok', sp).onclick = async () => {
      keep(); items = items.filter(i => i.text.trim()).map(i => ({ id: i.id, text: i.text.trim() }));
      if (!l.name.trim()) return toast('Give the checklist a name'); if (!items.length) return toast('Add at least one check');
      const row = { name: l.name.trim(), kind: l.kind, area: l.area.trim() || 'Kitchen', temps_area: l.temps_area, items, active: l.active, updated_at: new Date().toISOString() };
      const q = isNew ? sb.from('chk_lists').insert(Object.assign(row, { sort: 100 })) : sb.from('chk_lists').update(row).eq('id', l.id);
      const { error } = await q; if (error) return toast(errMsg(error));
      closeSheet(); await refresh(); toast('Saved'); viewSetup();
    };
  });
  render();
}

// keep data fresh when the app comes back to the front (e.g. phone unlocked)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.mode) return;
  const h = location.hash;
  if (h === '' || h === '#/' || h === '#/today-log') { try { await refresh(); route(); } catch (e) { } }
});

start().catch(e => { console.error(e); showNames(); });
})();
