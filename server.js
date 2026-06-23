const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = path.join(__dirname, 'www');
const ERP_URL = 'http://192.168.1.147:3001';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css',
};

http.createServer((req, res) => {
  // Proxy /api/* requests to ERP
  if (req.url.startsWith('/api/')) {
    const opts = {
      hostname: '127.0.0.1',
      port: 3001,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:3001' },
      timeout: 10000,
    };
    const proxy = http.request(opts, (erpRes) => {
      res.writeHead(erpRes.statusCode, erpRes.headers);
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
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('Mineazy Mobile POS running at http://localhost:' + PORT);
  console.log('ERP proxy: /api/* -> ' + ERP_URL);
});
