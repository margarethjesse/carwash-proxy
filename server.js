const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HASDATA_API_KEY = process.env.HASDATA_API_KEY || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

if (!HASDATA_API_KEY) console.warn('WARNING: HASDATA_API_KEY not set.');
if (!APP_PASSWORD) console.warn('WARNING: APP_PASSWORD not set.');

// ── Rate limiter — max 5 failed attempts per IP per 15 minutes ────────
const failedAttempts = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (!record) return false;
  // Reset window if expired
  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    failedAttempts.delete(ip);
    return false;
  }
  return record.count >= RATE_LIMIT_MAX;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    failedAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

function clearAttempts(ip) {
  failedAttempts.delete(ip);
}

// ── Read request body (for POST) ──────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// ── Get stored password from session token ────────────────────────────
// Simple in-memory token store: token -> expiry
const tokens = new Map();
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 hours

function generateToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function validateToken(token) {
  if (!token) return false;
  const expiry = tokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) { tokens.delete(token); return false; }
  return true;
}

function getToken(req) {
  return req.headers['x-session-token'] || url.parse(req.url, true).query.token || '';
}

// ── Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Health check — no auth
  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Car Wash Scanner proxy running' }));
    return;
  }

  // Auth endpoint — POST only, password in body
  if (pathname === '/auth') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const ip = getIP(req);

    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Too many failed attempts. Try again in 15 minutes.' }));
      return;
    }

    const body = await readBody(req);
    const pwd = body.password || '';

    if (pwd === APP_PASSWORD) {
      clearAttempts(ip);
      const token = generateToken();
      tokens.set(token, Date.now() + TOKEN_TTL);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, token }));
    } else {
      recordFailedAttempt(ip);
      const record = failedAttempts.get(ip);
      const remaining = RATE_LIMIT_MAX - (record?.count || 0);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Incorrect password', attemptsLeft: Math.max(0, remaining) }));
    }
    return;
  }

  // HasData proxy — requires valid session token
  if (!pathname.startsWith('/hasdata')) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const token = getToken(req);
  if (!validateToken(token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — please log in again' }));
    return;
  }

  if (!HASDATA_API_KEY) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Missing HASDATA_API_KEY' }));
    return;
  }

  // Strip token from query before forwarding
  const forwardQuery = { ...parsed.query };
  delete forwardQuery.token;
  const qs = new url.URLSearchParams(forwardQuery).toString();
  const forwardPath = pathname.replace('/hasdata', '') + (qs ? '?' + qs : '');

  const options = {
    hostname: 'api.hasdata.com',
    path: forwardPath,
    method: 'GET',
    headers: { 'x-api-key': HASDATA_API_KEY, 'Content-Type': 'application/json' }
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
