const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { SPORT_DEFAULTS } = require('./utils/sports');
const { DEFAULT_RANK_CRITERIA_ORDER, parseRankCriteriaOrder } = require('./utils/rankCriteria');
const { parseFavoriteSpotIds } = require('./utils/favoriteSpots');
const { DEFAULT_SEARCH_RADIUS_KM, parseSearchRadiusKm } = require('./utils/searchRadius');
const { parseMinRideableWindowHours } = require('./utils/rideableWindow');
const { haversineKm } = require('./utils/geo');
const MONTREAL_SPOTS = require('./seed/montreal-spots');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'windwatch.db');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** @returns {import('better-sqlite3').Database} */
function initDb() {
  ensureDataDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS spots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      ideal_directions TEXT NOT NULL DEFAULT '[]',
      source_url TEXT,
      igetwind_id TEXT
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sport TEXT NOT NULL DEFAULT 'wingfoiling',
      min_wind_knots INTEGER NOT NULL DEFAULT 12,
      max_gust_knots INTEGER NOT NULL DEFAULT 25,
      min_air_temp_c REAL,
      min_water_temp_c REAL
    );

    CREATE TABLE IF NOT EXISTS forecast_cache (
      spot_id TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observation_cache (
      spot_id TEXT PRIMARY KEY REFERENCES spots(id),
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_cache (
      spot_id TEXT PRIMARY KEY REFERENCES spots(id),
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  migrateDb(db);
  seedPreferences(db);
  seedMontrealIdealDirections(db);
  return db;
}

/** @param {import('better-sqlite3').Database} db */
function migrateDb(db) {
  const spotColumns = db.prepare('PRAGMA table_info(spots)').all().map((c) => c.name);
  if (!spotColumns.includes('igetwind_id')) {
    db.exec('ALTER TABLE spots ADD COLUMN igetwind_id TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_spots_igetwind_id
    ON spots(igetwind_id) WHERE igetwind_id IS NOT NULL
  `);

  const prefColumns = db.prepare('PRAGMA table_info(user_preferences)').all().map((c) => c.name);
  if (!prefColumns.includes('min_air_temp_c')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN min_air_temp_c REAL');
  }
  if (!prefColumns.includes('min_water_temp_c')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN min_water_temp_c REAL');
  }
  if (!prefColumns.includes('rank_criteria_order')) {
    db.exec(
      `ALTER TABLE user_preferences ADD COLUMN rank_criteria_order TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_RANK_CRITERIA_ORDER)}'`
    );
  }
  if (!prefColumns.includes('favorite_spot_ids')) {
    db.exec(`ALTER TABLE user_preferences ADD COLUMN favorite_spot_ids TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!prefColumns.includes('radius_km')) {
    db.exec(
      `ALTER TABLE user_preferences ADD COLUMN radius_km INTEGER NOT NULL DEFAULT ${DEFAULT_SEARCH_RADIUS_KM}`
    );
  }
  if (!prefColumns.includes('offshore_wind_ok')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN offshore_wind_ok INTEGER NOT NULL DEFAULT 0');
  }
  if (!prefColumns.includes('min_rideable_window_hours')) {
    db.exec('ALTER TABLE user_preferences ADD COLUMN min_rideable_window_hours INTEGER NOT NULL DEFAULT 2');
  }

  const prefs = db.prepare('SELECT sport, min_air_temp_c, min_water_temp_c FROM user_preferences WHERE id = 1').get();
  if (prefs && prefs.min_air_temp_c == null && prefs.min_water_temp_c == null) {
    const defaults = SPORT_DEFAULTS[prefs.sport] ?? SPORT_DEFAULTS.wingfoiling;
    db.prepare(`
      UPDATE user_preferences SET min_air_temp_c = ?, min_water_temp_c = ? WHERE id = 1
    `).run(defaults.min_air_temp_c, defaults.min_water_temp_c);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_cache (
      spot_id TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_cache (
      spot_id TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);
}

/** @param {import('better-sqlite3').Database} db */
function seedPreferences(db) {
  const row = db.prepare('SELECT id FROM user_preferences WHERE id = 1').get();
  if (row) return;

  const defaults = SPORT_DEFAULTS.wingfoiling;
  db.prepare(`
    INSERT INTO user_preferences (id, sport, min_wind_knots, max_gust_knots, min_air_temp_c, min_water_temp_c, rank_criteria_order, favorite_spot_ids, radius_km, offshore_wind_ok)
    VALUES (1, 'wingfoiling', ?, ?, ?, ?, ?, '[]', ?, ?)
  `).run(
    defaults.min_wind_knots,
    defaults.max_gust_knots,
    defaults.min_air_temp_c,
    defaults.min_water_temp_c,
    JSON.stringify(DEFAULT_RANK_CRITERIA_ORDER),
    DEFAULT_SEARCH_RADIUS_KM,
    defaults.offshore_wind_ok
  );
}

/** Merge ideal wind directions from Montreal seed onto synced spots by proximity. */
function seedMontrealIdealDirections(db) {
  const update = db.prepare('UPDATE spots SET ideal_directions = ? WHERE id = ?');
  const spots = db.prepare('SELECT id, latitude, longitude, ideal_directions FROM spots').all();
  const MAX_KM = 12;

  for (const spot of spots) {
    let current = [];
    try {
      current = JSON.parse(spot.ideal_directions || '[]');
    } catch {
      current = [];
    }
    if (current.length > 0) continue;

    let bestSeed = null;
    let bestDist = Infinity;
    for (const seed of MONTREAL_SPOTS) {
      const dist = haversineKm(spot.latitude, spot.longitude, seed.latitude, seed.longitude);
      if (dist < bestDist) {
        bestDist = dist;
        bestSeed = seed;
      }
    }
    if (bestSeed && bestDist <= MAX_KM) {
      update.run(JSON.stringify(bestSeed.ideal_directions), spot.id);
    }
  }
}

/** @param {import('better-sqlite3').Database} db */
function getPreferences(db) {
  const row = db.prepare(`
    SELECT sport, min_wind_knots, max_gust_knots, min_air_temp_c, min_water_temp_c, rank_criteria_order, favorite_spot_ids, radius_km, offshore_wind_ok, min_rideable_window_hours
    FROM user_preferences WHERE id = 1
  `).get();
  if (!row) return row;
  let favoriteIds = [];
  try {
    favoriteIds = parseFavoriteSpotIds(JSON.parse(row.favorite_spot_ids ?? '[]'));
  } catch {
    favoriteIds = [];
  }
  return {
    ...row,
    rank_criteria_order: parseRankCriteriaOrder(row.rank_criteria_order),
    favorite_spot_ids: favoriteIds,
    radius_km: parseSearchRadiusKm(row.radius_km),
    offshore_wind_ok: row.offshore_wind_ok ? 1 : 0,
    min_rideable_window_hours: parseMinRideableWindowHours(row.min_rideable_window_hours),
  };
}

/** @param {import('better-sqlite3').Database} db */
function updatePreferences(db, prefs) {
  db.prepare(`
    UPDATE user_preferences
    SET sport = ?, min_wind_knots = ?, max_gust_knots = ?,
        min_air_temp_c = ?, min_water_temp_c = ?,
        rank_criteria_order = ?, favorite_spot_ids = ?, radius_km = ?,
        offshore_wind_ok = ?, min_rideable_window_hours = ?
    WHERE id = 1
  `).run(
    prefs.sport,
    prefs.min_wind_knots,
    prefs.max_gust_knots,
    prefs.min_air_temp_c ?? null,
    prefs.min_water_temp_c ?? null,
    JSON.stringify(parseRankCriteriaOrder(prefs.rank_criteria_order)),
    JSON.stringify(parseFavoriteSpotIds(prefs.favorite_spot_ids)),
    parseSearchRadiusKm(prefs.radius_km),
    prefs.offshore_wind_ok ? 1 : 0,
    prefs.min_rideable_window_hours
  );
  return getPreferences(db);
}

function getObservationCache(db, spotId) {
  return db.prepare('SELECT fetched_at, data FROM observation_cache WHERE spot_id = ?').get(spotId);
}

function setObservationCache(db, spotId, data) {
  db.prepare(`
    INSERT INTO observation_cache (spot_id, fetched_at, data)
    VALUES (?, ?, ?)
    ON CONFLICT(spot_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data
  `).run(spotId, Date.now(), JSON.stringify(data));
}

/** @param {import('better-sqlite3').Database} db */
function getAllSpots(db) {
  return db
    .prepare('SELECT * FROM spots WHERE igetwind_id IS NOT NULL ORDER BY name')
    .all()
    .map(parseSpot);
}

/** @param {import('better-sqlite3').Database} db @param {string} id */
function getSpotById(db, id) {
  const row = db.prepare('SELECT * FROM spots WHERE id = ?').get(id);
  return row ? parseSpot(row) : null;
}

function parseSpot(row) {
  return {
    ...row,
    ideal_directions: JSON.parse(row.ideal_directions),
  };
}

module.exports = {
  initDb,
  getPreferences,
  updatePreferences,
  getAllSpots,
  getSpotById,
  getObservationCache,
  setObservationCache,
  DB_PATH,
};
