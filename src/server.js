require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb } = require('./db');
const { createSpotsRouter } = require('./routes/spots');
const { createForecastRouter } = require('./routes/forecast');
const { createRideabilityRouter } = require('./routes/rideability');
const { createPreferencesRouter } = require('./routes/preferences');
const { createIgetwindRouter } = require('./routes/igetwind');
const { createLocationRouter } = require('./routes/location');
const { createGeocodeRouter } = require('./routes/geocode');
const { createObservationsRouter } = require('./routes/observations');
const { createSportsRouter } = require('./routes/sports');
const { createWatchlistRouter } = require('./routes/watchlist');
const { createDepartureRouter } = require('./routes/departure');
const { startHorizonAlertScheduler } = require('./cron/horizonAlertScheduler');
const { startWatchlistJobs } = require('./cron/watchlistDigest');
const { syncIgetwindSpots } = require('./services/igetwindSync');
const { getProvider } = require('./services/weather');
const { syncAssets } = require('../scripts/sync-assets');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const db = initDb();
const app = express();
const repoAssets = path.join(__dirname, '..', 'assets');
const publicAssets = path.join(__dirname, '..', 'public', 'assets');

app.use(express.json());
app.use('/assets', (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
// Repo assets/ first (edit here) — public/assets is a synced copy for deploy
app.use('/assets', express.static(repoAssets));
app.use('/assets', express.static(publicAssets));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    weather_provider: getProvider(),
  });
});

app.use('/api/spots', createSpotsRouter(db));
app.use('/api/forecast', createForecastRouter(db));
app.use('/api/rideability', createRideabilityRouter(db));
app.use('/api/observations', createObservationsRouter(db));
app.use('/api/preferences', createPreferencesRouter(db));
app.use('/api/sports', createSportsRouter(db));
app.use('/api/watchlist', createWatchlistRouter(db));
app.use('/api/departure', createDepartureRouter(db));
app.use('/api/igetwind', createIgetwindRouter(db));
app.use('/api/location', createLocationRouter());
app.use('/api/geocode', createGeocodeRouter());

startHorizonAlertScheduler(db);
startWatchlistJobs(db);

async function bootstrap() {
  try {
    const n = syncAssets();
    console.log(`[assets] Synced ${n} PNGs to public/assets`);
  } catch (err) {
    console.warn('[assets] Sync skipped:', err.message);
  }

  if (process.env.IGETWIND_SYNC_SPOTS !== 'false') {
    try {
      const result = await syncIgetwindSpots(db);
      console.log(
        `[igetwind] Synced ${result.total} spots (${result.inserted} new, ${result.updated} updated)`
      );
    } catch (err) {
      console.warn('[igetwind] Spot sync failed:', err.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`Windmate running at http://localhost:${PORT}`);
  });
}

bootstrap();
