const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY || '';

if (!HASDATA_API_KEY) {
  console.warn('WARNING: HASDATA_API_KEY environment variable is not set.');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Car Wash Scanner proxy running' }));
    return;
  }

  if (!req.url.startsWith('/hasdata')) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (!HASDATA_API_KEY) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Server not configured: missing HASDATA_API_KEY' }));
    return;
  }

  const path = req.url.replace('/hasdata', '');

  const options = {
    hostname: 'api.hasdata.com',
    path: path,
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
