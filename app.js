// ============================================================
// MINEAZY Mobile POS - App Logic
// Progressive Web App for Industrial Sales
// ============================================================

// ---- App State ----
const state = {
  user: null,
  cart: null,
  currentScreen: 'login',
  productDetail: null,
  orderType: 'walkin',
  selectedCustomer: null,
  isOnline: navigator.onLine,
};

// ---- API Client ----
const ERP_DEFAULT = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? 'http://localhost:3005' : 'http://192.168.1.66:3005';
const API_BASE = localStorage.getItem('erp_api_url') || ERP_DEFAULT;
function setAPIBase(url) { localStorage.setItem('erp_api_url', url); location.reload(); }
const DEVICE_ID = (() => {
  let id = localStorage.getItem('mineazy_device_id');
  if (!id) { id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('mineazy_device_id', id); }
  return id;
})();

async function api(method, endpoint, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body) opts.body = JSON.stringify(body);

  const controller = new AbortController();
  opts.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(API_BASE + endpoint, opts);
    clearTimeout(timer);
    if (resp.status === 401) throw new Error('Unauthorized');
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || 'API error ' + resp.status);
    }
    return resp.status === 204 ? {} : await resp.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Network timeout');
    throw e;
  }
}

async function erpLogin(email, password) {
  const csrfResp = await fetch(API_BASE + '/api/auth/csrf', { credentials: 'include' });
  const csrfData = await csrfResp.json();
  const csrfToken = csrfData?.csrfToken;
  if (!csrfToken) throw new Error('Could not get CSRF token');

  const resp = await fetch(API_BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email, password, redirect: 'false', json: 'true' }),
    credentials: 'include',
    redirect: 'manual',
  });
  if (resp.status !== 200 && resp.status !== 302) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || err.message || 'Login failed');
  }
  return resp;
}

// ---- IndexedDB ----
const DB_NAME = 'mineazy';
const DB_VER = 2;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('products')) d.createObjectStore('products', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('cart')) d.createObjectStore('cart', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('orders')) d.createObjectStore('orders', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('sync')) d.createObjectStore('sync', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('customers')) d.createObjectStore('customers', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('users')) d.createObjectStore('users', { keyPath: 'id' });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbPutAll(storeName, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Seed Sample Data ----
async function seedDemoProducts() {
  // Try loading real catalog from products.json
  try {
    const resp = await fetch('products.json');
    if (resp.ok) {
      const catalog = await resp.json();
      const existing = await dbGetAll('products');
      if (existing.length < catalog.length) {
        await dbClear('products');
        await dbPutAll('products', catalog);
        console.log('Loaded ' + catalog.length + ' products from catalog');
      }
      return;
    }
  } catch (_) {}

  const existing = await dbGetAll('products');
  if (existing.length > 0) return;

  // Fallback demo products
  const products = [
    { id: 'p1', sku: 'BRG-6205-SKF', name: 'SKF 6205 Bearing', description: 'Deep groove ball bearing', price: 2.02, priceExcl: 1.75, stockQuantity: 53, unitOfMeasure: 'EA', shelfLocation: '4B', binNumber: 'BIN-A12', aisleNumber: '4', barcode: '7316571234567', category: 'Bearings', partNumber: '6205-2RSH' },
    { id: 'p2', sku: 'DB-12MM-IND', name: 'Drill Bit 12mm', description: 'Industrial HSS drill bit', price: 7.07, priceExcl: 6.12, stockQuantity: 120, unitOfMeasure: 'EA', shelfLocation: '2C', binNumber: 'SHELF-04', aisleNumber: '2', barcode: '7316572345678', category: 'Tools', partNumber: 'HSS-12MM' },
    { id: 'p3', sku: 'AC-220V-PRO', name: 'Air Compressor', description: 'Professional 220V air compressor', price: 222.50, priceExcl: 192.64, stockQuantity: 8, unitOfMeasure: 'EA', shelfLocation: '8', binNumber: 'WH-BULK', aisleNumber: '8', barcode: '7316573456789', category: 'Equipment', partNumber: 'AC-PRO-220' },
    { id: 'p4', sku: 'BNG-10MM-HD', name: 'Bunga 10mm', description: 'Heavy duty bunga fitting', price: 4.75, priceExcl: 4.11, stockQuantity: 200, unitOfMeasure: 'EA', shelfLocation: '5A', binNumber: 'BIN-D05', aisleNumber: '5', barcode: '7316574567890', category: 'Plumbing', partNumber: 'BNG-10' },
    { id: 'p5', sku: 'BNG-12MM-HD', name: 'Bunga 12mm', description: 'Heavy duty bunga fitting', price: 5.95, priceExcl: 5.15, stockQuantity: 175, unitOfMeasure: 'EA', shelfLocation: '5A', binNumber: 'BIN-D06', aisleNumber: '5', barcode: '7316575678901', category: 'Plumbing', partNumber: 'BNG-12' },
    { id: 'p6', sku: 'BNG-HD-PRO', name: 'Bunga Heavy Duty', description: 'Professional bunga fitting', price: 12.00, priceExcl: 10.39, stockQuantity: 85, unitOfMeasure: 'EA', shelfLocation: '5B', binNumber: 'BIN-D10', aisleNumber: '5', barcode: '7316576789012', category: 'Plumbing', partNumber: 'BNG-HD' },
    { id: 'p7', sku: 'WLD-GLOVE-L', name: 'Welding Gloves Size L', description: 'Premium leather welding gloves', price: 18.99, priceExcl: 16.44, stockQuantity: 42, unitOfMeasure: 'PR', shelfLocation: '3D', binNumber: 'SHELF-09', aisleNumber: '3', barcode: '7316577890123', category: 'Safety', partNumber: 'WG-L' },
    { id: 'p8', sku: 'CHN-5T-STD', name: 'Chain Block 5 Ton', description: 'Standard 5-ton chain block hoist', price: 151.52, priceExcl: 131.19, stockQuantity: 3, unitOfMeasure: 'EA', shelfLocation: '9', binNumber: 'WH-A01', aisleNumber: '9', barcode: '7316578901234', category: 'Lifting', partNumber: 'CB-5T' },
    { id: 'p9', sku: 'GRD-M8-STL', name: 'Grinding Disc M8', description: 'Steel grinding disc 8mm', price: 0.10, priceExcl: 0.09, stockQuantity: 0, unitOfMeasure: 'EA', shelfLocation: '6A', binNumber: 'BIN-E03', aisleNumber: '6', barcode: '7316579012345', category: 'Abrasives', partNumber: 'GD-M8' },
    { id: 'p10', sku: 'NUT-M20-STL', name: 'Nut M20 Steel', description: 'Hex nut M20 steel grade 8.8', price: 1.10, priceExcl: 0.95, stockQuantity: 500, unitOfMeasure: 'EA', shelfLocation: '1A', binNumber: 'BIN-A01', aisleNumber: '1', barcode: '7316570123456', category: 'Fasteners', partNumber: 'M20-STL-8.8' },
    { id: 'p11', sku: 'BOLT-M20-100', name: 'Bolt M20x100', description: 'Hex bolt M20 x 100mm grade 8.8', price: 2.30, priceExcl: 1.99, stockQuantity: 340, unitOfMeasure: 'EA', shelfLocation: '1B', binNumber: 'BIN-A05', aisleNumber: '1', barcode: '7316571123457', category: 'Fasteners', partNumber: 'M20x100-8.8' },
    { id: 'p12', sku: 'PIPE-50MM-GI', name: 'GI Pipe 50mm', description: 'Galvanized iron pipe 50mm diameter', price: 35.00, priceExcl: 30.30, stockQuantity: 22, unitOfMeasure: 'M', shelfLocation: '7C', binNumber: 'RACK-C01', aisleNumber: '7', barcode: '7316572234568', category: 'Plumbing', partNumber: 'GI-50MM' },
    { id: 'p13', sku: 'VALV-GATE-50', name: 'Gate Valve 50mm', description: 'Cast iron gate valve 50mm', price: 89.50, priceExcl: 77.49, stockQuantity: 15, unitOfMeasure: 'EA', shelfLocation: '7D', binNumber: 'RACK-D02', aisleNumber: '7', barcode: '7316573345679', category: 'Valves', partNumber: 'GV-50' },
    { id: 'p14', sku: 'SAW-HAND-PRO', name: 'Professional Handsaw', description: '24 inch industrial handsaw', price: 29.99, priceExcl: 25.97, stockQuantity: 30, unitOfMeasure: 'EA', shelfLocation: '2A', binNumber: 'SHELF-02', aisleNumber: '2', barcode: '7316574456780', category: 'Tools', partNumber: 'HS-24' },
    { id: 'p15', sku: 'OIL-20W50-5L', name: 'Engine Oil 20W50 5L', description: 'Heavy duty engine oil 5 liters', price: 42.00, priceExcl: 36.36, stockQuantity: 65, unitOfMeasure: 'EA', shelfLocation: '10A', binNumber: 'RACK-O01', aisleNumber: '10', barcode: '7316575567891', category: 'Lubricants', partNumber: '20W50-5L' },
  ];
  await dbPutAll('products', products);
}

// ---- Demo Customers ----
async function seedDemoCustomers() {
  const existing = await dbGetAll('customers');
  if (existing.length > 0) return;
  const customers = [
    { id: 'c1', name: 'Mr Nyoni', company: 'Nyoni Mining Co.', phone: '+260977123456', email: 'nyoni@example.com', orderCount: 12, lastOrderDate: '2026-06-10' },
    { id: 'c2', name: 'Sarah Jenkins', company: 'Jenkins Industrial', phone: '+260966654321', email: 'sarah@example.com', orderCount: 5, lastOrderDate: '2026-06-08' },
    { id: 'c3', name: 'Global Mining Corp', company: 'GMC Ltd.', phone: '+260955789012', email: 'procurement@gmc.com', orderCount: 34, lastOrderDate: '2026-06-14' },
    { id: 'c4', name: 'Copperbelt Hardware', company: 'CB Hardware', phone: '+260944321098', email: 'sales@cbhw.com', orderCount: 18, lastOrderDate: '2026-06-12' },
  ];
  await dbPutAll('customers', customers);
}

// ---- Navigation ----
function showLoading() { document.getElementById('loading-overlay').classList.add('show'); }
function hideLoading() { document.getElementById('loading-overlay').classList.remove('show'); }

async function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + screen);
  if (el) el.classList.add('active');
  state.currentScreen = screen;

  // Hide bottom nav on login, show on other screens
  const nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = screen === 'login' ? 'none' : 'flex';

  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.screen === screen);
    const icon = a.querySelector('.material-symbols-outlined');
    if (icon) icon.style.fontVariationSettings = a.classList.contains('active') ? "'FILL'1,'wght'400,'GRAD'0,'opsz'24" : "'FILL'0,'wght'400,'GRAD'0,'opsz'24";
  });

  if (screen === 'dashboard') { showLoading(); await loadDashboard(); hideLoading(); }
  if (screen === 'cart') renderCart();
  if (screen === 'settings') renderSettings();
  if (screen === 'search') { loadCategoryTabs(); updateCartBadge(); }
  if (screen === 'orders') { showLoading(); await loadOrders(); hideLoading(); }
  updateCartBadge();

  window.scrollTo(0, 0);
}

