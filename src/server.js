const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { searchLocation, getWeatherBundle, getHistorical, cacheStats, clearCache } = require('./weatherService');
const { readPreferences, writePreferences } = require('./preferencesStore');

const PORT = Number(process.env.PORT || 5000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100);

const rateStore = new Map();

function json(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { success: false, error: 'Not Found' });
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function rateLimit(req, res) {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = rateStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  current.count += 1;
  rateStore.set(ip, current);

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - current.count);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(current.resetAt / 1000));

  if (current.count > RATE_LIMIT_MAX_REQUESTS) {
    json(res, 429, {
      success: false,
      error: 'Rate limit exceeded. Please retry later.',
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000)
    });
    return false;
  }

  return true;
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseCoordinates(urlObj) {
  const lat = urlObj.searchParams.get('lat');
  const lon = urlObj.searchParams.get('lon');
  return {
    lat: lat !== null ? Number(lat) : undefined,
    lon: lon !== null ? Number(lon) : undefined
  };
}

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (!rateLimit(req, res)) return;

  const urlObj = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && urlObj.pathname === '/health') {
      return json(res, 200, { status: 'OK', timestamp: new Date().toISOString() });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/search') {
      const query = (urlObj.searchParams.get('query') || '').trim();
      if (!query) return json(res, 400, { success: false, error: 'query is required' });
      const data = await searchLocation(query);
      return json(res, 200, { success: true, data });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/current') {
      const city = urlObj.searchParams.get('city') || undefined;
      const lang = urlObj.searchParams.get('lang') || 'en';
      const { lat, lon } = parseCoordinates(urlObj);
      const data = await getWeatherBundle({ city, lat, lon, lang });
      return json(res, 200, { success: true, data });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/forecast') {
      const city = urlObj.searchParams.get('city') || undefined;
      const lang = urlObj.searchParams.get('lang') || 'en';
      const { lat, lon } = parseCoordinates(urlObj);
      const data = await getWeatherBundle({ city, lat, lon, lang });
      return json(res, 200, { success: true, data: { location: data.location, daily: data.daily } });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/hourly') {
      const city = urlObj.searchParams.get('city') || undefined;
      const lang = urlObj.searchParams.get('lang') || 'en';
      const { lat, lon } = parseCoordinates(urlObj);
      const data = await getWeatherBundle({ city, lat, lon, lang });
      return json(res, 200, { success: true, data: { location: data.location, hourly: data.hourly } });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/historical') {
      const city = urlObj.searchParams.get('city') || undefined;
      const days = Number(urlObj.searchParams.get('days') || 7);
      const { lat, lon } = parseCoordinates(urlObj);
      const data = await getHistorical({ city, lat, lon, days });
      return json(res, 200, { success: true, data });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/compare') {
      const locations = (urlObj.searchParams.get('locations') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4);

      if (locations.length < 2) {
        return json(res, 400, { success: false, error: 'Provide at least 2 comma-separated location names.' });
      }

      const data = await Promise.all(locations.map((city) => getWeatherBundle({ city })));
      return json(res, 200, {
        success: true,
        data: data.map((entry) => ({
          location: entry.location,
          temperature: entry.current.temperature,
          condition: entry.current.condition,
          humidity: entry.current.humidity,
          windSpeed: entry.current.windSpeed
        }))
      });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/preferences') {
      return json(res, 200, { success: true, data: readPreferences() });
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/preferences') {
      const body = await parseBody(req);
      const data = writePreferences(body);
      return json(res, 200, { success: true, data });
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/weather/cache') {
      return json(res, 200, { success: true, data: cacheStats() });
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/weather/cache/clear') {
      clearCache();
      return json(res, 200, { success: true, message: 'Cache cleared' });
    }

    if (req.method === 'GET' && (urlObj.pathname === '/' || urlObj.pathname === '/index.html')) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && urlObj.pathname === '/app.js') {
      return sendFile(res, path.join(PUBLIC_DIR, 'app.js'), 'text/javascript; charset=utf-8');
    }

    if (req.method === 'GET' && urlObj.pathname === '/style.css') {
      return sendFile(res, path.join(PUBLIC_DIR, 'style.css'), 'text/css; charset=utf-8');
    }

    return json(res, 404, { success: false, error: 'Not Found' });
  } catch (error) {
    return json(res, 500, {
      success: false,
      error: error.message || 'Unexpected error',
      timestamp: new Date().toISOString()
    });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Weather dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = { server };
