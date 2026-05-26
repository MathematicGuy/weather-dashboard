const test = require('node:test');
const assert = require('node:assert/strict');
const { weatherLabel, takeNext24Hours, normalizeWeather, buildFallbackWeather } = require('../src/weatherService');

test('weatherLabel returns translated condition and emoji', () => {
  const result = weatherLabel(61, 'es');
  assert.equal(result.condition, 'Lluvia');
  assert.equal(result.conditionEmoji, '🌧️');
});

test('takeNext24Hours limits and formats hourly weather', () => {
  const now = Date.now();
  const hourly = { time: [], temperature_2m: [], relative_humidity_2m: [], weather_code: [], wind_speed_10m: [], precipitation_probability: [] };
  for (let i = -2; i < 40; i += 1) {
    hourly.time.push(new Date(now + i * 3600 * 1000).toISOString());
    hourly.temperature_2m.push(i);
    hourly.relative_humidity_2m.push(50);
    hourly.weather_code.push(0);
    hourly.wind_speed_10m.push(5);
    hourly.precipitation_probability.push(10);
  }

  const next = takeNext24Hours(hourly);
  assert.equal(next.length, 24);
  assert.ok(next[0].time >= new Date(now).toISOString().slice(0, 13));
});

test('normalizeWeather builds current and daily summaries', () => {
  const weather = {
    current: { temperature_2m: 20, relative_humidity_2m: 44, apparent_temperature: 19, weather_code: 1, wind_speed_10m: 9, pressure_msl: 1012 },
    hourly: {
      time: [new Date().toISOString()],
      temperature_2m: [20],
      relative_humidity_2m: [44],
      weather_code: [1],
      wind_speed_10m: [9],
      precipitation_probability: [0]
    },
    daily: {
      time: ['2026-01-01'],
      temperature_2m_max: [23],
      temperature_2m_min: [12],
      precipitation_probability_max: [15],
      uv_index_max: [6],
      sunrise: ['2026-01-01T06:00:00'],
      sunset: ['2026-01-01T18:00:00'],
      weather_code: [1]
    }
  };
  const air = { hourly: { time: ['2026-01-01T00:00:00'], us_aqi: [42], pm2_5: [8] } };

  const normalized = normalizeWeather({ location: { name: 'Test', latitude: 1, longitude: 2 }, weather, air, lang: 'en' });
  assert.equal(normalized.current.temperature, 20);
  assert.equal(normalized.daily.length, 1);
  assert.equal(normalized.airQuality.usAqi, 42);
});

test('buildFallbackWeather returns complete local fallback bundle', () => {
  const fallback = buildFallbackWeather({ location: { name: 'Offline', latitude: 10, longitude: 20 }, lang: 'fr' });
  assert.equal(fallback.location.name, 'Offline');
  assert.equal(fallback.hourly.length, 24);
  assert.equal(fallback.daily.length, 7);
  assert.ok(typeof fallback.warning === 'string' && fallback.warning.length > 0);
});