// ---- Toast ----
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ---- Modals ----
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ---- Auth ----
function hashPassword(password) {
  let h1 = 0xdeadbeef ^ password.length, h2 = 0x41c6ce57 ^ password.length;
  for (let i = 0; i < password.length; i++) {
    const ch = password.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return ('00000000' + (h1 >>> 0).toString(16)).slice(-8) + ('00000000' + (h2 >>> 0).toString(16)).slice(-8);
}

let authMode = 'login';

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('auth-title').textContent = authMode === 'login' ? 'Mineazy Mobile POS' : 'Create Account';
  document.getElementById('auth-subtitle').textContent = authMode === 'login' ? 'Mobile Point of Sale' : 'Sign up to get started';
  document.getElementById('auth-submit-btn').textContent = authMode === 'login' ? 'SIGN IN' : 'SIGN UP';
  document.getElementById('auth-toggle-text').innerHTML = authMode === 'login'
    ? 'Don\'t have an account? <span style="color:var(--primary-dim);font-weight:700;cursor:pointer" onclick="toggleAuthMode()">Sign Up</span>'
    : 'Already have an account? <span style="color:var(--primary-dim);font-weight:700;cursor:pointer" onclick="toggleAuthMode()">Sign In</span>';
  document.getElementById('login-error').style.display = 'none';
}

async function doAuth() {
  if (authMode === 'signup') return doSignup();
  return doLogin();
}

async function doSignup() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  if (!user || !pass) { errEl.style.display = 'block'; errEl.textContent = 'Enter username and password'; return; }
  if (pass.length < 3) { errEl.style.display = 'block'; errEl.textContent = 'Password must be at least 3 characters'; return; }

  const existing = await dbGet('users', user);
  if (existing) { errEl.style.display = 'block'; errEl.textContent = 'Username already taken'; return; }

  const passwordHash = hashPassword(pass);
  await dbPut('users', { id: user, passwordHash, displayName: user, role: 'sales_rep', photoUrl: '', createdAt: new Date().toISOString() });

  state.user = { id: user, name: user, displayName: user, role: 'sales_rep', token: 'tk_' + Date.now(), photoUrl: '' };
  await dbPut('settings', { key: 'session_user', value: user });
  errEl.style.display = 'none';
  document.getElementById('screen-login').classList.remove('active');
  navigate('dashboard');
  toast('Account created! Welcome ' + user);
}

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  if (!user || !pass) { errEl.style.display = 'block'; errEl.textContent = 'Enter username and password'; return; }

  const userRecord = await dbGet('users', user);

  // Try ERP login when online
  if (state.isOnline) {
    try {
      await erpLogin(user, pass);
      console.log('ERP login successful');
    } catch (e) {
      if (!userRecord) {
        errEl.style.display = 'block';
        errEl.textContent = 'ERP login failed: ' + e.message;
        return;
      }
      console.log('ERP login failed, using offline auth');
    }
  }

  if (!userRecord) { errEl.style.display = 'block'; errEl.textContent = 'User not found'; return; }

  const passwordHash = hashPassword(pass);
  if (passwordHash !== userRecord.passwordHash) { errEl.style.display = 'block'; errEl.textContent = 'Incorrect password'; return; }

  state.user = {
    id: user,
    name: userRecord.displayName || user,
    displayName: userRecord.displayName || user,
    role: userRecord.role || 'sales_rep',
    token: 'tk_' + Date.now(),
    photoUrl: userRecord.photoUrl || '',
  };
  await dbPut('settings', { key: 'session_user', value: user });
  errEl.style.display = 'none';
  document.getElementById('screen-login').classList.remove('active');

  // Register device with ERP
  try { await api('POST', '/api/mobile/sync', { deviceId: DEVICE_ID, users: [{ id: user, displayName: userRecord.displayName || user, role: userRecord.role || 'sales_rep' }], orders: [] }); } catch (_) {}

  syncProductsFromERP();
  navigate('dashboard');
}

async function doLogout() {
  state.user = null;
  state.cart = null;
  await dbPut('settings', { key: 'session_user', value: '' });
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-login').classList.add('active');
  document.querySelector('.bottom-nav').style.display = 'none';
}

async function tryRestoreSession() {
  const data = await dbGet('settings', 'session_user');
  if (data?.value) {
    const userId = data.value;
    const userRecord = await dbGet('users', userId);
    if (userRecord) {
      state.user = {
        id: userId,
        name: userRecord.displayName || userId,
        displayName: userRecord.displayName || userId,
        role: userRecord.role || 'sales_rep',
        token: 'tk_' + Date.now(),
        photoUrl: userRecord.photoUrl || '',
      };
      document.getElementById('screen-login').classList.remove('active');
      navigate('dashboard');
      return true;
    }
  }
  return false;
}

