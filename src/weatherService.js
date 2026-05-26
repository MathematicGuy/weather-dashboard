const { TTLCache } = require('./cache');

const ttl = Number(process.env.CACHE_TTL || 600) * 1000;
const maxEntries = Number(process.env.CACHE_MAX_SIZE || 200);
const cache = new TTLCache(ttl, maxEntries);

const WEATHER_CODES = {
  0: { en: 'Clear sky', es: 'Cielo despejado', fr: 'Ciel dégagé', emoji: '☀️' },
  1: { en: 'Mainly clear', es: 'Mayormente despejado', fr: 'Globalement dégagé', emoji: '🌤️' },
  2: { en: 'Partly cloudy', es: 'Parcialmente nublado', fr: 'Partiellement nuageux', emoji: '⛅' },
  3: { en: 'Overcast', es: 'Nublado', fr: 'Couvert', emoji: '☁️' },
  45: { en: 'Fog', es: 'Niebla', fr: 'Brouillard', emoji: '🌫️' },
  51: { en: 'Light drizzle', es: 'Llovizna ligera', fr: 'Bruine légère', emoji: '🌦️' },
  61: { en: 'Rain', es: 'Lluvia', fr: 'Pluie', emoji: '🌧️' },
  71: { en: 'Snow', es: 'Nieve', fr: 'Neige', emoji: '🌨️' },
  95: { en: 'Thunderstorm', es: 'Tormenta', fr: 'Orage', emoji: '⛈️' }
};

function weatherLabel(code, lang = 'en') {
  const row = WEATHER_CODES[code] || WEATHER_CODES[3];
  return { condition: row[lang] || row.en, conditionEmoji: row.emoji };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Upstream request failed (${response.status})`);
  return response.json();
}

function normalizeCityResult(item) {
  return {
    name: item.name,
    country: item.country,
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone
  };
}

async function searchLocation(query) {
  const key = `search:${query.toLowerCase().trim()}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let results = [];
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
    const data = await fetchJson(url);
    results = (data.results || []).map(normalizeCityResult);
  } catch {
    const fallbackLocations = [
      { name: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
      { name: 'London', country: 'United Kingdom', latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London' },
      { name: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' },
      { name: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' }
    ];
    const q = query.toLowerCase().trim();
    results = fallbackLocations.filter((item) => item.name.toLowerCase().includes(q));
  }

  cache.set(key, results);
  return results;
}

async function resolveLocation({ city, lat, lon }) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { name: city || 'Selected location', latitude: lat, longitude: lon, timezone: 'auto' };
  }
  if (!city) throw new Error('Provide city or lat/lon');
  const results = await searchLocation(city);
  if (!results.length) throw new Error('Location not found');
  return results[0];
}

function buildWeatherUrl(location, { days = 7, hours = 24 }) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&timezone=auto&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl,is_day&hourly=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset&past_days=1&forecast_days=${Math.max(1, Math.min(16, days))}`;
}

function buildAirQualityUrl(location) {
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.latitude}&longitude=${location.longitude}&timezone=auto&hourly=us_aqi,pm2_5`;
}

function takeNext24Hours(hourly) {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < hourly.time.length; i += 1) {
    const ts = new Date(hourly.time[i]).getTime();
    if (ts >= now && rows.length < 24) {
      const label = weatherLabel(hourly.weather_code[i]);
      rows.push({
        time: hourly.time[i],
        temperature: hourly.temperature_2m[i],
        humidity: hourly.relative_humidity_2m[i],
        windSpeed: hourly.wind_speed_10m[i],
        precipitationProbability: hourly.precipitation_probability[i],
        ...label
      });
    }
  }
  return rows;
}

function normalizeWeather({ location, weather, air, lang = 'en' }) {
  const currentLabel = weatherLabel(weather.current.weather_code, lang);
  const daily = weather.daily.time.map((date, index) => ({
    date,
    temperatureMax: weather.daily.temperature_2m_max[index],
    temperatureMin: weather.daily.temperature_2m_min[index],
    precipitationProbabilityMax: weather.daily.precipitation_probability_max[index],
    uvIndexMax: weather.daily.uv_index_max[index],
    sunrise: weather.daily.sunrise[index],
    sunset: weather.daily.sunset[index],
    ...weatherLabel(weather.daily.weather_code[index], lang)
  }));

  const airLatestIndex = Math.max(0, air.hourly.time.length - 1);

  return {
    location,
    current: {
      temperature: weather.current.temperature_2m,
      feelsLike: weather.current.apparent_temperature,
      humidity: weather.current.relative_humidity_2m,
      windSpeed: weather.current.wind_speed_10m,
      pressure: weather.current.pressure_msl,
      uvIndex: daily[0]?.uvIndexMax ?? null,
      ...currentLabel
    },
    hourly: takeNext24Hours(weather.hourly).slice(0, 24),
    daily: daily.slice(0, 7),
    airQuality: {
      usAqi: air.hourly.us_aqi[airLatestIndex],
      pm25: air.hourly.pm2_5[airLatestIndex]
    },
    alerts: buildAlerts({ currentCode: weather.current.weather_code, daily }),
    timestamp: new Date().toISOString()
  };
}

