// ═══════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════
console.log('[AirportOps] app.js loaded');
const DB_KEY = 'airportOpsV2';
const SESSION_KEY = 'airportOpsSessionUserId';
let db = load();
/** @type {{id:number,username:string,displayName:string,role:string,leaderId:number|null}|null} */
let currentUser = null;
let appShellWired = false;
let currentOrderPageId = null;
/** True while the app updates the URL hash so `hashchange` does not double-apply routes. */
let hashSyncFromApp = false;
let routeLoaderShowTid = null;
let routeLoaderGeneration = 0;
const ROUTE_LOADER_SHOW_DELAY_MS = 165;

function markAuthBootComplete(){
  document.documentElement.setAttribute('data-auth-ready','yes');
  const boot = document.getElementById('app-boot-overlay');
  if(boot){
    boot.setAttribute('aria-busy','false');
    boot.setAttribute('aria-hidden','true');
  }
}

function setAuthSubmitBusy(busy){
  const btn = document.getElementById('auth-submit');
  const fm = document.getElementById('auth-form');
  if(btn){
    btn.disabled = !!busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  if(fm) fm.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showRouteLoader(){
  if(!currentUser || document.body.classList.contains('auth-locked')) return;
  if(document.documentElement.getAttribute('data-auth-ready') !== 'yes') return;
  const el = document.getElementById('content-route-loader');
  if(!el) return;
  routeLoaderGeneration++;
  const myGen = routeLoaderGeneration;
  if(routeLoaderShowTid){ clearTimeout(routeLoaderShowTid); routeLoaderShowTid = null; }
  el.classList.remove('is-visible');
  el.setAttribute('aria-hidden','true');
  routeLoaderShowTid = setTimeout(()=>{
    routeLoaderShowTid = null;
    if(myGen !== routeLoaderGeneration) return;
    el.setAttribute('aria-hidden','false');
    requestAnimationFrame(()=>{
      if(myGen !== routeLoaderGeneration) return;
      el.classList.add('is-visible');
    });
  }, ROUTE_LOADER_SHOW_DELAY_MS);
}

function scheduleRouteLoaderHide(){
  const el = document.getElementById('content-route-loader');
  if(!el) return;
  if(routeLoaderShowTid){
    clearTimeout(routeLoaderShowTid);
    routeLoaderShowTid = null;
  }
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      el.classList.remove('is-visible');
      el.setAttribute('aria-hidden','true');
    });
  });
}

let ordersListPage = 1;
let ordersPerPage = 15;
let leadersListPage = 1;
let leadersPerPage = 15;
let todayListPage = 1;
let todayPerPage = 15;
let servicesListPage = 1;
let servicesPerPage = 15;
let repSvcPage = 1;
let repSvcPerPage = 15;
let repCatPage = 1;
let repCatPerPage = 15;
let repExpPage = 1;
let repExpPerPage = 15;
let repLeadPage = 1;
let repLeadPerPage = 15;
let usersListPage = 1;
let usersPerPage = 15;
let ordersQuickFilter = '';
/** @type {Set<number>} */
let ordersBulkSelected = new Set();
const ORDER_QF_LABELS = { today:'Today', vip:'VIP', pending:'Pending', completed:'Completed' };
let dashClockInterval = null;

const UI_SEARCH_DEBOUNCE_MS = 240;
let _debOrdersTimer = null;
let _debLeadersTimer = null;
let _debServicesTimer = null;
let _debUsersTimer = null;
function flushSearchDebounceTimers(){
  clearTimeout(_debOrdersTimer);
  _debOrdersTimer = null;
  clearTimeout(_debLeadersTimer);
  _debLeadersTimer = null;
  clearTimeout(_debServicesTimer);
  _debServicesTimer = null;
  clearTimeout(_debUsersTimer);
  _debUsersTimer = null;
}
function scheduleRenderOrders(){
  clearTimeout(_debOrdersTimer);
  _debOrdersTimer = setTimeout(()=>{
    _debOrdersTimer = null;
    renderOrders(false);
  }, UI_SEARCH_DEBOUNCE_MS);
}
function scheduleRenderLeaders(){
  clearTimeout(_debLeadersTimer);
  _debLeadersTimer = setTimeout(()=>{
    _debLeadersTimer = null;
    renderLeaders(false);
  }, UI_SEARCH_DEBOUNCE_MS);
}
function scheduleRenderServicesSearch(){
  clearTimeout(_debServicesTimer);
  _debServicesTimer = setTimeout(()=>{
    _debServicesTimer = null;
    renderServices(true);
  }, UI_SEARCH_DEBOUNCE_MS);
}
function scheduleRenderUsers(){
  clearTimeout(_debUsersTimer);
  _debUsersTimer = setTimeout(()=>{
    _debUsersTimer = null;
    renderUsers(false);
  }, UI_SEARCH_DEBOUNCE_MS);
}

// ═══════════════════════════════════════
// FLIGHT DIRECTORY (simple offline lookup)
// ═══════════════════════════════════════
// Add/extend flights here. Keys are normalized flight numbers (e.g., "MS777").
const FLIGHT_DIRECTORY = {
  MS777: { time: '08:30', route: 'Cairo → Dubai' },
  EK512: { time: '14:00', route: 'Cairo → Dubai' },
  LH580: { time: '09:15', route: 'Frankfurt → Cairo' },
  MS308: { time: '11:00', route: 'Cairo → Beirut' },
};

function normalizeFlightNo(f){
  return (f || '')
    .toUpperCase()
    .replace(/\s+/g,'')
    .replace(/[^A-Z0-9]/g,'');
}

function getFlightDetails(flightNo){
  const key = normalizeFlightNo(flightNo);
  return FLIGHT_DIRECTORY[key] || null;
}

function applyFlightAutofill(){
  const flightEl = document.getElementById('o-flight');
  const timeEl = document.getElementById('o-time');
  const destEl = document.getElementById('o-dest');
  if(!flightEl || !timeEl || !destEl) return;

  const details = getFlightDetails(flightEl.value);
  if(!details) return;

  if(!timeEl.value) timeEl.value = details.time;
  if(!destEl.value) destEl.value = details.route;
}

let flightAutofillTimer = null;
function onFlightInput(){
  if(flightAutofillTimer) clearTimeout(flightAutofillTimer);
  flightAutofillTimer = setTimeout(applyFlightAutofill, 180);
}

function migrateService(s){
  if(!s||typeof s!=='object') return s;
  const sid = parseInt(s.id, 10);
  return {
    id: Number.isFinite(sid) && sid > 0 ? sid : 0,
    name:s.name||'',
    icon:s.icon||'✈️',
    color:s.color||'green',
    description:s.description??'',
    airport:s.airport??'',
    includes:s.includes??'',
    cost:s.cost??'',
    currency:s.currency??'EGP',
  };
}

function ensureLeaderShape(l){
  if(!l || typeof l !== 'object') return null;
  const id = parseInt(l.id, 10);
  if(!Number.isFinite(id) || id < 1) return null;
  const st = ['Available', 'Busy', 'Off'];
  return {
    id,
    name: String(l.name || '').trim() || 'Guide',
    phone: String(l.phone || '').trim(),
    spec: String(l.spec || '').trim(),
    status: st.includes(l.status) ? l.status : 'Available',
    notes: String(l.notes || '').trim(),
    availabilityMode: l.availabilityMode === 'manual' ? 'manual' : 'auto',
  };
}

/** Offline-only password hash (not for high-security deployments). */
function simplePwdHash(password, salt){
  const s = String(salt) + '\n' + String(password) + '\nairportOpsV2';
  let h = 5381;
  for(let p = 0; p < 4; p++){
    for(let i = 0; i < s.length; i++){
      h = ((h << 5) + h) + s.charCodeAt(i) + (p * 17) | 0;
    }
  }
  let x = (h >>> 0).toString(16) + '_' + s.split('').reverse().join('').slice(0, 80);
  for(let r = 0; r < 800; r++){
    let t = 0;
    for(let i = 0; i < x.length; i++) t = (Math.imul(31, t) + x.charCodeAt(i)) | 0;
    x = (t >>> 0).toString(16).padStart(8, '0') + x.slice(0, 100);
  }
  return x.slice(0, 160);
}

function randomSalt(){
  try{
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch{
    return String(Math.random()).slice(2) + String(Date.now());
  }
}

/** Same rules as stored usernames: lowercase, a–z / 0–9 / . _ - only, max 64 chars. */
function normalizeUsername(raw){
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64);
}

function ensureUserShape(u){
  if(!u || typeof u !== 'object') return null;
  const id = parseInt(u.id, 10);
  if(!Number.isFinite(id) || id < 1) return null;
  const role = ['admin', 'supervisor', 'leader'].includes(u.role) ? u.role : 'leader';
  const lid = u.leaderId != null && u.leaderId !== '' ? parseInt(u.leaderId, 10) : null;
  const uname = normalizeUsername(u.username);
  if(!uname) return null;
  return {
    id,
    username: uname,
    displayName: String(u.displayName || uname).trim().slice(0, 120) || uname,
    role,
    salt: String(u.salt || ''),
    passwordHash: String(u.passwordHash || ''),
    leaderId: role === 'leader' ? (Number.isFinite(lid) ? lid : null) : null,
    active: u.active !== false,
    createdAt: u.createdAt || new Date().toISOString(),
  };
}

function normalizeVehicleRow(v){
  const own = String(v && v.ownership || '').toLowerCase();
  const ownership = own === 'client' ? 'client' : 'company';
  return {
    vehicleType: String(v && v.vehicleType || '').trim(),
    ownership,
    driverName: String(v && v.driverName || '').trim(),
    driverPhone: String(v && v.driverPhone || '').trim(),
  };
}

function summarizeVehiclesFromRows(vehicles){
  const rows = (vehicles || []).filter(x => x && (x.vehicleType || x.driverName || x.driverPhone));
  if(!rows.length) return '';
  return rows.map(v => {
    const tag = v.ownership === 'client' ? 'Cl' : 'Co';
    const type = v.vehicleType || '—';
    const d = [v.driverName, v.driverPhone].filter(Boolean).join(' · ');
    return `${type} (${tag}) ${d}`;
  }).join(' | ');
}

function ensureOrderVehicles(o){
  let veh = Array.isArray(o.vehicles) ? o.vehicles.map(normalizeVehicleRow) : [];
  veh = veh.filter(x => x.vehicleType || x.driverName || x.driverPhone);
  o.driver = String(o.driver || '').trim();
  if(!veh.length && o.driver){
    veh = [{ vehicleType: '', ownership: 'company', driverName: o.driver, driverPhone: '' }];
  }
  o.vehicles = veh;
  if(veh.length) o.driver = summarizeVehiclesFromRows(veh);
}

function orderTransportComplete(o){
  const vs = Array.isArray(o.vehicles) ? o.vehicles : [];
  if(vs.length){
    return vs.every(v => String(v.driverName || '').trim() && String(v.driverPhone || '').trim());
  }
  return String(o.driver || '').trim().length > 0;
}

function ensureOrderFields(o){
  if(!o || typeof o !== 'object') return o;
  o.type = String(o.type || 'Arrival').trim() || 'Arrival';
  o.flight = String(o.flight || '').trim();
  o.date = String(o.date || todayStr()).trim();
  o.time = String(o.time || '12:00').trim();
  o.flightType = String(o.flightType || 'Arrival').trim() || 'Arrival';
  o.dest = String(o.dest || '').trim();
  o.adults = parseInt(o.adults, 10) || 0;
  o.children = parseInt(o.children, 10) || 0;
  const nc = o.children;
  if(!Array.isArray(o.childAges)) o.childAges = [];
  while(o.childAges.length < nc) o.childAges.push(0);
  o.childAges = o.childAges.slice(0, Math.max(nc, 0));
  const lid = o.leaderId != null && o.leaderId !== '' ? parseInt(o.leaderId, 10) : null;
  o.leaderId = Number.isFinite(lid) ? lid : null;
  o.rep = String(o.rep || '').trim();
  ensureOrderVehicles(o);
  const okStatus = ['Scheduled', 'In progress', 'Completed', 'Cancelled'];
  o.status = okStatus.includes(o.status) ? o.status : 'Scheduled';
  o.ref = String(o.ref || '').trim();
  o.notes = String(o.notes || '').trim();
  if(!Array.isArray(o.files)) o.files = [];
  if(!Array.isArray(o.expenses)) o.expenses = [];
  else o.expenses = o.expenses.map((ex, i) => normalizeExpenseLine(ex, i + 1)).filter(Boolean);
  if(!o.createdAt) o.createdAt = new Date().toISOString();
  return o;
}

function sanitizeOrderLeaderRefOnOrder(o, leaders){
  const L = Array.isArray(leaders) ? leaders : [];
  if(o.leaderId != null && !L.some(x => x.id === o.leaderId)) o.leaderId = null;
}

function recomputeNextIds(d){
  const maxO = (d.orders || []).reduce((m, o) => Math.max(m, parseInt(o.id, 10) || 0), 0);
  const maxL = (d.leaders || []).reduce((m, l) => Math.max(m, parseInt(l.id, 10) || 0), 0);
  const maxS = (d.services || []).reduce((m, s) => Math.max(m, parseInt(s.id, 10) || 0), 0);
  const maxU = (d.users || []).reduce((m, u) => Math.max(m, parseInt(u.id, 10) || 0), 0);
  const no = parseInt(d.nextOrderId, 10);
  const nl = parseInt(d.nextLeaderId, 10);
  const ns = parseInt(d.nextServiceId, 10);
  const nu = parseInt(d.nextUserId, 10);
  d.nextOrderId = Math.max(Number.isFinite(no) ? no : 0, maxO + 1) || 1;
  d.nextLeaderId = Math.max(Number.isFinite(nl) ? nl : 0, maxL + 1) || 1;
  d.nextServiceId = Math.max(Number.isFinite(ns) ? ns : 0, maxS + 1) || 1;
  d.nextUserId = Math.max(Number.isFinite(nu) ? nu : 0, maxU + 1) || 1;
}

/**
 * If there is no active admin account, adds exactly one: username `admin`, password `admin123`
 * (hashed with a random salt). Safe to call on every load/migration; never removes or replaces users.
 */
function ensureDefaultAdminAccount(d){
  if(!d || typeof d !== 'object' || !Array.isArray(d.users)) return;
  const hasAdmin = d.users.some(u => u.role === 'admin' && u.active !== false);
  if(hasAdmin) return;
  const salt = randomSalt();
  const maxId = d.users.length ? d.users.reduce((m, u) => Math.max(m, u.id || 0), 0) : 0;
  const id = maxId + 1;
  d.users.push({
    id,
    username: 'admin',
    displayName: 'Administrator',
    role: 'admin',
    salt,
    passwordHash: simplePwdHash('admin123', salt),
    leaderId: null,
    active: true,
    createdAt: new Date().toISOString(),
  });
}

function applyMigrationsToDb(d){
  if(!d || typeof d !== 'object') return applyMigrationsToDb(defaultDB());
  if(!Array.isArray(d.services)) d.services = [];
  d.services = d.services.filter(s => s && typeof s === 'object').map(migrateService).filter(s => s && s.id > 0);
  if(!d.services.length){
    d.services = defaultDB().services.map(migrateService);
  }
  if(!Array.isArray(d.leaders)) d.leaders = [];
  d.leaders = d.leaders.map(ensureLeaderShape).filter(Boolean);
  if(!Array.isArray(d.orders)) d.orders = [];
  d.orders = d.orders.filter(o => o && typeof o === 'object');
  let autoOrderId = d.orders.reduce((m, o) => Math.max(m, parseInt(o.id, 10) || 0), 0);
  d.orders.forEach(o => {
    const oid = parseInt(o.id, 10);
    if(!Number.isFinite(oid) || oid < 1) o.id = ++autoOrderId;
    ensureOrderFields(o);
    migrateOrderNationality(o);
    sanitizeOrderLeaderRefOnOrder(o, d.leaders);
  });
  if(!Array.isArray(d.users)) d.users = [];
  d.users = d.users.map(ensureUserShape).filter(Boolean);
  const seen = new Set();
  d.users = d.users.filter(u => {
    if(seen.has(u.username)){ return false; }
    seen.add(u.username);
    return true;
  });
  ensureDefaultAdminAccount(d);
  recomputeNextIds(d);
  return d;
}

function load(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(raw == null || raw === ''){
      return applyMigrationsToDb(defaultDB());
    }
    const d = JSON.parse(raw);
    return applyMigrationsToDb(d);
  } catch{
    return applyMigrationsToDb(defaultDB());
  }
}

