const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const PORT = 3000;
const ROOT = path.join(__dirname, 'www');
const ERP_HOST = '127.0.0.1';
const ERP_PORT = 3005;

const mimeTypes = {
  '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css',
};

let erpCookies = '';

function erpRawRequest(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: ERP_HOST, port: ERP_PORT, path, method, headers, timeout: 10000 };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.headers['set-cookie']) {
          const newCookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
          for (const c of newCookies) {
            const [nameVal] = c.split(';');
            const [name, val] = nameVal.split('=');
            if (name && val) {
              erpCookies = erpCookies.split('; ').filter(x => !x.startsWith(name + '=')).concat(`${name}=${val}`).filter(Boolean).join('; ');
            }
          }
          console.log('ERP cookies updated, count:', erpCookies.split('; ').length);
        }
        resolve({ status: res.statusCode, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ensureERPAuth() {
  try {
    // Step 1: Get CSRF token
    const csrfRes = await erpRawRequest('GET', '/api/auth/csrf', {});
    const csrfData = JSON.parse(csrfRes.body);
    const csrfToken = csrfData.csrfToken;
    if (!csrfToken) { console.log('No CSRF token from ERP'); return; }
    console.log('Got CSRF token');

    // Step 2: Login with credentials
    const loginBody = querystring.stringify({
      csrfToken, email: 'admin@mineazy.com', password: 'admin123',
      redirect: 'false', json: 'true',
    });
    const loginRes = await erpRawRequest('POST', '/api/auth/callback/credentials', {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(loginBody),
      cookie: erpCookies,
    }, loginBody);
    console.log('ERP login status:', loginRes.status);
    
    // Check for session cookie
    const hasSession = erpCookies.includes('next-auth.session-token');
    console.log('Session cookie present:', hasSession);
    if (!hasSession) {
      console.log('Cookies:', erpCookies.substring(0, 200));
    }
  } catch (e) {
    console.log('ERP auth error:', e.message);
  }
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxyHeaders = { ...req.headers, host: `localhost:${ERP_PORT}` };
    // Forward browser cookies if present, otherwise use server session
    if (req.headers.cookie) {
      proxyHeaders.cookie = req.headers.cookie;
    } else if (erpCookies) {
      proxyHeaders.cookie = erpCookies;
    }

    const opts = {
      hostname: ERP_HOST, port: ERP_PORT,
      path: req.url, method: req.method,
      headers: proxyHeaders, timeout: 10000,
    };

    const proxy = http.request(opts, (erpRes) => {
      const headers = { ...erpRes.headers };
      delete headers['set-cookie'];
      if (erpRes.headers['set-cookie']) {
        const cookies = Array.isArray(erpRes.headers['set-cookie']) ? erpRes.headers['set-cookie'] : [erpRes.headers['set-cookie']];
        res.setHeader('Set-Cookie', cookies);
      }
      res.writeHead(erpRes.statusCode, headers);
      erpRes.pipe(res);
    });
    proxy.on('timeout', () => { proxy.destroy(); res.writeHead(504); res.end('ERP timeout'); });
    proxy.on('error', () => { res.writeHead(502); res.end('ERP unreachable'); });
    req.pipe(proxy);
    return;
  }

  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', async () => {
  console.log('PWA server on port', PORT, '| ERP proxy -> port', ERP_PORT);
  await ensureERPAuth();
});
