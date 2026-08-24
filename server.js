const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

if (!HASDATA_API_KEY) {
  console.warn('WARNING: HASDATA_API_KEY not set.');
}
if (!APP_PASSWORD) {
  console.warn('WARNING: APP_PASSWORD not set.');
}

function getPassword(req) {
  const parsed = url.parse(req.url, true);
  return parsed.query.pwd || req.headers['x-app-password'] || '';
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-password');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Car Wash Scanner proxy running' }));
    return;
  }

  if (pathname === '/auth') {
    const pwd = getPassword(req);
    if (pwd === APP_PASSWORD) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Incorrect password' }));
    }
    return;
  }

  if (!pathname.startsWith('/hasdata')) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const pwd = getPassword(req);
  if (pwd !== APP_PASSWORD) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (!HASDATA_API_KEY) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Missing HASDATA_API_KEY' }));
    return;
  }

  delete parsed.query.pwd;
  const qs = new url.URLSearchParams(parsed.query).toString();
  const forwardPath = pathname.replace('/hasdata', '') + (qs ? '?' + qs : '');

  const options = {
    hostname: 'api.hasdata.com',
    path: forwardPath,
    method: 'GET',
    headers: {
      'x-api-key': HASDATA_API_KEY,
      'Content-Type': 'application/json'
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });

  proxyReq.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Car Wash Scanner proxy running on port ${PORT}`);
});
