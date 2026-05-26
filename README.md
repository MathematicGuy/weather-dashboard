# 🌤️ Weather Dashboard

A production-ready weather dashboard using **Open-Meteo** APIs (no API key). It includes a Node.js backend, responsive frontend, caching, preference storage, maps, chart visualizations, and tests.

## Features

- Current weather: temperature, humidity, wind, pressure, UV, condition
- 7-day forecast and next 24-hour forecast
- Historical weather (last N days)
- City search + browser geolocation
- Air quality (US AQI, PM2.5)
- Sunrise/sunset and basic weather alerts
- Location comparison across cities
- Dark/light mode
- Multi-language conditions (English, Spanish, French)
- API response caching + stale-cache fallback
- User preferences and favorites persistence
- Rate limiting headers and protection
- Map visualization (Leaflet) and chart visualization (Chart.js)

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open:
- Dashboard: http://localhost:5000
- Health: http://localhost:5000/health

## API Documentation

Base URL: `http://localhost:5000/api`

### Current weather
`GET /weather/current?city=London&lang=en`

Or by coordinates:
`GET /weather/current?lat=51.5072&lon=-0.1276&lang=en`

### Forecast (7-day)
`GET /weather/forecast?city=London`

### Hourly (24-hour)
`GET /weather/hourly?city=London`

### Historical
`GET /weather/historical?city=London&days=7`

### Location search
`GET /weather/search?query=Tokyo`

### Compare locations
`GET /weather/compare?locations=Paris,Tokyo,New York`

### Preferences
- `GET /preferences`
- `POST /preferences`

Example request body:
```json
{
  "theme": "dark",
  "language": "en",
  "favorites": ["Tokyo", "Paris"]
}
```

### Cache
- `GET /weather/cache`
- `POST /weather/cache/clear`

## Configuration Guide

See `.env.example`:

- `PORT`: server port
- `CORS_ORIGIN`: allowed origin (`*` by default)
- `CACHE_TTL`: cache TTL in seconds
- `CACHE_MAX_SIZE`: max cache entries
- `RATE_LIMIT_WINDOW_MS`: rate limit window
- `RATE_LIMIT_MAX_REQUESTS`: max requests/window

## Testing

Run unit tests:

```bash
npm test
```

Run syntax/build checks:

```bash
npm run build
```

## Deployment Guide

### Vercel/Heroku-style (Node runtime)
- Set environment variables from `.env.example`
- Start command: `npm start`
- Expose port from `PORT`

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 5000
CMD ["npm","start"]
```

Build/run:

```bash
docker build -t weather-dashboard .
docker run -p 5000:5000 --env-file .env weather-dashboard
```

## Notes

- Open-Meteo is used for forecast, archive, geocoding, and air quality.
- Frontend dependencies (Leaflet, Chart.js) are loaded from CDNs.
- Browser Notifications are used for alert popups when permission is granted.