// ---- Dashboard ----
async function loadDashboard() {
  const uid = state.user?.id;
  const allOrders = await dbGetAll('orders');
  const orders = allOrders.filter(o => o.userId === uid);
  const sync = await dbGetAll('sync');

  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(o => o.createdAt?.startsWith(today));
  const totalSales = orders.reduce((s, o) => s + (o.grandTotal || 0), 0);

  document.getElementById('stat-today').textContent = todayOrders.length;
  document.getElementById('stat-sales').textContent = '$' + totalSales.toLocaleString();
  document.getElementById('stat-submitted').textContent = orders.filter(o => o.status === 'confirmed').length;
  document.getElementById('stat-pending').textContent = sync.length;

  // Dashboard user card
  const u = state.user;
  document.getElementById('dash-rep-name').textContent = u?.displayName || u?.name || 'User';
  document.getElementById('dash-rep-id').textContent = (u?.role || 'sales_rep').replace(/_/g,' ').toUpperCase() + ' (ID: ' + (u?.id || '---') + ')';

  // Dashboard profile pic
  const dashPic = document.getElementById('dash-profile-pic');
  const dashIcon = document.getElementById('dash-profile-icon');
  if (u?.photoUrl) {
    dashPic.style.display = 'block';
    dashPic.src = u.photoUrl;
    if (dashIcon) dashIcon.style.display = 'none';
  }

  // Render recent orders
  const recent = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const container = document.getElementById('recent-orders');
  if (recent.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding:20px">No orders yet</p>';
    return;
  }
  container.innerHTML = recent.map(o => `
    <div class="order-row">
      <div>
        <div class="mono-sm text-primary">${o.orderNumber}</div>
        <div style="font-weight:500">${o.customerName}</div>
        <div class="text-muted" style="font-size:10px;font-weight:700;letter-spacing:0.5px">${timeAgo(o.createdAt)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:16px;font-weight:600">$${o.grandTotal.toFixed(2)}</div>
        <span class="badge ${o.status==='confirmed'?'badge-green':o.status==='syncing'?'badge-orange':'badge-yellow'}">${o.status}</span>
      </div>
    </div>
  `).join('');
}

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' mins ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hours ago';
  return Math.floor(diff / 86400) + ' days ago';
}

// ---- Create Order ----
function selectCustomerType(type) {
  state.orderType = type;
  document.getElementById('chip-walkin').classList.toggle('selected', type === 'walkin');
  document.getElementById('chip-existing').classList.toggle('selected', type === 'existing');
  document.getElementById('customer-search-box').style.display = type === 'existing' ? 'block' : 'none';
  document.getElementById('walkin-name-box').style.display = type === 'walkin' ? 'block' : 'none';
  state.selectedCustomer = null;
}

function showCreateOrderModal() {
  selectCustomerType('walkin');
  document.getElementById('customer-search-input').value = '';
  document.getElementById('walkin-name-input').value = '';
  document.getElementById('customer-search-results').innerHTML = '';
  openModal('modal-create-order');
}

async function searchCustomers(query) {
  if (!query.trim()) { document.getElementById('customer-search-results').innerHTML = ''; return; }
  const all = await dbGetAll('customers');
  const results = all.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
  document.getElementById('customer-search-results').innerHTML = results.map(c => `
    <div style="padding:10px;border:1px solid var(--outline-var);border-radius:var(--radius);margin-bottom:4px;cursor:pointer"
         onclick="selectCustomer('${c.id}','${c.name}')">
      <div style="font-weight:600">${c.name}</div>
      <div class="text-muted mono-sm">${c.company||''} · ${c.orderCount||0} orders</div>
    </div>
  `).join('');
}

function selectCustomer(id, name) {
  state.selectedCustomer = { id, name };
  document.getElementById('customer-search-input').value = name;
  document.getElementById('customer-search-results').innerHTML = '';
}

function startOrder() {
  const walkinName = document.getElementById('walkin-name-input')?.value.trim() || '';
  const customerName = state.orderType === 'walkin'
    ? (walkinName || 'Walk-In Customer')
    : (state.selectedCustomer?.name || document.getElementById('customer-search-input').value || 'Existing Customer');
  const customerId = state.selectedCustomer?.id || null;
  const userId = state.user?.id || '';
  state.cart = {
    id: 'cart_' + userId,
    customerName,
    customerId,
    isWalkIn: state.orderType === 'walkin',
    salesRepName: state.user?.name || 'User',
    salesRepId: userId,
    userId,
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  closeModal('modal-create-order');
  navigate('search');
  toast('Order started for ' + customerName);
}

// ---- Product Search ----
let allProductsCache = [];
let currentCategory = 'all';

async function loadCategoryTabs() {
  const all = await dbGetAll('products');
  allProductsCache = all;
  const cats = {};
  all.forEach(p => {
    const cat = p.category || 'General Hardware';
    cats[cat] = (cats[cat] || 0) + 1;
  });
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const tabs = document.getElementById('category-tabs');
  tabs.innerHTML = '<button class="cat-tab active" onclick="filterByCategory(\'all\',this)" style="white-space:nowrap;padding:6px 14px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:0.5px;border:1px solid var(--outline-var);background:transparent;color:var(--txt-var)">All (' + all.length + ')</button>';
  sorted.forEach(([cat, count]) => {
    tabs.innerHTML += '<button class="cat-tab" onclick="filterByCategory(\'' + cat.replace(/'/g, "\\'") + '\',this)" style="white-space:nowrap;padding:6px 14px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:0.5px;border:1px solid var(--outline-var);background:transparent;color:var(--txt-var)">' + cat + ' (' + count + ')</button>';
  });
}

function filterByCategory(cat, el) {
  currentCategory = cat;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const searchVal = document.getElementById('search-input').value;
  searchProducts(searchVal);
}

async function searchProducts(query) {
  const clearBtn = document.getElementById('search-clear');
  const results = document.getElementById('search-results');
  clearBtn.style.display = query ? 'inline-flex' : 'none';

  if (allProductsCache.length === 0) {
    allProductsCache = await dbGetAll('products');
    if (document.getElementById('category-tabs').children.length <= 1) loadCategoryTabs();
  }

  let filtered = allProductsCache;
  if (currentCategory !== 'all') {
    filtered = filtered.filter(p => (p.category || 'General Hardware') === currentCategory);
  }

  if (!query.trim()) {
    if (filtered.length === 0) {
      results.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined icon">inventory_2</span><p>No products in this category</p></div>';
    } else {
      const show = filtered.slice(0, 50);
      results.innerHTML = '<div class="text-muted" style="text-align:center;padding:16px;font-size:12px;font-weight:600">' + filtered.length + ' products · showing first 50</div>';
      results.innerHTML += show.map(p => renderProductCard(p)).join('');
      if (filtered.length > 50) {
        results.innerHTML += '<div class="text-muted" style="text-align:center;padding:12px;font-size:11px">Type a keyword to search all ' + filtered.length + ' products</div>';
      }
    }
    return;
  }

  const q = query.toLowerCase();
  const matches = filtered.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q) ||
    (p.partNumber && p.partNumber.toLowerCase().includes(q)) ||
    (p.barcode && p.barcode.includes(q))
  );

  if (matches.length === 0) {
    results.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined icon">search</span><p>No products found for "' + query + '"</p></div>';
    return;
  }

  results.innerHTML = matches.map(p => renderProductCard(p)).join('');
}

function renderProductCard(p) {
    const cartItem = state.cart?.items.find(i => i.productId === p.id);
    const status = p.stockQuantity <= 0 ? 'badge-red' : p.stockQuantity < 5 ? 'badge-orange' : 'badge-green';
    const statusLabel = p.stockQuantity <= 0 ? 'OUT' : p.stockQuantity < 5 ? 'LOW' : 'IN STOCK';
    return '<div class="prod-card" style="margin-bottom:8px" onclick="openProductDetail(\'' + p.id + '\')">'
      + '<div class="header">'
      + '<div class="flex flex-col" style="flex:1">'
      + '<span class="sku">SKU: ' + p.sku + '</span>'
      + '<span class="name">' + p.name + '</span>'
      + '</div>'
      + '<span class="badge ' + status + '">' + statusLabel + '</span>'
      + '</div>'
      + '<div class="flex justify-between items-center" style="margin-top:8px">'
      + '<div><span class="price">$' + p.price.toFixed(2) + '</span>'
      + (p.priceExcl ? ' <span class="mono-sm text-muted" style="margin-left:6px">excl $' + p.priceExcl.toFixed(2) + '</span>' : '')
      + '</div>'
      + '<span class="mono-sm text-muted">Stock: ' + p.stockQuantity + '</span>'
      + '</div>'
      + (cartItem ? '<div style="margin-top:6px;padding:4px 8px;background:rgba(255,193,7,.08);border-radius:2px;font-size:11px;font-weight:700;color:var(--primary-dim);text-align:center">' + cartItem.quantity + ' in cart</div>' : '')
      + '</div>';
}