function buildAlerts({ currentCode, daily }) {
  const alerts = [];
  if (currentCode >= 95) alerts.push('Thunderstorm conditions detected.');
  if ((daily[0]?.uvIndexMax || 0) >= 8) alerts.push('High UV index expected today.');
  if ((daily[0]?.temperatureMax || 0) >= 35) alerts.push('Heat alert: very high daytime temperatures.');
  return alerts;
}

function buildFallbackWeather({ location, lang = 'en' }) {
  const now = new Date();
  const baseTemp = Math.round(((location.latitude + 90) % 30) + 5);
  const hourly = [];
  for (let i = 0; i < 24; i += 1) {
    const t = new Date(now.getTime() + i * 3600 * 1000);
    const wave = Math.sin((i / 24) * Math.PI * 2);
    const temperature = Math.round((baseTemp + wave * 5) * 10) / 10;
    hourly.push({
      time: t.toISOString(),
      temperature,
      humidity: 55 + Math.round(Math.abs(wave) * 20),
      windSpeed: 8 + Math.round(Math.abs(wave) * 7),
      precipitationProbability: Math.max(0, Math.round((1 - wave) * 20)),
      ...weatherLabel(2, lang)
    });
  }

  const daily = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const max = Math.round(baseTemp + 6 + Math.sin(i) * 3);
    const min = Math.round(baseTemp - 2 + Math.cos(i) * 2);
    daily.push({
      date: d.toISOString().slice(0, 10),
      temperatureMax: max,
      temperatureMin: min,
      precipitationProbabilityMax: Math.max(5, Math.round(35 - Math.sin(i) * 15)),
      uvIndexMax: Math.min(11, 4 + i),
      sunrise: new Date(d.setHours(6, 0, 0, 0)).toISOString(),
      sunset: new Date(d.setHours(18, 0, 0, 0)).toISOString(),
      ...weatherLabel(2, lang)
    });
  }

  return {
    location,
    current: {
      temperature: hourly[0].temperature,
      feelsLike: hourly[0].temperature - 1,
      humidity: hourly[0].humidity,
      windSpeed: hourly[0].windSpeed,
      pressure: 1012,
      uvIndex: daily[0].uvIndexMax,
      ...weatherLabel(2, lang)
    },
    hourly,
    daily,
    airQuality: {
      usAqi: 48,
      pm25: 10
    },
    alerts: buildAlerts({ currentCode: 2, daily }),
    timestamp: new Date().toISOString(),
    warning: 'Serving fallback sample weather due to upstream unavailability.'
  };
}

async function getWeatherBundle({ city, lat, lon, lang = 'en' }) {
  const location = await resolveLocation({ city, lat, lon });
  const cacheKey = `weather:${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}:${lang}`;

  const cached = cache.get(cacheKey);
  if (cached) return { ...cached, source: 'cache' };

  try {
    const [weather, air] = await Promise.all([
      fetchJson(buildWeatherUrl(location, {})),
      fetchJson(buildAirQualityUrl(location))
    ]);

    const data = normalizeWeather({ location, weather, air, lang });
    cache.set(cacheKey, data);
    return { ...data, source: 'live' };
  } catch (error) {
    const stale = cache.getStale(cacheKey);
    if (stale) {
      return { ...stale, source: 'stale-cache', warning: 'Serving stale cached data due to upstream failure.' };
    }
    return { ...buildFallbackWeather({ location, lang }), source: 'fallback' };
  }
}

async function getHistorical({ city, lat, lon, days = 7 }) {
  const location = await resolveLocation({ city, lat, lon });
  const safeDays = Math.max(1, Math.min(14, Number(days) || 7));
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (safeDays - 1));
  const date = (d) => d.toISOString().slice(0, 10);

  const key = `hist:${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}:${safeDays}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let result;
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${location.latitude}&longitude=${location.longitude}&start_date=${date(start)}&end_date=${date(end)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
    const data = await fetchJson(url);
    result = {
      location,
      historical: data.daily.time.map((day, i) => ({
        date: day,
        temperatureMax: data.daily.temperature_2m_max[i],
        temperatureMin: data.daily.temperature_2m_min[i],
        precipitationSum: data.daily.precipitation_sum[i]
      }))
    };
  } catch {
    const fallback = buildFallbackWeather({ location });
    result = {
      location,
      historical: fallback.daily.slice(0, safeDays).map((day) => ({
        date: day.date,
        temperatureMax: day.temperatureMax,
        temperatureMin: day.temperatureMin,
        precipitationSum: Math.round((day.precipitationProbabilityMax / 100) * 8 * 10) / 10
      }))
    };
  }

  cache.set(key, result);
  return result;
}

function cacheStats() {
  return cache.stats();
}

function clearCache() {
  cache.clear();
}

module.exports = {
  searchLocation,
  getWeatherBundle,
  getHistorical,
  cacheStats,
  clearCache,
  weatherLabel,
  takeNext24Hours,
  normalizeWeather,
  buildFallbackWeather
};
