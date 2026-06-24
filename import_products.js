const http = require('http');
const fs = require('fs');
const path = require('path');

const ERP = { hostname: '127.0.0.1', port: 3001 };
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'products.json'), 'utf8'));

async function fetchAPI(method, endpoint, body = null, cookie = '') {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: ERP.hostname, port: ERP.port, path: endpoint, method,
      headers: { 'Content-Type': 'application/json', cookie },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log(`Importing ${PRODUCTS.length} products into ERP...`);

  // 1. Get CSRF token
  const csrf = await fetchAPI('GET', '/api/auth/csrf');
  const csrfToken = csrf.body?.csrfToken;
  if (!csrfToken) { console.log('No CSRF token - ERP running?'); return; }
  const cookie = csrf.headers['set-cookie']?.join('; ') || '';

  // 2. Login
  const body = `csrfToken=${encodeURIComponent(csrfToken)}&email=admin%40mineazy.com&password=admin123&redirect=false&json=true`;
  const login = await fetchAPI('POST', '/api/auth/callback/credentials', null, cookie);
  console.log('Login:', login.status);

  // 3. Import in batches
  const BATCH = 100;
  let imported = 0;
  for (let i = 0; i < PRODUCTS.length; i += BATCH) {
    const batch = PRODUCTS.slice(i, i + BATCH).map(p => ({
      code: p.sku,
      name: p.name,
      unit: p.unitOfMeasure || 'EA',
      sellingPrice: p.price,
      costPrice: p.priceExcl || p.price * 0.85,
      stock: p.stockQuantity || 10,
      barcode: p.barcode || '',
      categoryId: '',
      description: '',
      isActive: true,
    }));
    
    // Try creating one by one since bulk might not be supported
    for (const prod of batch) {
      try {
        const res = await fetchAPI('POST', '/api/inventory/products', prod, cookie);
        if (res.status === 201 || res.status === 200) imported++;
        else console.log(`Failed ${prod.code}: ${res.status}`);
      } catch { console.log(`Error ${prod.code}`); }
    }
    console.log(`Progress: ${Math.min(i + BATCH, PRODUCTS.length)}/${PRODUCTS.length} (imported: ${imported})`);
  }
  console.log(`Done! Imported ${imported}/${PRODUCTS.length} products`);
}

main().catch(console.error);