// ---- Product Detail ----
function openProductDetail(productId) {
  dbGet('products', productId).then(p => {
    if (!p) return toast('Product not found');
    state.productDetail = p;
    document.getElementById('pd-sku').textContent = 'SKU: ' + p.sku;
    document.getElementById('pd-name').textContent = p.name;
    document.getElementById('pd-location').textContent = 'Aisle ' + (p.aisleNumber||'-') + ' · Shelf ' + (p.shelfLocation||'-') + ' · Bin ' + (p.binNumber||'-');
    document.getElementById('pd-loc').textContent = p.shelfLocation||'-';
    document.getElementById('pd-aisle').textContent = (p.aisleNumber||'-') + ' / ' + (p.shelfLocation||'-') + ' / ' + (p.binNumber||'-');
    document.getElementById('pd-unit').textContent = p.unitOfMeasure;
    document.getElementById('pd-part').textContent = p.partNumber||'-';
    document.getElementById('pd-price').textContent = '$' + p.price.toFixed(2);
    document.getElementById('pd-price-excl').textContent = p.priceExcl ? '$' + p.priceExcl.toFixed(2) + ' excl VAT' : '';
    document.getElementById('pd-stock').textContent = 'per ' + p.unitOfMeasure + ' · ' + p.stockQuantity + ' in stock';
    document.getElementById('pd-qty').textContent = '1';
    document.getElementById('pd-qty').dataset.val = '1';
    document.getElementById('pd-max-qty').textContent = 'Max: ' + p.stockQuantity;
    document.getElementById('pd-add-btn').disabled = p.stockQuantity <= 0;
    document.getElementById('pd-add-btn').textContent = p.stockQuantity <= 0 ? 'Out of Stock' : 'Add to Cart';

    const status = p.stockQuantity <= 0 ? 'badge-red' : p.stockQuantity < 5 ? 'badge-orange' : 'badge-green';
    const statusLabel = p.stockQuantity <= 0 ? 'OUT OF STOCK' : p.stockQuantity < 5 ? 'LOW STOCK' : 'IN STOCK';
    document.getElementById('pd-status').innerHTML = `<span class="badge ${status}">${statusLabel}</span>`;

    openModal('modal-product');
  });
}

function changeQty(delta) {
  const el = document.getElementById('pd-qty');
  let qty = parseInt(el.dataset.val || '1') + delta;
  const max = state.productDetail?.stockQuantity || 99;
  if (qty < 1) qty = 1;
  if (qty > max) qty = max;
  el.textContent = qty;
  el.dataset.val = qty;
}

