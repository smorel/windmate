const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const {
  selectSpotsInBbox,
  findSpotWithinRadius,
  validateCreateSpotBody,
  formatSpotForMap,
} = require('../src/utils/spotBbox');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE spots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      ideal_directions TEXT NOT NULL DEFAULT '[]',
      source_url TEXT,
      igetwind_id TEXT
    )
  `);
  return db;
}

function insertSpot(db, spot) {
  db.prepare(
    `INSERT INTO spots (id, name, latitude, longitude, ideal_directions, source_url, igetwind_id)
     VALUES (@id, @name, @latitude, @longitude, '[]', @source_url, @igetwind_id)`
  ).run(spot);
}

describe('validateCreateSpotBody', () => {
  it('accepts valid spot input', () => {
    const result = validateCreateSpotBody({ name: 'My Launch', latitude: 45.5, longitude: -73.5 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { name: 'My Launch', latitude: 45.5, longitude: -73.5 });
  });

  it('rejects empty name', () => {
    const result = validateCreateSpotBody({ name: '  ', latitude: 45.5, longitude: -73.5 });
    assert.equal(result.ok, false);
  });

  it('rejects invalid coordinates', () => {
    assert.equal(validateCreateSpotBody({ name: 'X', latitude: 91, longitude: 0 }).ok, false);
    assert.equal(validateCreateSpotBody({ name: 'X', latitude: 0, longitude: 181 }).ok, false);
  });
});

describe('selectSpotsInBbox', () => {
  const spots = [
    { id: '1', name: 'A', latitude: 45.5, longitude: -73.5, igetwind_id: 'igw1' },
    { id: '2', name: 'B', latitude: 45.51, longitude: -73.51, igetwind_id: null },
    { id: '3', name: 'C', latitude: 46.0, longitude: -74.0, igetwind_id: 'igw2' },
  ];

  it('returns igetwind and windmate spots in viewport', () => {
    const result = selectSpotsInBbox(spots, 45.52, 45.49, -73.49, -73.52, 50, []);
    assert.equal(result.length, 2);
    const sources = result.map((s) => s.source).sort();
    assert.deepEqual(sources, ['igetwind', 'windmate']);
  });

  it('prioritizes favorites when over limit', () => {
    const many = [];
    for (let i = 0; i < 10; i++) {
      many.push({
        id: `s${i}`,
        name: `Spot ${i}`,
        latitude: 45.5 + i * 0.001,
        longitude: -73.5,
        igetwind_id: `igw${i}`,
      });
    }
    const result = selectSpotsInBbox(many, 45.51, 45.5, -73.49, -73.51, 3, ['s7']);
    assert.equal(result.length, 3);
    assert.ok(result.some((s) => s.id === 's7' && s.is_favorite));
  });
});

describe('findSpotWithinRadius', () => {
  const spots = [
    { id: '1', name: 'Near', latitude: 45.501, longitude: -73.567, igetwind_id: 'a' },
    { id: '2', name: 'Far', latitude: 46.0, longitude: -74.0, igetwind_id: 'b' },
  ];

  it('finds spot within 50 m', () => {
    const found = findSpotWithinRadius(spots, 45.5012, -73.5672);
    assert.equal(found?.id, '1');
  });

  it('returns null when no spot is close enough', () => {
    const found = findSpotWithinRadius(spots, 45.0, -72.0);
    assert.equal(found, null);
  });
});

describe('formatSpotForMap', () => {
  it('marks source and favorite state', () => {
    const igetwind = formatSpotForMap(
      { id: 'a', name: 'I', latitude: 1, longitude: 2, igetwind_id: 'x' },
      new Set(['b'])
    );
    assert.equal(igetwind.source, 'igetwind');
    assert.equal(igetwind.is_favorite, false);

    const manual = formatSpotForMap(
      { id: 'b', name: 'M', latitude: 1, longitude: 2, igetwind_id: null },
      new Set(['b'])
    );
    assert.equal(manual.source, 'windmate');
    assert.equal(manual.is_favorite, true);
  });
});

describe('manual spots persistence', () => {
  it('manual spot row has null igetwind_id', () => {
    const db = createTestDb();
    const id = uuidv4();
    insertSpot(db, {
      id,
      name: 'Custom',
      latitude: 45.5,
      longitude: -73.5,
      source_url: null,
      igetwind_id: null,
    });
    const row = db.prepare('SELECT * FROM spots WHERE id = ?').get(id);
    assert.equal(row.igetwind_id, null);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM spots WHERE igetwind_id IS NULL').get().n,
      1
    );
  });
});