function save(){
  try{
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch(e){
    const name = e && e.name;
    if(name === 'QuotaExceededError'){
      toast('Browser storage is full. Export a backup, then remove old orders or clear site data for this app.', 'err');
    } else {
      toast('Could not save: ' + (e && e.message ? e.message : 'unknown error'), 'err');
    }
  }
}

// ═══════════════════════════════════════
// AUTH & RBAC
// ═══════════════════════════════════════
function isTourLeaderRole(){
  return !!(currentUser && currentUser.role === 'leader');
}
function canManageUsers(){
  return !!(currentUser && currentUser.role === 'admin');
}
function canManageLeadersAndServices(){
  return !!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'));
}
function canExportImportBackup(){
  return !!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'));
}

function authOrdersScope(){
  if(!currentUser) return [];
  if(currentUser.role === 'leader'){
    const lid = currentUser.leaderId;
    if(lid == null) return [];
    return db.orders.filter(o => o.leaderId === lid);
  }
  return db.orders;
}

function pageAllowedForRole(page){
  if(page === 'order-detail') return true;
  if(page === 'users') return canManageUsers();
  if(['leaders', 'services', 'reports'].includes(page)) return canManageLeadersAndServices();
  return true;
}

function setAuthGateLocked(locked){
  document.body.classList.toggle('auth-locked', locked);
  const gate = document.getElementById('auth-gate');
  if(gate) gate.setAttribute('aria-hidden', locked ? 'false' : 'true');
}

/** Keeps `<html data-auth-hydrate>` aligned with `sessionStorage` (`airportOpsSessionUserId`). */
function syncDocumentAuthHydrate(){
  try{
    const raw = sessionStorage.getItem(SESSION_KEY);
    const sid = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
    document.documentElement.setAttribute(
      'data-auth-hydrate',
      Number.isFinite(sid) ? 'authenticated' : 'guest'
    );
  } catch(e){
    document.documentElement.setAttribute('data-auth-hydrate', 'guest');
  }
}

function applyRoleToUi(){
  const role = currentUser ? currentUser.role : '';
  document.body.setAttribute('data-user-role', role || '');
  const av = document.getElementById('toolbar-avatar');
  const nm = document.getElementById('toolbar-user-name');
  const rl = document.getElementById('toolbar-user-role');
  const loginEl = document.getElementById('toolbar-user-login');
  if(nm) nm.textContent = currentUser ? currentUser.displayName : '—';
  if(loginEl) loginEl.textContent = currentUser && currentUser.username ? '@' + currentUser.username : '';
  if(rl){
    const labels = { admin: 'Admin', supervisor: 'Supervisor', leader: 'Tour leader' };
    rl.textContent = currentUser ? (labels[currentUser.role] || currentUser.role) : '—';
  }
  if(av){
    const ch = (currentUser && currentUser.displayName) ? currentUser.displayName.trim().charAt(0) : '?';
    av.textContent = ch.toUpperCase();
  }
  const accSum = document.querySelector('.navbar-account-trigger');
  if(accSum){
    accSum.setAttribute('title', currentUser ? `${currentUser.displayName} — Account` : 'Account');
    accSum.setAttribute('aria-label', currentUser ? `Account menu (${currentUser.displayName})` : 'Account menu');
  }
  const backupBlock = document.getElementById('navbar-backup-block');
  if(backupBlock) backupBlock.style.display = canExportImportBackup() ? '' : 'none';
}

function sessionUserIdFromStorage(){
  const raw = sessionStorage.getItem(SESSION_KEY);
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

function tryRestoreSession(){
  currentUser = null;
  const sid = sessionUserIdFromStorage();
  if(sid == null) return false;
  const u = db.users.find(x => x.id === sid && x.active !== false);
  if(!u || !u.passwordHash || !u.salt){
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }
  if(u.role === 'leader' && (u.leaderId == null || !db.leaders.some(l => l.id === u.leaderId))){
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }
  currentUser = {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    leaderId: u.leaderId != null ? u.leaderId : null,
  };
  return true;
}

function clearAuthForm(){
  const u = document.getElementById('auth-username');
  const p = document.getElementById('auth-password');
  if(u) u.value = '';
  if(p) p.value = '';
}

function clearAuthInlineError(){
  const el = document.getElementById('auth-inline-error');
  if(el) el.textContent = '';
}

function showAuthInlineError(msg){
  const el = document.getElementById('auth-inline-error');
  if(el) el.textContent = msg;
  toast(msg, 'err');
}

function performLogin(){
  clearAuthInlineError();
  const userEl = document.getElementById('auth-username');
  const passEl = document.getElementById('auth-password');
  const username = normalizeUsername(userEl && userEl.value);
  const password = passEl ? passEl.value : '';
  console.log('[AirportOps] username/password values read', { username: username || '(empty)', passwordLen: password.length });
  if(!username || !password){
    showAuthInlineError('Enter username and password.');
    return;
  }
  const u = db.users.find(x => x.username === username);
  if(!u){
    showAuthInlineError('Unknown username. Use the same login name as in Users (letters, numbers, . _ - only).');
    return;
  }
  if(u.active === false){
    showAuthInlineError('This account is inactive. Ask an admin to activate it.');
    return;
  }
  if(!u.salt || !u.passwordHash){
    showAuthInlineError('This account has no password set. Ask an admin to set a password.');
    return;
  }
  if(simplePwdHash(password, u.salt) !== u.passwordHash){
    showAuthInlineError('Incorrect password. Try again.');
    return;
  }
  if(u.role === 'leader' && (u.leaderId == null || !db.leaders.some(l => l.id === u.leaderId))){
    showAuthInlineError('This tour leader login is not linked to a roster profile. Ask an admin.');
    return;
  }
  setAuthSubmitBusy(true);
  try{
    sessionStorage.setItem(SESSION_KEY, String(u.id));
    currentUser = {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      leaderId: u.leaderId != null ? u.leaderId : null,
    };
    clearAuthForm();
    clearAuthInlineError();
    startLoggedInApp({ fromLogin: true });
  } finally {
    setAuthSubmitBusy(false);
  }
}

function submitAuthLogin(ev){
  if(ev && typeof ev.preventDefault === 'function'){
    ev.preventDefault();
  }
  console.log('[AirportOps] login submit triggered');
  performLogin();
}

function logout(){
  sessionStorage.removeItem(SESSION_KEY);
  syncDocumentAuthHydrate();
  currentUser = null;
  appShellWired = false;
  clearOrderHash();
  currentOrderPageId = null;
  closeNavbarAccountMenu();
  if(routeLoaderShowTid){ clearTimeout(routeLoaderShowTid); routeLoaderShowTid = null; }
  const crl = document.getElementById('content-route-loader');
  if(crl){
    crl.classList.remove('is-visible');
    crl.setAttribute('aria-hidden','true');
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const dash = document.getElementById('p-dash');
  if(dash) dash.classList.add('active');
  document.querySelectorAll('#main-nav .nav-btn[data-nav]').forEach(b => b.classList.remove('active'));
  const nb = document.querySelector('#main-nav .nav-btn[data-nav="dash"]');
  if(nb) nb.classList.add('active');
  applyRoleToUi();
  setAuthGateLocked(true);
  const userEl = document.getElementById('auth-username');
  if(userEl) queueMicrotask(() => { try{ userEl.focus(); }catch(e){} });
  toast('Signed out', 'info');
}

let editingUserId = null;

function syncUserFormLeaderField(){
  const role = document.getElementById('u-role')?.value || 'admin';
  const wrap = document.getElementById('u-leader-wrap');
  if(wrap) wrap.style.display = role === 'leader' ? '' : 'none';
}

function populateUserLeaderSelect(){
  const sel = document.getElementById('u-leader');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select tour leader —</option>'
    + db.leaders.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  if(prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function openUserModal(){
  if(!canManageUsers()){ toast('Only admins manage user accounts', 'err'); return; }
  editingUserId = null;
  document.getElementById('u-username').value = '';
  document.getElementById('u-display').value = '';
  document.getElementById('u-role').value = 'supervisor';
  document.getElementById('u-password').value = '';
  document.getElementById('u-password-hint').textContent = '(required for new users)';
  document.getElementById('u-active').checked = true;
  populateUserLeaderSelect();
  syncUserFormLeaderField();
  document.getElementById('user-modal-title').textContent = '👤 Add user';
  document.getElementById('u-username').readOnly = false;
  openModal('user-overlay');
}

function editUser(id){
  if(!canManageUsers()) return;
  const u = db.users.find(x => x.id === id);
  if(!u) return;
  editingUserId = id;
  document.getElementById('u-username').value = u.username;
  document.getElementById('u-username').readOnly = true;
  document.getElementById('u-display').value = u.displayName;
  document.getElementById('u-role').value = u.role;
  document.getElementById('u-password').value = '';
  document.getElementById('u-password-hint').textContent = '(leave blank to keep current password)';
  document.getElementById('u-active').checked = u.active !== false;
  populateUserLeaderSelect();
  if(u.leaderId) document.getElementById('u-leader').value = String(u.leaderId);
  syncUserFormLeaderField();
  document.getElementById('user-modal-title').textContent = '✏️ Edit user';
  openModal('user-overlay');
}

function saveUser(){
  if(!canManageUsers()) return;
  const displayName = document.getElementById('u-display').value.trim();
  const role = document.getElementById('u-role').value;
  const password = document.getElementById('u-password').value;
  const active = document.getElementById('u-active').checked;
  const leaderPick = parseInt(document.getElementById('u-leader').value, 10) || null;
  if(!displayName){ toast('Display name is required', 'err'); return; }
  if(role === 'leader'){
    if(!leaderPick || !db.leaders.some(l => l.id === leaderPick)){
      toast('Tour leader role requires a linked roster profile', 'err');
      return;
    }
  }
  if(editingUserId){
    const u = db.users.find(x => x.id === editingUserId);
    if(!u){ toast('User not found', 'err'); return; }
    const otherAdmin = db.users.filter(x => x.role === 'admin' && x.active !== false && x.id !== u.id);
    if(u.role === 'admin' && (role !== 'admin' || !active) && !otherAdmin.length){
      toast('Keep at least one active admin account', 'err');
      return;
    }
    if(password){
      u.salt = randomSalt();
      u.passwordHash = simplePwdHash(password, u.salt);
    }
    u.displayName = displayName;
    u.role = role;
    u.leaderId = role === 'leader' ? leaderPick : null;
    u.active = active;
    if(u.id === currentUser.id && currentUser){
      currentUser = {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        leaderId: u.leaderId != null ? u.leaderId : null,
      };
      applyRoleToUi();
    }
    toast('User updated', 'ok');
  } else {
    const rawUsername = document.getElementById('u-username').value;
    const username = normalizeUsername(rawUsername);
    if(!username){
      toast('Username must use letters, numbers, dots, underscores, or hyphens only (e.g. john.smith).', 'err');
      return;
    }
    if(db.users.some(x => x.username === username)){ toast('That username is already taken', 'err'); return; }
    if(!password){ toast('Set an initial password for new users', 'err'); return; }
    const salt = randomSalt();
    const nu = {
      id: db.nextUserId++,
      username,
      displayName,
      role,
      salt,
      passwordHash: simplePwdHash(password, salt),
      leaderId: role === 'leader' ? leaderPick : null,
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(nu);
    const authUserEl = document.getElementById('auth-username');
    if(authUserEl) authUserEl.value = username;
    toast(`User created — sign in as "${username}" with the password you set.`, 'ok');
  }
  save();
  closeModal('user-overlay');
  renderUsers(false);
}

function toggleUserActive(id){
  if(!canManageUsers()) return;
  const u = db.users.find(x => x.id === id);
  if(!u) return;
  if(u.id === currentUser.id){
    toast('You cannot deactivate your own session from the list — use another admin account.', 'err');
    return;
  }
  const next = u.active !== false ? false : true;
  if(u.role === 'admin' && next === false){
    const others = db.users.filter(x => x.id !== u.id && x.role === 'admin' && x.active !== false);
    if(!others.length){ toast('Cannot deactivate the last admin', 'err'); return; }
  }
  u.active = next;
  save();
  renderUsers(false);
  toast(next ? 'Account activated' : 'Account deactivated', 'ok');
}

function renderUsers(resetPage){
  if(resetPage) usersListPage = 1;
  const tbody = document.getElementById('users-tbody');
  const pagEl = document.getElementById('users-pagination');
  if(!tbody) return;
  if(!canManageUsers()){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="ei">🔒</div><p>Admins only</p></div></td></tr>`;
    if(pagEl){ pagEl.innerHTML = ''; pagEl.hidden = true; }
    return;
  }
  const q = (document.getElementById('user-search')?.value || '').toLowerCase().trim();
  const list = db.users.filter(u => {
    if(!q) return true;
    return u.username.includes(q) || (u.displayName || '').toLowerCase().includes(q);
  }).slice().sort((a, b) => a.username.localeCompare(b.username));
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / usersPerPage));
  usersListPage = Math.min(Math.max(1, usersListPage), totalPages);

  if(!total){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="ei">👤</div><p>No user accounts</p></div></td></tr>`;
    if(pagEl){ pagEl.innerHTML = ''; pagEl.hidden = true; }
    return;
  }
  const start = (usersListPage - 1) * usersPerPage;
  const pageRows = list.slice(start, start + usersPerPage);
  const from = start + 1;
  const to = start + pageRows.length;
  if(pagEl){
    pagEl.innerHTML = buildPaginationHTML('users', from, to, total, usersListPage, totalPages, usersPerPage);
    pagEl.hidden = false;
  }
  const roleLab = { admin: 'Admin', supervisor: 'Supervisor', leader: 'Tour leader' };
  tbody.innerHTML = pageRows.map(u => {
    const leader = u.leaderId ? db.leaders.find(l => l.id === u.leaderId) : null;
    const link = u.role === 'leader'
      ? (leader ? escapeHtml(leader.name) : '<span style="color:var(--red)">Missing profile</span>')
      : '—';
    const st = u.active !== false ? '<span class="badge b-green">Active</span>' : '<span class="badge b-gray">Inactive</span>';
    const self = currentUser && u.id === currentUser.id;
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px;">${escapeHtml(u.username)}${self ? ' <span style="color:var(--muted2)">(you)</span>' : ''}</td>
      <td>${escapeHtml(u.displayName)}</td>
      <td>${roleLab[u.role] || u.role}</td>
      <td>${link}</td>
      <td>${st}</td>
      <td><div class="ibtn-row">
        <div class="ibtn" onclick="editUser(${u.id})" title="Edit">✏️</div>
        <div class="ibtn" onclick="toggleUserActive(${u.id})" title="${u.active !== false ? 'Deactivate' : 'Activate'}">${u.active !== false ? '⏸️' : '▶️'}</div>
      </div></td>
    </tr>`;
  }).join('');
}

function usersPagRelative(delta){
  usersListPage += delta;
  renderUsers(false);
}
function usersGoToPage(n){
  usersListPage = n;
  renderUsers(false);
}
function usersSetPerPage(v){
  usersPerPage = parseInt(v, 10) || 15;
  usersListPage = 1;
  renderUsers(false);
}

function formatNationalitySummaryFromRows(rows){
  if(!Array.isArray(rows)) return '';
  return rows
    .filter(r=>String(r.nationality||'').trim())
    .map(r=>{
      const n=String(r.nationality).trim();
      const a=parseInt(r.adults)||0;
      const c=parseInt(r.children)||0;
      return n+' ('+a+'A+'+c+'C)';
    })
    .join('; ');
}

function getNationalityBreakdown(o){
  if(!o) return [];
  if(Array.isArray(o.nationalityBreakdown) && o.nationalityBreakdown.length)
    return o.nationalityBreakdown.map(x=>({
      nationality:String(x.nationality||'').trim(),
      adults:parseInt(x.adults)||0,
      children:parseInt(x.children)||0
    })).filter(x=>x.nationality);
  const leg=(o.nat||'').trim();
  if(leg) return [{ nationality:leg, adults:parseInt(o.adults)||0, children:parseInt(o.children)||0 }];
  return [];
}

function migrateOrderNationality(o){
  if(!o||typeof o!=='object') return o;
  if(Array.isArray(o.nationalityBreakdown) && o.nationalityBreakdown.length>0){
    o.nationalityBreakdown = o.nationalityBreakdown.map(x=>({
      nationality:String(x.nationality||'').trim(),
      adults:parseInt(x.adults)||0,
      children:parseInt(x.children)||0
    })).filter(x=>x.nationality);
    o.nat = formatNationalitySummaryFromRows(o.nationalityBreakdown);
    return o;
  }
  const legacy=(o.nat||'').trim();
  if(legacy){
    o.nationalityBreakdown = [{ nationality:legacy, adults:parseInt(o.adults)||0, children:parseInt(o.children)||0 }];
  } else {
    o.nationalityBreakdown = [];
  }
  o.nat = formatNationalitySummaryFromRows(o.nationalityBreakdown);
  return o;
}

function orderNationalitySearchText(o){
  const parts=[(o.nat||'')];
  getNationalityBreakdown(o).forEach(r=>{ parts.push(r.nationality||''); });
  return parts.join(' ').toLowerCase();
}

function defaultDB(){
  return {
    orders:[], leaders:[], services:[
      {id:1,name:'Arrival',icon:'🛬',color:'green',airport:'Cairo International (CAI) — all terminals',description:'Standard meet & greet for arriving passengers.',includes:'Greeter at gate/belt · name board · porter assist (on request) · escort to transport.',cost:'120',currency:'EGP'},
      {id:2,name:'Departure',icon:'🛫',color:'red',airport:'Cairo International (CAI)',description:'Check-in assistance and lounge coordination for departures.',includes:'Check-in support · security fast guidance · gate escort · flight updates.',cost:'110',currency:'EGP'},
      {id:3,name:'Transit',icon:'🔄',color:'purple',airport:'Cairo International (CAI)',description:'Short connection handling between inbound and outbound flights.',includes:'Airside meet · connection timing watch · gate-to-gate escort.',cost:'95',currency:'EGP'},
      {id:4,name:'VIP Arrival',icon:'⭐',color:'amber',airport:'Cairo International (CAI) — VIP / private wing',description:'Premium arrival with privacy and minimal queues.',includes:'Private greeter · fast-track where available · luggage priority · lounge if booked · dedicated vehicle lane.',cost:'450',currency:'EGP'},
      {id:5,name:'VIP Departure',icon:'🎩',color:'amber',airport:'Cairo International (CAI)',description:'Premium departure assistance and lounge access coordination.',includes:'Curbside meet · premium check-in lane · lounge access (if entitled) · gate escort.',cost:'420',currency:'EGP'},
    ],
    users: [],
    nextOrderId:1, nextLeaderId:1, nextServiceId:6, nextUserId:1
  };
}

// ═══════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════
function tickClock(){
  const el = document.getElementById('clockEl');
  if(!el) return;
  const now = new Date();
  el.textContent =
    now.toLocaleTimeString('en-GB',{hour12:false}) + ' — ' +
    now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
}
setInterval(tickClock,1000); tickClock();

// ═══════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════
function clearOrderHash(){
  const base = window.location.href.split('#')[0];
  if(window.location.hash) history.replaceState(null, '', base);
}

function parseOrderHash(){
  const h = (window.location.hash || '').replace(/^#/,'');
  const m = /^order\/(\d+)$/.exec(h);
  return m ? parseInt(m[1], 10) : null;
}

const MAIN_NAV_HASH_PAGES = new Set(['dash','orders','today','leaders','services','reports','users']);

function parseMainPageSlugFromHash(){
  const h = (window.location.hash || '').replace(/^#/,'').trim();
  if(!h) return 'dash';
  if(/^order\/\d+$/.test(h)) return 'dash';
  if(MAIN_NAV_HASH_PAGES.has(h)) return h;
  return 'dash';
}

function syncMainNavHash(page){
  if(!MAIN_NAV_HASH_PAGES.has(page)) return;
  const base = window.location.href.split('#')[0];
  hashSyncFromApp = true;
  try{
    if(page === 'dash') history.replaceState(null, '', base);
    else history.replaceState(null, '', base + '#' + page);
  } finally{
    setTimeout(()=>{ hashSyncFromApp = false; }, 0);
  }
}

function nav(page, opts){
  const fromHash = !!(opts && opts.fromHash);
  const panel = document.getElementById('p-' + page);
  if(!panel){
    toast('Unknown page: ' + String(page || ''), 'err');
    return;
  }
  if(currentUser && !pageAllowedForRole(page)){
    toast('You do not have access to that section', 'err');
    if(page !== 'dash') nav('dash');
    return;
  }
  closeNavbarAccountMenu();
  const showRouteSkeleton = currentUser && !document.body.classList.contains('auth-locked')
    && document.documentElement.getAttribute('data-auth-ready') === 'yes'
    && !panel.classList.contains('active');
  if(showRouteSkeleton) showRouteLoader();
  if(!fromHash) syncMainNavHash(page);
  currentOrderPageId = null;
  flushSearchDebounceTimers();
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#main-nav .nav-btn[data-nav]').forEach(b=>b.classList.remove('active'));
  panel.classList.add('active');
  const navBtn = document.querySelector(`#main-nav .nav-btn[data-nav="${page}"]`);
  if(navBtn) navBtn.classList.add('active');

  const btn = document.getElementById('main-action-btn');
  if(btn){
    if(page==='leaders'){btn.innerHTML='+ New tour leader';btn.onclick=openLeaderModal;}
    else if(page==='services'){btn.innerHTML='+ New service';btn.onclick=openServiceModal;}
    else if(page==='users'){btn.innerHTML='+ Add user';btn.onclick=openUserModal;}
    else{btn.innerHTML='<i class="bi bi-airplane-fill" aria-hidden="true"></i> New order';btn.onclick=openOrderModal;}
  }

  if(page==='reports'){ switchReportTab('overview'); renderReports(); }
  if(page==='today') renderToday(false);
  if(page==='services') renderServices(false);
  if(page==='orders') renderOrders(false);
  if(page==='leaders') renderLeaders(false);
  if(page==='users') renderUsers(false);
  if(page==='dash') renderDash();
  if(showRouteSkeleton) scheduleRouteLoaderHide();
}

function goOrdersTodayTimeline(){
  nav('orders');
  requestAnimationFrame(()=>{
    ordersQuickFilter = 'today';
    const sort = document.getElementById('order-sort');
    if(sort) sort.value = 'dateAsc';
    const assign = document.getElementById('order-filter-assign');
    if(assign) assign.value = '';
    renderOrders(true);
    syncOrderQuickFilterButtons();
  });
}

function refreshAppAfterDataChange(){
  flushSearchDebounceTimers();
  updateBadges();
  populateOrderTypeFilter();
  populateOrderServiceTypeSelect();
  renderDash();
  renderToday(false);
  renderOrders(false);
  renderLeaders(false);
  renderServices(false);
  if(document.getElementById('p-reports')?.classList.contains('active')) renderReports();
  if(document.getElementById('p-users')?.classList.contains('active')) renderUsers(false);
  const tdl = document.getElementById('today-date-label');
  if(tdl) tdl.textContent = fmtDate(todayStr());
  populateLeaderDropdown();
  if(currentOrderPageId) showOrderDetailPage(currentOrderPageId);
}

function closeToolbarDataMenu(){
  closeNavbarAccountMenu();
}

function closeNavbarAccountMenu(){
  const d = document.getElementById('navbar-account-dd');
  if(d) d.removeAttribute('open');
}

function logoutFromAccountMenu(){
  closeNavbarAccountMenu();
  logout();
}

function openAccountSettingsMenu(){
  closeNavbarAccountMenu();
  if(canManageUsers()){
    nav('users');
    return;
  }
  if(canManageLeadersAndServices()){
    nav('leaders');
    return;
  }
  toast('Profile changes are handled by your coordinator.', 'info');
}

function buildShiftBriefing(today, todays){
  const active = todays.filter(o => o.status !== 'Cancelled');
  const open = active.filter(o => o.status !== 'Completed');
  const unassigned = open.filter(o => !o.leaderId);
  const inProgress = active.filter(o => o.status === 'In progress');
  const stale = open.filter(o => o.status === 'Scheduled' && minutesUntilTodayTime(o.time) < -45);
  const pax = active.reduce((s, o) => s + (parseInt(o.adults, 10) || 0) + (parseInt(o.children, 10) || 0), 0);
  const spend = active.reduce((s, o) => s + sumOrderExpenses(o), 0);
  const next = [...open].sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'))[0] || null;
  const orderSrcTeam = isTourLeaderRole() ? authOrdersScope() : db.orders;
  const leadersBusy = db.leaders.filter(l => orderSrcTeam.some(o => o.leaderId === l.id && o.date === today && o.status !== 'Cancelled' && o.status !== 'Completed'));
  const leadersFree = isTourLeaderRole()
    ? []
    : db.leaders.filter(l => l.status === 'Available' && !leadersBusy.some(x => x.id === l.id));

  const orderLine = (o) => {
    const leader = db.leaders.find(l => l.id == o.leaderId);
    const ref = o.ref || 'ORD-' + String(o.id).padStart(4, '0');
    const paxO = (parseInt(o.adults, 10) || 0) + (parseInt(o.children, 10) || 0);
    const flags = [
      /vip/i.test(o.type || '') ? 'VIP' : '',
      !o.leaderId ? 'NO LEADER' : '',
      o.leaderId && !orderTransportComplete(o) ? 'NO DRIVER' : '',
    ].filter(Boolean).join(', ');
    return `${o.time || '--:--'} | ${ref} | ${o.flight || '-'} | ${o.type || '-'} | ${paxO} PAX | ${leader ? leader.name : 'Unassigned'}${flags ? ' | ' + flags : ''}`;
  };

  const risks = [];
  if(unassigned.length) risks.push(`${unassigned.length} open order${unassigned.length === 1 ? '' : 's'} need tour leader assignment`);
  if(stale.length) risks.push(`${stale.length} scheduled slot${stale.length === 1 ? '' : 's'} already passed by 45+ min`);
  const noDriver = open.filter(o => o.leaderId && !orderTransportComplete(o));
  if(noDriver.length) risks.push(`${noDriver.length} assigned order${noDriver.length === 1 ? '' : 's'} missing driver / vehicle details`);
  if(!risks.length) risks.push('No hard execution gaps detected');

  const lines = [
    `Airport Ops Shift Brief - ${fmtDate(today)}`,
    `Generated ${new Date().toLocaleString('en-GB', { hour12:false })}`,
    '',
    `Volume: ${active.length} active order${active.length === 1 ? '' : 's'} / ${pax} PAX / ${Math.round(spend).toLocaleString('en-GB')} recorded costs`,
    `Status: ${open.length} open, ${inProgress.length} in progress, ${unassigned.length} unassigned`,
    isTourLeaderRole()
      ? 'Team: (guide view — company-wide roster counts omitted)'
      : `Team: ${leadersBusy.length} active leader${leadersBusy.length === 1 ? '' : 's'}, ${leadersFree.length} available with no open jobs`,
    '',
    'Risks:',
    ...risks.map(r => `- ${r}`),
    '',
    'Next on the clock:',
    next ? `- ${orderLine(next)}` : '- No open work left today',
    '',
    'Open timeline:',
    ...(open.length ? open.slice(0, 12).map(o => `- ${orderLine(o)}`) : ['- No open orders']),
  ];
  if(open.length > 12) lines.push(`- ... ${open.length - 12} more open order(s)`);

  return {
    text: lines.join('\n'),
    metrics: {
      active: active.length,
      open: open.length,
      unassigned: unassigned.length,
      pax,
      risks: risks.length === 1 && risks[0] === 'No hard execution gaps detected' ? 0 : risks.length,
      leadersFree: leadersFree.length,
    },
  };
}

function renderShiftBriefing(today, todays){
  const grid = document.getElementById('shift-brief-grid');
  const txt = document.getElementById('shift-brief-text');
  if(!txt) return;
  const brief = buildShiftBriefing(today, todays);
  txt.value = brief.text;
  if(!grid) return;
  const m = brief.metrics;
  grid.innerHTML = `
    <div class="shift-brief-tile">
      <div class="shift-brief-label">Open work</div>
      <div class="shift-brief-value">${m.open}</div>
      <div class="shift-brief-note">${m.active} active order${m.active === 1 ? '' : 's'} today, ${m.pax.toLocaleString('en-GB')} PAX</div>
    </div>
    <div class="shift-brief-tile">
      <div class="shift-brief-label">Assignment gaps</div>
      <div class="shift-brief-value">${m.unassigned}</div>
      <div class="shift-brief-note">${m.leadersFree} available leader${m.leadersFree === 1 ? '' : 's'} currently clear</div>
    </div>
    <div class="shift-brief-tile">
      <div class="shift-brief-label">Risks</div>
      <div class="shift-brief-value">${m.risks}</div>
      <div class="shift-brief-note">Driver gaps, stale statuses, and unassigned open jobs</div>
    </div>
  `;
}

function getCurrentShiftBriefingText(){
  const txt = document.getElementById('shift-brief-text');
  const today = todayStr();
  const scoped = authOrdersScope().filter(o => o.date === today);
  return txt && txt.value ? txt.value : buildShiftBriefing(today, scoped).text;
}

function copyShiftBriefing(){
  const text = getCurrentShiftBriefingText();
  const done = () => toast('Shift briefing copied to clipboard', 'ok');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(()=>{
      fallbackCopyShiftBriefing(text);
    });
  } else {
    fallbackCopyShiftBriefing(text);
  }
}

function fallbackCopyShiftBriefing(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand && document.execCommand('copy');
  ta.remove();
  toast(ok ? 'Shift briefing copied to clipboard' : 'Copy failed - select the briefing text and copy manually', ok ? 'ok' : 'err');
}

function exportShiftBriefing(){
  const blob = new Blob([getCurrentShiftBriefingText()], { type:'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `airport-shift-brief-${todayStr()}.txt`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  toast('Shift briefing TXT downloaded', 'ok');
}

function exportDataBackup(){
  if(!canExportImportBackup()){ toast('Only supervisors and admins can export backups', 'err'); return; }
  const payload = {
    schema: 'airportOpsV2',
    exportedAt: new Date().toISOString(),
    app: 'Airport Operations System',
    data: JSON.parse(JSON.stringify(db)),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `airport-ops-backup-${todayStr()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  toast('Backup JSON downloaded — store it somewhere safe (not only in this browser).', 'ok');
}

function triggerImportBackup(){
  if(!canExportImportBackup()){ toast('Only supervisors and admins can restore backups', 'err'); return; }
  document.getElementById('backup-import-input')?.click();
}

function importDataBackup(ev){
  if(!canExportImportBackup()){ toast('Only supervisors and admins can restore backups', 'err'); return; }
  const input = ev.target;
  const f = input.files && input.files[0];
  input.value = '';
  if(!f) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      const raw = parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'
        ? parsed.data
        : parsed;
      if(!raw || typeof raw !== 'object') throw new Error('Invalid backup file');
      if(!Array.isArray(raw.orders)) raw.orders = [];
      if(!Array.isArray(raw.leaders)) raw.leaders = [];
      if(!Array.isArray(raw.services)) raw.services = [];
      if(!raw.orders.length && !raw.leaders.length && !raw.services.length) throw new Error('Backup is empty');
      if(!confirm('Replace ALL current data with this backup? Export first if you need a copy. This cannot be undone.')) return;
      closeAllOverlays();
      flushSearchDebounceTimers();
      db = applyMigrationsToDb(JSON.parse(JSON.stringify(raw)));
      syncLeaderStatusesFromSchedule(true);
      save();
      refreshAppAfterDataChange();
      if(!tryRestoreSession()){
        sessionStorage.removeItem(SESSION_KEY);
        currentUser = null;
        appShellWired = false;
        setAuthGateLocked(true);
        applyRoleToUi();
        toast('Backup restored. Sign in again with an account from this file.', 'info');
      } else {
        applyRoleToUi();
        toast('Backup restored. All views refreshed.', 'ok');
      }
    } catch(err){
      toast('Restore failed: ' + (err && err.message ? err.message : 'invalid JSON'), 'err');
    }
  };
  reader.onerror = ()=> toast('Could not read the file.', 'err');
  reader.readAsText(f);
}

// ═══════════════════════════════════════
// MODAL LAYER — focus restore, inert shell, shared open/close
// ═══════════════════════════════════════
let modalFocusPrevious = null;

function syncMainContentModalLayer(){
  const shell = document.getElementById('app-shell') || document.getElementById('app-main');
  const open = document.querySelector('.overlay.open');
  if(shell){
    try{
      if(open && 'inert' in shell) shell.inert = true;
      else shell.removeAttribute('inert');
    }catch(e){}
  }
  document.documentElement.classList.toggle('modal-open', !!open);
}

function getModalFocusables(modalEl){
  const sel = 'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...modalEl.querySelectorAll(sel)].filter(n=>{
    const cs = window.getComputedStyle(n);
    if(cs.display === 'none' || cs.visibility === 'hidden') return false;
    if(n.closest && n.closest('[hidden]')) return false;
    return true;
  });
}

function focusOverlayFirst(overlayEl){
  const modal = overlayEl.querySelector('.modal');
  if(!modal) return;
  const list = getModalFocusables(modal);
  if(list.length){ try{ list[0].focus(); }catch(e){} }
}

function openModal(id){
  const el = document.getElementById(id);
  if(!el) return;
  if(!document.querySelector('.overlay.open')) modalFocusPrevious = document.activeElement;
  el.classList.add('open');
  el.setAttribute('aria-hidden','false');
  syncMainContentModalLayer();
  queueMicrotask(()=> focusOverlayFirst(el));
}

function closeModal(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden','true');
  if(!document.querySelector('.overlay.open')){
    syncMainContentModalLayer();
    const prev = modalFocusPrevious;
    modalFocusPrevious = null;
    if(prev && typeof prev.focus === 'function'){
      try{ prev.focus(); }catch(e){}
    }
  }
}

function closeAllOverlays(){
  [...document.querySelectorAll('.overlay.open')].forEach(ov=>{
    if(ov.id) closeModal(ov.id);
    else ov.classList.remove('open');
  });
}

// ═══════════════════════════════════════
// ORDERS EXPORT / IMPORT (Excel)
// ═══════════════════════════════════════
function ensureXLSX(){
  if (typeof XLSX === 'undefined') {
    toast('Excel library failed to load. Check your network and refresh.', 'err');
    return false;
  }
  return true;
}

function exportOrdersExcel(){
  if (!ensureXLSX()) return;
  const orderRows = db.orders.map(o => ({
    id: o.id,
    ref: o.ref || '',
    type: o.type || '',
    flight: o.flight || '',
    date: o.date || '',
    time: o.time || '',
    flight_type: o.flightType || '',
    dest: o.dest || '',
    adults: o.adults || 0,
    children: o.children || 0,
    child_ages_json: JSON.stringify(o.childAges || []),
    leader_id: o.leaderId ?? '',
    rep: o.rep || '',
    driver: o.driver || '',
    vehicle_count: Array.isArray(o.vehicles) ? o.vehicles.length : 0,
    vehicles_json: JSON.stringify(o.vehicles || []),
    status: o.status || '',
    notes: o.notes || '',
    nat: o.nat || '',
    nationality_breakdown_json: JSON.stringify(o.nationalityBreakdown || []),
    created_at: o.createdAt || '',
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderRows), 'Orders');
  const expRows = [];
  db.orders.forEach(o => {
    (o.expenses || []).forEach(ex => {
      expRows.push({
        order_id: o.id,
        order_ref: o.ref || '',
        expense_id: ex.id,
        category: ex.category || '',
        amount: ex.amount,
        date: ex.date || '',
        notes: ex.notes || '',
      });
    });
  });
  if (expRows.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'Expenses');
  }
  XLSX.writeFile(wb, `airport-orders-${todayStr()}.xlsx`);
  toast('Excel workbook downloaded', 'ok');
}

function normalizeExpenseLine(ex, fallbackId){
  if (!ex || typeof ex !== 'object') return null;
  const id = Number.isFinite(parseInt(ex.id, 10)) ? parseInt(ex.id, 10) : fallbackId;
  const amount = parseFloat(ex.amount);
  return {
    id,
    category: String(ex.category || 'Other').trim() || 'Other',
    amount: Number.isFinite(amount) ? amount : 0,
    date: String(ex.date || '').trim() || todayStr(),
    notes: String(ex.notes || '').trim(),
    files: Array.isArray(ex.files) ? ex.files : [],
    createdAt: ex.createdAt || new Date().toISOString(),
  };
}

function normalizeImportedOrder(raw){
  if (!raw || typeof raw !== 'object') return null;
  let o;
  try {
    o = JSON.parse(JSON.stringify(raw));
  } catch {
    return null;
  }
  ensureOrderFields(o);
  migrateOrderNationality(o);
  return o;
}

function sanitizeOrderLeaderRef(o){
  sanitizeOrderLeaderRefOnOrder(o, db.leaders);
}

function importOrdersMerge(rows){
  let added = 0;
  const idMap = new Map();
  const refMap = new Map();
  for (const raw of rows) {
    const excelIdRaw = raw.id != null ? parseInt(raw.id, 10) : NaN;
    const excelRefRaw = String(raw.ref || '').trim();
    const o = normalizeImportedOrder(raw);
    if (!o) continue;
    const newId = db.nextOrderId++;
    if (Number.isFinite(excelIdRaw)) idMap.set(excelIdRaw, newId);
    o.id = newId;
    sanitizeOrderLeaderRef(o);
    if (!o.ref) o.ref = 'ORD-' + String(newId).padStart(4, '0');
    if (db.orders.some(x => x.ref === o.ref)) o.ref = 'ORD-' + String(newId).padStart(4, '0');
    if (excelRefRaw) refMap.set(excelRefRaw, o.ref);
    migrateOrderNationality(o);
    db.orders.push(o);
    added++;
  }
  return { added, idMap, refMap };
}

function importOrdersReplace(rows){
  const next = [];
  for (const raw of rows) {
    const o = normalizeImportedOrder(raw);
    if (!o) continue;
    next.push(o);
  }
  db.orders = next;
  if (!db.orders.length) {
    db.nextOrderId = 1;
    return 0;
  }
  let maxId = 0;
  db.orders.forEach(o => {
    let id = parseInt(o.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      id = maxId + 1;
      o.id = id;
    }
    maxId = Math.max(maxId, id);
    sanitizeOrderLeaderRef(o);
    migrateOrderNationality(o);
    if (Array.isArray(o.expenses)) {
      o.expenses.forEach((ex, i) => {
        if (!ex.id || !Number.isFinite(ex.id)) ex.id = i + 1;
      });
    }
  });
  db.nextOrderId = maxId + 1;
  return db.orders.length;
}

function normalizeExcelRowKeys(row){
  const out = {};
  Object.keys(row || {}).forEach(k => {
    const nk = String(k).trim().toLowerCase().replace(/\s+/g, '_');
    out[nk] = row[k];
  });
  return out;
}

function excelDateToIso(v){
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().split('T')[0];
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + v * 86400000);
    if (!isNaN(+d)) return d.toISOString().split('T')[0];
  }
  const s = String(v ?? '').trim();
  return s.slice(0, 10);
}

function excelTimeToHHMM(v){
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return v.trim().slice(0, 8);
  if (typeof v === 'number' && v > 0 && v < 1) {
    const totalMin = Math.round(v * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  return String(v).trim();
}

function excelExpenseDateVal(v){
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().split('T')[0];
  return excelDateToIso(v);
}

function pickExcel(n, ...keys){
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (n[k] !== undefined && n[k] !== null && String(n[k]).trim() !== '') return n[k];
  }
  return '';
}

function excelRowToRawOrder(row){
  const n = normalizeExcelRowKeys(row);
  const type = String(pickExcel(n, 'type', 'service_type', 'service') || '').trim();
  const flight = String(pickExcel(n, 'flight', 'flight_no', 'flight_number') || '').trim();
  const dateRaw = pickExcel(n, 'date', 'flight_date', 'service_date');
  const date = excelDateToIso(dateRaw);
  const timeRaw = pickExcel(n, 'time', 'flight_time');
  const time = excelTimeToHHMM(timeRaw) || '12:00';
  const ref = String(pickExcel(n, 'ref', 'order_ref', 'order_no', 'order_number', 'order_#') || '').trim();
  if (!type && !flight && !dateRaw && !ref) return null;

  let nationalityBreakdown = [];
  const nbj = pickExcel(n, 'nationality_breakdown_json', 'nationality_breakdown');
  if (nbj) {
    try {
      const p = typeof nbj === 'string' ? JSON.parse(nbj) : nbj;
      if (Array.isArray(p)) nationalityBreakdown = p;
    } catch (_) {}
  }

  let vehicles = [];
  const vej = pickExcel(n, 'vehicles_json', 'vehicles');
  if (vej) {
    try {
      const p = typeof vej === 'string' ? JSON.parse(vej) : vej;
      if (Array.isArray(p)) vehicles = p;
    } catch (_) {}
  }

  let childAges = [];
  const caj = pickExcel(n, 'child_ages_json', 'child_ages');
  if (caj) {
    try {
      const p = typeof caj === 'string' ? JSON.parse(caj) : caj;
      if (Array.isArray(p)) childAges = p.map(x => parseInt(x, 10) || 0);
    } catch (_) {}
  }

  const idRaw = pickExcel(n, 'id', 'order_id');
  const lidRaw = pickExcel(n, 'leader_id', 'leaderid', 'tour_leader_id');
  const lid = lidRaw !== '' ? parseInt(lidRaw, 10) : null;

  const o = {
    id: idRaw !== '' && idRaw !== undefined ? parseInt(idRaw, 10) : undefined,
    ref,
    type: type || 'Arrival',
    flight,
    date: date || todayStr(),
    time,
    flightType: String(pickExcel(n, 'flight_type', 'flighttype') || 'Arrival').trim() || 'Arrival',
    dest: String(pickExcel(n, 'dest', 'destination', 'route') || '').trim(),
    adults: parseInt(pickExcel(n, 'adults') || '0', 10) || 0,
    children: parseInt(pickExcel(n, 'children') || '0', 10) || 0,
    childAges,
    leaderId: Number.isFinite(lid) ? lid : null,
    rep: String(pickExcel(n, 'rep', 'airport_rep') || '').trim(),
    driver: String(pickExcel(n, 'driver', 'car') || '').trim(),
    vehicles,
    status: String(pickExcel(n, 'status') || 'Scheduled').trim(),
    notes: String(pickExcel(n, 'notes', 'remark') || '').trim(),
    nat: String(pickExcel(n, 'nat', 'nationality_summary') || '').trim(),
    nationalityBreakdown,
    expenses: [],
    files: [],
    createdAt: String(pickExcel(n, 'created_at', 'created') || '').trim() || undefined,
  };
  return o;
}

function renumberAllOrderExpenseIds(){
  db.orders.forEach(o => {
    if (!Array.isArray(o.expenses)) return;
    o.expenses.forEach((ex, i) => { ex.id = i + 1; });
  });
}

function applyExcelExpenseRows(rows, idMap, refMap){
  if (!rows || !rows.length) return;
  const idLookup = idMap || new Map();
  const refLookup = refMap || new Map();
  rows.forEach(r => {
    const n = normalizeExcelRowKeys(r);
    let order = null;
    const eid = parseInt(pickExcel(n, 'order_id', 'orderid'), 10);
    if (Number.isFinite(eid)) {
      const nid = idLookup.get(eid);
      const targetId = Number.isFinite(nid) ? nid : eid;
      order = db.orders.find(x => x.id === targetId);
    }
    const rref = String(pickExcel(n, 'order_ref', 'orderref') || '').trim();
    if (!order && rref) {
      const mapped = refLookup.get(rref) || rref;
      order = db.orders.find(x => x.ref === mapped);
    }
    if (!order) return;
    if (!Array.isArray(order.expenses)) order.expenses = [];
    const nextId = (order.expenses.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1;
    const amt = parseFloat(pickExcel(n, 'amount', 'amt'));
    if (!Number.isFinite(amt) || amt <= 0) return;
    const ex = normalizeExpenseLine({
      category: pickExcel(n, 'category', 'cat') || 'Other',
      amount: amt,
      date: excelExpenseDateVal(pickExcel(n, 'date', 'expense_date')) || todayStr(),
      notes: String(pickExcel(n, 'notes', 'note') || '').trim(),
    }, nextId);
    if (ex) order.expenses.push(ex);
  });
}

function completeOrdersImport(mode, countMsg){
  syncLeaderStatusesFromSchedule(true);
  save();
  closeModal('orders-import-overlay');
  toast(mode === 'replace' ? `Replaced with ${countMsg} order(s)` : `Imported ${countMsg} order(s)`, 'ok');
  updateBadges();
  renderDash();
  renderOrders(true);
  renderToday(false);
  populateOrderTypeFilter();
  populateOrderServiceTypeSelect();
  populateLeaderDropdown();
  if (typeof renderReports === 'function' && document.getElementById('p-reports')?.classList.contains('active')) renderReports();
  if (currentOrderPageId && !db.orders.some(o => o.id === currentOrderPageId)) {
    currentOrderPageId = null;
    clearOrderHash();
    nav('orders');
  } else if (currentOrderPageId && typeof refreshOrderDetailPageIfOpen === 'function') {
    refreshOrderDetailPageIfOpen(currentOrderPageId);
  }
}

function runOrdersImportExcel(arrayBuffer, mode){
  if (!ensureXLSX()) return;
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const ordersSheetName = wb.SheetNames.includes('Orders') ? 'Orders' : wb.SheetNames[0];
  if (!ordersSheetName) throw new Error('Workbook has no sheets');
  const orderRows = XLSX.utils.sheet_to_json(wb.Sheets[ordersSheetName], { defval: '', raw: false });
  let expRows = [];
  if (wb.SheetNames.includes('Expenses')) {
    expRows = XLSX.utils.sheet_to_json(wb.Sheets['Expenses'], { defval: '', raw: false });
  }
  const rawOrders = orderRows.map(excelRowToRawOrder).filter(Boolean);
  if (!rawOrders.length && mode !== 'replace') throw new Error('No rows found in Orders sheet');

  if (mode === 'replace') {
    importOrdersReplace(rawOrders);
    applyExcelExpenseRows(expRows, null, null);
    renumberAllOrderExpenseIds();
    completeOrdersImport(mode, db.orders.length);
    return;
  }
  const { added, idMap, refMap } = importOrdersMerge(rawOrders);
  applyExcelExpenseRows(expRows, idMap, refMap);
  renumberAllOrderExpenseIds();
  completeOrdersImport(mode, added);
}

function openOrdersImportModal(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins can import orders from Excel', 'err'); return; }
  const f = document.getElementById('orders-import-file');
  if (f) f.value = '';
  const m = document.querySelector('input[name="orders-import-mode"][value="merge"]');
  if (m) m.checked = true;
  openModal('orders-import-overlay');
}

function runOrdersImport(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins can import orders from Excel', 'err'); return; }
  const input = document.getElementById('orders-import-file');
  const file = input?.files?.[0];
  if (!file) {
    toast('Choose an Excel file first', 'err');
    return;
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    toast('Only Excel files (.xlsx or .xls) are supported', 'err');
    return;
  }
  const mode = document.querySelector('input[name="orders-import-mode"]:checked')?.value || 'merge';
  if (mode === 'replace' && !confirm('Replace ALL orders with this file? Current orders will be removed. Continue?')) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      runOrdersImportExcel(reader.result, mode);
    } catch (e) {
      toast(e.message || 'Excel import failed', 'err');
    }
  };
  reader.onerror = () => toast('Could not read file', 'err');
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════
// BADGES & COUNTERS
// ═══════════════════════════════════════
function updateBadges(){
  const today = todayStr();
  const scope = authOrdersScope();
  document.getElementById('nb-orders').textContent = String(scope.length);
  document.getElementById('nb-today').textContent = String(scope.filter(o=>o.date===today).length);
  document.getElementById('nb-leaders').textContent = String(db.leaders.length);
}
function todayStr(){ return new Date().toISOString().split('T')[0]; }
function addDaysIso(isoDateStr, deltaDays){
  const d = new Date(isoDateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().split('T')[0];
}
function fmtDate(d){
  if(!d)return'—';
  return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
}
function avClass(id){ return 'av'+((id%8)||8); }

// ═══════════════════════════════════════
// SERVICE HELPERS
// ═══════════════════════════════════════
function getService(nameOrId){
  return db.services.find(s=>s.name===nameOrId||s.id==nameOrId);
}
function serviceBadge(name){
  const sv = getService(name);
  if(!sv) return `<span class="badge b-gray">${name||'—'}</span>`;
  const cls = {green:'b-green',red:'b-red',purple:'b-purple',amber:'b-amber',blue:'b-blue',cyan:'b-blue'}[sv.color]||'b-gray';
  return `<span class="badge ${cls}">${sv.name}</span>`;
}
function colorVar(c){ const m={green:'var(--green)',red:'var(--red)',purple:'var(--purple)',amber:'var(--amber)',blue:'var(--blue)',cyan:'var(--cyan)'}; return m[c]||'var(--muted)'; }

function minutesUntilTodayTime(timeStr){
  const p=(timeStr||'00:00').split(':');
  const hh=parseInt(p[0],10)||0, mm=parseInt(p[1],10)||0;
  const now=new Date();
  const t=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hh,mm,0,0);
  return Math.round((t-now)/60000);
}
function formatDueLabel(mins){
  if(mins===null||Number.isNaN(mins))return '—';
  if(mins<-120)return '';
  if(mins<-45)return 'Started';
  if(mins<=25)return 'Due soon';
  if(mins<60)return 'In '+mins+' min';
  const h=Math.floor(mins/60), m=mins%60;
  if(h>=12)return 'Later';
  return m===0?'In '+h+' h':'In '+h+' h '+m+' min';
}

/** Minutes from midnight for HH:mm (used for leader overlap logic). */
function orderTimeToMinutes(timeStr){
  const p = (timeStr || '00:00').split(':');
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
}

/** Default block length for meet & greet overlap checks (one guide can’t be in two places). */
const LEADER_SERVICE_BLOCK_MINS = 90;

function getLeaderOpenOrders(leaderId){
  return db.orders.filter(o =>
    o.leaderId === leaderId &&
    o.status !== 'Cancelled' &&
    o.status !== 'Completed'
  );
}

/** Open orders for a leader, soonest first (for “what are they busy with?” views). */
function getLeaderOpenOrdersSorted(leaderId){
  return getLeaderOpenOrders(leaderId).slice().sort((a, b)=>{
    const da = (a.date || '').localeCompare(b.date || '');
    if(da !== 0) return da;
    return (a.time || '').localeCompare(b.time || '');
  });
}

/** HTML chips for leaders table — each chip opens the order. */
function renderLeaderWorkloadTableCell(l){
  const orders = getLeaderOpenOrdersSorted(l.id);
  if(!orders.length){
    return '<span class="leader-wl-empty">No open jobs</span>';
  }
  return '<div class="leader-workload">' + orders.map(o=>{
    const ref = o.ref || ('ORD-' + String(o.id).padStart(4, '0'));
    const when = (o.date ? fmtDate(o.date) : '—') + ' · ' + (o.time || '—');
    const flight = (o.flight || '—').trim();
    const st = o.status || '';
    const stCls = st === 'In progress' ? 'leader-wl-ip' : 'leader-wl-sch';
    const tip = ref + ' · ' + flight + ' · ' + when + ' · ' + st;
    return `<button type="button" class="leader-wl-row ${stCls}" onclick="showDetail(${o.id})" title="${escapeHtml(tip)}">
      <div class="leader-wl-top"><span class="leader-wl-ref">${escapeHtml(ref)}</span><span class="leader-wl-st">${escapeHtml(st)}</span></div>
      <div class="leader-wl-sub">${escapeHtml(flight)} · ${escapeHtml(when)}</div>
    </button>`;
  }).join('') + '</div>';
}

/** Compact HTML line for dashboard leader strip (first 2 jobs + count). */
function formatLeaderWorkloadDashHtml(l, todayIso){
  const orders = getLeaderOpenOrdersSorted(l.id);
  if(!orders.length) return '';
  const maxShow = 2;
  const parts = [];
  for(let i = 0; i < orders.length && i < maxShow; i++){
    const o = orders[i];
    const ref = escapeHtml(o.ref || ('ORD-' + String(o.id).padStart(4, '0')));
    const tim = escapeHtml(o.time || '—');
    const fl = escapeHtml(String(o.flight || '—').slice(0, 14));
    const dateBit = o.date === todayIso ? '' : escapeHtml(fmtDate(o.date)) + ' ';
    const ip = o.status === 'In progress';
    parts.push(`<span class="l-mini-wl-item${ip ? ' is-live' : ''}">${ip ? '●' : '○'} ${ref} · ${fl} · ${dateBit}${tim}</span>`);
  }
  let html = parts.join('<span class="l-mini-wl-sep">·</span>');
  if(orders.length > maxShow) html += ` <span class="l-mini-wl-more">+${orders.length - maxShow}</span>`;
  return html;
}

/** Plain tooltip: open jobs list (order form dropdown). */
function leaderOpenJobsTitle(l){
  const orders = getLeaderOpenOrdersSorted(l.id);
  if(!orders.length) return 'Open jobs: none';
  const bits = orders.slice(0, 6).map(o=>{
    const ref = o.ref || ('ORD-' + String(o.id).padStart(4, '0'));
    return ref + ' ' + (o.date || '') + ' ' + (o.time || '') + ' ' + (o.flight || '—');
  });
  let s = 'Open jobs: ' + bits.join(' | ');
  if(orders.length > 6) s += ' … +' + (orders.length - 6) + ' more';
  return s;
}

function leaderHasScheduleOverlap(leaderId){
  const orders = getLeaderOpenOrders(leaderId);
  const byDate = {};
  orders.forEach(o=>{
    const d = o.date || '';
    if(!byDate[d]) byDate[d] = [];
    byDate[d].push(o);
  });
  for(const date of Object.keys(byDate)){
    const list = byDate[date].sort((a, b)=>orderTimeToMinutes(a.time) - orderTimeToMinutes(b.time));
    const blocks = list.map(o=>{
      const s = orderTimeToMinutes(o.time);
      return { start: s, end: s + LEADER_SERVICE_BLOCK_MINS };
    });
    for(let i = 0; i < blocks.length; i++){
      for(let j = i + 1; j < blocks.length; j++){
        if(blocks[i].start < blocks[j].end && blocks[j].start < blocks[i].end) return true;
      }
    }
  }
  return false;
}

/** Same calendar day: two service windows [time, time+block) overlap (used when assigning a leader). */
function orderTimeWindowsOverlap(dateA, timeA, dateB, timeB){
  if(!dateA || !dateB || String(dateA) !== String(dateB)) return false;
  const s1 = orderTimeToMinutes(timeA);
  const e1 = s1 + LEADER_SERVICE_BLOCK_MINS;
  const s2 = orderTimeToMinutes(timeB);
  const e2 = s2 + LEADER_SERVICE_BLOCK_MINS;
  return s1 < e2 && s2 < e1;
}

function leaderOpenOrdersExcept(leaderId, excludeOrderId){
  return getLeaderOpenOrders(leaderId).filter(o => excludeOrderId == null || o.id !== excludeOrderId);
}

/**
 * True if this leader already has another open order whose time window overlaps the proposed slot
 * (prevents double-booking / “two jobs at once or too close”).
 */
function leaderAssignmentConflictsSchedule(leaderId, orderDate, orderTime, excludeOrderId){
  if(!leaderId || !orderDate || !orderTime) return false;
  const others = leaderOpenOrdersExcept(leaderId, excludeOrderId);
  return others.some(o => orderTimeWindowsOverlap(orderDate, orderTime, o.date, o.time));
}

/**
 * Schedule-based insight (independent of stored status except Off = roster off).
 * code: off | manual | overlap | on_job | booked | clear
 */
function inferLeaderAvailabilityInsight(l){
  if(l.status === 'Off'){
    return { code: 'off', label: 'Off duty', hint: 'Marked off rota — not auto-assigned as busy.', badge: 'b-amber' };
  }
  if(l.availabilityMode === 'manual'){
    return { code: 'manual', label: 'Manual', hint: 'Status is edited only by you (cycle or dropdown).', badge: l.status === 'Busy' ? 'b-red' : 'b-gray' };
  }
  const open = getLeaderOpenOrders(l.id);
  if(open.some(o => o.status === 'In progress')){
    return { code: 'on_job', label: 'On job', hint: 'At least one order is in progress.', badge: 'b-amber' };
  }
  if(leaderHasScheduleOverlap(l.id)){
    return { code: 'overlap', label: 'Overlap risk', hint: 'Two open jobs share the same calendar day with overlapping time windows (~' + LEADER_SERVICE_BLOCK_MINS + ' min blocks).', badge: 'b-red' };
  }
  if(open.length){
    return { code: 'booked', label: open.length + ' open', hint: 'Has scheduled work but no detected overlap.', badge: 'b-blue' };
  }
  return { code: 'clear', label: 'Clear', hint: 'No open assigned orders.', badge: 'b-green' };
}

/** Auto mode only: suggest Available vs Busy from workload (never sets Off). */
function computeAutoLeaderStatus(l){
  if(l.availabilityMode === 'manual') return null;
  if(l.status === 'Off') return null;
  const open = getLeaderOpenOrders(l.id);
  if(open.some(o => o.status === 'In progress')) return 'Busy';
  if(leaderHasScheduleOverlap(l.id)) return 'Busy';
  return 'Available';
}

/**
 * Updates leader.status from schedule for guides in auto mode.
 * @param {boolean} skipSave If true, only mutate db (caller saves).
 * @returns {boolean} true if any leader status changed
 */
function syncLeaderStatusesFromSchedule(skipSave){
  let changed = false;
  for(const l of db.leaders){
    const next = computeAutoLeaderStatus(l);
    if(next && l.status !== next){
      l.status = next;
      changed = true;
    }
  }
  if(changed && !skipSave) save();
  return changed;
}

function syncLeadersFromScheduleAndRefresh(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage tour leaders', 'err'); return; }
  const ch = syncLeaderStatusesFromSchedule(false);
  renderLeaders(false);
  renderDash();
  populateLeaderDropdown();
  toast(ch ? 'Tour leader statuses updated from open orders.' : 'No auto-status changes needed (check overlap hints in the table).', ch ? 'ok' : 'info');
}

function leaderDropdownSortKey(l){
  if(l.status === 'Off') return -1000;
  const ins = inferLeaderAvailabilityInsight(l);
  const rank = { overlap: 30, on_job: 40, booked: 60, clear: 100, manual: 50, off: 0 };
  return rank[ins.code] ?? 0;
}

function tickDashClock(){
  const tEl = document.getElementById('dash-clock-time');
  const dEl = document.getElementById('dash-clock-date');
  if(!tEl || !dEl) return;
  const now = new Date();
  tEl.textContent = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  dEl.textContent = now.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
}
function ensureDashClockInterval(){
  tickDashClock();
  if(dashClockInterval != null) return;
  dashClockInterval = setInterval(tickDashClock, 30000);
}

// ═══════════════════════════════════════
// RENDER DASHBOARD
// ═══════════════════════════════════════
function renderDash(){
  ensureDashClockInterval();
  const today = todayStr();
  const scoped = authOrdersScope();
  const todays = scoped.filter(o=>o.date===today);
  document.getElementById('s-today').textContent = todays.length;
  document.getElementById('s-in').textContent = todays.filter(o=>o.type&&o.type.toLowerCase().includes('arrival')).length;
  document.getElementById('s-out').textContent = todays.filter(o=>o.type&&o.type.toLowerCase().includes('departure')).length;
  document.getElementById('s-unassigned').textContent = scoped.filter(o=>!o.leaderId&&o.status!=='Cancelled').length;

  const intro = document.getElementById('dash-intro-sub');
  if(intro){
    const now = new Date();
    intro.textContent = 'PAX load, documented costs, next slot, and curbside blockers in one place · '
      + now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
      + ' · Refreshes when you open the dashboard or save data.';
  }

  const unassigned = scoped.filter(o=>!o.leaderId && o.status!=='Cancelled')
    .sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||''));

  const dashTodayPreview = 4;
  const dashLeadersPreview = 4;

  // today list
  const el = document.getElementById('dash-today-list');
  const sorted = [...todays].sort((a,b)=>a.time.localeCompare(b.time));
  const todayMeta = document.getElementById('dash-today-meta');
  if(todayMeta){
    if(!sorted.length) todayMeta.textContent = '';
    else if(sorted.length <= dashTodayPreview) todayMeta.textContent = `${sorted.length} job${sorted.length === 1 ? '' : 's'} today · earliest first`;
    else todayMeta.textContent = `Showing first ${dashTodayPreview} of ${sorted.length} · open Full day timeline for the rest`;
  }
  if(!sorted.length){
    el.innerHTML='<div class="empty"><div class="ei">📅</div><p>No orders today</p><p class="empty-hint">Use <strong>New Order</strong> with today’s flight date, or open <strong>All Orders</strong> to plan ahead.</p></div>';
  } else el.innerHTML = sorted.slice(0,dashTodayPreview).map(o=>orderQRow(o)).join('');

  // leaders
  const ll = document.getElementById('dash-leaders-list');
  const leadSum = document.getElementById('dash-leader-summary');
  const leadMeta = document.getElementById('dash-leaders-meta');
  const maxLeadersDash = dashLeadersPreview;
  if(leadSum){
    if(!db.leaders.length) leadSum.innerHTML = '';
    else if(isTourLeaderRole()){
      const me = db.leaders.find(l => l.id === currentUser.leaderId);
      leadSum.innerHTML = me
        ? `<span class="dash-ls-pill"><b>Your roster</b></span><span class="dash-ls-pill">${escapeHtml(me.name)}</span><span class="dash-ls-pill">${escapeHtml(me.status)}</span>`
        : '';
    } else {
      const av = db.leaders.filter(l => l.status === 'Available').length;
      const bu = db.leaders.filter(l => l.status === 'Busy').length;
      const of = db.leaders.filter(l => l.status === 'Off').length;
      leadSum.innerHTML = `<span class="dash-ls-pill"><b>${db.leaders.length}</b> on roster</span>`
        + `<span class="dash-ls-pill">🟢 Avail <b>${av}</b></span>`
        + `<span class="dash-ls-pill">🔴 Busy <b>${bu}</b></span>`
        + `<span class="dash-ls-pill">⏸ Off <b>${of}</b></span>`;
    }
  }
  if(leadMeta){
    if(!db.leaders.length) leadMeta.textContent = '';
    else if(isTourLeaderRole()) leadMeta.textContent = 'Your assignments and workload';
    else if(db.leaders.length > maxLeadersDash) leadMeta.textContent = `Showing ${maxLeadersDash} of ${db.leaders.length} · Manage opens the full list`;
    else leadMeta.textContent = '● live job · ○ scheduled · line below = open assignments (same as Busy with column)';
  }
  if(!db.leaders.length){ ll.innerHTML='<div class="empty"><div class="ei">👥</div><p>No tour leaders</p><p class="empty-hint">Add staff under <strong>Tour Leaders</strong> so you can assign meet &amp; greet.</p></div>'; }
  else{
    const leadPool = isTourLeaderRole() && currentUser && currentUser.leaderId
      ? db.leaders.filter(l => l.id === currentUser.leaderId)
      : db.leaders;
    const slice = leadPool.slice(0, maxLeadersDash);
    ll.innerHTML = slice.map(l=>{
      const cnt = scoped.filter(o=>o.leaderId==l.id&&o.date===today).length;
      const sd = l.status==='Available'?'sd-green':l.status==='Busy'?'sd-red':'sd-amber';
      const wlHtml = formatLeaderWorkloadDashHtml(l, today);
      return `<div class="l-mini">
      <div class="av ${avClass(l.id)}">${l.name[0]}</div>
      <div class="l-mini-info">
        <div class="l-mini-name">${escapeHtml(l.name)}</div>
        <div class="l-mini-detail">${escapeHtml(l.spec||'—')} · ${cnt ? cnt + ' job(s) today' : 'No jobs today'}</div>
        ${wlHtml ? `<div class="l-mini-workload">${wlHtml}</div>` : ''}
      </div>
      <div class="status-dot ${sd}"></div>
    </div>`;
    }).join('')
      + (leadPool.length > maxLeadersDash
        ? `<div class="dash-more-leaders"><button type="button" class="btn btn-ghost btn-sm" onclick="nav('leaders')">All ${leadPool.length} leaders →</button></div>`
        : '');
  }

  const banner = document.getElementById('dash-banner-text');
  const bannerBox = document.getElementById('dash-banner');
  if(banner && bannerBox){
    const parts = [];
    if(unassigned.length) parts.push(`<strong>${unassigned.length}</strong> order${unassigned.length===1?'':'s'} still need a tour leader`);
    const inProg = todays.filter(o=>o.status==='In progress').length;
    if(inProg) parts.push(`<strong>${inProg}</strong> in progress now`);
    const soon = todays.filter(o=>{
      if(o.status==='Cancelled'||o.status==='Completed')return false;
      const m = minutesUntilTodayTime(o.time);
      return m>=0 && m<=90;
    }).length;
    if(soon) parts.push(`<strong>${soon}</strong> service${soon===1?'':'s'} in the next 90 minutes`);
    banner.innerHTML = parts.length ? parts.join(' · ') : `You’re up to date — <strong>${todays.length}</strong> on today’s roster.`;
    bannerBox.classList.toggle('dash-banner--alert', parts.length>0);
  }

  renderDashShiftIntel(today, todays);
  renderShiftBriefing(today, todays);
}

function orderQRow(o){
  const sv = getService(o.type);
  const leader = db.leaders.find(l=>l.id==o.leaderId);
  const typeLabel = sv ? `<div class="qrow-type" style="background:${colorVar(sv.color)}22;color:${colorVar(sv.color)}">${sv.name}</div>` : '<div class="qrow-type" style="background:var(--s3);color:var(--muted)">—</div>';
  const statusCls = {'Scheduled':'b-blue','In progress':'b-amber','Completed':'b-green','Cancelled':'b-gray'}[o.status]||'b-gray';
  const ft = o.flightType||'Arrival';
  return `<div class="qrow" onclick="showDetail(${o.id})">
    ${typeLabel}
    <div class="qrow-body">
      <div class="qrow-top">
        <span class="qrow-time">${o.time||'--:--'}</span>
        <span class="qrow-flight">${o.flight||'—'}</span>
        <span style="font-size:11px;color:var(--muted2);font-weight:600;">${escapeHtml(ft)}</span>
      </div>
      <div class="qrow-meta">
        ${leader?'👤 '+leader.name:'⚠️ Unassigned'}
      </div>
    </div>
    <div class="qrow-right">
      <span class="badge ${statusCls}">${o.status}</span>
    </div>
  </div>`;
}

// ═══════════════════════════════════════
// PAGINATION (shared)
// ═══════════════════════════════════════
const PAGINATION_KIND_HANDLERS = {
  orders: ['ordersSetPerPage','ordersPagRelative','ordersGoToPage'],
  leaders: ['leadersSetPerPage','leadersPagRelative','leadersGoToPage'],
  today: ['todaySetPerPage','todayPagRelative','todayGoToPage'],
  services: ['servicesSetPerPage','servicesPagRelative','servicesGoToPage'],
  users: ['usersSetPerPage','usersPagRelative','usersGoToPage'],
  repSvc: ['repSvcSetPerPage','repSvcPagRelative','repSvcGoToPage'],
  repCat: ['repCatSetPerPage','repCatPagRelative','repCatGoToPage'],
  repExp: ['repExpSetPerPage','repExpPagRelative','repExpGoToPage'],
  repLead: ['repLeadSetPerPage','repLeadPagRelative','repLeadGoToPage'],
};
function buildPaginationHTML(kind, from, to, total, page, totalPages, perPage){
  const prevD = page <= 1;
  const nextD = page >= totalPages;
  const h = PAGINATION_KIND_HANDLERS[kind] || PAGINATION_KIND_HANDLERS.orders;
  const setPer = h[0];
  const goRel = h[1];
  const goPage = h[2];
  let nums = '';
  const maxNumBtns = 12;
  if (totalPages <= maxNumBtns && totalPages > 0) {
    for (let i = 1; i <= totalPages; i++) {
      const active = i === page ? ' pag-num--active' : '';
      const aria = i === page ? ' aria-current="page"' : '';
      nums += `<button type="button" class="btn btn-ghost btn-sm pag-num${active}"${aria} onclick="${goPage}(${i})">${i}</button>`;
    }
  }
  return `
    <div class="pagination-inner">
      <div class="pagination-meta">Showing <strong>${from}</strong>–<strong>${to}</strong> of <strong>${total}</strong></div>
      <div class="pagination-actions">
        <label class="pagination-per">Rows per page
          <select onchange="${setPer}(this.value)">
            <option value="10" ${perPage===10?'selected':''}>10</option>
            <option value="15" ${perPage===15?'selected':''}>15</option>
            <option value="25" ${perPage===25?'selected':''}>25</option>
            <option value="50" ${perPage===50?'selected':''}>50</option>
            <option value="100" ${perPage===100?'selected':''}>100</option>
          </select>
        </label>
        <div class="pagination-btns">
          <button type="button" class="btn btn-ghost btn-sm" ${prevD?'disabled':''} onclick="${goRel}(-1)">← Prev</button>
          <span class="pagination-page-label" style="font-size:11px;color:var(--muted2);padding:0 4px;white-space:nowrap;">Page ${page} / ${totalPages}</span>
          <button type="button" class="btn btn-ghost btn-sm" ${nextD?'disabled':''} onclick="${goRel}(1)">Next →</button>
        </div>
        ${nums ? `<div class="pagination-nums">${nums}</div>` : ''}
      </div>
    </div>
  `;
}

function ordersPagRelative(delta){
  ordersListPage += delta;
  renderOrders();
}
function ordersGoToPage(n){
  ordersListPage = n;
  renderOrders();
}
function ordersSetPerPage(v){
  ordersPerPage = parseInt(v, 10) || 15;
  ordersListPage = 1;
  renderOrders();
}

function leadersPagRelative(delta){
  leadersListPage += delta;
  renderLeaders();
}
function leadersGoToPage(n){
  leadersListPage = n;
  renderLeaders();
}
function leadersSetPerPage(v){
  leadersPerPage = parseInt(v, 10) || 15;
  leadersListPage = 1;
  renderLeaders();
}

function todayPagRelative(delta){
  todayListPage += delta;
  renderToday();
}
function todayGoToPage(n){
  todayListPage = n;
  renderToday();
}
function todaySetPerPage(v){
  todayPerPage = parseInt(v, 10) || 15;
  todayListPage = 1;
  renderToday();
}

function servicesPagRelative(delta){
  servicesListPage += delta;
  renderServices(false);
}
function servicesGoToPage(n){
  servicesListPage = n;
  renderServices(false);
}
function servicesSetPerPage(v){
  servicesPerPage = parseInt(v, 10) || 15;
  servicesListPage = 1;
  renderServices(false);
}

function repSvcPagRelative(delta){ repSvcPage += delta; renderReports(); }
function repSvcGoToPage(n){ repSvcPage = n; renderReports(); }
function repSvcSetPerPage(v){ repSvcPerPage = parseInt(v,10)||15; repSvcPage = 1; renderReports(); }

function repCatPagRelative(delta){ repCatPage += delta; renderReports(); }
function repCatGoToPage(n){ repCatPage = n; renderReports(); }
function repCatSetPerPage(v){ repCatPerPage = parseInt(v,10)||15; repCatPage = 1; renderReports(); }

function repExpPagRelative(delta){ repExpPage += delta; renderReports(); }
function repExpGoToPage(n){ repExpPage = n; renderReports(); }
function repExpSetPerPage(v){ repExpPerPage = parseInt(v,10)||15; repExpPage = 1; renderReports(); }

function repLeadPagRelative(delta){ repLeadPage += delta; renderReports(); }
function repLeadGoToPage(n){ repLeadPage = n; renderReports(); }
function repLeadSetPerPage(v){ repLeadPerPage = parseInt(v,10)||15; repLeadPage = 1; renderReports(); }

function resetReportPagination(){
  repSvcPage = repCatPage = repExpPage = repLeadPage = 1;
}

function closeOrdersMoreFilters(){
  const d = document.getElementById('orders-more-filters');
  if(d) d.removeAttribute('open');
}

function setOrdersQuickFilter(key){
  if(!key){ ordersQuickFilter=''; renderOrders(true); return; }
  ordersQuickFilter = ordersQuickFilter===key ? '' : key;
  renderOrders(true);
}

function syncOrderQuickFilterButtons(){
  document.querySelectorAll('[data-order-qf]').forEach(btn=>{
    const k = btn.getAttribute('data-order-qf');
    btn.classList.toggle('qf-btn--active', ordersQuickFilter===k);
  });
}

function dismissOrderChip(kind){
  if(kind==='search'){
    const el = document.getElementById('order-search');
    if(el) el.value='';
  } else if(kind==='type'){
    const el = document.getElementById('order-filter-type');
    if(el) el.value='';
  } else if(kind==='status'){
    const el = document.getElementById('order-filter-status');
    if(el) el.value='';
  } else if(kind==='assign'){
    const el = document.getElementById('order-filter-assign');
    if(el) el.value='';
  } else if(kind==='qf'){
    ordersQuickFilter='';
  }
  renderOrders(true);
}

function clearAllOrderFilters(){
  ordersQuickFilter='';
  const s = document.getElementById('order-search');
  if(s) s.value='';
  ['order-filter-type','order-filter-status','order-filter-assign'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value='';
  });
  const sort = document.getElementById('order-sort');
  if(sort) sort.value='newest';
  closeOrdersMoreFilters();
  renderOrders(true);
}

function renderOrderFilterChips(){
  const host = document.getElementById('order-filter-chips');
  const wrap = document.getElementById('order-filter-chips-wrap');
  if(!host || !wrap) return;
  const chips = [];
  const qs = document.getElementById('order-search')?.value.trim();
  if(qs) chips.push({ id:'search', text:'Search · '+escapeHtml(qs) });
  const ft = document.getElementById('order-filter-type')?.value;
  if(ft) chips.push({ id:'type', text:'Type · '+escapeHtml(ft) });
  const fs = document.getElementById('order-filter-status')?.value;
  if(fs) chips.push({ id:'status', text:'Status · '+escapeHtml(fs) });
  const fa = document.getElementById('order-filter-assign')?.value;
  if(fa==='unassigned') chips.push({ id:'assign', text:'Assignment · Needs leader' });
  else if(fa==='assigned') chips.push({ id:'assign', text:'Assignment · Has leader' });
  if(ordersQuickFilter && ORDER_QF_LABELS[ordersQuickFilter]){
    chips.push({ id:'qf', text:ORDER_QF_LABELS[ordersQuickFilter] });
  }
  const lab = wrap.querySelector('.filter-chips-label');
  if(!chips.length){
    host.innerHTML = '';
    wrap.hidden = true;
    if(lab) lab.style.display = 'none';
    return;
  }
  wrap.hidden = false;
  if(lab) lab.style.display = '';
  host.innerHTML = chips.map(c=>
    `<span class="filter-chip">${c.text}<button type="button" class="filter-chip-remove" onclick="dismissOrderChip('${c.id}')" aria-label="Remove filter">×</button></span>`
  ).join('') + ` <button type="button" class="filter-chips-clear" onclick="clearAllOrderFilters()">Clear all</button>`;
}

// ═══════════════════════════════════════
// RENDER ORDERS TABLE
// ═══════════════════════════════════════
function getFilteredOrdersList(){
  const q=(document.getElementById('order-search')?.value||'').toLowerCase();
  const ft=document.getElementById('order-filter-type')?.value ?? '';
  const fs=document.getElementById('order-filter-status')?.value ?? '';
  const fa=document.getElementById('order-filter-assign')?.value||'';
  const sortMode=document.getElementById('order-sort')?.value || 'newest';
  const orderSource = authOrdersScope();
  let list = orderSource.filter(o=>{
    const mq=!q||(o.flight||'').toLowerCase().includes(q)||(o.dest||'').toLowerCase().includes(q)||orderNationalitySearchText(o).includes(q);
    const mt=!ft||o.type===ft;
    const ms=!fs||o.status===fs;
    const ma=!fa||(fa==='assigned'&&o.leaderId)||(fa==='unassigned'&&!o.leaderId);
    let mqk = true;
    if(ordersQuickFilter==='today'){
      if(o.date!==todayStr()) mqk=false;
    } else if(ordersQuickFilter==='vip'){
      if(!/(vip)/i.test(String(o.type||''))) mqk=false;
    } else if(ordersQuickFilter==='pending'){
      if(o.status!=='Scheduled' && o.status!=='In progress') mqk=false;
    } else if(ordersQuickFilter==='completed'){
      if(o.status!=='Completed') mqk=false;
    }
    return mq&&mt&&ms&&ma&&mqk;
  });

  const dtKey = (o)=> (o.date||'') + (o.time||'');
  const strKey = (v)=> (v||'').toString().toLowerCase();
  const statusRank = {'Scheduled':1,'In progress':2,'Completed':3,'Cancelled':4};

  list = list.sort((a,b)=>{
    if(sortMode==='newest') return (b.id||0)-(a.id||0);
    if(sortMode==='oldest') return (a.id||0)-(b.id||0);
    if(sortMode==='dateAsc') return dtKey(a).localeCompare(dtKey(b));
    if(sortMode==='dateDesc') return dtKey(b).localeCompare(dtKey(a));
    if(sortMode==='flightAsc') return strKey(a.flight).localeCompare(strKey(b.flight));
    if(sortMode==='flightDesc') return strKey(b.flight).localeCompare(strKey(a.flight));
    if(sortMode==='status') return (statusRank[a.status]||99) - (statusRank[b.status]||99) || (b.id||0)-(a.id||0);
    if(sortMode==='service') return strKey(a.type).localeCompare(strKey(b.type)) || (b.id||0)-(a.id||0);
    return dtKey(b).localeCompare(dtKey(a));
  });
  return list;
}

function populateOrdersBulkLeaderSelect(){
  const sel=document.getElementById('orders-bulk-leader-sel');
  if(!sel) return;
  const keep=sel.value;
  sel.innerHTML='<option value="">Assign leader…</option>'
    +'<option value="__clear__">— Unassign all —</option>'
    +db.leaders.map(l=>`<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  if(keep && [...sel.options].some(o=>o.value===keep)) sel.value=keep;
}

function syncOrdersBulkHeaderCheckbox(pageRows){
  const el=document.getElementById('orders-select-all-page');
  if(!el) return;
  const pageIds=pageRows.map(o=>o.id);
  const nSel=pageIds.filter(id=>ordersBulkSelected.has(id)).length;
  el.checked=pageIds.length>0 && nSel===pageIds.length;
  el.indeterminate=nSel>0 && nSel<pageIds.length;
}

function updateOrdersBulkBarVisibility(){
  const bar=document.getElementById('orders-bulk-bar');
  const cnt=document.getElementById('orders-bulk-count');
  if(!bar||!cnt) return;
  const n=ordersBulkSelected.size;
  bar.classList.toggle('is-open', n > 0);
  bar.setAttribute('aria-hidden', n === 0 ? 'true' : 'false');
  cnt.textContent=n===1?'1 order selected':n+' orders selected';
}

function ordersBulkToggle(id, checked){
  if(checked) ordersBulkSelected.add(id);
  else ordersBulkSelected.delete(id);
  renderOrders(false);
}

function ordersToggleSelectPage(checked){
  const list=getFilteredOrdersList();
  const totalPages=Math.max(1, Math.ceil(list.length / ordersPerPage));
  ordersListPage=Math.min(Math.max(1, ordersListPage), totalPages);
  const start=(ordersListPage-1)*ordersPerPage;
  const pageRows=list.slice(start, start+ordersPerPage);
  pageRows.forEach(o=>{
    if(checked) ordersBulkSelected.add(o.id);
    else ordersBulkSelected.delete(o.id);
  });
  renderOrders(false);
}

function clearOrdersBulkSelection(){
  ordersBulkSelected.clear();
  renderOrders(false);
}

function bulkApplyOrderStatus(){
  if(isTourLeaderRole()){ toast('Bulk actions are for coordinators only', 'err'); return; }
  const sel=document.getElementById('orders-bulk-status-sel');
  const status=sel?.value||'';
  if(!status){ toast('Choose a status from the list first','info'); return; }
  const ids=[...ordersBulkSelected];
  if(!ids.length){ toast('Select one or more orders (checkboxes)','info'); return; }
  let n=0;
  ids.forEach(id=>{
    const o=db.orders.find(x=>x.id===id);
    if(o){ o.status=status; n++; }
  });
  syncLeaderStatusesFromSchedule(true);
  save();
  toast(`Updated status for ${n} order(s)`,'ok');
  renderDash(); renderToday(); updateBadges();
  populateLeaderDropdown();
  renderOrders(false);
}

function bulkApplyOrderLeader(){
  if(isTourLeaderRole()){ toast('Bulk actions are for coordinators only', 'err'); return; }
  const sel=document.getElementById('orders-bulk-leader-sel');
  const v=sel?.value;
  if(v===''||v==null){ toast('Pick a tour leader or Unassign all','info'); return; }
  const leaderId=v==='__clear__'?null:parseInt(v,10);
  if(leaderId!==null && !Number.isFinite(leaderId)){ toast('Invalid leader','err'); return; }
  const ids=[...ordersBulkSelected];
  if(!ids.length){ toast('Select one or more orders (checkboxes)','info'); return; }
  let ok=0, skip=0;
  ids.forEach(id=>{
    const o=db.orders.find(x=>x.id===id);
    if(!o) return;
    if(leaderId!==null && leaderAssignmentConflictsSchedule(leaderId, o.date, o.time, o.id)){
      skip++;
      return;
    }
    o.leaderId=leaderId;
    ok++;
  });
  syncLeaderStatusesFromSchedule(true);
  save();
  if(skip) toast(`Assigned leader on ${ok} order(s). ${skip} skipped (schedule overlap with that leader).`, ok ? 'ok' : 'err');
  else toast(`Updated leader on ${ok} order(s)`,'ok');
  renderDash(); renderToday(); updateBadges();
  populateLeaderDropdown();
  renderOrders(false);
}

function bulkDeleteOrders(){
  if(isTourLeaderRole()){ toast('Bulk actions are for coordinators only', 'err'); return; }
  const ids=[...ordersBulkSelected];
  if(!ids.length){ toast('Select orders to delete','info'); return; }
  if(!confirm(`Delete ${ids.length} order(s)? This cannot be undone.`)) return;
  const del=new Set(ids);
  db.orders=db.orders.filter(x=>!del.has(x.id));
  ordersBulkSelected.clear();
  syncLeaderStatusesFromSchedule(true);
  save();
  toast(`Deleted ${ids.length} order(s)`,'err');
  renderDash(); renderToday(); updateBadges();
  populateLeaderDropdown();
  renderOrders(false);
  if(currentOrderPageId!=null && del.has(currentOrderPageId)) closeOrderPage();
}

function exportOrdersExcelBulk(){
  if(!ensureXLSX()) return;
  const scopeSet = new Set(authOrdersScope().map(o => o.id));
  const ids = [...ordersBulkSelected].filter(id => scopeSet.has(id));
  if(!ids.length){ toast('Select orders first (checkboxes left of each row)', 'info'); return; }
  const pick=new Set(ids);
  const ordersPick=db.orders.filter(o=>pick.has(o.id));
  const orderRows=ordersPick.map(o=>({
    id:o.id,
    ref:o.ref||'',
    type:o.type||'',
    flight:o.flight||'',
    date:o.date||'',
    time:o.time||'',
    flight_type:o.flightType||'',
    dest:o.dest||'',
    adults:o.adults||0,
    children:o.children||0,
    child_ages_json:JSON.stringify(o.childAges||[]),
    leader_id:o.leaderId??'',
    rep:o.rep||'',
    driver:o.driver||'',
    vehicle_count: Array.isArray(o.vehicles) ? o.vehicles.length : 0,
    vehicles_json: JSON.stringify(o.vehicles || []),
    status:o.status||'',
    notes:o.notes||'',
    nat:o.nat||'',
    nationality_breakdown_json:JSON.stringify(o.nationalityBreakdown||[]),
    created_at:o.createdAt||'',
  }));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderRows), 'Orders');
  const expRows=[];
  ordersPick.forEach(o=>{
    (o.expenses||[]).forEach(ex=>{
      expRows.push({
        order_id:o.id,
        order_ref:o.ref||'',
        expense_id:ex.id,
        category:ex.category||'',
        amount:ex.amount,
        date:ex.date||'',
        notes:ex.notes||'',
      });
    });
  });
  if(expRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'Expenses');
  XLSX.writeFile(wb, `airport-orders-selected-${todayStr()}.xlsx`);
  toast(`Exported ${ordersPick.length} order(s)`,'ok');
}

function renderOrders(resetPage){
  if (resetPage) ordersListPage = 1;
  const tbody=document.getElementById('orders-tbody');
  if(!tbody) return;

  for(const id of [...ordersBulkSelected]){
    if(!authOrdersScope().some(o=>o.id===id)) ordersBulkSelected.delete(id);
  }

  const list=getFilteredOrdersList();
  const pagEl=document.getElementById('orders-pagination');
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / ordersPerPage));
  ordersListPage = Math.min(Math.max(1, ordersListPage), totalPages);

  if(!list.length){
    const assign=document.getElementById('order-filter-assign')?.value;
    const hint = assign==='unassigned'
      ? '<p class="empty-hint">Every visible order has a leader — or relax filters above.</p>'
      : assign==='assigned'
        ? '<p class="empty-hint">Try clearing assignment filter or add leaders from <strong>Tour Leaders</strong>.</p>'
        : '';
    tbody.innerHTML=`<tr><td colspan="10"><div class="empty"><div class="ei">📋</div><p>No matching orders</p>${hint}</div></td></tr>`;
    if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
    const metaEl=document.getElementById('orders-table-meta');
    if(metaEl){
      metaEl.innerHTML='<span><strong>0</strong> orders match current filters</span><span class="meta-mono">Try clearing search or filters above</span>';
    }
    syncOrderQuickFilterButtons();
    renderOrderFilterChips();
    populateOrdersBulkLeaderSelect();
    updateOrdersBulkBarVisibility();
    const hall=document.getElementById('orders-select-all-page');
    if(hall){ hall.checked=false; hall.indeterminate=false; }
    return;
  }

  const start = (ordersListPage - 1) * ordersPerPage;
  const pageRows = list.slice(start, start + ordersPerPage);
  const from = start + 1;
  const to = start + pageRows.length;

  if(pagEl){
    pagEl.innerHTML = buildPaginationHTML('orders', from, to, total, ordersListPage, totalPages, ordersPerPage);
    pagEl.hidden = false;
  }

  const metaEl=document.getElementById('orders-table-meta');
  if(metaEl){
    metaEl.innerHTML=
      `<span>Showing <strong>${from}</strong>–<strong>${to}</strong> of <strong>${total}</strong> order${total===1?'':'s'}</span>`+
      `<span class="meta-mono">${ordersPerPage} per page · page ${ordersListPage} / ${totalPages}</span>`;
  }

  const statusCls={'Scheduled':'b-blue','In progress':'b-amber','Completed':'b-green','Cancelled':'b-gray'};
  tbody.innerHTML=pageRows.map(o=>{
    const leader=db.leaders.find(l=>l.id==o.leaderId);
    const refTxt = o.ref||'ORD-'+String(o.id).padStart(4,'0');
    const sel=ordersBulkSelected.has(o.id)?' checked':'';
    return `<tr>
      <td class="td-cb" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select ${escapeHtml(refTxt)}" data-order-id="${o.id}"${sel} onchange="ordersBulkToggle(${o.id}, this.checked)"></td>
      <td style="font-family:var(--mono);font-size:10px;">
        <a href="#order/${o.id}" class="order-num-link">${refTxt}</a>
      </td>
      <td style="font-size:12px;color:var(--muted2);white-space:nowrap;">${fmtDate(o.date)}</td>
      <td><div class="time-chip">${o.time||'—'}</div></td>
      <td class="flight-no">${o.flight||'—'}</td>
      <td style="font-size:12px;">${escapeHtml(o.flightType||'Arrival')}</td>
      <td>${serviceBadge(o.type)}</td>
      <td>${leader?`<div class="person"><div class="av ${avClass(leader.id)}" style="width:26px;height:26px;font-size:10px">${leader.name[0]}</div>${leader.name}</div>`:'<span style="color:var(--red);font-size:11px">⚠️ Unassigned</span>'}</td>
      <td><span class="badge ${statusCls[o.status]||'b-gray'}">${o.status}</span></td>
      <td><div class="ibtn-row">
        <div class="ibtn" onclick="showDetail(${o.id})">👁️</div>
        <div class="ibtn" onclick="editOrder(${o.id})">✏️</div>
        <div class="ibtn del" onclick="deleteOrder(${o.id})">🗑️</div>
      </div></td>
    </tr>`;
  }).join('');
  syncOrdersBulkHeaderCheckbox(pageRows);
  populateOrdersBulkLeaderSelect();
  updateOrdersBulkBarVisibility();
  syncOrderQuickFilterButtons();
  renderOrderFilterChips();
}

function populateOrderTypeFilter(){
  const sel=document.getElementById('order-filter-type');
  sel.innerHTML='<option value="">All types</option>';
  db.services.forEach(s=>{ const o=document.createElement('option');o.value=s.name;o.textContent=s.name;sel.appendChild(o); });
}

function populateOrderServiceTypeSelect(){
  const sel=document.getElementById('o-type');
  if(!sel) return;
  const keep=sel.value;
  sel.innerHTML='';
  const ph=document.createElement('option');
  ph.value='';
  ph.textContent='— Select service type —';
  sel.appendChild(ph);
  db.services.forEach(s=>{
    const o=document.createElement('option');
    o.value=s.name;
    const ic=(s.icon&&String(s.icon).trim())?String(s.icon).trim()+' ':'';
    o.textContent=ic+s.name;
    sel.appendChild(o);
  });
  if(keep && [...sel.options].some(x=>x.value===keep)) sel.value=keep;
}

function setOrderServiceTypeValue(name){
  const sel=document.getElementById('o-type');
  if(!sel) return;
  if(!name){ sel.value=''; return; }
  if([...sel.options].some(o=>o.value===name)){ sel.value=name; return; }
  const o=document.createElement('option');
  o.value=name;
  o.textContent=name+' (not in list)';
  sel.appendChild(o);
  sel.value=name;
}

// ═══════════════════════════════════════
// RENDER TODAY
// ═══════════════════════════════════════
function renderToday(resetPage){
  if(resetPage) todayListPage = 1;
  const today=todayStr();
  document.getElementById('today-date-label').textContent=fmtDate(today);
  const list=authOrdersScope().filter(o=>o.date===today).sort((a,b)=>a.time.localeCompare(b.time));
  const el=document.getElementById('today-list');
  const pagEl=document.getElementById('today-pagination');
  if(!list.length){
    el.innerHTML='<div class="empty"><div class="ei">📅</div><p>No flights on today’s sheet</p><p class="empty-hint">Create orders with <strong>today’s date</strong> or pull work from <strong>All Orders</strong>.</p></div>';
    if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
    return;
  }
  const total=list.length;
  const totalPages=Math.max(1,Math.ceil(total/todayPerPage));
  todayListPage=Math.min(Math.max(1,todayListPage),totalPages);
  const start=(todayListPage-1)*todayPerPage;
  const pageRows=list.slice(start,start+todayPerPage);
  const from=start+1;
  const to=start+pageRows.length;
  if(pagEl){
    pagEl.innerHTML=buildPaginationHTML('today',from,to,total,todayListPage,totalPages,todayPerPage);
    pagEl.hidden=false;
  }
  el.innerHTML=pageRows.map(o=>orderQRow(o)).join('');
}

// ═══════════════════════════════════════
// RENDER LEADERS
// ═══════════════════════════════════════
function renderLeaders(resetPage){
  if (resetPage) leadersListPage = 1;
  const q=(document.getElementById('leader-search')?.value||'').toLowerCase();
  const list=db.leaders.filter(l=>!q||l.name.toLowerCase().includes(q));
  const tbody=document.getElementById('leaders-tbody');
  const pagEl=document.getElementById('leaders-pagination');
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / leadersPerPage));
  leadersListPage = Math.min(Math.max(1, leadersListPage), totalPages);

  if(!list.length){
    tbody.innerHTML=`<tr><td colspan="8"><div class="empty"><div class="ei">👥</div><p>No tour leaders</p></div></td></tr>`;
    if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
    return;
  }

  const start = (leadersListPage - 1) * leadersPerPage;
  const pageRows = list.slice(start, start + leadersPerPage);
  const from = start + 1;
  const to = start + pageRows.length;

  if(pagEl){
    pagEl.innerHTML = buildPaginationHTML('leaders', from, to, total, leadersListPage, totalPages, leadersPerPage);
    pagEl.hidden = false;
  }

  const now=new Date();
  const monthOrders=o=>{ const d=new Date(o.date+'T12:00:00');return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); };
  const bc={'Available':'b-green','Busy':'b-red','Off':'b-amber'};
  tbody.innerHTML=pageRows.map(l=>{
    const cnt=db.orders.filter(o=>o.leaderId==l.id&&monthOrders(o)).length;
    const ins = inferLeaderAvailabilityInsight(l);
    const modeTag = l.availabilityMode === 'manual'
      ? '<span style="font-size:9px;color:var(--muted2);display:block;margin-top:4px;">Manual roster</span>'
      : '<span style="font-size:9px;color:var(--muted2);display:block;margin-top:4px;">Auto roster</span>';
    return `<tr>
      <td><div class="person"><div class="av ${avClass(l.id)}">${l.name[0]}</div><div><div class="person-name">${escapeHtml(l.name)}</div><div class="person-id">ID-${String(l.id).padStart(3,'0')}</div></div></div></td>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(l.phone||'—')}</td>
      <td>${escapeHtml(l.spec||'—')}</td>
      <td><strong style="color:var(--amber)">${cnt}</strong> orders</td>
      <td title="${escapeHtml(ins.hint)}"><span class="badge ${ins.badge}">${escapeHtml(ins.label)}</span>${modeTag}</td>
      <td>${renderLeaderWorkloadTableCell(l)}</td>
      <td><span class="badge ${bc[l.status]||'b-gray'}">${escapeHtml(l.status)}</span></td>
      <td><div class="ibtn-row">
        <div class="ibtn" onclick="editLeader(${l.id})">✏️</div>
        <div class="ibtn" onclick="cycleLeaderStatus(${l.id})" title="Manual cycle (switches to manual mode)">🔄</div>
        <div class="ibtn del" onclick="deleteLeader(${l.id})">🗑️</div>
      </div></td>
    </tr>`;
  }).join('');
}

function cycleLeaderStatus(id){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage tour leaders', 'err'); return; }
  const l=db.leaders.find(x=>x.id===id);
  const s=['Available','Busy','Off'];
  l.availabilityMode = 'manual';
  l.status=s[(s.indexOf(l.status)+1)%3];
  save();renderLeaders();renderDash();populateLeaderDropdown();
  toast(`${l.name} → ${l.status} (manual roster)`,'info');
}
function deleteLeader(id){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage tour leaders', 'err'); return; }
  if(db.users.some(u => u.leaderId === id)){
    toast('Cannot delete: a user login is linked to this tour leader. Edit or remove that user first.', 'err');
    return;
  }
  if(!confirm('Delete this tour leader?'))return;
  db.leaders=db.leaders.filter(x=>x.id!==id);
  db.orders.forEach(o=>{if(o.leaderId==id)o.leaderId=null;});
  syncLeaderStatusesFromSchedule(true);
  save();renderLeaders();updateBadges();
  populateLeaderDropdown();
  toast('Deleted','err');
}

// ═══════════════════════════════════════
// RENDER SERVICES
// ═══════════════════════════════════════
function escapeHtml(str){
  return String(str??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function updateOrderDetailHead(o){
  const line = document.getElementById('order-detail-line');
  if(!line) return;
  const refTxt = o.ref||'ORD-'+String(o.id).padStart(4,'0');
  const statusCls = {'Scheduled':'b-blue','In progress':'b-amber','Completed':'b-green','Cancelled':'b-gray'}[o.status]||'b-gray';
  const leader = db.leaders.find(l=>l.id===o.leaderId);
  let leaderHtml = '';
  if(o.status!=='Cancelled'){
    if(!o.leaderId) leaderHtml = '<span class="od-warn">⚠ No leader</span>';
    else if(leader) leaderHtml = `<span class="od-leader" title="${escapeHtml(leader.name)}">${escapeHtml(leader.name)}</span>`;
  }
  const when = `${fmtDate(o.date)} · ${o.time||'—'}`;
  const dest = (o.dest||'').trim();
  const destHtml = dest
    ? `<span class="od-sep" aria-hidden="true">|</span><span class="od-chip od-chip-dest" title="${escapeHtml(dest)}">${escapeHtml(dest)}</span>`
    : '';
  line.innerHTML = `
    <span class="od-ref">${escapeHtml(refTxt)}</span>
    <span class="od-sep" aria-hidden="true">|</span>
    ${serviceBadge(o.type)}
    <span class="od-flight">${escapeHtml(o.flight||'—')}</span>
    <span class="od-sep" aria-hidden="true">|</span>
    <span class="od-when">${escapeHtml(when)}</span>
    ${destHtml}
    <span class="od-sep" aria-hidden="true">|</span>
    <span class="badge ${statusCls}">${escapeHtml(o.status)}</span>
    ${leaderHtml?`<span class="od-sep" aria-hidden="true">|</span>${leaderHtml}`:''}`;
}

function formatNationalityBreakdownDetailHTML(o){
  const rows=getNationalityBreakdown(o);
  if(!rows.length) return '<div class="dv">🌍 —</div>';
  const body=rows.map(r=>`<tr><td>${escapeHtml(r.nationality)}</td><td style="font-family:var(--mono);text-align:center">${r.adults}</td><td style="font-family:var(--mono);text-align:center">${r.children}</td></tr>`).join('');
  return `<table class="nat-mini-table"><thead><tr><th>Nationality</th><th style="text-align:center;width:72px">Adults</th><th style="text-align:center;width:72px">Children</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderServices(resetPage){
  if(resetPage) servicesListPage = 1;
  const tbody=document.getElementById('services-tbody');
  const pagEl=document.getElementById('services-pagination');
  if(!tbody) return;
  const statsEl=document.getElementById('services-list-stats');
  const qRaw=(document.getElementById('service-list-search')?.value||'').trim();
  const q=qRaw.toLowerCase();

  const orderCountFor=(type)=>authOrdersScope().filter(o=>o.type===type).length;
  const list=db.services.filter(s=>{
    if(!q) return true;
    const blob=[s.name,s.airport,s.description,s.includes,s.currency,s.color,String(s.cost||'')].map(x=>(x||'').toLowerCase()).join('\n');
    return blob.includes(q);
  });
  const typesInUse=db.services.filter(s=>orderCountFor(s.name)>0).length;

  if(statsEl){
    if(!db.services.length){
      statsEl.textContent='No service types yet — add your first one to use it in orders.';
    } else {
      const totalAssigned=db.orders.filter(o=>db.services.some(s=>s.name===o.type)).length;
      const base=`${db.services.length} type(s) · ${typesInUse} used in orders · ${totalAssigned} / ${db.orders.length} orders use a listed type · full details (description, includes, price…): View or Edit`;
      if(qRaw) statsEl.textContent=`Search: “${qRaw.slice(0,48)}${qRaw.length>48?'…':''}” · showing ${list.length} of ${db.services.length} · ${base}`;
      else statsEl.textContent=base;
    }
  }

  if(!db.services.length){
    tbody.innerHTML='<tr><td colspan="4"><div class="empty" style="padding:28px 16px 36px;"><div class="ei">⚙️</div><p>No services added yet</p><p style="font-size:12px;margin-top:8px;color:var(--muted2);max-width:420px;margin-left:auto;margin-right:auto;">Add each product you sell (arrival, VIP, transit…). Use <strong>View</strong> or <strong>Edit</strong> on a row to enter description, includes, default price, icon, and colour.</p></div></td></tr>';
    if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
    return;
  }

  if(!list.length){
    tbody.innerHTML='<tr><td colspan="4"><div class="empty" style="padding:28px 16px;"><div class="ei">🔍</div><p>No services match this search</p></div></td></tr>';
    if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
    return;
  }

  const total=list.length;
  const totalPages=Math.max(1,Math.ceil(total/servicesPerPage));
  servicesListPage=Math.min(Math.max(1,servicesListPage),totalPages);
  const start=(servicesListPage-1)*servicesPerPage;
  const pageRows=list.slice(start,start+servicesPerPage);
  const from=start+1;
  const to=start+pageRows.length;
  if(pagEl){
    pagEl.innerHTML=buildPaginationHTML('services',from,to,total,servicesListPage,totalPages,servicesPerPage);
    pagEl.hidden=false;
  }

  tbody.innerHTML=pageRows.map(s=>{
    const n=orderCountFor(s.name);
    const col=colorVar(s.color);
    const icon=escapeHtml(s.icon||'✈️');
    const name=escapeHtml(s.name);
    const ap=escapeHtml(s.airport||'');
    return `<tr>
      <td>
        <div class="svc-td-name">
          <div class="svc-td-ic" style="background:${col}22;color:${col}">${icon}</div>
          <div>
            <div class="svc-td-title">${name}</div>
            <div style="font-size:10px;color:var(--muted);font-family:var(--mono)">ID-${s.id}</div>
          </div>
        </div>
      </td>
      <td class="svc-cell-muted" title="${ap}">${ap||'—'}</td>
      <td style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--cyan);">${n}</td>
      <td><div class="ibtn-row">
        <div class="ibtn" onclick="viewService(${s.id})" title="View full details">👁️</div>
        <div class="ibtn" onclick="editService(${s.id})" title="Edit">✏️</div>
        <div class="ibtn del" onclick="deleteService(${s.id})" title="Delete">🗑️</div>
      </div></td>
    </tr>`;
  }).join('');
}
function deleteService(id){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage service types', 'err'); return; }
  const svc=db.services.find(x=>x.id===id);
  if(!svc) return;
  const n=db.orders.filter(o=>o.type===svc.name).length;
  const msg=n
    ? `Delete “${svc.name}”? It is linked on ${n} order(s). Orders keep the same label, but you lose this catalogue entry. Continue?`
    : `Delete “${svc.name}”?`;
  if(!confirm(msg)) return;
  db.services=db.services.filter(x=>x.id!==id);
  save();renderServices(false);
  populateOrderTypeFilter();
  populateOrderServiceTypeSelect();
  toast('Service deleted','err');
}

// ═══════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════
function sumOrderExpenses(o){
  if(!Array.isArray(o.expenses)) return 0;
  return o.expenses.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
}

function renderDashShiftIntel(today, todays){
  const kpiHost = document.getElementById('dash-kpi-strip');
  const nextEl = document.getElementById('dash-next-panel');
  const attnEl = document.getElementById('dash-attn-panel');
  const loadHint = document.getElementById('dash-load-hint');
  if(!kpiHost || !nextEl || !attnEl) return;

  const active = todays.filter(o => o.status !== 'Cancelled');
  const pax = active.reduce((s, o) => s + (parseInt(o.adults, 10) || 0) + (parseInt(o.children, 10) || 0), 0);
  const spend = active.reduce((s, o) => s + sumOrderExpenses(o), 0);
  const openToday = todays.filter(o => o.status !== 'Cancelled' && o.status !== 'Completed');
  const needLeader = openToday.filter(o => !o.leaderId).length;
  const staleList = todays.filter(o => o.status === 'Scheduled' && minutesUntilTodayTime(o.time) < -45)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const staleSlots = staleList.length;

  const fmtMoney = n => (Math.round(n)).toLocaleString('en-GB');

  kpiHost.innerHTML = `
    <div class="dash-kpi-tile">
      <div class="dash-kpi-lbl">PAX today</div>
      <div class="dash-kpi-val">${pax.toLocaleString('en-GB')}</div>
      <div class="dash-kpi-sub">Guests on non-cancelled orders dated today</div>
    </div>
    <div class="dash-kpi-tile">
      <div class="dash-kpi-lbl">Costs on the books</div>
      <div class="dash-kpi-val">${fmtMoney(spend)}</div>
      <div class="dash-kpi-sub">Expense lines recorded on today’s orders</div>
    </div>
    <div class="dash-kpi-tile${needLeader ? ' dash-kpi-tile--alert' : ''}">
      <div class="dash-kpi-lbl">Open · needs leader</div>
      <div class="dash-kpi-val">${needLeader}</div>
      <div class="dash-kpi-sub">Today’s open work still unassigned</div>
    </div>
    <div class="dash-kpi-tile${staleSlots ? ' dash-kpi-tile--alert' : ''}">
      <div class="dash-kpi-lbl">Stale “Scheduled”</div>
      <div class="dash-kpi-val">${staleSlots}</div>
      <div class="dash-kpi-sub">Slot passed 45+ min ago — reconcile status</div>
    </div>
  `;

  const openSorted = [...todays].filter(o => o.status !== 'Cancelled' && o.status !== 'Completed')
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  let nextPick = null;
  let nextKind = '';
  const upSoon = openSorted.filter(o => o.status === 'Scheduled' && minutesUntilTodayTime(o.time) >= -15);
  if(upSoon.length){
    nextPick = upSoon[0];
    nextKind = 'upcoming';
  } else {
    const live = openSorted.filter(o => o.status === 'In progress');
    if(live.length){
      nextPick = live[0];
      nextKind = 'live';
    } else {
      const sch = openSorted.filter(o => o.status === 'Scheduled');
      if(sch.length){
        nextPick = sch[0];
        nextKind = 'check';
      }
    }
  }

  if(!nextPick){
    nextEl.innerHTML = `<div class="dash-next-label">Next on the clock</div>
      <div class="dash-next-empty">No open work on today’s sheet.
        <div class="dash-next-actions" style="margin-top:10px">
          <button type="button" class="btn btn-ghost btn-sm" onclick="nav('today')">Open timeline</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="openOrderModal()">+ New order</button>
        </div>
      </div>`;
  } else {
    const refTxt = nextPick.ref || 'ORD-' + String(nextPick.id).padStart(4, '0');
    const ld = db.leaders.find(l => l.id == nextPick.leaderId);
    const mins = minutesUntilTodayTime(nextPick.time);
    let sub = '';
    if(nextKind === 'upcoming'){
      if(mins >= 0 && mins <= 240) sub = formatDueLabel(mins) + ' · confirm greeter, plate, and gate notes';
      else if(mins < 0) sub = 'Slot window open — confirm on-ground status';
      else sub = 'Later today — prep meet point & signage';
    } else if(nextKind === 'live') sub = 'In progress — watch handoff, luggage, and close-out';
    else sub = 'Still “Scheduled” — update time or advance status so the floor stays trustworthy';

    const vipBadge = /vip/i.test(nextPick.type || '') ? '<span class="badge b-amber">VIP</span>' : '';
    const paxO = (parseInt(nextPick.adults, 10) || 0) + (parseInt(nextPick.children, 10) || 0);
    const destShort = String(nextPick.dest || '').trim().slice(0, 56);

    nextEl.innerHTML = `
      <div class="dash-next-label">Next on the clock</div>
      <div class="dash-next-main">
        <div class="dash-next-time">${escapeHtml(nextPick.time || '—')}</div>
        <div class="dash-next-line">
          <span class="attn-flight">${escapeHtml(nextPick.flight || '—')}</span>${vipBadge}
          <span style="font-family:var(--mono);color:var(--muted2);font-size:11px;">${escapeHtml(refTxt)}</span>
        </div>
        <div class="dash-next-meta">${ld ? escapeHtml(ld.name) : '<span style="color:var(--amber)">No leader yet</span>'} · ${paxO} PAX${destShort ? ' · ' + escapeHtml(destShort) : ''}</div>
        <div class="dash-next-meta" style="margin-top:4px">${escapeHtml(sub)}</div>
      </div>
      <div class="dash-next-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="showDetail(${nextPick.id})">Open order</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="nav('today')">Full timeline</button>
      </div>`;
  }

  const attention = [];
  const noDriver = openToday.filter(o => o.leaderId && !orderTransportComplete(o));
  if(noDriver.length){
    attention.push({
      title: `${noDriver.length} job${noDriver.length === 1 ? '' : 's'} missing driver / vehicle details`,
      hint: 'Leader set but each vehicle line needs driver name and phone filled.',
      id: noDriver[0].id,
    });
  }
  if(staleSlots > 0 && staleList[0]){
    attention.push({
      title: `${staleSlots} “Scheduled” after their slot (from ${staleList[0].time || '—'})`,
      hint: 'Board honesty: mark in progress or complete.',
      id: staleList[0].id,
    });
  }
  const vipUn = openToday.filter(o => !o.leaderId && /vip/i.test(o.type || ''));
  if(vipUn.length){
    attention.push({
      title: `${vipUn.length} VIP open job${vipUn.length === 1 ? '' : 's'} without a tour leader`,
      hint: 'Premium exposure — assign your strongest opener.',
      id: vipUn[0].id,
    });
  }
  const vipNoRep = openToday.filter(o => /vip/i.test(o.type || '') && o.leaderId && !String(o.rep || '').trim());
  if(vipNoRep.length && attention.length < 4){
    attention.push({
      title: `${vipNoRep.length} VIP with leader but no rep / coordinator`,
      hint: 'Airline & lounge desks expect a named rep on VIP.',
      id: vipNoRep[0].id,
    });
  }

  if(!attention.length){
    attnEl.innerHTML = `<div class="dash-attn-label">Attention queue</div>
      <div class="dash-attn-empty">No hard execution gaps detected — keep clearing new slots and logging costs as they land.</div>`;
  } else {
    attnEl.innerHTML = `<div class="dash-attn-label">Attention queue</div>` + attention.slice(0, 4).map(a => `
      <button type="button" class="dash-attn-item" onclick="showDetail(${a.id})" title="Open order">
        <div>
          <div class="dash-attn-item-text">${escapeHtml(a.title)}</div>
          <div class="dash-attn-item-hint">${escapeHtml(a.hint)}</div>
        </div>
        <span class="dash-attn-go">Open →</span>
      </button>`).join('');
  }

  if(loadHint){
    const avail = db.leaders.filter(l => l.status === 'Available');
    const busyToday = db.leaders.map(l => ({
      l,
      n: db.orders.filter(o => o.leaderId === l.id && o.date === today && o.status !== 'Cancelled' && o.status !== 'Completed').length,
    })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const heaviest = busyToday[0];
    const idleAvail = avail.filter(l => !db.orders.some(o => o.leaderId === l.id && o.date === today && o.status !== 'Cancelled' && o.status !== 'Completed')).length;

    let parts = [];
    if(heaviest) parts.push(`<strong>${escapeHtml(heaviest.l.name)}</strong> is carrying <strong>${heaviest.n}</strong> open job${heaviest.n === 1 ? '' : 's'} today — watch overload.`);
    if(idleAvail && needLeader) parts.push(`<strong>${idleAvail}</strong> available guide${idleAvail === 1 ? '' : 's'} have <strong>no</strong> open jobs today — use them to drain the queue.`);
    if(!parts.length && avail.length) parts.push(`<strong>${avail.length}</strong> guide${avail.length === 1 ? '' : 's'} marked available for new assignments.`);
    if(parts.length){
      loadHint.innerHTML = parts.join(' ');
      loadHint.hidden = false;
    } else {
      loadHint.innerHTML = '';
      loadHint.hidden = true;
    }
  }
}

function getReportFilteredOrders(){
  const from = document.getElementById('rep-from')?.value || '';
  const to = document.getElementById('rep-to')?.value || '';
  return authOrdersScope().filter(o=>{
    const d = o.date || '';
    if(!from && !to) return true;
    if(!d) return false;
    if(from && d < from) return false;
    if(to && d > to) return false;
    return true;
  });
}

/** When date range is set, each expense line uses ex.date, else order.date, for the range check. */
function expenseLineInDateRange(ex, order){
  const from = document.getElementById('rep-from')?.value || '';
  const to = document.getElementById('rep-to')?.value || '';
  if(!from && !to) return true;
  const d = ex.date || order.date || '';
  if(!d) return false;
  if(from && d < from) return false;
  if(to && d > to) return false;
  return true;
}

function collectReportExpenseLines(){
  const orders = getReportFilteredOrders();
  const out = [];
  orders.forEach(o=>{
    (o.expenses||[]).forEach(ex=>{
      if(!expenseLineInDateRange(ex, o)) return;
      out.push({ ex, order: o });
    });
  });
  out.sort((a,b)=>{
    const da = a.ex.date || a.order.date || '';
    const db = b.ex.date || b.order.date || '';
    if(da !== db) return db.localeCompare(da);
    const am = (parseFloat(b.ex.amount)||0) - (parseFloat(a.ex.amount)||0);
    if(am) return am;
    return (b.order.id||0) - (a.order.id||0);
  });
  return out;
}

function repEsc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function orderExpenseTotalFromLines(orderId, lines){
  return lines.filter(x=>x.order.id===orderId).reduce((s,x)=>s+(parseFloat(x.ex.amount)||0),0);
}

function applyRepExpPageSlice(rowHtmlList){
  const body = document.getElementById('report-exp-detail-tbody');
  const pagEl = document.getElementById('report-exp-pagination');
  if(!body) return;
  const total = rowHtmlList.length;
  if(!total){
    if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / repExpPerPage));
  repExpPage = Math.min(Math.max(1, repExpPage), totalPages);
  const start = (repExpPage - 1) * repExpPerPage;
  const pageRows = rowHtmlList.slice(start, start + repExpPerPage);
  body.innerHTML = pageRows.join('');
  const from = start + 1;
  const to = start + pageRows.length;
  if(pagEl){
    pagEl.innerHTML = buildPaginationHTML('repExp', from, to, total, repExpPage, totalPages, repExpPerPage);
    pagEl.hidden = false;
  }
}

function renderExpenseBreakdownSection(lines, expGrandTotal){
  const head = document.getElementById('report-exp-detail-head');
  const body = document.getElementById('report-exp-detail-tbody');
  const pagEl = document.getElementById('report-exp-pagination');
  if(!head || !body) return;
  const mode = document.getElementById('rep-exp-breakdown-mode')?.value || 'lines';
  const denom = expGrandTotal > 0 ? expGrandTotal : 1;

  if(mode === 'lines'){
    head.innerHTML = '<tr><th>Date</th><th>Category</th><th style="text-align:right">Amount</th><th>Order</th><th>Flight</th><th>Service</th><th>Tour leader</th><th>Notes</th><th style="text-align:center">Files</th></tr>';
    if(!lines.length){
      body.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="ei">🧾</div><p>No expense lines match filters</p></div></td></tr>';
      if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
      return;
    }
    const rowHtmlList = lines.map(({ ex, order })=>{
      const amt = parseFloat(ex.amount)||0;
      const d = ex.date || order.date || '—';
      const ref = order.ref || 'ORD-'+String(order.id).padStart(4,'0');
      const ld = db.leaders.find(l=>l.id==order.leaderId);
      const note = (ex.notes||'').trim();
      const noteShort = note.length > 72 ? note.slice(0,72)+'…' : note;
      const fc = (ex.files && ex.files.length) ? ex.files.length : 0;
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px;color:var(--muted2)">${fmtDate(d)}</td>
        <td><span class="badge b-gray">${repEsc(ex.category||'Other')}</span></td>
        <td style="text-align:right;font-family:var(--mono);font-weight:800;color:var(--amber)">${amt.toFixed(0)}</td>
        <td><a href="#order/${order.id}" class="order-num-link">${ref}</a></td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--cyan)">${repEsc(order.flight||'—')}</td>
        <td>${repEsc(order.type||'—')}</td>
        <td>${ld ? repEsc(ld.name) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="font-size:11px;color:var(--muted2);max-width:220px;">${noteShort ? repEsc(noteShort) : '—'}</td>
        <td style="text-align:center;font-family:var(--mono);font-size:11px;">${fc || '—'}</td>
      </tr>`;
    });
    applyRepExpPageSlice(rowHtmlList);
    return;
  }

  if(mode === 'category'){
    head.innerHTML = '<tr><th>Category</th><th style="text-align:right">Lines</th><th style="text-align:right">Amount</th><th style="text-align:right">Share</th></tr>';
    const map = {};
    lines.forEach(({ ex })=>{
      const k = ex.category || 'Other';
      if(!map[k]) map[k] = { n: 0, s: 0 };
      map[k].n++;
      map[k].s += parseFloat(ex.amount)||0;
    });
    const rows = Object.entries(map).sort((a,b)=>b[1].s - a[1].s);
    if(!rows.length){
      body.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="ei">🧾</div><p>No data</p></div></td></tr>';
      if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
      return;
    }
    const rowHtmlList = rows.map(([k,v])=>{
      const pct = Math.round((v.s / denom) * 100);
      return `<tr><td>${repEsc(k)}</td><td style="text-align:right;font-family:var(--mono)">${v.n}</td><td style="text-align:right;font-family:var(--mono);font-weight:800;color:var(--amber)">${v.s.toFixed(0)}</td><td style="text-align:right;color:var(--muted2);font-family:var(--mono)">${pct}%</td></tr>`;
    });
    applyRepExpPageSlice(rowHtmlList);
    return;
  }

  if(mode === 'order'){
    head.innerHTML = '<tr><th>Order</th><th>Flight</th><th style="text-align:right">Lines</th><th style="text-align:right">Amount</th><th style="text-align:right">Share</th></tr>';
    const map = {};
    lines.forEach(({ ex, order })=>{
      const id = order.id;
      if(!map[id]) map[id] = { order, n: 0, s: 0 };
      map[id].n++;
      map[id].s += parseFloat(ex.amount)||0;
    });
    const rows = Object.values(map).sort((a,b)=>b.s - a.s);
    if(!rows.length){
      body.innerHTML = '<tr><td colspan="5"><div class="empty"><div class="ei">🧾</div><p>No data</p></div></td></tr>';
      if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
      return;
    }
    const rowHtmlList = rows.map(({ order, n, s })=>{
      const ref = order.ref || 'ORD-'+String(order.id).padStart(4,'0');
      const pct = Math.round((s / denom) * 100);
      return `<tr>
        <td><a href="#order/${order.id}" class="order-num-link">${ref}</a></td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--cyan)">${repEsc(order.flight||'—')}</td>
        <td style="text-align:right;font-family:var(--mono)">${n}</td>
        <td style="text-align:right;font-family:var(--mono);font-weight:800;color:var(--amber)">${s.toFixed(0)}</td>
        <td style="text-align:right;color:var(--muted2);font-family:var(--mono)">${pct}%</td>
      </tr>`;
    });
    applyRepExpPageSlice(rowHtmlList);
    return;
  }

  if(mode === 'leader'){
    head.innerHTML = '<tr><th>Tour leader</th><th style="text-align:right">Lines</th><th style="text-align:right">Amount</th><th style="text-align:right">Share</th></tr>';
    const map = {};
    lines.forEach(({ ex, order })=>{
      const lid = order.leaderId;
      const key = lid == null ? '__none__' : String(lid);
      if(!map[key]) map[key] = { lid, n: 0, s: 0 };
      map[key].n++;
      map[key].s += parseFloat(ex.amount)||0;
    });
    const rows = Object.values(map).sort((a,b)=>b.s - a.s);
    if(!rows.length){
      body.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="ei">🧾</div><p>No data</p></div></td></tr>';
      if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
      return;
    }
    const rowHtmlList = rows.map(({ lid, n, s })=>{
      const name = lid==null ? 'Unassigned' : (db.leaders.find(l=>l.id==lid)?.name || 'Unknown');
      const pct = Math.round((s / denom) * 100);
      return `<tr><td>${repEsc(name)}</td><td style="text-align:right;font-family:var(--mono)">${n}</td><td style="text-align:right;font-family:var(--mono);font-weight:800;color:var(--amber)">${s.toFixed(0)}</td><td style="text-align:right;color:var(--muted2);font-family:var(--mono)">${pct}%</td></tr>`;
    });
    applyRepExpPageSlice(rowHtmlList);
    return;
  }

  if(mode === 'date'){
    head.innerHTML = '<tr><th>Expense date</th><th style="text-align:right">Lines</th><th style="text-align:right">Amount</th><th style="text-align:right">Share</th></tr>';
    const map = {};
    lines.forEach(({ ex, order })=>{
      const d = ex.date || order.date || '—';
      if(!map[d]) map[d] = { n: 0, s: 0 };
      map[d].n++;
      map[d].s += parseFloat(ex.amount)||0;
    });
    const rows = Object.entries(map).sort((a,b)=>b[0].localeCompare(a[0]));
    if(!rows.length){
      body.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="ei">🧾</div><p>No data</p></div></td></tr>';
      if(pagEl){ pagEl.innerHTML=''; pagEl.hidden=true; }
      return;
    }
    const rowHtmlList = rows.map(([d,v])=>{
      const pct = Math.round((v.s / denom) * 100);
      const label = d === '—' ? '—' : fmtDate(d);
      return `<tr><td style="font-family:var(--mono);font-size:12px;">${label}</td><td style="text-align:right;font-family:var(--mono)">${v.n}</td><td style="text-align:right;font-family:var(--mono);font-weight:800;color:var(--amber)">${v.s.toFixed(0)}</td><td style="text-align:right;color:var(--muted2);font-family:var(--mono)">${pct}%</td></tr>`;
    });
    applyRepExpPageSlice(rowHtmlList);
  }
}

function csvEscape(v){
  const t = v==null ? '' : String(v);
  if(/[",\n\r]/.test(t)) return '"'+t.replace(/"/g,'""')+'"';
  return t;
}

function switchReportTab(tab){
  const keys = ['overview','expenses','teams'];
  keys.forEach(k=>{
    const panel = document.getElementById('rep-panel-'+k);
    const btn = document.getElementById('rep-tabbtn-'+k);
    const on = k === tab;
    if(panel) panel.classList.toggle('active', on);
    if(btn){ btn.classList.toggle('active', on); btn.setAttribute('aria-selected', on ? 'true' : 'false'); }
  });
}

function setReportPreset(key){
  const fromEl = document.getElementById('rep-from');
  const toEl = document.getElementById('rep-to');
  if(!fromEl || !toEl) return;
  const now = new Date();
  if(key==='all'){
    fromEl.value = '';
    toEl.value = '';
  } else if(key==='month'){
    const a = new Date(now.getFullYear(), now.getMonth(), 1);
    fromEl.value = a.toISOString().split('T')[0];
    toEl.value = now.toISOString().split('T')[0];
  } else if(key==='30d'){
    const a = new Date(now.getTime() - 29 * 86400000);
    fromEl.value = a.toISOString().split('T')[0];
    toEl.value = now.toISOString().split('T')[0];
  }
  resetReportPagination();
  renderReports();
}

function exportReportCsv(){
  const orders = getReportFilteredOrders();
  const expLines = collectReportExpenseLines();
  const headers = ['Order#','Date','Time','Flight','Service','Status','Tour leader','Adults','Children','PAX','Expenses','Destination','Nationality'];
  const lines = [headers.join(',')];
  orders.forEach(o=>{
    const ref = o.ref || 'ORD-'+String(o.id).padStart(4,'0');
    const ld = db.leaders.find(l=>l.id==o.leaderId);
    const pax = (parseInt(o.adults)||0) + (parseInt(o.children)||0);
    const expO = orderExpenseTotalFromLines(o.id, expLines).toFixed(2);
    lines.push([ref,o.date||'',o.time||'',o.flight||'',o.type||'',o.status||'',ld?ld.name:'',o.adults||0,o.children||0,pax,expO,o.dest||'',o.nat||''].map(csvEscape).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'orders-report.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2500);
  toast('CSV downloaded','ok');
}

function exportExpenseBreakdownCsv(){
  const lines = collectReportExpenseLines();
  const headers = ['ExpenseDate','Category','Amount','Order#','Flight','Service','TourLeader','Notes','Files'];
  const out = [headers.join(',')];
  lines.forEach(({ ex, order })=>{
    const d = ex.date || order.date || '';
    const ld = db.leaders.find(l=>l.id==order.leaderId);
    const ref = order.ref || 'ORD-'+String(order.id).padStart(4,'0');
    const fc = (ex.files && ex.files.length) ? ex.files.length : 0;
    out.push([d, ex.category||'Other', (parseFloat(ex.amount)||0).toFixed(2), ref, order.flight||'', order.type||'', ld?ld.name:'', ex.notes||'', fc].map(csvEscape).join(','));
  });
  const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'expense-breakdown.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2500);
  toast('Expenses CSV downloaded','ok');
}

// ═══════════════════════════════════════
// RENDER REPORTS
// ═══════════════════════════════════════
function renderReports(){
  const orders = getReportFilteredOrders();
  const expLines = collectReportExpenseLines();
  const expTotal = expLines.reduce((s,x)=>s+(parseFloat(x.ex.amount)||0), 0);
  const from = document.getElementById('rep-from')?.value || '';
  const to = document.getElementById('rep-to')?.value || '';
  const hint = document.getElementById('rep-hint');
  if(hint){
    hint.textContent = (!from && !to)
      ? 'All dates · expenses use each line date (or order date if blank)'
      : `Orders by flight date · expense lines by expense date (or order date): ${from || '…'} → ${to || '…'}`;
  }

  document.getElementById('r-total').textContent = orders.length;
  document.getElementById('r-done').textContent = orders.filter(o=>o.status==='Completed').length;
  document.getElementById('r-sched').textContent = orders.filter(o=>o.status==='Scheduled').length;
  document.getElementById('r-prog').textContent = orders.filter(o=>o.status==='In progress').length;
  document.getElementById('r-can').textContent = orders.filter(o=>o.status==='Cancelled').length;

  document.getElementById('r-expense').textContent = expTotal.toFixed(0);
  const paxTot = orders.reduce((s,o)=>s + (parseInt(o.adults)||0) + (parseInt(o.children)||0), 0);
  document.getElementById('r-pax').textContent = paxTot;
  const avgExp = orders.length ? (expTotal / orders.length) : 0;
  document.getElementById('r-exp-avg').textContent = avgExp.toFixed(0);

  const n = orders.length || 1;
  const svcBody = document.getElementById('report-service-tbody');
  const svcPag = document.getElementById('report-svc-pagination');
  const typeCount = {};
  orders.forEach(o=>{ const t = o.type || '—'; typeCount[t] = (typeCount[t]||0) + 1; });
  const typeEntries = Object.entries(typeCount).sort((a,b)=>b[1]-a[1]);
  if(!typeEntries.length){
    svcBody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="ei">📋</div><p>No orders in range</p></div></td></tr>`;
    if(svcPag){ svcPag.innerHTML=''; svcPag.hidden=true; }
  } else {
    const svcTotal = typeEntries.length;
    const svcTotalPages = Math.max(1, Math.ceil(svcTotal / repSvcPerPage));
    repSvcPage = Math.min(Math.max(1, repSvcPage), svcTotalPages);
    const svcStart = (repSvcPage - 1) * repSvcPerPage;
    const svcSlice = typeEntries.slice(svcStart, svcStart + repSvcPerPage);
    svcBody.innerHTML = svcSlice.map(([t,c])=>{
      const pct = Math.round((c/n)*100);
      return `<tr><td>${t}</td><td><strong style="color:var(--amber)">${c}</strong></td><td style="color:var(--muted2);font-family:var(--mono)">${pct}%</td></tr>`;
    }).join('');
    const svcFrom = svcStart + 1;
    const svcTo = svcStart + svcSlice.length;
    if(svcPag){
      svcPag.innerHTML = buildPaginationHTML('repSvc', svcFrom, svcTo, svcTotal, repSvcPage, svcTotalPages, repSvcPerPage);
      svcPag.hidden = false;
    }
  }

  const expBody = document.getElementById('report-expense-tbody');
  const catPag = document.getElementById('report-cat-pagination');
  const catSum = {};
  expLines.forEach(({ ex })=>{
    const c = ex.category || 'Other';
    catSum[c] = (catSum[c]||0) + (parseFloat(ex.amount)||0);
  });
  const catEntries = Object.entries(catSum).sort((a,b)=>b[1]-a[1]);
  const expDenom = expTotal > 0 ? expTotal : 1;
  if(!catEntries.length){
    expBody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="ei">🧾</div><p>No expenses in range</p></div></td></tr>`;
    if(catPag){ catPag.innerHTML=''; catPag.hidden=true; }
  } else {
    const catTotal = catEntries.length;
    const catTotalPages = Math.max(1, Math.ceil(catTotal / repCatPerPage));
    repCatPage = Math.min(Math.max(1, repCatPage), catTotalPages);
    const catStart = (repCatPage - 1) * repCatPerPage;
    const catSlice = catEntries.slice(catStart, catStart + repCatPerPage);
    expBody.innerHTML = catSlice.map(([c,a])=>{
      const pct = Math.round((a/expDenom)*100);
      return `<tr><td>${c}</td><td style="font-family:var(--mono);color:var(--amber);font-weight:800;">${a.toFixed(0)}</td><td style="color:var(--muted2);font-family:var(--mono)">${pct}%</td></tr>`;
    }).join('');
    const catFrom = catStart + 1;
    const catTo = catStart + catSlice.length;
    if(catPag){
      catPag.innerHTML = buildPaginationHTML('repCat', catFrom, catTo, catTotal, repCatPage, catTotalPages, repCatPerPage);
      catPag.hidden = false;
    }
  }

  renderExpenseBreakdownSection(expLines, expTotal);

  const tbody = document.getElementById('report-tbody');
  const leadPag = document.getElementById('report-lead-pagination');
  if(!db.leaders.length){
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="ei">📈</div><p>No tour leaders</p></div></td></tr>`;
    if(leadPag){ leadPag.innerHTML=''; leadPag.hidden=true; }
  } else {
    const leaderRows = db.leaders.map(l=>{
      const lt = orders.filter(o=>o.leaderId==l.id);
      const done = lt.filter(o=>o.status==='Completed').length;
      const sched = lt.filter(o=>o.status==='Scheduled').length;
      const prog = lt.filter(o=>o.status==='In progress').length;
      const can = lt.filter(o=>o.status==='Cancelled').length;
      const expL = expLines.filter(x=>x.order.leaderId==l.id).reduce((s,x)=>s+(parseFloat(x.ex.amount)||0),0);
      const pct = lt.length ? Math.round((done/lt.length)*100) : 0;
      const pc = pct>70 ? 'var(--green)' : pct>40 ? 'var(--amber)' : 'var(--red)';
      return `<tr>
        <td><div class="person"><div class="av ${avClass(l.id)}">${l.name[0]}</div>${l.name}</div></td>
        <td><strong style="color:var(--amber)">${lt.length}</strong></td>
        <td style="font-family:var(--mono);color:var(--cyan);font-weight:700;">${expL.toFixed(0)}</td>
        <td style="color:var(--green)">${done}</td>
        <td style="color:var(--blue)">${sched}</td>
        <td style="color:var(--purple)">${prog}</td>
        <td style="color:var(--red)">${can}</td>
        <td><div style="display:flex;align-items:center;gap:10px;">
          <div class="prog-wrap"><div class="prog-bar" style="width:${pct}%;background:${pc}"></div></div>
          <span style="font-size:11px;color:var(--muted2);width:34px">${pct}%</span>
        </div></td>
      </tr>`;
    });
    const ldTotal = leaderRows.length;
    const ldTotalPages = Math.max(1, Math.ceil(ldTotal / repLeadPerPage));
    repLeadPage = Math.min(Math.max(1, repLeadPage), ldTotalPages);
    const ldStart = (repLeadPage - 1) * repLeadPerPage;
    const ldSlice = leaderRows.slice(ldStart, ldStart + repLeadPerPage);
    tbody.innerHTML = ldSlice.join('');
    const ldFrom = ldStart + 1;
    const ldTo = ldStart + ldSlice.length;
    if(leadPag){
      leadPag.innerHTML = buildPaginationHTML('repLead', ldFrom, ldTo, ldTotal, repLeadPage, ldTotalPages, repLeadPerPage);
      leadPag.hidden = false;
    }
  }
}

// ═══════════════════════════════════════
// ORDER MODAL
// ═══════════════════════════════════════
let editingOrderId=null;
let pendingFiles=[];
let pendingExpenseFiles=[];

function buildChildrenAges(){
  const n=parseInt(document.getElementById('o-children').value)||0;
  const container=document.getElementById('children-ages-container');
  if(n<=0){container.innerHTML='';return;}
  container.innerHTML='<div style="margin-top:8px;"><div style="font-size:10px;color:var(--muted2);margin-bottom:6px;font-weight:700;">Children ages:</div>'
    +Array.from({length:n},(_,i)=>`
      <div class="child-row">
        <span>Child ${i+1}</span>
        <input class="child-age" type="number" min="0" max="17" placeholder="Age" id="child-age-${i}">
        <span>yrs</span>
      </div>`).join('')+'</div>';
}

function populateLeaderDropdown(){
  const sel=document.getElementById('o-leader');
  if(!sel) return;
  if(isTourLeaderRole() && currentUser && currentUser.leaderId){
    const me = db.leaders.find(l => l.id === currentUser.leaderId);
    sel.innerHTML = me
      ? `<option value="${me.id}">${escapeHtml(me.name)}</option>`
      : '<option value="">—</option>';
    if(me) sel.value = String(me.id);
    return;
  }
  const dateVal = document.getElementById('o-date')?.value || '';
  const timeVal = document.getElementById('o-time')?.value || '';
  const hasSlot = Boolean(dateVal && timeVal);
  const prev = sel.value;
  sel.innerHTML='<option value="">-- Select tour leader --</option>';
  const sorted = [...db.leaders].sort((a, b)=>leaderDropdownSortKey(b) - leaderDropdownSortKey(a));
  sorted.forEach(l=>{
    const o=document.createElement('option');
    o.value=l.id;
    const ins = inferLeaderAvailabilityInsight(l);
    const schedConflict = hasSlot && leaderAssignmentConflictsSchedule(l.id, dateVal, timeVal, editingOrderId);
    let suffix = '';
    if(l.status === 'Off') suffix = ' — Off duty';
    else if(schedConflict) suffix = ' — overlaps another order (~' + LEADER_SERVICE_BLOCK_MINS + ' min)';
    else if(ins.code === 'overlap') suffix = ' — overlap!';
    else if(ins.code === 'on_job') suffix = ' — on job';
    else if(l.status !== 'Available') suffix = ' (' + l.status + ')';
    o.textContent = l.name + suffix;
    o.title = leaderOpenJobsTitle(l);
    if(l.status === 'Off' || ins.code === 'overlap' || schedConflict) o.setAttribute('data-warn', '1');
    sel.appendChild(o);
  });
  if(prev){
    const opt = sel.querySelector('option[value="' + prev + '"]');
    if(opt) sel.value = prev;
  }
}

function collectNationalityBreakdownFromForm(){
  const c=document.getElementById('nat-breakdown-rows');
  if(!c) return [];
  return [...c.querySelectorAll('.nat-break-row')].map(row=>({
    nationality:(row.querySelector('.nat-br-name')?.value||'').trim(),
    adults:parseInt(row.querySelector('.nat-br-adults')?.value)||0,
    children:parseInt(row.querySelector('.nat-br-chld')?.value)||0,
  })).filter(r=>r.nationality);
}

function renderNationalityBreakdownRows(rows){
  const box=document.getElementById('nat-breakdown-rows');
  if(!box) return;
  if(!rows||!rows.length) rows=[{nationality:'',adults:0,children:0}];
  box.innerHTML=rows.map((r,i)=>`
    <div class="nat-break-row" data-idx="${i}">
      <input type="text" class="nat-br-name fg-in" placeholder="e.g. German, French…" value="${escapeHtml(r.nationality||'')}" oninput="syncNationalityTotalsHint()">
      <input type="number" class="nat-br-adults fg-in" min="0" placeholder="Adlt" value="${Number.isFinite(r.adults)?r.adults:0}" oninput="syncNationalityTotalsHint()">
      <input type="number" class="nat-br-chld fg-in" min="0" placeholder="Chld" value="${Number.isFinite(r.children)?r.children:0}" oninput="syncNationalityTotalsHint()">
      <button type="button" class="nat-br-remove" onclick="removeNationalityBreakdownRow(${i})" title="Remove line">✕</button>
    </div>
  `).join('');
  syncNationalityTotalsHint();
}

function addNationalityBreakdownRow(){
  const cur=collectNationalityBreakdownFromForm();
  cur.push({nationality:'',adults:0,children:0});
  renderNationalityBreakdownRows(cur);
}

function removeNationalityBreakdownRow(i){
  const all=document.querySelectorAll('#nat-breakdown-rows .nat-break-row');
  if(all.length<=1){
    renderNationalityBreakdownRows([{nationality:'',adults:0,children:0}]);
    return;
  }
  const cur=[];
  all.forEach(row=>{
    cur.push({
      nationality:(row.querySelector('.nat-br-name')?.value||'').trim(),
      adults:parseInt(row.querySelector('.nat-br-adults')?.value)||0,
      children:parseInt(row.querySelector('.nat-br-chld')?.value)||0,
    });
  });
  cur.splice(i,1);
  renderNationalityBreakdownRows(cur.length?cur:[{nationality:'',adults:0,children:0}]);
}

function syncNationalityTotalsHint(){
  const hint=document.getElementById('nat-breakdown-hint');
  if(!hint) return;
  const ta=parseInt(document.getElementById('o-adults')?.value)||0;
  const tc=parseInt(document.getElementById('o-children')?.value)||0;
  const rows=document.querySelectorAll('#nat-breakdown-rows .nat-break-row');
  let sa=0,sc=0;
  rows.forEach(row=>{
    const nm=(row.querySelector('.nat-br-name')?.value||'').trim();
    if(!nm) return;
    sa+=parseInt(row.querySelector('.nat-br-adults')?.value)||0;
    sc+=parseInt(row.querySelector('.nat-br-chld')?.value)||0;
  });
  const hasNamed=rows.length&&[...rows].some(row=>(row.querySelector('.nat-br-name')?.value||'').trim());
  if(!hasNamed){ hint.textContent=''; hint.classList.remove('warn'); return; }
  if(sa===ta&&sc===tc){
    hint.textContent='Breakdown sums match total adults / children.';
    hint.classList.remove('warn');
  } else {
    hint.textContent=`Breakdown sum: ${sa} adults + ${sc} children · Order total: ${ta} adults + ${tc} children — adjust lines or totals if needed.`;
    hint.classList.add('warn');
  }
}

function emptyVehicleRow(){
  return { vehicleType: '', ownership: 'company', driverName: '', driverPhone: '' };
}

function collectVehicleRowsFromForm(){
  const c = document.getElementById('veh-breakdown-rows');
  if(!c) return [];
  return [...c.querySelectorAll('.veh-break-row')].map(row => normalizeVehicleRow({
    vehicleType: row.querySelector('.veh-br-type')?.value,
    ownership: row.querySelector('.veh-br-own')?.value,
    driverName: row.querySelector('.veh-br-driver')?.value,
    driverPhone: row.querySelector('.veh-br-phone')?.value,
  })).filter(r => r.vehicleType || r.driverName || r.driverPhone);
}

function renderVehicleRows(rows){
  const box = document.getElementById('veh-breakdown-rows');
  if(!box) return;
  if(!rows || !rows.length) rows = [emptyVehicleRow()];
  box.innerHTML = rows.map((r, i) => {
    const rv = normalizeVehicleRow(r);
    const selCo = rv.ownership !== 'client' ? ' selected' : '';
    const selCl = rv.ownership === 'client' ? ' selected' : '';
    return `
    <div class="veh-break-row" data-idx="${i}">
      <input type="text" class="veh-br-type fg-in" placeholder="Vehicle type" value="${escapeHtml(rv.vehicleType)}" oninput="syncVehicleRowsHint()">
      <select class="veh-br-own fg-in" onchange="syncVehicleRowsHint()">
        <option value="company"${selCo}>Reserved (company vehicle)</option>
        <option value="client"${selCl}>Client's own vehicle</option>
      </select>
      <input type="text" class="veh-br-driver fg-in" placeholder="Driver name" value="${escapeHtml(rv.driverName)}" oninput="syncVehicleRowsHint()">
      <input type="tel" class="veh-br-phone fg-in" placeholder="Driver phone" value="${escapeHtml(rv.driverPhone)}" oninput="syncVehicleRowsHint()">
      <button type="button" class="veh-br-remove" onclick="removeVehicleRow(${i})" title="Remove vehicle">✕</button>
    </div>`;
  }).join('');
  syncVehicleRowsHint();
}

function addVehicleRow(){
  const cur = [...collectVehicleRowsFromForm().map(normalizeVehicleRow), emptyVehicleRow()];
  renderVehicleRows(cur.length ? cur : [emptyVehicleRow()]);
}

function removeVehicleRow(i){
  const all = document.querySelectorAll('#veh-breakdown-rows .veh-break-row');
  if(all.length <= 1){
    renderVehicleRows([emptyVehicleRow()]);
    return;
  }
  const cur = [];
  all.forEach(row => {
    cur.push(normalizeVehicleRow({
      vehicleType: row.querySelector('.veh-br-type')?.value,
      ownership: row.querySelector('.veh-br-own')?.value,
      driverName: row.querySelector('.veh-br-driver')?.value,
      driverPhone: row.querySelector('.veh-br-phone')?.value,
    }));
  });
  cur.splice(i, 1);
  renderVehicleRows(cur.length ? cur : [emptyVehicleRow()]);
}

function syncVehicleRowsHint(){
  const hint = document.getElementById('veh-breakdown-hint');
  if(!hint) return;
  const rows = document.querySelectorAll('#veh-breakdown-rows .veh-break-row');
  let filled = 0;
  rows.forEach(row => {
    const t = (row.querySelector('.veh-br-type')?.value || '').trim();
    const d = (row.querySelector('.veh-br-driver')?.value || '').trim();
    const p = (row.querySelector('.veh-br-phone')?.value || '').trim();
    if(t || d || p) filled++;
  });
  if(!filled){
    hint.textContent = '';
    hint.classList.remove('warn');
    return;
  }
  hint.textContent = `${filled} vehicle line${filled === 1 ? '' : 's'} · Driver name + phone required per vehicle for dashboard handoff.`;
  const incomplete = [...rows].some(row => {
    const t = (row.querySelector('.veh-br-type')?.value || '').trim();
    const d = (row.querySelector('.veh-br-driver')?.value || '').trim();
    const p = (row.querySelector('.veh-br-phone')?.value || '').trim();
    if(!t && !d && !p) return false;
    return !d || !p;
  });
  hint.classList.toggle('warn', incomplete);
}

function vehiclesForOrderForm(o){
  const raw = Array.isArray(o.vehicles) ? o.vehicles.map(normalizeVehicleRow).filter(x => x.vehicleType || x.driverName || x.driverPhone) : [];
  if(raw.length) return raw;
  const legacy = String(o.driver || '').trim();
  if(legacy) return [{ vehicleType: '', ownership: 'company', driverName: legacy, driverPhone: '' }];
  return [emptyVehicleRow()];
}

const ORDER_WIZARD_STEP_NAMES = [
  'Service type',
  'Flight',
  'Passengers',
  'Ground team',
  'Vehicles',
  'Status & notes',
  'Attachments'
];
let orderWizardStep = 0;

function resetOrderWizard(){
  orderWizardStep = 0;
  syncOrderWizardUi();
}

function syncOrderWizardUi(){
  const total = ORDER_WIZARD_STEP_NAMES.length;
  document.querySelectorAll('.order-wizard-step').forEach((el, i) => {
    el.classList.toggle('is-active', i === orderWizardStep);
  });
  document.querySelectorAll('.order-wizard-seg').forEach((seg, i) => {
    seg.classList.toggle('is-done', i < orderWizardStep);
    seg.classList.toggle('is-active', i === orderWizardStep);
  });
  const numEl = document.getElementById('order-wizard-step-num');
  const nameEl = document.getElementById('order-wizard-step-name');
  if(numEl) numEl.textContent = 'Step ' + (orderWizardStep + 1) + ' of ' + total;
  if(nameEl) nameEl.textContent = ORDER_WIZARD_STEP_NAMES[orderWizardStep] || '';
  const back = document.getElementById('order-wizard-back');
  const next = document.getElementById('order-wizard-next');
  const save = document.getElementById('order-wizard-save');
  if(back) back.hidden = orderWizardStep <= 0;
  if(next) next.hidden = orderWizardStep >= total - 1;
  if(save) save.hidden = orderWizardStep < total - 1;
  try{
    const body = document.querySelector('#order-overlay .modal-body');
    if(body) body.scrollTop = 0;
  }catch(e){}
}

function validateOrderWizardStep(step){
  if(step === 0){
    const type = document.getElementById('o-type') && document.getElementById('o-type').value;
    if(!type){ toast('Select a service type to continue', 'err'); return false; }
    return true;
  }
  if(step === 1){
    const flight = (document.getElementById('o-flight') && document.getElementById('o-flight').value || '').trim();
    const date = document.getElementById('o-date') && document.getElementById('o-date').value;
    const time = document.getElementById('o-time') && document.getElementById('o-time').value;
    if(!flight){ toast('Enter a flight number', 'err'); return false; }
    if(!date || !time){ toast('Set flight date and time', 'err'); return false; }
    return true;
  }
  return true;
}

function orderWizardGoNext(){
  if(!validateOrderWizardStep(orderWizardStep)) return;
  if(orderWizardStep < ORDER_WIZARD_STEP_NAMES.length - 1){
    orderWizardStep++;
    syncOrderWizardUi();
  }
}

function orderWizardGoPrev(){
  if(orderWizardStep > 0){
    orderWizardStep--;
    syncOrderWizardUi();
  }
}

function openOrderModal(){
  if(isTourLeaderRole()){ toast('Tour leaders cannot create new orders here', 'err'); return; }
  editingOrderId=null; pendingFiles=[];
  clearOrderForm();
  populateLeaderDropdown();
  document.getElementById('order-modal-title').textContent='✈️ New Order';
  openModal('order-overlay');
  // Auto-generate next order reference (preview)
  document.getElementById('o-ref').value = 'ORD-' + String(db.nextOrderId).padStart(4,'0');
  applyFlightAutofill();
}

function editOrder(id){
  const o=db.orders.find(x=>x.id===id);
  if(!o){ toast('Order not found','err'); return; }
  if(isTourLeaderRole() && o.leaderId !== currentUser.leaderId){
    toast('You can only edit orders assigned to you', 'err');
    return;
  }
  editingOrderId=id;
  clearOrderForm();
  setOrderServiceTypeValue(o.type||'');
  document.getElementById('o-flight').value=o.flight||'';
  document.getElementById('o-flightType').value=o.flightType||'Arrival';
  document.getElementById('o-date').value=o.date||'';
  document.getElementById('o-time').value=o.time||'';
  document.getElementById('o-dest').value=o.dest||'';
  document.getElementById('o-adults').value=o.adults||0;
  document.getElementById('o-children').value=o.children||0;
  buildChildrenAges();
  renderNationalityBreakdownRows(getNationalityBreakdown(o).length?getNationalityBreakdown(o):[{nationality:'',adults:0,children:0}]);
  if(o.childAges) o.childAges.forEach((a,i)=>{ const el=document.getElementById('child-age-'+i);if(el)el.value=a; });
  populateLeaderDropdown();
  document.getElementById('o-leader').value=o.leaderId?String(o.leaderId):'';
  document.getElementById('o-rep').value=o.rep||'';
  renderVehicleRows(vehiclesForOrderForm(o));
  document.getElementById('o-status').value=o.status||'Scheduled';
  document.getElementById('o-ref').value=o.ref||'';
  document.getElementById('o-notes').value=o.notes||'';
  pendingFiles=o.files?[...o.files]:[];
  renderFileList();
  document.getElementById('order-modal-title').textContent='✏️ Edit Order';
  openModal('order-overlay');
  applyFlightAutofill();
}

function clearOrderForm(){
  ['o-flight','o-date','o-time','o-dest','o-rep','o-ref','o-notes'].forEach(id=>document.getElementById(id).value='');
  const ls=document.getElementById('o-leader'); if(ls) ls.value='';
  document.getElementById('o-flightType').value='Arrival';
  document.getElementById('o-adults').value=0;
  document.getElementById('o-children').value=0;
  document.getElementById('o-status').value='Scheduled';
  document.getElementById('o-type').value='';
  document.getElementById('children-ages-container').innerHTML='';
  document.getElementById('file-list').innerHTML='';
  pendingFiles=[];
  populateOrderServiceTypeSelect();
  renderNationalityBreakdownRows([{nationality:'',adults:0,children:0}]);
  renderVehicleRows([emptyVehicleRow()]);
  resetOrderWizard();
}

function saveOrder(){
  const type=document.getElementById('o-type').value;
  const date=document.getElementById('o-date').value;
  const time=document.getElementById('o-time').value;
  const flight=document.getElementById('o-flight').value.trim();
  const flightType=document.getElementById('o-flightType').value;
  if(!type){
    toast('Please select a service type','err');
    orderWizardStep = 0;
    syncOrderWizardUi();
    return;
  }
  if(!date||!time){
    toast('Please set date and time','err');
    orderWizardStep = 1;
    syncOrderWizardUi();
    return;
  }

  let leaderPick=parseInt(document.getElementById('o-leader').value)||null;
  if(isTourLeaderRole()){
    if(!editingOrderId){ toast('Tour leaders cannot create orders here', 'err'); return; }
    leaderPick = currentUser.leaderId;
  }
  if(leaderPick && leaderAssignmentConflictsSchedule(leaderPick, date, time, editingOrderId)){
    toast('This tour leader already has another open order overlapping this slot (same-day windows of '+LEADER_SERVICE_BLOCK_MINS+' minutes). Choose another leader or change date/time.', 'err');
    orderWizardStep = 3;
    syncOrderWizardUi();
    return;
  }

  const nChildren=parseInt(document.getElementById('o-children').value)||0;
  const childAges=Array.from({length:nChildren},(_,i)=>{ const el=document.getElementById('child-age-'+i);return el?parseInt(el.value)||0:0; });

  const nb=collectNationalityBreakdownFromForm();
  const vehRows = collectVehicleRowsFromForm().map(normalizeVehicleRow);
  const orderData={
    type, flight, date, time,
    flightType,
    dest:document.getElementById('o-dest').value.trim(),
    nationalityBreakdown:nb,
    nat:formatNationalitySummaryFromRows(nb),
    adults:parseInt(document.getElementById('o-adults').value)||0,
    children:nChildren,
    childAges,
    leaderId:leaderPick,
    rep:document.getElementById('o-rep').value.trim(),
    vehicles: vehRows,
    driver: vehRows.length ? summarizeVehiclesFromRows(vehRows) : '',
    status:document.getElementById('o-status').value,
    ref:document.getElementById('o-ref').value.trim(),
    notes:document.getElementById('o-notes').value.trim(),
    files:pendingFiles
  };

  if(editingOrderId){
    const o=db.orders.find(x=>x.id===editingOrderId);
    const existingExpenses = Array.isArray(o.expenses) ? o.expenses : [];
    Object.assign(o,orderData);
    o.expenses = existingExpenses;
    toast('Order updated','ok');
  } else {
    orderData.id=db.nextOrderId++;
    orderData.createdAt=new Date().toISOString();
    if(!orderData.ref) orderData.ref = 'ORD-' + String(orderData.id).padStart(4,'0');
    orderData.expenses = [];
    db.orders.push(orderData);
    toast('Order created','ok');
  }
  syncLeaderStatusesFromSchedule(true);
  save(); closeModal('order-overlay'); updateBadges();
  renderDash(); renderOrders(!editingOrderId); renderToday();
  populateOrderTypeFilter();
  populateOrderServiceTypeSelect();
  populateLeaderDropdown();
}

// ═══════════════════════════════════════
// LEADER MODAL
// ═══════════════════════════════════════
let editingLeaderId=null;
function openLeaderModal(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage tour leaders', 'err'); return; }
  editingLeaderId=null;
  ['l-name','l-phone','l-spec','l-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('l-status').value='Available';
  const autoEl = document.getElementById('l-auto-availability');
  if(autoEl) autoEl.checked = true;
  document.getElementById('leader-modal-title').textContent='👤 Add tour leader';
  openModal('leader-overlay');
}
function editLeader(id){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage tour leaders', 'err'); return; }
  editingLeaderId=id;
  const l=db.leaders.find(x=>x.id===id);
  document.getElementById('l-name').value=l.name;
  document.getElementById('l-phone').value=l.phone||'';
  document.getElementById('l-spec').value=l.spec||'';
  document.getElementById('l-status').value=l.status;
  document.getElementById('l-notes').value=l.notes||'';
  const autoEl = document.getElementById('l-auto-availability');
  if(autoEl) autoEl.checked = l.availabilityMode !== 'manual';
  document.getElementById('leader-modal-title').textContent='✏️ Edit tour leader';
  openModal('leader-overlay');
}
function saveLeader(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage tour leaders', 'err'); return; }
  const name=document.getElementById('l-name').value.trim();
  if(!name){toast('Please enter a name','err');return;}
  const autoEl = document.getElementById('l-auto-availability');
  const availabilityMode = autoEl && autoEl.checked ? 'auto' : 'manual';
  const ld={
    name,
    phone:document.getElementById('l-phone').value.trim(),
    spec:document.getElementById('l-spec').value.trim(),
    status:document.getElementById('l-status').value,
    notes:document.getElementById('l-notes').value.trim(),
    availabilityMode,
  };
  if(editingLeaderId){
    Object.assign(db.leaders.find(x=>x.id===editingLeaderId), ld);
    toast('Updated','ok');
  } else {
    ld.id = db.nextLeaderId++;
    db.leaders.push(ld);
    toast('Added','ok');
  }
  syncLeaderStatusesFromSchedule(true);
  save();
  closeModal('leader-overlay');
  updateBadges();
  renderLeaders(!editingLeaderId);
  renderDash();
  populateLeaderDropdown();
}

// ═══════════════════════════════════════
// SERVICE MODAL
// ═══════════════════════════════════════
let pickedIcon='✈️';
let editingServiceId=null;
let serviceModalViewOnly=false;

function setServiceModalBanner(text){
  const b=document.getElementById('service-modal-banner');
  if(!b) return;
  if(text){ b.style.display='block'; b.textContent=text; }
  else{ b.style.display='none'; b.textContent=''; }
}

function clearServiceForm(){
  ['sv-name','sv-icon','sv-desc','sv-airport','sv-includes','sv-cost','sv-currency'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
  document.getElementById('sv-color').value='green';
  pickedIcon='✈️';
}

function fillServiceForm(s){
  document.getElementById('sv-name').value=s.name||'';
  document.getElementById('sv-icon').value=s.icon||'';
  document.getElementById('sv-color').value=s.color||'green';
  pickedIcon=s.icon||'✈️';
  document.getElementById('sv-desc').value=s.description||'';
  document.getElementById('sv-airport').value=s.airport||'';
  document.getElementById('sv-includes').value=s.includes||'';
  document.getElementById('sv-cost').value=s.cost!==undefined&&s.cost!==null&&s.cost!==''?s.cost:'';
  document.getElementById('sv-currency').value=s.currency||'EGP';
}

function setServiceFormReadonly(ro){
  ['sv-name','sv-icon','sv-desc','sv-airport','sv-includes','sv-cost','sv-currency'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.readOnly=ro;
  });
  const ip=document.getElementById('icon-picker');
  const sw=document.getElementById('sv-color-swatches');
  if(ip){ ip.style.pointerEvents=ro?'none':''; ip.style.opacity=ro?'.45':'1'; }
  if(sw){ sw.style.pointerEvents=ro?'none':''; sw.style.opacity=ro?'.45':'1'; }
}

function openServiceModal(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage service types', 'err'); return; }
  editingServiceId=null;
  serviceModalViewOnly=false;
  clearServiceForm();
  setServiceModalBanner('');
  setServiceFormReadonly(false);
  document.getElementById('service-modal-title').textContent='⚙️ Add service type';
  document.getElementById('sv-btn-save').style.display='';
  document.getElementById('sv-btn-edit').style.display='none';
  document.getElementById('sv-btn-cancel').textContent='Cancel';
  openModal('service-overlay');
}

function viewService(id){
  const s=db.services.find(x=>x.id===id);
  if(!s) return;
  editingServiceId=id;
  serviceModalViewOnly=true;
  fillServiceForm(s);
  setServiceFormReadonly(true);
  setServiceModalBanner('Service sheet (read-only). Description, includes, default price, icon and colour are all on this screen — use Edit to change anything.');
  document.getElementById('service-modal-title').textContent='👁️ '+s.name;
  document.getElementById('sv-btn-save').style.display='none';
  document.getElementById('sv-btn-edit').style.display='';
  document.getElementById('sv-btn-cancel').textContent='Close';
  openModal('service-overlay');
}

function switchServiceModalToEdit(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage service types', 'err'); return; }
  serviceModalViewOnly=false;
  setServiceModalBanner('');
  setServiceFormReadonly(false);
  const s=db.services.find(x=>x.id===editingServiceId);
  document.getElementById('service-modal-title').textContent=s?'✏️ Edit: '+s.name:'✏️ Edit service type';
  document.getElementById('sv-btn-save').style.display='';
  document.getElementById('sv-btn-edit').style.display='none';
  document.getElementById('sv-btn-cancel').textContent='Cancel';
}

function editService(id){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage service types', 'err'); return; }
  const s=db.services.find(x=>x.id===id);
  if(!s) return;
  editingServiceId=id;
  serviceModalViewOnly=false;
  fillServiceForm(s);
  setServiceModalBanner('');
  setServiceFormReadonly(false);
  document.getElementById('service-modal-title').textContent='✏️ Edit: '+s.name;
  document.getElementById('sv-btn-save').style.display='';
  document.getElementById('sv-btn-edit').style.display='none';
  document.getElementById('sv-btn-cancel').textContent='Cancel';
  openModal('service-overlay');
}

function pickIcon(i){pickedIcon=i;document.getElementById('sv-icon').value=i;}
function pickColor(c){document.getElementById('sv-color').value=c;}

function saveService(){
  if(!canManageLeadersAndServices()){ toast('Only supervisors and admins manage service types', 'err'); return; }
  if(serviceModalViewOnly) return;
  const name=document.getElementById('sv-name').value.trim();
  if(!name){toast('Please enter a service name','err');return;}
  const icon=document.getElementById('sv-icon').value||pickedIcon;
  const color=document.getElementById('sv-color').value;
  const payload={
    name,
    icon,
    color,
    description:document.getElementById('sv-desc').value.trim(),
    airport:document.getElementById('sv-airport').value.trim(),
    includes:document.getElementById('sv-includes').value.trim(),
    cost:document.getElementById('sv-cost').value.trim(),
    currency:document.getElementById('sv-currency').value.trim()||'EGP',
  };
  if(editingServiceId){
    const s=db.services.find(x=>x.id===editingServiceId);
    if(!s){toast('Service not found','err');return;}
    const oldName=s.name;
    Object.assign(s,migrateService({...s,...payload,id:editingServiceId}));
    if(oldName!==name) db.orders.forEach(o=>{ if(o.type===oldName) o.type=name; });
    toast('Service updated','ok');
  } else {
    db.services.push(migrateService({id:db.nextServiceId++,...payload}));
    toast('Service added','ok');
  }
  save();closeModal('service-overlay');renderServices(!editingServiceId);
  populateOrderTypeFilter();
  populateOrderServiceTypeSelect();
}

// ═══════════════════════════════════════
// FILE HANDLING
// ═══════════════════════════════════════
function handleFiles(files){
  Array.from(files).forEach(f=>{
    const reader=new FileReader();
    reader.onload=e=>{
      pendingFiles.push({name:f.name,size:f.size,data:e.target.result,type:f.type});
      renderFileList();
    };
    reader.readAsDataURL(f);
  });
}
function renderFileList(){
  const el=document.getElementById('file-list');
  el.innerHTML=pendingFiles.map((f,i)=>`
    <div class="file-item">
      <span>${f.name.endsWith('.pdf')?'📄':f.type?.startsWith('image')?'🖼️':'📎'}</span>
      <span class="fname">${f.name}</span>
      <span class="fsize">${(f.size/1024).toFixed(0)} KB</span>
      ${f.data?`<a href="${f.data}" download="${f.name}" style="color:var(--cyan);font-size:11px;text-decoration:none;">⬇️</a>`:''}
      <span class="file-del" onclick="removeFile(${i})">✕</span>
    </div>`).join('');
}
function removeFile(i){pendingFiles.splice(i,1);renderFileList();}

function handleExpenseFiles(files){
  Array.from(files||[]).forEach(f=>{
    const reader=new FileReader();
    reader.onload=e=>{
      pendingExpenseFiles.push({name:f.name,size:f.size,data:e.target.result,type:f.type});
      renderExpenseFileList();
    };
    reader.readAsDataURL(f);
  });
}
function renderExpenseFileList(){
  const el=document.getElementById('ex-file-list');
  if(!el) return;
  el.innerHTML=pendingExpenseFiles.map((f,i)=>`
    <div class="file-item">
      <span>${f.name.endsWith('.pdf')?'📄':f.type?.startsWith('image')?'🖼️':'📎'}</span>
      <span class="fname">${f.name}</span>
      <span class="fsize">${(f.size/1024).toFixed(0)} KB</span>
      ${f.data?`<a href="${f.data}" download="${f.name.replace(/"/g,'')}" style="color:var(--cyan);font-size:11px;text-decoration:none;">⬇️</a>`:''}
      <span class="file-del" onclick="removeExpenseFile(${i})">✕</span>
    </div>`).join('');
}
function removeExpenseFile(i){pendingExpenseFiles.splice(i,1);renderExpenseFileList();}

function switchOrderTab(key){
  const keys = ['trip', 'passengers', 'ground', 'notes', 'expenses'];
  const k = keys.includes(key) ? key : 'trip';
  keys.forEach(id => {
    const btn = document.getElementById('tab-btn-' + id);
    const panel = document.getElementById('tab-' + id);
    if(btn){
      btn.classList.toggle('active', id === k);
      btn.setAttribute('aria-selected', id === k ? 'true' : 'false');
    }
    if(panel) panel.classList.toggle('active', id === k);
  });
}

function renderExpensesList(order){
  if(!order?.expenses?.length){
    return `<div class="empty"><div class="ei">🧾</div><p>No expenses yet</p></div>`;
  }
  const rows = order.expenses
    .slice()
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))
    .map(ex=>{
      const amt = (parseFloat(ex.amount)||0);
      const att = (ex.files&&ex.files.length)
        ? `<div style="margin-top:6px;width:100%;">${ex.files.map(f=>`
            <div class="file-item" style="margin-top:4px;padding:6px 8px;">
              <span>${f.name.endsWith('.pdf')?'📄':f.type?.startsWith('image')?'🖼️':'📎'}</span>
              <span class="fname">${f.name}</span>
              <span class="fsize">${((f.size||0)/1024).toFixed(0)} KB</span>
              ${f.data?`<a href="${f.data}" download="${(f.name||'receipt').replace(/"/g,'')}" style="color:var(--cyan);font-size:11px;text-decoration:none;">⬇️</a>`:''}
            </div>`).join('')}</div>`
        : '';
      return `<div class="file-item" style="align-items:flex-start;flex-wrap:wrap;">
        <span>🧾</span>
        <span class="fname" style="white-space:normal;flex:1;min-width:140px;">
          <strong style="color:var(--text);">${ex.category||'Expense'}</strong>
          <span style="color:var(--muted);font-family:var(--mono);font-size:10px;margin-left:8px;">${ex.date?fmtDate(ex.date):'—'}</span>
          ${ex.notes?`<div style="color:var(--muted2);margin-top:3px;font-size:11px;font-weight:600;">${ex.notes}</div>`:''}
          ${att}
        </span>
        <span class="fsize" style="color:var(--amber);font-weight:900;">${amt.toFixed(0)}</span>
        <span class="file-del" onclick="deleteOrderExpense(${order.id}, ${ex.id})" title="Delete">✕</span>
      </div>`;
    }).join('');
  return rows;
}

function addOrderExpense(orderId){
  const o = db.orders.find(x=>x.id===orderId);
  if(!o) return;
  if(!Array.isArray(o.expenses)) o.expenses = [];

  const cat = document.getElementById('ex-cat')?.value || 'Other';
  const amountRaw = document.getElementById('ex-amount')?.value;
  const amount = parseFloat(amountRaw);
  const date = document.getElementById('ex-date')?.value || todayStr();
  const notes = (document.getElementById('ex-notes')?.value || '').trim();

  if(!Number.isFinite(amount) || amount <= 0){
    toast('Please enter a valid amount','err');
    return;
  }

  const nextId = (o.expenses.reduce((m,e)=>Math.max(m, e.id||0), 0) || 0) + 1;
  const expFiles = pendingExpenseFiles.slice();
  o.expenses.push({
    id: nextId,
    category: cat,
    amount: amount,
    date,
    notes,
    files: expFiles.length ? expFiles : [],
    createdAt: new Date().toISOString()
  });
  save();
  pendingExpenseFiles = [];
  const exFileIn = document.getElementById('ex-file-input');
  if(exFileIn) exFileIn.value = '';
  renderExpenseFileList();

  const listEl = document.getElementById('expenses-list');
  if(listEl) listEl.innerHTML = renderExpensesList(o);

  const amtEl = document.getElementById('ex-amount');
  const notesEl = document.getElementById('ex-notes');
  if(amtEl) amtEl.value = '';
  if(notesEl) notesEl.value = '';

  refreshOrderDetailPageIfOpen(orderId);
  switchOrderTab('expenses');
  toast('Expense added','ok');
}

function deleteOrderExpense(orderId, expenseId){
  const o = db.orders.find(x=>x.id===orderId);
  if(!o || !Array.isArray(o.expenses)) return;
  o.expenses = o.expenses.filter(e=>e.id!==expenseId);
  save();
  refreshOrderDetailPageIfOpen(orderId);
  switchOrderTab('expenses');
  toast('Expense deleted','err');
}

// ═══════════════════════════════════════
// ORDER DETAIL (full page, hash #order/ID)
// ═══════════════════════════════════════
function formatVehiclesDetailHTML(o){
  const vs = Array.isArray(o.vehicles)
    ? o.vehicles.map(normalizeVehicleRow).filter(v => v.vehicleType || v.driverName || v.driverPhone)
    : [];
  if(vs.length){
    const body = vs.map((v, i) => {
      const own = v.ownership === 'client'
        ? "Client's vehicle"
        : 'Company reserved';
      return `<tr><td>${i + 1}</td><td>${escapeHtml(v.vehicleType || '—')}</td><td>${own}</td><td>${escapeHtml(v.driverName || '—')}</td><td style="font-family:var(--mono);">${escapeHtml(v.driverPhone || '—')}</td></tr>`;
    }).join('');
    return `<table class="nat-mini-table" style="margin-top:6px;"><thead><tr><th>#</th><th>Type</th><th>Ownership</th><th>Driver</th><th>Phone</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  const leg = String(o.driver || '').trim();
  if(leg) return `<div class="dv">${escapeHtml(leg)}</div>`;
  return `<div class="dv">—</div>`;
}

function buildOrderDetailBodyHTML(o){
  if(!Array.isArray(o.expenses)) o.expenses = [];
  const leader=db.leaders.find(l=>l.id==o.leaderId);
  const statusCls={'Scheduled':'b-blue','In progress':'b-amber','Completed':'b-green','Cancelled':'b-gray'};
  const expTotal = o.expenses.reduce((sum,e)=>sum+(parseFloat(e.amount)||0),0);
  return `<div class="order-detail-body-shell">
    <div class="order-detail-layout">
    <nav class="order-detail-side-nav" role="tablist" aria-label="Order sections">
      <button type="button" role="tab" class="tab-btn active" id="tab-btn-trip" onclick="switchOrderTab('trip')" aria-selected="true" aria-controls="tab-trip">Trip</button>
      <button type="button" role="tab" class="tab-btn" id="tab-btn-passengers" onclick="switchOrderTab('passengers')" aria-selected="false" aria-controls="tab-passengers">Passengers</button>
      <button type="button" role="tab" class="tab-btn" id="tab-btn-ground" onclick="switchOrderTab('ground')" aria-selected="false" aria-controls="tab-ground">Ground</button>
      <button type="button" role="tab" class="tab-btn" id="tab-btn-notes" onclick="switchOrderTab('notes')" aria-selected="false" aria-controls="tab-notes">Notes &amp; files</button>
      <button type="button" role="tab" class="tab-btn" id="tab-btn-expenses" onclick="switchOrderTab('expenses')" aria-selected="false" aria-controls="tab-expenses">Expenses <span style="color:var(--muted2);font-family:var(--mono);font-size:11px;">(${expTotal.toFixed(0)})</span></button>
    </nav>

    <div class="order-detail-main">
    <div class="tab-panel active" id="tab-trip" role="tabpanel" aria-labelledby="tab-btn-trip">
      <div class="detail-grid">
        <div class="detail-item"><div class="dl">Order #</div><div class="dv" style="font-family:var(--mono);color:var(--muted2);">${o.ref||'ORD-'+String(o.id).padStart(4,'0')}</div></div>
        <div class="detail-item"><div class="dl">Flight</div><div class="dv" style="color:var(--cyan);font-family:var(--mono)">${o.flight||'—'}</div></div>
        <div class="detail-item"><div class="dl">Flight type</div><div class="dv">${o.flightType||'Arrival'}</div></div>
        <div class="detail-item"><div class="dl">Date &amp; time</div><div class="dv">${fmtDate(o.date)} <span style="color:var(--amber);font-family:var(--mono)">${o.time||''}</span></div></div>
        <div class="detail-item"><div class="dl">Destination</div><div class="dv">${o.dest||'—'}</div></div>
        <div class="detail-item"><div class="dl">Status</div><div class="dv"><span class="badge ${statusCls[o.status]||'b-gray'}">${o.status}</span></div></div>
      </div>
    </div>

    <div class="tab-panel" id="tab-passengers" role="tabpanel" aria-labelledby="tab-btn-passengers">
      <div class="detail-grid">
        <div class="detail-item" style="grid-column:1/-1;"><div class="dl">Nationality breakdown</div>${formatNationalityBreakdownDetailHTML(o)}</div>
        <div class="detail-item"><div class="dl">Adults</div><div class="dv">${o.adults||0}</div></div>
        <div class="detail-item"><div class="dl">Children</div><div class="dv">${o.children||0}${o.childAges?.length?' <span style="color:var(--muted2);font-weight:600;">(ages: '+o.childAges.join(', ')+')</span>':''}</div></div>
      </div>
    </div>

    <div class="tab-panel" id="tab-ground" role="tabpanel" aria-labelledby="tab-btn-ground">
      <div class="detail-grid">
        <div class="detail-item"><div class="dl">Tour leader</div><div class="dv">${leader?leader.name:'⚠️ Unassigned'}</div></div>
        <div class="detail-item"><div class="dl">Airport rep</div><div class="dv">${o.rep||'—'}</div></div>
        <div class="detail-item" style="grid-column:1/-1;"><div class="dl">Vehicles (${Array.isArray(o.vehicles) ? o.vehicles.length : 0})</div>${formatVehiclesDetailHTML(o)}</div>
      </div>
    </div>

    <div class="tab-panel" id="tab-notes" role="tabpanel" aria-labelledby="tab-btn-notes">
      <div class="detail-item" style="margin-bottom:12px;"><div class="dl">Notes</div><div class="dv" style="font-weight:500;font-size:12px;color:${o.notes?'var(--muted2)':'var(--muted)'};white-space:pre-wrap;">${o.notes?escapeHtml(String(o.notes)):'—'}</div></div>
      <div style="font-size:10px;font-weight:700;color:var(--blue);letter-spacing:1px;margin-bottom:8px;">Attachments</div>
      ${o.files?.length?o.files.map(f=>`<div class="file-item"><span>${f.name.endsWith('.pdf')?'📄':f.type?.startsWith('image')?'🖼️':'📎'}</span><span class="fname">${f.name}</span><span class="fsize">${(f.size/1024).toFixed(0)} KB</span>${f.data?`<a href="${f.data}" download="${f.name}" style="color:var(--cyan);font-size:11px;text-decoration:none;">⬇️ Download</a>`:''}</div>`).join(''):'<div class="detail-item"><div class="dv" style="color:var(--muted2);font-weight:500;font-size:12px;">No files attached</div></div>'}
    </div>

    <div class="tab-panel" id="tab-expenses" role="tabpanel" aria-labelledby="tab-btn-expenses">
      <div class="card" style="margin-bottom:12px;">
        <div class="card-head">
          <div class="card-head-main">
            <div class="card-title"><span class="dot" style="background:var(--amber)"></span> Add expense</div>
          </div>
        </div>
        <div style="padding:14px 16px;">
          <div class="form-grid g3">
            <div class="fg">
              <label>Category</label>
              <select id="ex-cat">
                <option value="Allowance">Allowance</option>
                <option value="Uber">Uber</option>
                <option value="Taxi">Taxi</option>
                <option value="Meals">Meals</option>
                <option value="Tips">Tips</option>
                <option value="Parking">Parking</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div class="fg">
              <label>Amount</label>
              <input id="ex-amount" type="number" min="0" step="0.01" placeholder="0">
            </div>
            <div class="fg">
              <label>Date</label>
              <input id="ex-date" type="date" value="${o.date||todayStr()}">
            </div>
          </div>
          <div class="fg" style="margin-bottom:0;">
            <label>Notes</label>
            <input id="ex-notes" type="text" placeholder="Optional...">
          </div>
          <div class="fg" style="margin-bottom:0;">
            <label>Attachments (receipt, invoice…)</label>
            <div class="attach-zone" onclick="document.getElementById('ex-file-input').click()">📎 Click to add files</div>
            <input type="file" id="ex-file-input" multiple style="display:none" onchange="handleExpenseFiles(this.files); this.value=''">
            <div class="file-list" id="ex-file-list"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:10px;">
            <button class="btn btn-primary btn-sm" onclick="addOrderExpense(${o.id})">+ Add</button>
            <div style="margin-left:auto;color:var(--muted2);font-family:var(--mono);font-size:12px;display:flex;align-items:center;">
              Total: <span style="color:var(--amber);font-weight:800;margin-left:6px;">${expTotal.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-head-main">
            <div class="card-title"><span class="dot" style="background:var(--blue)"></span> Expenses list</div>
          </div>
        </div>
        <div style="padding:10px 12px;" id="expenses-list">
          ${renderExpensesList(o)}
        </div>
      </div>
    </div>
    </div>
    </div>
  </div>`;
}

function refreshOrderDetailPageIfOpen(orderId){
  if(currentOrderPageId!==orderId) return;
  const pageEl = document.getElementById('p-order-detail');
  if(!pageEl || !pageEl.classList.contains('active')) return;
  const o = db.orders.find(x=>x.id===orderId);
  if(!o) return;
  document.getElementById('order-detail-content').innerHTML = buildOrderDetailBodyHTML(o);
  updateOrderDetailHead(o);
}

function showOrderDetailPage(id){
  const o=db.orders.find(x=>x.id===id);
  if(!o){ toast('Order not found','err'); clearOrderHash(); nav('orders'); return; }
  if(isTourLeaderRole() && o.leaderId !== currentUser.leaderId){
    toast('You can only open orders assigned to you', 'err');
    clearOrderHash();
    nav('orders');
    return;
  }
  closeNavbarAccountMenu();
  const showRouteSkeleton = currentUser && !document.body.classList.contains('auth-locked')
    && document.documentElement.getAttribute('data-auth-ready') === 'yes'
    && !(document.getElementById('p-order-detail')?.classList.contains('active') && currentOrderPageId === id);
  if(showRouteSkeleton) showRouteLoader();
  flushSearchDebounceTimers();
  if(!Array.isArray(o.expenses)) o.expenses = [];
  pendingExpenseFiles = [];
  currentOrderPageId = id;

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#main-nav .nav-btn[data-nav]').forEach(b=>b.classList.remove('active'));
  document.getElementById('p-order-detail').classList.add('active');

  updateOrderDetailHead(o);
  document.getElementById('order-detail-content').innerHTML = buildOrderDetailBodyHTML(o);

  const openEdit = ()=>{ editOrder(id); };
  document.getElementById('order-page-edit').onclick = openEdit;
  const btn = document.getElementById('main-action-btn');
  btn.textContent='✏️ Edit order';
  btn.onclick = openEdit;
  if(showRouteSkeleton) scheduleRouteLoaderHide();
}

function closeOrderPage(){
  // replaceState(clear hash) does not fire hashchange, so we must switch pages here
  nav('orders');
}

function showDetail(id){
  window.location.hash = 'order/'+id;
}

function deleteOrder(id){
  if(isTourLeaderRole()){ toast('Only coordinators can delete orders', 'err'); return; }
  if(!confirm('Delete this order?'))return;
  ordersBulkSelected.delete(id);
  db.orders=db.orders.filter(x=>x.id!==id);
  syncLeaderStatusesFromSchedule(true);
  save();renderOrders();renderDash();renderToday();updateBadges();
  populateLeaderDropdown();
  if(currentOrderPageId===id){ closeOrderPage(); }
  toast('Order deleted','err');
}

// ═══════════════════════════════════════
// MODAL — backdrop + tab cycle + ARIA (openModal / closeModal defined earlier)
// ═══════════════════════════════════════
document.querySelectorAll('.overlay').forEach(ov=>{
  ov.addEventListener('click', function(e){
    if(e.target === this && this.id) closeModal(this.id);
  });
});

document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Tab') return;
  const overlay = document.querySelector('.overlay.open');
  if(!overlay) return;
  const modal = overlay.querySelector('.modal');
  if(!modal || !modal.contains(document.activeElement)) return;
  const list = getModalFocusables(modal);
  if(list.length < 2) return;
  const first = list[0], last = list[list.length - 1];
  if(e.shiftKey){
    if(document.activeElement === first){ e.preventDefault(); try{ last.focus(); }catch(err){} }
  }else{
    if(document.activeElement === last){ e.preventDefault(); try{ first.focus(); }catch(err){} }
  }
});

function initModalAccessibility(){
  document.querySelectorAll('.overlay').forEach(ov=>{
    ov.setAttribute('role','dialog');
    ov.setAttribute('aria-modal','true');
    ov.setAttribute('aria-hidden', ov.classList.contains('open') ? 'false' : 'true');
    const ttl = ov.querySelector('.modal-title[id]');
    if(ttl && ttl.id) ov.setAttribute('aria-labelledby', ttl.id);
  });
}

// ═══════════════════════════════════════
// TOAST
// ═══════════════════════════════════════
function toast(msg,type='ok'){
  const wrap = document.getElementById('toasts');
  if(!wrap) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  const prefix = type==='ok'?'✅ ':type==='err'?'❌ ':'ℹ️ ';
  const prevLive = wrap.getAttribute('aria-live') || 'polite';
  if(type === 'err') wrap.setAttribute('aria-live','assertive');

  const msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  msgEl.textContent = prefix + msg;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-dismiss';
  dismiss.setAttribute('aria-label','Dismiss notification');
  dismiss.innerHTML = '&times;';

  let cleared = false;
  const cleanup = ()=>{
    if(cleared) return;
    cleared = true;
    el.remove();
    wrap.setAttribute('aria-live', prevLive);
  };

  const ms = type === 'err' ? 5600 : 3800;
  const timer = setTimeout(cleanup, ms);
  dismiss.addEventListener('click', ()=>{ clearTimeout(timer); cleanup(); });

  el.appendChild(msgEl);
  el.appendChild(dismiss);
  wrap.appendChild(el);
}

// ═══════════════════════════════════════
// THEME (light / dark)
// ═══════════════════════════════════════
const THEME_STORAGE_KEY = 'airportOpsTheme';

function applyTheme(theme){
  if(theme !== 'light' && theme !== 'dark') theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem(THEME_STORAGE_KEY, theme); }catch(e){}
  const btn = document.getElementById('theme-toggle');
  if(btn){
    btn.innerHTML = theme === 'dark'
      ? '<i class="bi bi-sun-fill" aria-hidden="true"></i>'
      : '<i class="bi bi-moon-stars-fill" aria-hidden="true"></i>';
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', btn.title);
  }
  const meta = document.getElementById('meta-theme-color');
  if(meta) meta.setAttribute('content', theme === 'light' ? '#fafafa' : '#09090b');
}

function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

function syncThemeToggleUi(){
  const t = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(t);
}

function wireAppShellOnce(){
  if(appShellWired) return;
  appShellWired = true;

  const flightEl = document.getElementById('o-flight');
  if(flightEl){
    flightEl.addEventListener('input', onFlightInput);
    flightEl.addEventListener('blur', applyFlightAutofill);
  }

  window.addEventListener('hashchange', ()=>{
    if(hashSyncFromApp) return;
    const id = parseOrderHash();
    if(id){ showOrderDetailPage(id); return; }
    nav(parseMainPageSlugFromHash(), { fromHash: true });
  });

  const oid = parseOrderHash();
  if(oid) showOrderDetailPage(oid);
  else nav(parseMainPageSlugFromHash(), { fromHash: true });

  document.addEventListener('click', (e)=>{
    const acc = document.getElementById('navbar-account-dd');
    if(acc && acc.open && !acc.contains(e.target)) acc.removeAttribute('open');
    const det = document.getElementById('orders-more-filters');
    if(!det || !det.open) return;
    if(det.contains(e.target)) return;
    det.removeAttribute('open');
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return;
    const acc = document.getElementById('navbar-account-dd');
    if(acc && acc.open){
      e.preventDefault();
      acc.removeAttribute('open');
      try{ acc.querySelector('summary')?.focus(); }catch(err){}
      return;
    }
    const od = document.getElementById('p-order-detail');
    if(od && od.classList.contains('active')){
      e.preventDefault();
      closeOrderPage();
      return;
    }
    if(document.querySelector('.overlay.open')){
      e.preventDefault();
      closeAllOverlays();
      return;
    }
  });
}

function startLoggedInApp(opts){
  if(!currentUser) return;
  const fromLogin = !!(opts && opts.fromLogin);

  syncDocumentAuthHydrate();

  if(fromLogin){
    const base = window.location.href.split('#')[0];
    history.replaceState(null, '', base);
  }

  const showEnterSkeleton = document.documentElement.getAttribute('data-auth-ready') === 'yes';
  if(showEnterSkeleton) showRouteLoader();
  setAuthGateLocked(false);
  applyRoleToUi();
  seedSampleData();
  if(syncLeaderStatusesFromSchedule(true)) save();
  updateBadges();
  populateOrderTypeFilter();
  populateOrderServiceTypeSelect();
  populateOrdersBulkLeaderSelect();
  const tdl = document.getElementById('today-date-label');
  if(tdl) tdl.textContent = fmtDate(todayStr());
  wireAppShellOnce();
  if(fromLogin){
    toast(`Signed in successfully — welcome, ${currentUser.displayName}.`, 'ok');
  }
  if(showEnterSkeleton) scheduleRouteLoaderHide();
}

// ═══════════════════════════════════════
// SAMPLE DATA + INIT
// ═══════════════════════════════════════
function seedSampleData(){
  if(db.leaders.length)return;
  db.leaders=[
    {id:1,name:'Ahmed Mohamed',phone:'01012345678',spec:'English',status:'Available',notes:''},
    {id:2,name:'Sara Youssef',phone:'01098765432',spec:'French',status:'Available',notes:''},
    {id:3,name:'Mahmoud Ali',phone:'01123456789',spec:'Italian',status:'Busy',notes:''},
  ];
  db.nextLeaderId=4;
  const today=todayStr();
  const tomorrow=new Date(Date.now()+86400000).toISOString().split('T')[0];
  db.orders=[
    {id:1,type:'Arrival',flight:'MS-777',date:today,time:'08:30',dest:'Cairo',nat:'German (2A+2C); French (2A+0C)',nationalityBreakdown:[{nationality:'German',adults:2,children:2},{nationality:'French',adults:2,children:0}],adults:4,children:2,childAges:[5,8],leaderId:1,rep:'Mohamed El-Shemy',driver:'Ahmed Saeed - CAR 123',status:'Scheduled',ref:'ORD-0001',notes:'VIP family',files:[],expenses:[],createdAt:new Date().toISOString()},
    {id:2,type:'Departure',flight:'EK-512',date:today,time:'14:00',dest:'Cairo → Dubai',nat:'French (8A+0C)',nationalityBreakdown:[{nationality:'French',adults:8,children:0}],adults:8,children:0,childAges:[],leaderId:2,rep:'Sami El-Belasy',driver:'Karim Abdallah - CAR 456',status:'In progress',ref:'ORD-0002',notes:'',files:[],expenses:[],createdAt:new Date().toISOString()},
    {id:3,type:'VIP Arrival',flight:'LH-580',date:tomorrow,time:'09:15',dest:'Frankfurt → Cairo',nat:'German (2A+0C)',nationalityBreakdown:[{nationality:'German',adults:2,children:0}],adults:2,children:0,childAges:[],leaderId:3,rep:'',driver:'',status:'Scheduled',ref:'ORD-0003',notes:'Special guest - pre-coordinated',files:[],expenses:[],createdAt:new Date().toISOString()},
    {id:4,type:'Transit',flight:'MS-308',date:tomorrow,time:'11:00',dest:'Cairo — Beirut',nat:'Italian (12A+1C)',nationalityBreakdown:[{nationality:'Italian',adults:12,children:1}],adults:12,children:1,childAges:[10],leaderId:1,rep:'Khaled El-Naggar',driver:'Youssef Mostafa - CAR 789',status:'Scheduled',ref:'ORD-0004',notes:'',files:[],expenses:[],createdAt:new Date().toISOString()},
    {id:5,type:'Arrival',flight:'MS-955',date:today,time:'18:45',dest:'Luxor → Cairo',nat:'British (4A+0C)',nationalityBreakdown:[{nationality:'British',adults:4,children:0}],adults:4,children:0,childAges:[],leaderId:null,rep:'',driver:'',status:'Scheduled',ref:'ORD-0005',notes:'Assign leader before evening rush',files:[],expenses:[],createdAt:new Date().toISOString()},
  ];
  db.nextOrderId=6;
  db.orders.forEach(o => {
    ensureOrderFields(o);
    migrateOrderNationality(o);
    sanitizeOrderLeaderRefOnOrder(o, db.leaders);
  });
  save();
}

function wireAuthForm(){
  console.log('[AirportOps] wireAuthForm()');
  const form = document.getElementById('auth-form');
  if(!form){
    console.warn('[AirportOps] auth form NOT found (#auth-form)');
    return;
  }
  console.log('[AirportOps] auth form found');
  if(form.dataset.bound === '1'){
    console.log('[AirportOps] auth form already bound; skipping');
    return;
  }
  form.dataset.bound = '1';

  form.addEventListener('submit', function onAuthSubmit(ev){
    console.log('[AirportOps] form submit event');
    submitAuthLogin(ev);
  });

  const btn = document.getElementById('auth-submit');
  if(btn){
    btn.addEventListener('click', function onAuthButtonClick(ev){
      ev.preventDefault();
      console.log('[AirportOps] login button click → requestSubmit');
      try{
        if(typeof form.requestSubmit === 'function'){
          form.requestSubmit(btn);
        } else {
          submitAuthLogin({ preventDefault(){}, stopPropagation(){} });
        }
      } catch(err){
        console.warn('[AirportOps] requestSubmit failed; using direct login', err);
        submitAuthLogin({ preventDefault(){}, stopPropagation(){} });
      }
    });
  }
}

function init(){
  console.log('[AirportOps] init started');
  wireAuthForm();
  initModalAccessibility();
  syncThemeToggleUi();
  if(tryRestoreSession()){
    startLoggedInApp();
  } else {
    setAuthGateLocked(true);
    applyRoleToUi();
    syncDocumentAuthHydrate();
    const userEl = document.getElementById('auth-username');
    if(userEl) queueMicrotask(() => { try{ userEl.focus(); }catch(e){} });
  }
  markAuthBootComplete();
}

init();