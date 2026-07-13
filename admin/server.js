const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3003;
const ROOT = __dirname;
const ERP_URL = 'http://localhost:3005';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css',
};

// Store ERP session cookies per browser session
let erpCookies = '';

function proxyToERP(req, res) {
  const opts = {
    hostname: '127.0.0.1',
    port: 3005,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: 'localhost:3005', cookie: erpCookies },
    timeout: 15000,
  };

  const proxy = http.request(opts, (erpRes) => {
    // Capture any new cookies from ERP
    if (erpRes.headers['set-cookie']) {
      const newCookies = Array.isArray(erpRes.headers['set-cookie']) ? erpRes.headers['set-cookie'] : [erpRes.headers['set-cookie']];
      for (const c of newCookies) {
        const parts = c.split(';')[0];
        const [name, val] = parts.split('=');
        if (name && val) {
          const existing = erpCookies.split('; ').filter(x => !x.startsWith(name + '='));
          erpCookies = [...existing, `${name}=${val}`].filter(Boolean).join('; ');
        }
      }
    }

    const headers = { ...erpRes.headers };
    delete headers['set-cookie'];
    // Forward ERP cookies back to browser so auth works in browser too
    if (erpRes.headers['set-cookie']) {
      const cookies = Array.isArray(erpRes.headers['set-cookie']) ? erpRes.headers['set-cookie'] : [erpRes.headers['set-cookie']];
      res.setHeader('Set-Cookie', cookies.map(c => c.replace(/Domain=[^;]+;?/i, '').replace(/domain=[^;]+;?/i, '')));
    }
    res.writeHead(erpRes.statusCode, headers);
    erpRes.pipe(res);
  });

  proxy.on('timeout', () => { proxy.destroy(); res.writeHead(504); res.end('ERP timeout'); });
  proxy.on('error', (e) => { res.writeHead(502); res.end('ERP unreachable: ' + e.message); });
  req.pipe(proxy);
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    proxyToERP(req, res);
    return;
  }

  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('Admin Dashboard running at http://localhost:' + PORT);
  console.log('ERP proxy: /api/* -> ' + ERP_URL);
});
