const { v4: uuidv4 } = require('uuid');
const { haversineKm } = require('../utils/geo');
const { fetchAllSpots, spotProfileUrl } = require('./igetwind');

/**
 * Import validated iGetwind spots. Syncs all spots when radius is 0, otherwise filters by center.
 * @param {import('better-sqlite3').Database} db
 */
async function syncIgetwindSpots(db) {
  const radiusKm = parseFloat(process.env.IGETWIND_SYNC_RADIUS_KM ?? '0');
  const centerLat = parseFloat(process.env.IGETWIND_SYNC_CENTER_LAT ?? '45.5017');
  const centerLng = parseFloat(process.env.IGETWIND_SYNC_CENTER_LNG ?? '-73.5673');

  const { spots } = await fetchAllSpots();
  let validated = spots.filter(
    (spot) => spot.vld === 1 && spot.geo?.lat != null && spot.geo?.long != null
  );

  if (radiusKm > 0) {
    validated = validated.filter(
      (spot) => haversineKm(centerLat, centerLng, spot.geo.lat, spot.geo.long) <= radiusKm
    );
  }

  const updateSpot = db.prepare(`
    UPDATE spots
    SET name = @name, latitude = @latitude, longitude = @longitude, source_url = @source_url
    WHERE igetwind_id = @igetwind_id
  `);

  const insertSpot = db.prepare(`
    INSERT INTO spots (id, name, latitude, longitude, ideal_directions, source_url, igetwind_id)
    VALUES (@id, @name, @latitude, @longitude, @ideal_directions, @source_url, @igetwind_id)
  `);

  const sync = db.transaction((rows) => {
    let inserted = 0;
    let updated = 0;
    for (const spot of rows) {
      const existing = db.prepare('SELECT id FROM spots WHERE igetwind_id = ?').get(spot._id);
      const row = {
        id: existing?.id ?? uuidv4(),
        name: spot.name,
        latitude: spot.geo.lat,
        longitude: spot.geo.long,
        ideal_directions: '[]',
        source_url: spotProfileUrl(spot.uname),
        igetwind_id: spot._id,
      };
      if (existing) {
        updateSpot.run(row);
        updated++;
      } else {
        insertSpot.run(row);
        inserted++;
      }
    }

    const removed = db.prepare('DELETE FROM spots WHERE igetwind_id IS NULL').run().changes;
    return { inserted, updated, removed, total: rows.length };
  });

  return sync(validated);
}

module.exports = { syncIgetwindSpots };