function addToCartFromDetail() {
  if (!state.productDetail) return;
  if (state.productDetail.stockQuantity <= 0) return toast('Product out of stock');
  if (!state.cart) {
    const userId = state.user?.id || '';
    state.cart = {
      id: 'cart_' + userId,
      customerName: 'Walk-In Customer',
      customerId: null,
      isWalkIn: true,
      salesRepName: state.user?.name || 'User',
      salesRepId: userId,
      userId,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const qtyEl = document.getElementById('pd-qty');
  const qty = parseInt(qtyEl.dataset.val || '1');

  const existing = state.cart.items.find(i => i.productId === state.productDetail.id);
  if (existing) {
    existing.quantity += qty;
  } else {
    state.cart.items.push({
      productId: state.productDetail.id,
      sku: state.productDetail.sku,
      name: state.productDetail.name,
      price: state.productDetail.price,
      quantity: qty,
      unitOfMeasure: state.productDetail.unitOfMeasure,
      shelfLocation: state.productDetail.shelfLocation,
      binNumber: state.productDetail.binNumber,
      aisleNumber: state.productDetail.aisleNumber,
      barcode: state.productDetail.barcode || '',
      stockQuantity: state.productDetail.stockQuantity,
      isCollected: false,
    });
  }
  state.cart.updatedAt = new Date().toISOString();
  dbPut('cart', state.cart);
  closeModal('modal-product');
  updateCartBadge();
  toast(state.productDetail.name + ' x' + qty + ' added to cart');
}

// ---- Cart ----
function renderCart() {
  const container = document.getElementById('cart-content');
  const clearBtn = document.getElementById('cart-clear-btn');

  if (!state.cart || state.cart.items.length === 0) {
    clearBtn.style.display = 'none';
    container.innerHTML = `
      <div class="empty-state" style="padding-top:80px">
        <span class="material-symbols-outlined icon">shopping_cart</span>
        <p style="font-size:16px;font-weight:600">Cart is empty</p>
        <p class="text-muted">Start adding products from Search</p>
        <button class="btn btn-outline" style="margin-top:12px;max-width:200px" onclick="navigate('search')"><span class="material-symbols-outlined" style="font-size:18px">search</span>Search Products</button>
      </div>`;
    return;
  }

  clearBtn.style.display = 'flex';

  let html = '';
  if (state.cart.customerName) {
    html += `
      <div class="customer-header" style="margin-bottom:14px">
        <div class="flex justify-between items-center">
          <div>
            <div class="section-title" style="margin-bottom:2px">CUSTOMER</div>
            <div style="font-size:18px;font-weight:600;color:var(--primary-dim)">${state.cart.customerName}</div>
          </div>
          <span class="badge badge-orange">DIRECT SALES</span>
        </div>
      </div>`;
  }

  html += state.cart.items.map((item, i) => `
    <div class="card card-glow" style="margin-bottom:10px">
      <div class="flex justify-between items-start" style="margin-bottom:8px">
        <div style="flex:1">
          <span class="mono-sm text-primary">SKU: ${item.sku}</span>
          <div style="font-size:15px;font-weight:600">${item.name}</div>
        </div>
        <div class="qty-ctrl">
          <button onclick="updateCartQty('${item.productId}', ${item.quantity - 1})">−</button>
          <span class="qty">${item.quantity}</span>
          <button onclick="updateCartQty('${item.productId}', ${item.quantity + 1})">+</button>
          <button onclick="removeFromCart('${item.productId}')" style="color:var(--red)"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
        </div>
      </div>
      <div class="flex justify-between items-center" style="margin-top:8px">
        <div class="flex gap-12">
          <div class="mono-sm text-muted">$${item.price.toFixed(2)} ea</div>
          <div class="mono-sm text-muted">${item.shelfLocation||'-'} | ${item.binNumber||'-'}</div>
        </div>
        <div style="font-size:18px;font-weight:600;color:var(--primary-dim)">$${(item.price * item.quantity).toFixed(2)}</div>
      </div>
    </div>
  `).join('');

  const subtotal = state.cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = subtotal * 0.15;
  const total = subtotal + tax;

  html += `
    <div class="card" style="background:var(--surf-high);margin-top:16px">
      <div class="flex justify-between" style="margin-bottom:8px"><span class="text-muted">Subtotal</span><span class="mono">$${subtotal.toFixed(2)}</span></div>
      <div class="flex justify-between" style="margin-bottom:8px"><span class="text-muted">Tax (15%)</span><span class="mono">$${tax.toFixed(2)}</span></div>
      <div style="border-top:1px solid var(--outline-var);margin:8px 0;padding-top:10px" class="flex justify-between">
        <span style="font-size:16px;font-weight:600">Grand Total</span>
        <span style="font-size:22px;font-weight:700;color:var(--primary-container)">$${total.toFixed(2)}</span>
      </div>
    </div>
    <div class="flex gap-8" style="margin-top:16px">
      <button class="btn btn-outline" style="flex:1" onclick="openPicking()"><span class="material-symbols-outlined" style="font-size:18px">checklist</span>Picking</button>
      <button class="btn btn-primary" style="flex:1" onclick="openSummary()"><span class="material-symbols-outlined" style="font-size:18px">receipt_long</span>Review</button>
    </div>
    <div style="height:20px"></div>`;

  container.innerHTML = html;
}

function updateCartQty(productId, qty) {
  if (!state.cart) return;
  if (qty <= 0) { removeFromCart(productId); return; }
  const item = state.cart.items.find(i => i.productId === productId);
  if (!item) return;
  if (qty > item.stockQuantity) { toast('Max stock: ' + item.stockQuantity); return; }
  item.quantity = qty;
  state.cart.updatedAt = new Date().toISOString();
  dbPut('cart', state.cart);
  renderCart();
  updateCartBadge();
}

function removeFromCart(productId) {
  if (!state.cart) return;
  state.cart.items = state.cart.items.filter(i => i.productId !== productId);
  state.cart.updatedAt = new Date().toISOString();
  dbPut('cart', state.cart);
  renderCart();
  updateCartBadge();
}

function clearCart() {
  state.cart = null;
  const userId = state.user?.id;
  if (userId) dbDelete('cart', 'cart_' + userId);
  renderCart();
  updateCartBadge();
  toast('Cart cleared');
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge-search');
  if (!state.cart || state.cart.items.length === 0) {
    badge.style.display = 'none';
  } else {
    const totalItems = state.cart.items.reduce((s, i) => s + i.quantity, 0);
    badge.style.display = 'block';
    badge.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle">shopping_cart</span> ${totalItems} items in cart (${state.cart.items.length} products)`;
  }
}

// ---- Picking Mode ----
function openPicking() {
  if (!state.cart || state.cart.items.length === 0) return toast('Cart is empty');
  renderPickingItems();
  openModal('modal-picking');
}

function renderPickingItems() {
  const items = state.cart.items;
  const collected = items.filter(i => i.isCollected).length;
  const total = items.length;
  const progress = total > 0 ? (collected / total) * 100 : 0;

  document.getElementById('picking-count').textContent = collected + ' / ' + total + ' Items Collected';
  document.getElementById('picking-progress-bar').style.width = progress + '%';

  const activeItem = items.find(i => !i.isCollected);
  const container = document.getElementById('picking-items');
  container.innerHTML = items.map((item, idx) => {
    const isDone = item.isCollected;
    const isActive = !isDone && item.productId === (activeItem?.productId);
    return `
      <div style="padding:14px;border-radius:8px;border:${isActive?'2px solid var(--primary-dim)':'1px solid var(--outline-var)'};background:${isActive?'var(--surf-high)':'var(--surf)'};opacity:${isDone&&!isActive?'0.55':'1'};box-shadow:${isActive?'0 0 12px rgba(250,189,0,.15)':'none'}">
        <div class="flex gap-12" style="align-items:flex-start">
          <div onclick="togglePicked('${item.productId}')" style="width:28px;height:28px;border-radius:4px;border:2px solid var(--primary-dim);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${isDone?'var(--primary-dim)':'transparent'};margin-top:2px;cursor:pointer">
            ${isDone ? '<span class="material-symbols-outlined" style="font-size:18px;color:var(--on-primary-fixed)">check</span>' : ''}
          </div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:600;text-decoration:${isDone?'line-through':'none'}">${item.name}</div>
            <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--txt-var);margin-top:2px">QTY: ${item.quantity} UNITS | Aisle ${item.aisleNumber||'-'}</div>
            ${isActive ? `
              <div class="flex gap-8" style="margin-top:10px">
                <button class="btn btn-ghost" style="flex:1;height:40px;font-size:10px" onclick="toast('Navigate to Aisle ${item.aisleNumber||'-'} · ${item.shelfLocation||'-'}')">
                  <span class="material-symbols-outlined" style="font-size:16px">map</span>LOCATE
                </button>
                <button class="btn btn-ghost" style="flex:1;height:40px;font-size:10px;border-color:var(--secondary-container);color:var(--secondary-container)" onclick="startPickScan('${item.productId}','${item.barcode||''}')">
                  <span class="material-symbols-outlined" style="font-size:16px">qr_code_scanner</span>SCAN
                </button>
                <button class="btn btn-primary" style="flex:1;height:40px;font-size:10px" onclick="togglePicked('${item.productId}')">
                  <span class="material-symbols-outlined" style="font-size:16px">check_circle</span>PICKED
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  const completeBtn = document.getElementById('picking-complete-btn');
  completeBtn.disabled = collected < total;
  if (collected >= total) {
    completeBtn.classList.add('btn-success');
    completeBtn.classList.remove('btn-primary');
    completeBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">check_circle</span>Complete Collection';
  } else {
    completeBtn.classList.remove('btn-success');
    completeBtn.classList.add('btn-primary');
    completeBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">assignment_turned_in</span>Complete Collection (${collected}/${total})`;
  }
}

function togglePicked(productId) {
  const item = state.cart.items.find(i => i.productId === productId);
  if (!item) return;
  item.isCollected = !item.isCollected;
  state.cart.updatedAt = new Date().toISOString();
  dbPut('cart', state.cart);
  renderPickingItems();
  if (navigator.vibrate) navigator.vibrate(10);
}

function completePicking() {
  closeModal('modal-picking');
  openSummary();
}

// ---- Cart Summary / ERP Submit ----
function openSummary() {
  if (!state.cart || state.cart.items.length === 0) return toast('Cart is empty');
  const c = state.cart;

  document.getElementById('summary-customer').innerHTML = `
    <div class="flex justify-between items-center">
      <div>
        <div class="section-title" style="margin-bottom:2px">CUSTOMER ENTITY</div>
        <div style="font-size:18px;font-weight:600;color:var(--primary-dim)">${c.customerName}</div>
      </div>
      <span class="badge badge-orange">DIRECT SALES</span>
    </div>`;

  document.getElementById('summary-items').innerHTML = c.items.map(item => `
    <div class="card card-glow">
      <div class="flex justify-between items-start">
        <div>
          <span class="mono-sm text-primary">SKU: ${item.sku}</span>
          <div style="font-size:14px;font-weight:600">${item.name}</div>
        </div>
        <span style="background:var(--surf-high);padding:2px 8px;border-radius:2px;font-size:11px;font-weight:700;color:var(--primary)">QTY: ${item.quantity}</span>
      </div>
      <div class="flex justify-between items-center" style="margin-top:8px">
        <div class="flex gap-12">
          <span class="mono-sm text-muted">$${item.price.toFixed(2)} ea</span>
          <span class="mono-sm text-muted">${item.shelfLocation||'-'}</span>
        </div>
        <span style="font-size:16px;font-weight:600;color:var(--primary-dim)">$${(item.price*item.quantity).toFixed(2)}</span>
      </div>
    </div>
  `).join('');

  const subtotal = c.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = subtotal * 0.15;
  const total = subtotal + tax;
  document.getElementById('sum-subtotal').textContent = '$' + subtotal.toFixed(2);
  document.getElementById('sum-tax').textContent = '$' + tax.toFixed(2);
  document.getElementById('sum-total').textContent = '$' + total.toFixed(2);
  document.getElementById('summary-status').style.display = 'none';
  document.getElementById('summary-submit-btn').disabled = false;
  document.getElementById('summary-submit-btn').innerHTML = '<span class="material-symbols-outlined">description</span>GENERATE SALES ORDER';

  openModal('modal-summary');
}

async function submitOrder() {
  if (!state.cart || state.cart.items.length === 0) return;

  const btn = document.getElementById('summary-submit-btn');
  const status = document.getElementById('summary-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> PROCESSING...';
  status.style.display = 'block';
  status.textContent = 'TRANSMITTING DATA TO ERP...';

  const c = state.cart;
  const subtotal = c.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const orderNum = '#SO-' + Math.floor(100000 + Math.random() * 900000);

  const order = {
    id: 'o_' + Date.now(),
    orderNumber: orderNum,
    customerName: c.customerName,
    customerId: c.customerId,
    salesRepName: c.salesRepName,
    salesRepId: c.salesRepId,
    userId: state.user?.id || '',
    subtotal,
    tax: subtotal * 0.15,
    grandTotal: subtotal * 1.15,
    status: 'confirmed',
    erpReference: orderNum,
    createdAt: new Date().toISOString(),
    items: c.items.map(i => ({ sku: i.sku, name: i.name, qty: i.quantity, unitPrice: i.price })),
  };

  // Try sync to ERP, fall back to local
  let orderPlaced = false;
  try {
    // Register device first if needed
    await api('POST', '/api/mobile/device', { deviceId: DEVICE_ID, deviceName: 'Mineazy POS', platform: 'android', appVersion: '1.0' });
    await api('POST', '/api/mobile/sync', {
      deviceId: DEVICE_ID,
      users: [{ id: state.user?.id, displayName: state.user?.displayName, role: state.user?.role }],
      orders: [order],
    });
    orderPlaced = true;
  } catch (e) {
    order.status = 'queued';
    await dbPut('sync', { payload: JSON.stringify(order), createdAt: new Date().toISOString(), status: 'pending' });
    toast('Saved offline - will sync when connected');
  }

  await dbPut('orders', order);

  // Decrement stock for each item
  for (const item of c.items) {
    const product = await dbGet('products', item.productId);
    if (product) {
      product.stockQuantity = Math.max(0, product.stockQuantity - item.quantity);
      await dbPut('products', product);
    }
  }

  // Update customer order count
  if (c.customerId) {
    const customer = await dbGet('customers', c.customerId);
    if (customer) {
      customer.orderCount = (customer.orderCount || 0) + 1;
      customer.lastOrderDate = new Date().toISOString().split('T')[0];
      await dbPut('customers', customer);
    }
  }

  closeModal('modal-summary');

  // Show success
  document.getElementById('success-order-num').textContent = orderNum;
  document.getElementById('success-erp-ref').textContent = orderPlaced ? 'ERP Ref: ' + orderNum : 'Queued for sync';
  document.getElementById('success-details').textContent = c.items.length + ' products · ' + c.items.reduce((s, i) => s + i.quantity, 0) + ' items · Total: $' + order.grandTotal.toFixed(2);
  openModal('modal-success');

  // Clear cart
  state.cart = null;
  await dbDelete('cart', 'cart_' + (state.user?.id || ''));
  updateCartBadge();
  renderCart();
  loadDashboard();
}

// ---- Order History ----
let ordersFilter = 'all';
let ordersCache = [];

async function loadOrders() {
  const uid = state.user?.id;
  const allOrders = await dbGetAll('orders');
  ordersCache = allOrders.filter(o => o.userId === uid).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderOrderList();
}

function filterOrders(status, el) {
  ordersFilter = status;
  document.querySelectorAll('#orders-filter-chips .cat-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderOrderList();
}

function renderOrderList() {
  const container = document.getElementById('orders-list');
  const filtered = ordersFilter === 'all' ? ordersCache : ordersCache.filter(o => o.status === ordersFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined icon">receipt_long</span><p>No orders found</p></div>';
    return;
  }

  container.innerHTML = filtered.map(o => `
    <div class="card card-glow" style="margin-bottom:10px;cursor:pointer" onclick="toggleOrderDetail('${o.id}')">
      <div class="flex justify-between items-start">
        <div>
          <div class="mono-sm text-primary">${o.orderNumber}</div>
          <div style="font-weight:600;font-size:15px">${o.customerName}</div>
          <div class="text-muted" style="font-size:10px;font-weight:700;letter-spacing:0.5px">${timeAgo(o.createdAt)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:700;color:var(--primary-dim)">$${o.grandTotal.toFixed(2)}</div>
          <span class="badge ${o.status==='confirmed'?'badge-green':o.status==='queued'?'badge-yellow':'badge-orange'}">${o.status}</span>
        </div>
      </div>
      <div id="order-detail-${o.id}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--outline-var)">
        <div class="section-title" style="margin-bottom:8px">Line Items</div>
        ${(o.items||[]).map(i => `
          <div class="flex justify-between items-center" style="padding:6px 0;border-bottom:1px solid var(--outline-var);font-size:13px">
            <div style="flex:1"><span class="mono-sm text-primary">${i.sku}</span> ${i.name} <span class="badge" style="margin-left:4px">x${i.qty}</span></div>
            <span style="font-weight:600">$${(i.unitPrice*i.qty).toFixed(2)}</span>
          </div>
        `).join('')}
        <div class="flex justify-between" style="margin-top:8px;font-size:12px"><span class="text-muted">Subtotal</span><span>$${o.subtotal.toFixed(2)}</span></div>
        <div class="flex justify-between" style="font-size:12px"><span class="text-muted">Tax</span><span>$${o.tax.toFixed(2)}</span></div>
        <button class="btn btn-outline" style="margin-top:10px;font-size:12px;padding:8px" onclick="event.stopPropagation();printOrder('${o.id}')"><span class="material-symbols-outlined" style="font-size:16px">print</span>Print</button>
      </div>
    </div>
  `).join('');
}

function toggleOrderDetail(orderId) {
  const el = document.getElementById('order-detail-' + orderId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function printOrder(orderId) {
  const order = ordersCache.find(o => o.id === orderId);
  if (!order) return;
  const lines = (order.items||[]).map(i => `${i.sku}\t${i.name}\t${i.qty}\t${i.unitPrice.toFixed(2)}\t${(i.unitPrice*i.qty).toFixed(2)}`).join('\n');
  const text = `ORDER: ${order.orderNumber}\nCustomer: ${order.customerName}\nDate: ${order.createdAt}\nStatus: ${order.status}\n\nSKU\tName\tQty\tPrice\tTotal\n${lines}\n\nSubtotal: $${order.subtotal.toFixed(2)}\nTax: $${order.tax.toFixed(2)}\nGrand Total: $${order.grandTotal.toFixed(2)}`;
  const w = window.open('', '_blank', 'width=400,height=600');
  w.document.write('<pre style="font-family:monospace;font-size:12px;padding:20px">' + text + '</pre>');
  w.document.close();
  w.print();
}

function exportOrdersCSV() {
  const filtered = ordersFilter === 'all' ? ordersCache : ordersCache.filter(o => o.status === ordersFilter);
  let csv = 'Order Number,Customer,Date,Status,Items,Subtotal,Tax,Grand Total\n';
  for (const o of filtered) {
    const items = (o.items||[]).map(i => `${i.sku}:${i.name}x${i.qty}`).join('; ');
    csv += `"${o.orderNumber}","${o.customerName}","${o.createdAt}","${o.status}","${items}",${o.subtotal},${o.tax},${o.grandTotal}\n`;
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mineazy_orders_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('Orders exported to CSV');
}

// ---- Customer Management ----
async function openCustomerManagement() {
  document.getElementById('cust-search-input').value = '';
  document.getElementById('customer-form').style.display = 'none';
  await loadCustomerList();
  openModal('modal-customers');
}

async function loadCustomerList(query) {
  const all = await dbGetAll('customers');
  const filtered = query ? all.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.company||'').toLowerCase().includes(query.toLowerCase())) : all;
  document.getElementById('manage-customer-list').innerHTML = filtered.map(c => `
    <div class="flex justify-between items-center" style="padding:10px;border:1px solid var(--outline-var);border-radius:var(--radius);margin-bottom:4px">
      <div style="flex:1">
        <div style="font-weight:600">${c.name}</div>
        <div class="mono-sm text-muted">${c.company||''} ${c.phone ? '· ' + c.phone : ''}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button onclick="editCustomer('${c.id}')" style="padding:6px;color:var(--primary-dim)"><span class="material-symbols-outlined" style="font-size:18px">edit</span></button>
        <button onclick="deleteCustomer('${c.id}')" style="padding:6px;color:var(--red)"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>
      </div>
    </div>
  `).join('') || '<p class="text-muted text-center" style="padding:20px">No customers found</p>';
}

function searchManageCustomers(query) {
  loadCustomerList(query);
}

function showAddCustomerForm() {
  document.getElementById('cust-form-id').value = '';
  document.getElementById('cust-form-name').value = '';
  document.getElementById('cust-form-company').value = '';
  document.getElementById('cust-form-phone').value = '';
  document.getElementById('cust-form-email').value = '';
  document.getElementById('customer-form').style.display = 'block';
}

async function editCustomer(id) {
  const c = await dbGet('customers', id);
  if (!c) return;
  document.getElementById('cust-form-id').value = c.id;
  document.getElementById('cust-form-name').value = c.name;
  document.getElementById('cust-form-company').value = c.company || '';
  document.getElementById('cust-form-phone').value = c.phone || '';
  document.getElementById('cust-form-email').value = c.email || '';
  document.getElementById('customer-form').style.display = 'block';
}

function cancelCustomerForm() {
  document.getElementById('customer-form').style.display = 'none';
}

async function saveCustomer() {
  const id = document.getElementById('cust-form-id').value;
  const name = document.getElementById('cust-form-name').value.trim();
  const company = document.getElementById('cust-form-company').value.trim();
  const phone = document.getElementById('cust-form-phone').value.trim();
  const email = document.getElementById('cust-form-email').value.trim();

  if (!name) return toast('Customer name is required');

  const customer = {
    id: id || 'c_' + Date.now(),
    name,
    company,
    phone,
    email,
    orderCount: 0,
    lastOrderDate: '',
  };

  if (id) {
    const existing = await dbGet('customers', id);
    if (existing) {
      customer.orderCount = existing.orderCount || 0;
      customer.lastOrderDate = existing.lastOrderDate || '';
    }
  }

  await dbPut('customers', customer);
  cancelCustomerForm();
  await loadCustomerList();
  toast(id ? 'Customer updated' : 'Customer added');
}

async function deleteCustomer(id) {
  await dbDelete('customers', id);
  await loadCustomerList();
  toast('Customer deleted');
}

// ---- Barcode Scanner ----
let scannerStream = null;
let pickScanProductId = null;
let pickScanBarcode = '';

function startPickScan(productId, barcode) {
  pickScanProductId = productId;
  pickScanBarcode = barcode;
  document.getElementById('pick-scan-info').style.display = 'block';
  document.getElementById('scan-title').textContent = 'Scan to Verify';
  document.getElementById('scan-subtitle').textContent = 'Point camera at product barcode';
  openScanner();
}

async function openScanner() {
  document.getElementById('scanner-view').classList.add('show');
  document.getElementById('manual-barcode').value = '';
  if (!pickScanProductId) {
    document.getElementById('pick-scan-info').style.display = 'none';
    document.getElementById('scan-title').textContent = 'Scan Barcode';
    document.getElementById('scan-subtitle').textContent = 'Point camera at product barcode';
  }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = scannerStream;
    video.setAttribute('playsinline', true);
    video.play();
    const sv = document.getElementById('scanner-view');
    const existingVideo = sv.querySelector('video');
    if (existingVideo) existingVideo.remove();
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0';
    sv.insertBefore(video, sv.firstChild);
  } catch (e) {
    console.log('Camera not available, using manual input');
  }
}

function closeScanner() {
  document.getElementById('scanner-view').classList.remove('show');
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  pickScanProductId = null;
  pickScanBarcode = '';
}

async function scanManualBarcode() {
  const code = document.getElementById('manual-barcode').value.trim();
  if (!code) return toast('Enter a barcode');

  if (pickScanProductId) {
    if (code === pickScanBarcode) {
      closeScanner();
      togglePicked(pickScanProductId);
      toast('Item verified!');
      if (!state.cart.items.find(i => !i.isCollected)) {
        toast('All items collected!');
      }
    } else {
      toast('Wrong item! Expected barcode: ' + pickScanBarcode);
    }
    return;
  }

  closeScanner();
  const all = await dbGetAll('products');
  const product = all.find(p => p.barcode === code);
  if (!product) return toast('Product not found for barcode: ' + code);
  openProductDetail(product.id);
}

// ---- Settings ----
function renderSettings() {
  const u = state.user;
  document.getElementById('set-rep-name').textContent = u?.displayName || u?.name || 'User';
  document.getElementById('set-rep-id').textContent = (u?.role || 'Industrial Sales Pro').replace(/_/g, ' ') + ' (ID: ' + (u?.id || '---') + ')';
  document.getElementById('set-display-name-sub').textContent = u?.displayName ? 'Current: ' + u.displayName : 'Tap to change name';

  // Profile photo in settings
  const setPic = document.getElementById('set-profile-pic');
  const setIcon = document.getElementById('set-profile-icon');
  if (u?.photoUrl) {
    setPic.style.display = 'block';
    setPic.src = u.photoUrl;
    setIcon.style.display = 'none';
  } else {
    setPic.style.display = 'none';
    setIcon.style.display = 'block';
  }

  // Theme
  const theme = localStorage.getItem('mineazy_theme') || 'dark';
  document.getElementById('theme-label').textContent = theme.toUpperCase() + ' MODE';
  document.getElementById('theme-icon').textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';

  // Language
  const lang = localStorage.getItem('mineazy_lang') || 'en';
  const langLabels = { en: 'ENGLISH (US)', fr: 'FRANCAIS', es: 'ESPANOL', pt: 'PORTUGUES', sw: 'SWAHILI' };
  document.getElementById('lang-label').textContent = langLabels[lang] || 'ENGLISH (US)';

  // Notifications
  const notif = localStorage.getItem('mineazy_notif') !== 'false';
  document.getElementById('notif-label').textContent = notif ? 'ENABLED' : 'DISABLED';
  document.getElementById('notif-icon').textContent = notif ? 'notifications' : 'notifications_off';

  // Scanner sensitivity
  const sens = localStorage.getItem('mineazy_scanner_sens') || 'high';
  const sensLabels = { low: 'LOW', medium: 'MED', high: 'HIGH' };
  document.getElementById('scanner-sensitivity-badge-sm').textContent = sensLabels[sens] || 'HIGH';

  // ERP Sync status
  document.getElementById('erp-url-input').value = API_BASE;
  renderERPSyncStatus();
  checkERPStatus();
}

function saveERPUrl() {
  const url = document.getElementById('erp-url-input').value.trim();
  if (!url) return toast('Enter a valid URL');
  toast('ERP URL saved. Restarting...');
  setTimeout(() => setAPIBase(url), 800);
}

// ---- Edit Profile ----
function openEditProfile() {
  const u = state.user;
  document.getElementById('edit-profile-name').value = u?.displayName || u?.name || '';
  document.getElementById('edit-profile-role').value = u?.role || 'Industrial Sales Pro';

  const previewPic = document.getElementById('edit-preview-pic');
  const previewIcon = document.getElementById('edit-preview-icon');
  if (u?.photoUrl) {
    previewPic.style.display = 'block';
    previewPic.src = u.photoUrl;
    previewIcon.style.display = 'none';
  } else {
    previewPic.style.display = 'none';
    previewIcon.style.display = 'block';
  }

  // Reset temp photo
  state._tempPhoto = u?.photoUrl || '';

  openModal('modal-edit-profile');
}

async function handleProfilePicUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const dataUrl = await readFileAsDataURL(file);
  if (state.user) {
    state.user.photoUrl = dataUrl;
    await saveProfileToSettings();
  }
  renderSettings();
  loadDashboard();
  toast('Profile photo updated');
}

async function handleEditPicPreview(event) {
  const file = event.target.files[0];
  if (!file) return;
  const dataUrl = await readFileAsDataURL(file);
  state._tempPhoto = dataUrl;
  document.getElementById('edit-preview-pic').style.display = 'block';
  document.getElementById('edit-preview-pic').src = dataUrl;
  document.getElementById('edit-preview-icon').style.display = 'none';
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveProfile() {
  const newName = document.getElementById('edit-profile-name').value.trim();
  const newRole = document.getElementById('edit-profile-role').value.trim();

  if (!newName) return toast('Name is required');

  if (state.user) {
    state.user.displayName = newName;
    state.user.name = newName;
    state.user.role = newRole || 'sales_rep';
    state.user.photoUrl = state._tempPhoto || state.user.photoUrl || '';
    await saveProfileToSettings();
  }

  closeModal('modal-edit-profile');
  renderSettings();
  loadDashboard();
  toast('Profile saved');
}

async function saveProfileToSettings() {
  if (!state.user) return;
  const userRecord = await dbGet('users', state.user.id);
  if (userRecord) {
    userRecord.displayName = state.user.displayName || state.user.name;
    userRecord.role = state.user.role;
    userRecord.photoUrl = state.user.photoUrl || '';
    await dbPut('users', userRecord);
  }
}

// ---- Theme Toggle ----
function toggleTheme() {
  const current = localStorage.getItem('mineazy_theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';

  if (next === 'light') {
    document.documentElement.style.setProperty('--bg', '#f0f0f0');
    document.documentElement.style.setProperty('--surf', '#ffffff');
    document.documentElement.style.setProperty('--surf-low', '#f8f8f8');
    document.documentElement.style.setProperty('--surf-high', '#ececec');
    document.documentElement.style.setProperty('--surf-highest', '#e0e0e0');
    document.documentElement.style.setProperty('--txt', '#1a1a1a');
    document.documentElement.style.setProperty('--txt-var', '#555555');
    document.documentElement.style.setProperty('--outline', '#999999');
    document.documentElement.style.setProperty('--outline-var', '#cccccc');
    document.body.style.color = '#1a1a1a';
    document.body.style.background = '#f0f0f0';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f0f0f0');
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').setAttribute('content', 'default');
  } else {
    document.documentElement.style.setProperty('--bg', '#131313');
    document.documentElement.style.setProperty('--surf', '#201f1f');
    document.documentElement.style.setProperty('--surf-low', '#1c1b1b');
    document.documentElement.style.setProperty('--surf-high', '#2a2a2a');
    document.documentElement.style.setProperty('--surf-highest', '#353534');
    document.documentElement.style.setProperty('--txt', '#e5e2e1');
    document.documentElement.style.setProperty('--txt-var', '#d4c5ab');
    document.documentElement.style.setProperty('--outline', '#9c8f78');
    document.documentElement.style.setProperty('--outline-var', '#4f4632');
    document.body.style.color = '#e5e2e1';
    document.body.style.background = '#131313';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#131313');
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').setAttribute('content', 'black');
  }

  localStorage.setItem('mineazy_theme', next);
  renderSettings();
  toast('Theme: ' + next.toUpperCase() + ' MODE');
}

// ---- Language Toggle ----
function toggleLanguage() {
  const current = localStorage.getItem('mineazy_lang') || 'en';
  const langs = ['en', 'fr', 'es', 'pt', 'sw'];
  const labels = { en: 'English (US)', fr: 'Francais', es: 'Espanol', pt: 'Portugues', sw: 'Swahili' };
  const idx = (langs.indexOf(current) + 1) % langs.length;
  const next = langs[idx];

  localStorage.setItem('mineazy_lang', next);
  renderSettings();
  toast('Language: ' + labels[next]);
}

// ---- Notifications Toggle ----
function toggleNotifications() {
  const current = localStorage.getItem('mineazy_notif') !== 'false';
  const next = !current;
  localStorage.setItem('mineazy_notif', next);
  renderSettings();

  if (next && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  toast('Notifications: ' + (next ? 'ENABLED' : 'DISABLED'));
}

// ---- Scanner Sensitivity ----
function toggleScannerSensitivity() {
  const current = localStorage.getItem('mineazy_scanner_sens') || 'high';
  const levels = { low: 'medium', medium: 'high', high: 'low' };
  const next = levels[current] || 'high';
  localStorage.setItem('mineazy_scanner_sens', next);
  renderSettings();
  toast('Scanner: ' + next.toUpperCase() + ' SENSITIVITY');
}

// ---- ERP Sync ----
async function checkERPStatus() {
  const dot = document.getElementById('erp-dot');
  const text = document.getElementById('erp-status-text');
  const detail = document.getElementById('erp-status-detail');
  try {
    const resp = await fetch(API_BASE + '/api/auth/csrf', { credentials: 'include' });
    const ok = resp.ok;
    dot.style.background = ok ? '#4caf50' : '#ff5252';
    text.textContent = ok ? 'ERP Connected' : 'ERP Unreachable';
    detail.textContent = ok ? API_BASE : 'Check your connection';
  } catch (_) {
    dot.style.background = '#ff5252';
    text.textContent = 'ERP Offline';
    detail.textContent = 'Cannot reach ' + API_BASE;
  }
}

function renderERPSyncStatus() {
  const lastSync = localStorage.getItem('erp_last_sync');
  document.getElementById('erp-last-sync').textContent = lastSync ? timeAgo(lastSync) : 'Never';
  const lastProdSync = localStorage.getItem('erp_last_products_sync');
  document.getElementById('erp-products-sync').textContent = lastProdSync ? timeAgo(lastProdSync) : 'Never';
  dbGetAll('sync').then(items => {
    document.getElementById('erp-pending-count').textContent = items.length + ' items';
  });
  const dot = document.getElementById('erp-dot');
  dot.style.background = '#ff9800';
  document.getElementById('erp-status-text').textContent = 'Checking...';
  document.getElementById('erp-status-detail').textContent = 'Connecting to ERP';
}

async function doManualSync() {
  const btn = document.getElementById('erp-sync-btn');
  const status = document.getElementById('erp-sync-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Syncing...';
  status.style.display = 'block';
  status.textContent = 'Connecting to ERP...';

  try {
    await syncPendingOrders();
    await syncProductsFromERP();
    const now = new Date().toISOString();
    localStorage.setItem('erp_last_sync', now);
    document.getElementById('erp-last-sync').textContent = timeAgo(now);
    const items = await dbGetAll('sync');
    document.getElementById('erp-pending-count').textContent = items.length + ' items';
    status.textContent = 'Sync complete';
    toast('Synced successfully');
  } catch (e) {
    status.textContent = 'Sync failed: ' + (e.message || 'Unknown error');
    toast('Sync failed');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">sync</span>Sync Now';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
  checkERPStatus();
}

// ---- Network Status ----
window.addEventListener('online', () => {
  state.isOnline = true;
  syncPendingOrders();
  syncProductsFromERP();
  if (state.currentScreen === 'settings') { renderSettings(); checkERPStatus(); }
  toast('Back online - syncing...');
});

window.addEventListener('offline', () => {
  state.isOnline = false;
  if (state.currentScreen === 'settings') { renderSettings(); checkERPStatus(); }
  toast('You are offline');
});

async function syncPendingOrders() {
  const items = await dbGetAll('sync');
  if (items.length === 0) return;
  const orders = items.map(item => JSON.parse(typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload)));
  try {
    await api('POST', '/api/mobile/device', { deviceId: DEVICE_ID, deviceName: 'Mineazy POS', platform: 'android', appVersion: '1.0' });
    await api('POST', '/api/mobile/sync', {
      deviceId: DEVICE_ID,
      users: [{ id: state.user?.id, displayName: state.user?.displayName, role: state.user?.role }],
      orders,
    });
    for (const item of items) await dbDelete('sync', item.id);
    localStorage.setItem('erp_last_sync', new Date().toISOString());
    toast('Synced ' + orders.length + ' orders to ERP');
    loadDashboard();
  } catch (_) {
    throw new Error('ERP unreachable');
  }
}

// ---- Sync Products from ERP ----
async function syncProductsFromERP() {
  if (!state.isOnline) return;
  try {
    const products = await api('GET', '/api/mobile/products');
    if (products && products.length > 0) {
      await dbClear('products');
      await dbPutAll('products', products);
      console.log('Synced ' + products.length + ' products from ERP');
      localStorage.setItem('erp_last_products_sync', new Date().toISOString());
      allProductsCache = [];
      loadCategoryTabs();
      return true;
    }
  } catch (e) {
    console.log('ERP products sync failed:', e.message);
  }
  return false;
}

// ---- Init ----
async function init() {
  // Restore saved theme
  const savedTheme = localStorage.getItem('mineazy_theme');
  if (savedTheme === 'light') {
    document.documentElement.style.setProperty('--bg', '#f0f0f0');
    document.documentElement.style.setProperty('--surf', '#ffffff');
    document.documentElement.style.setProperty('--surf-low', '#f8f8f8');
    document.documentElement.style.setProperty('--surf-high', '#ececec');
    document.documentElement.style.setProperty('--surf-highest', '#e0e0e0');
    document.documentElement.style.setProperty('--txt', '#1a1a1a');
    document.documentElement.style.setProperty('--txt-var', '#555555');
    document.documentElement.style.setProperty('--outline', '#999999');
    document.documentElement.style.setProperty('--outline-var', '#cccccc');
    document.body.style.color = '#1a1a1a';
    document.body.style.background = '#f0f0f0';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f0f0f0');
  }

  await openDB();
  if (state.isOnline) {
    const synced = await syncProductsFromERP();
    if (!synced) await seedDemoProducts();
  } else {
    await seedDemoProducts();
  }
  await seedDemoCustomers();
  const restored = await tryRestoreSession();
  if (restored) {
    const userId = state.user?.id;
    if (userId) {
      const savedCart = await dbGet('cart', 'cart_' + userId);
      if (savedCart) {
        state.cart = savedCart;
        updateCartBadge();
      }
    }
  } else {
    document.getElementById('screen-login').classList.add('active');
    document.querySelector('.bottom-nav').style.display = 'none';
  }

  // Login form submit on enter
  document.getElementById('login-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAuth();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Periodic sync check
  setInterval(syncPendingOrders, 60000 * 15); // Every 15 minutes
}

document.addEventListener('DOMContentLoaded', init);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
