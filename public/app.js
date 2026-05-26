const state = {
  preferences: { theme: 'light', language: 'en', favorites: [] },
  map: null,
  marker: null,
  chart: null,
  lastLocation: null
};

const ui = {
  status: document.getElementById('status'),
  currentCard: document.getElementById('currentCard'),
  airCard: document.getElementById('airCard'),
  dailyGrid: document.getElementById('dailyGrid'),
  historical: document.getElementById('historical'),
  favorites: document.getElementById('favorites'),
  compareResults: document.getElementById('compareResults')
};

const locationInput = document.getElementById('locationInput');
const searchButton = document.getElementById('searchButton');
const geoButton = document.getElementById('geoButton');
const themeToggle = document.getElementById('themeToggle');
const languageSelect = document.getElementById('languageSelect');
const compareInput = document.getElementById('compareInput');
const compareButton = document.getElementById('compareButton');

function setStatus(text) {
  ui.status.textContent = text || '';
}

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload.data;
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

async function savePreferences(next) {
  state.preferences = await api('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next)
  });
  renderFavorites();
}

function renderFavorites() {
  ui.favorites.innerHTML = '';
  if (!state.preferences.favorites.length) {
    ui.favorites.textContent = 'No favorites yet.';
    return;
  }

  state.preferences.favorites.forEach((city) => {
    const el = document.createElement('button');
    el.className = 'badge';
    el.textContent = city;
    el.onclick = () => loadWeather({ city });
    ui.favorites.appendChild(el);
  });
}

function renderWeather(data) {
  state.lastLocation = data.location;
  const c = data.current;
  ui.currentCard.innerHTML = `
    <h2>${data.location.name}, ${data.location.country || ''}</h2>
    <p style="font-size:1.4rem">${c.conditionEmoji} ${c.temperature}°C</p>
    <p>${c.condition}</p>
    <p>Feels like: ${c.feelsLike}°C · Humidity: ${c.humidity}% · Wind: ${c.windSpeed} km/h</p>
    <p>UV: ${c.uvIndex ?? '-'} · Pressure: ${c.pressure ?? '-'} hPa</p>
    <button id="favBtn">⭐ Save favorite</button>
  `;
  document.getElementById('favBtn').onclick = async () => {
    const next = [...new Set([data.location.name, ...state.preferences.favorites])].slice(0, 10);
    await savePreferences({ ...state.preferences, favorites: next });
  };

  ui.airCard.innerHTML = `
    <h2>Air Quality</h2>
    <p>US AQI: <strong>${data.airQuality.usAqi ?? '-'}</strong></p>
    <p>PM2.5: <strong>${data.airQuality.pm25 ?? '-'} μg/m³</strong></p>
    <p>Sunrise: ${data.daily[0]?.sunrise?.slice(11, 16) || '-'}</p>
    <p>Sunset: ${data.daily[0]?.sunset?.slice(11, 16) || '-'}</p>
    ${data.alerts.length ? `<p>⚠️ ${data.alerts.join(' ')}</p>` : '<p>No active weather alerts.</p>'}
    ${data.warning ? `<p>ℹ️ ${data.warning}</p>` : ''}
  `;

  ui.dailyGrid.innerHTML = data.daily
    .map(
      (d) => `<div class="daily-item">
        <strong>${d.date}</strong>
        <div>${d.conditionEmoji} ${d.condition}</div>
        <div>${d.temperatureMin}° / ${d.temperatureMax}°C</div>
        <div>Rain: ${d.precipitationProbabilityMax}% · UV: ${d.uvIndexMax ?? '-'}</div>
      </div>`
    )
    .join('');

  drawHourlyChart(data.hourly);
  drawMap(data.location);
  maybeNotify(data);
}

