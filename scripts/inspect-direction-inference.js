require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDb } = require('../src/db');
const db = initDb();
const total = db.prepare('SELECT COUNT(*) AS c FROM spots').get().c;
const withInf = db.prepare('SELECT COUNT(*) AS c FROM spots WHERE direction_inference IS NOT NULL').get().c;
const rows = db.prepare('SELECT name, direction_inference FROM spots').all();
let failed = 0;
let high = 0;
let low = 0;
let emptyDirs = 0;
const errors = {};
for (const r of rows) {
  if (!r.direction_inference) continue;
  let j;
  try {
    j = JSON.parse(r.direction_inference);
  } catch {
    continue;
  }
  if (j.confidence === 'failed') failed++;
  else if (j.confidence === 'high') high++;
  else if (j.confidence === 'low') low++;
  if (!j.directions?.length) emptyDirs++;
  const ek = `${j.confidence}:${j.error ?? 'none'}`;
  errors[ek] = (errors[ek] || 0) + 1;
}
console.log({ total, withInf, high, low, failed, emptyDirs });
console.log('errors:', errors);
console.log('sample:');
for (const r of rows.slice(0, 8)) {
  if (!r.direction_inference) {
    console.log(' -', r.name, '(no cache)');
    continue;
  }
  const j = JSON.parse(r.direction_inference);
  console.log(' -', r.name, j.confidence, j.error ?? '', (j.directions ?? []).join(','));
}
