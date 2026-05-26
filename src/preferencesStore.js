const fs = require('node:fs');
const path = require('node:path');

const PREFS_PATH = path.join(__dirname, '..', 'data', 'preferences.json');

const defaults = {
  theme: 'light',
  language: 'en',
  favorites: []
};

function ensureFile() {
  const dir = path.dirname(PREFS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(PREFS_PATH)) fs.writeFileSync(PREFS_PATH, JSON.stringify(defaults, null, 2));
}

function readPreferences() {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
    return {
      ...defaults,
      ...parsed,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.slice(0, 10) : []
    };
  } catch {
    return { ...defaults };
  }
}

function writePreferences(input) {
  const next = {
    ...defaults,
    ...input,
    favorites: Array.isArray(input.favorites) ? input.favorites.slice(0, 10) : []
  };
  ensureFile();
  fs.writeFileSync(PREFS_PATH, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readPreferences, writePreferences, defaults };