function drawHourlyChart(hourly) {
  const ctx = document.getElementById('hourlyChart');
  if (!window.Chart) {
    const parent = ctx.parentElement;
    if (parent && !parent.querySelector('[data-chart-fallback]')) {
      parent.insertAdjacentHTML('beforeend', '<p data-chart-fallback>Chart library unavailable; showing data in cards only.</p>');
    }
    return;
  }
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hourly.map((h) => h.time.slice(11, 16)),
      datasets: [
        { label: 'Temp °C', data: hourly.map((h) => h.temperature), borderColor: '#0ea5e9', tension: 0.35 },
        { label: 'Rain %', data: hourly.map((h) => h.precipitationProbability), borderColor: '#16a34a', tension: 0.35 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function drawMap(location) {
  if (!window.L) {
    const mapEl = document.getElementById('map');
    mapEl.textContent = `Map library unavailable. Coordinates: ${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}`;
    return;
  }
  if (!state.map) {
    state.map = L.map('map').setView([location.latitude, location.longitude], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
  } else {
    state.map.setView([location.latitude, location.longitude], 9);
  }

  if (state.marker) state.marker.remove();
  state.marker = L.marker([location.latitude, location.longitude]).addTo(state.map);
  state.marker.bindPopup(`${location.name}`).openPopup();
}

async function loadHistorical(params) {
  const query = params.city
    ? `city=${encodeURIComponent(params.city)}`
    : `lat=${params.lat}&lon=${params.lon}`;
  const data = await api(`/api/weather/historical?${query}&days=7`);
  ui.historical.innerHTML = `<table class="table"><tr><th>Date</th><th>Min</th><th>Max</th><th>Precip</th></tr>${data.historical
    .map((r) => `<tr><td>${r.date}</td><td>${r.temperatureMin}</td><td>${r.temperatureMax}</td><td>${r.precipitationSum}</td></tr>`)
    .join('')}</table>`;
}

async function loadWeather(params) {
  setStatus('Loading weather...');
  try {
    const query = params.city
      ? `city=${encodeURIComponent(params.city)}&lang=${state.preferences.language}`
      : `lat=${params.lat}&lon=${params.lon}&lang=${state.preferences.language}`;
    const data = await api(`/api/weather/current?${query}`);
    renderWeather(data);
    await loadHistorical(params);
    setStatus(`Updated at ${new Date(data.timestamp).toLocaleTimeString()} (${data.source}).`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

async function compareLocations() {
  const raw = compareInput.value.trim();
  if (!raw) return;
  try {
    const data = await api(`/api/weather/compare?locations=${encodeURIComponent(raw)}`);
    ui.compareResults.innerHTML = `<table class="table"><tr><th>Location</th><th>Temp</th><th>Condition</th></tr>${data
      .map((d) => `<tr><td>${d.location.name}</td><td>${d.temperature}°C</td><td>${d.condition}</td></tr>`)
      .join('')}</table>`;
  } catch (error) {
    setStatus(`Compare failed: ${error.message}`);
  }
}

function maybeNotify(data) {
  if (!window.Notification || Notification.permission !== 'granted' || !data.alerts.length) return;
  new Notification('Weather alert', { body: data.alerts.join(' ') });
}

async function initialize() {
  state.preferences = await api('/api/preferences');
  languageSelect.value = state.preferences.language;
  applyTheme(state.preferences.theme);
  renderFavorites();

  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  await loadWeather({ city: state.preferences.favorites[0] || 'New York' });
}

searchButton.onclick = () => {
  const city = locationInput.value.trim();
  if (city) loadWeather({ city });
};

geoButton.onclick = () => {
  if (!navigator.geolocation) return setStatus('Geolocation not available in this browser.');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => loadWeather({ lat: coords.latitude, lon: coords.longitude }),
    () => setStatus('Unable to read your location.')
  );
};

themeToggle.onclick = async () => {
  const theme = state.preferences.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  await savePreferences({ ...state.preferences, theme });
};

languageSelect.onchange = async () => {
  await savePreferences({ ...state.preferences, language: languageSelect.value });
  if (state.lastLocation?.name) {
    await loadWeather({ city: state.lastLocation.name });
  }
};

compareButton.onclick = compareLocations;

initialize().catch((error) => setStatus(`Startup failed: ${error.message}`));
