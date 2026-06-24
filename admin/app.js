// Mineazy Admin Dashboard
const API = '/api';
let sessionCookie = null;

async function apiFetch(path) {
  const resp = await fetch(API + path, { credentials: 'include' });
  if (resp.status === 401) { doLogout(); throw new Error('Unauthorized'); }
  if (!resp.ok) throw new Error('API error ' + resp.status);
  return resp.json();
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-err');
  if (!email || !pass) { err.style.display = 'block'; err.textContent = 'Enter email and password'; return; }

  try {
    const csrfResp = await fetch(API + '/auth/csrf', { credentials: 'include' });
    const csrfData = await csrfResp.json();
    const csrfToken = csrfData?.csrfToken;
    if (!csrfToken) throw new Error('No CSRF token');

    const body = new URLSearchParams({ csrfToken, email, password: pass, redirect: 'false', json: 'true' });
    const loginResp = await fetch(API + '/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'include',
      redirect: 'manual',
    });

    if (loginResp.status !== 200) throw new Error('Login failed');

    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'block';
    err.style.display = 'none';
    loadDashboard();
  } catch (e) {
    err.style.display = 'block';
    err.textContent = e.message || 'Login failed';
  }
}

function doLogout() {
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
}

let currentTab = 'devices';

async function loadDashboard() {
  const kpiRow = document.getElementById('kpi-row');
  kpiRow.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  try {
    const [devData, salesData, custData] = await Promise.all([
      apiFetch('/mobile/device'),
      apiFetch('/mobile/sales?days=365'),
      apiFetch('/crm/customers').catch(() => ({ items: [] })),
    ]);

    const sales = salesData.items || salesData || [];
    const totalSales = sales.reduce((s, o) => s + (Number(o.grandTotal) || 0), 0);
    const today = new Date().toISOString().split('T')[0];
    const todayCount = sales.filter(o => (o.soldAt || o.createdAt || '').startsWith(today)).length;

    const kpis = [
      { label: 'Devices', value: devData.kpis?.totalDevices || devData.devices?.length || 0 },
      { label: 'Online Now', value: devData.kpis?.onlineDevices || 0 },
      { label: 'Total Orders', value: devData.kpis?.totalSalesCount || sales.length },
      { label: 'Total Sales', value: '$' + totalSales.toLocaleString() },
      { label: 'Orders Today', value: todayCount },
      { label: 'Customers', value: custData.items?.length || custData.length || 0 },
    ];

    kpiRow.innerHTML = kpis.map(k => `<div class="kpi"><div class="label">${k.label}</div><div class="value">${k.value}</div></div>`).join('');

    window._data = { devData, sales, custData };
    switchTab(currentTab);
  } catch (e) {
    kpiRow.innerHTML = '<div class="loading">Cannot connect to ERP. Check that it is running.</div>';
  }
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const d = window._data;
  if (!d) return;

  const content = document.getElementById('tab-content');
  if (tab === 'devices') renderDevices(d.devData, content);
  if (tab === 'orders') renderOrders(d.sales, content);
  if (tab === 'users') renderUsers(d.devData, content);
  if (tab === 'customers') renderCustomers(d.custData, content);
  if (tab === 'products') renderProducts(content);
}

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function renderDevices(data, el) {
  const devices = data.devices || [];
  if (devices.length === 0) { el.innerHTML = '<div class="loading">No devices registered yet</div>'; return; }
  el.innerHTML = `
    <table>
      <thead><tr><th>Device</th><th>Status</th><th>Users</th><th>Orders</th><th>Sales</th><th>Sync</th><th>Last Seen</th></tr></thead>
      <tbody>${devices.map(d => `
        <tr>
          <td><b>${d.deviceName}</b><br/><span class="mono text-muted">${(d.deviceId||'').slice(0,14)}...</span></td>
          <td><span class="badge ${d.isOnline?'badge-green':'badge-red'}">${d.isOnline?'ONLINE':'OFFLINE'}</span></td>
          <td>${d._count?.users || d.users?.length || 0}</td>
          <td class="mono">${d.totalOrders||0}</td>
          <td class="mono text-primary">$${(Number(d.totalSales)||0).toLocaleString()}</td>
          <td><span class="badge ${d.syncStatus==='synced'?'badge-green':'badge-yellow'}">${d.syncStatus||'-'}</span></td>
          <td>${timeAgo(d.lastSeenAt)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
}

function renderOrders(sales, el) {
  if (sales.length === 0) { el.innerHTML = '<div class="loading">No orders yet</div>'; return; }
  el.innerHTML = `
    <input class="search-box" type="text" placeholder="Search orders by number or customer..." oninput="filterOrders(this.value)"/>
    <table id="orders-table">
      <thead><tr><th>Order #</th><th>Customer</th><th>Rep</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${sales.map(s => `
        <tr data-search="${(s.orderNumber||'')} ${(s.customerName||'')}">
          <td class="mono text-primary">${s.orderNumber}</td>
          <td>${s.customerName}</td>
          <td class="text-muted">${s.salesRepName||'-'}</td>
          <td>${s.itemsCount||0}</td>
          <td class="mono" style="font-weight:700">$${(Number(s.grandTotal)||0).toLocaleString()}</td>
          <td><span class="badge badge-green">${s.status||'confirmed'}</span></td>
          <td class="text-muted">${timeAgo(s.soldAt)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
}

function filterOrders(q) {
  const rows = document.querySelectorAll('#orders-table tbody tr');
  const term = q.toLowerCase();
  rows.forEach(r => { r.style.display = r.dataset.search.toLowerCase().includes(term) ? '' : 'none'; });
}

function renderUsers(data, el) {
  const devices = data.devices || [];
  const users = devices.flatMap(d => (d.users||[]).map(u => ({ ...u, deviceName: d.deviceName })));
  if (users.length === 0) { el.innerHTML = '<div class="loading">No users yet</div>'; return; }
  el.innerHTML = `
    <table>
      <thead><tr><th>User</th><th>Device</th><th>Role</th><th>Status</th><th>Orders</th><th>Sales</th></tr></thead>
      <tbody>${users.map(u => `
        <tr>
          <td><b>${u.displayName}</b><br/><span class="mono text-muted">@${u.username}</span></td>
          <td class="text-muted">${u.deviceName}</td>
          <td><span class="badge badge-primary">${u.role||'sales_rep'}</span></td>
          <td><span class="badge ${u.isActive?'badge-green':'badge-red'}">${u.isActive?'ACTIVE':'INACTIVE'}</span></td>
          <td class="mono">${u.totalOrders||0}</td>
          <td class="mono text-primary">$${(Number(u.totalSales)||0).toLocaleString()}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
}

function renderCustomers(data, el) {
  const customers = data?.items || data || [];
  if (customers.length === 0) { el.innerHTML = '<div class="loading">No customers</div>'; return; }
  el.innerHTML = `
    <input class="search-box" type="text" placeholder="Search customers..." oninput="filterTable(this,'cust-table')"/>
    <table id="cust-table">
      <thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Phone</th><th>City</th></tr></thead>
      <tbody>${customers.slice(0, 100).map(c => `
        <tr>
          <td class="mono">${c.code||'-'}</td>
          <td><b>${c.name}</b>${c.company ? '<br/><span class="text-muted">'+c.company+'</span>' : ''}</td>
          <td>${c.email||'-'}</td>
          <td>${c.phone||'-'}</td>
          <td>${c.city||'-'}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
}

async function renderProducts(el) {
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading products...</div>';
  try {
    const data = await apiFetch('/inventory/products?limit=5000');
    const products = data.items || data || [];
    if (products.length === 0) { 
      el.innerHTML = '<div class="loading"><p style="font-size:16px;margin-bottom:8px">No products in ERP database</p><p class="text-muted">Products need to be imported into the ERP. The PWA has 4,182 products locally.<br/>Run <b>node import_products.js</b> from the mineazy_pwa folder to import them.</p></div>'; 
      return; 
    }
    el.innerHTML = `
      <div class="text-muted" style="margin-bottom:8px">${products.length} products</div>
      <input class="search-box" type="text" placeholder="Search ${products.length} products..." oninput="filterTable(this,'prod-table')"/>
      <table id="prod-table">
        <thead><tr><th>Code</th><th>Name</th><th>Price</th><th>Stock</th><th>Unit</th></tr></thead>
        <tbody>${products.map(p => `
          <tr>
            <td class="mono">${p.code||'-'}</td>
            <td>${p.name}</td>
            <td class="mono text-primary">$${(Number(p.sellingPrice)||0).toFixed(2)}</td>
            <td>${p.stock||0}</td>
            <td>${p.unit||'EA'}</td>
          </tr>
        `).join('')}</tbody>
      </table>`;
  } catch (_) {
    el.innerHTML = '<div class="loading">Cannot load products. Check ERP connection.</div>';
  }
}

function filterTable(query, tableId) {
  const rows = document.querySelectorAll('#' + tableId + ' tbody tr');
  const term = query.toLowerCase();
  rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(term) ? '' : 'none'; });
}

// Init tabs
document.getElementById('tabs-row').innerHTML = `
  <button class="tab active" data-tab="devices" onclick="switchTab('devices')">Devices</button>
  <button class="tab" data-tab="orders" onclick="switchTab('orders')">Orders</button>
  <button class="tab" data-tab="users" onclick="switchTab('users')">Users</button>
  <button class="tab" data-tab="customers" onclick="switchTab('customers')">Customers</button>
  <button class="tab" data-tab="products" onclick="switchTab('products')">Products</button>
`;
