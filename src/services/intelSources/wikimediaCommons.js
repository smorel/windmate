const { haversineKm } = require('../../utils/geo');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT =
  process.env.WINDMATE_USER_AGENT ??
  'Windmate/1.0 (spot media; https://github.com/windmate/windwatch)';

const DEFAULT_GEORADIUS_M = parseInt(process.env.COMMONS_GEORADIUS_M ?? '2000', 10);
const GEO_RADII_M = [500, 1200, Math.max(500, Math.min(DEFAULT_GEORADIUS_M, 3000))];

const IRRELEVANT_TITLE =
  /\b(toyota|chevrolet|ford|gmc|honda|nissan|bmw|mercedes|camry|sierra|caprice|sedan|crew cab)\b/i;
const EVENT_TITLE = /\b(orchestra|orchestre|spectacle|carnaval|concert|festival|wtmtl)\b/i;
const NON_PHOTO_EXT = /\.(pdf|djvu|svg|webm|ogv|ogg)$/i;
const HISTORIC_TITLE =
  /\b(btv1b|carte marine|marine chart|presbyt[eè]re|manoir|fa[çc]ade|vers 18|vers 19|imported from flickr)\b/i;
const WATER_TITLE =
  /\b(lac|lake|parc|park|plage|beach|rivi[eè]re|river|anse|water|eau|nature|shore|launch|baie|bay|waterfront|marina|sailing|kite|wing|foil|surf)\b/i;
const STRUCTURE_TITLE = /\b(pont|bridge|route principale|[eé]glise|church|airport|a[eé]roport)\b/i;

const CONFLICTING_PLACES = [
  'cap saint jacques',
  'cap-saint-jacques',
  'wasaga beach',
  'wasaga',
  'pont pierre-laporte',
  'pont de québec',
  'pont de quebec',
  'quebec bridge',
  'boundary bay',
  'key colony beach',
];

function spotSearchQuery(spot) {
  const name = String(spot.name ?? '')
    .replace(/[''`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name} Quebec`;
}

function isPhotoMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/') && mime !== 'image/svg+xml';
}

function spotNameTokens(spot) {
  return String(spot.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function titleHasSpotNameMatch(title, spot) {
  const lower = String(title ?? '').toLowerCase();
  return spotNameTokens(spot).some((token) => lower.includes(token));
}

function titleHasWaterContext(title) {
  return WATER_TITLE.test(String(title ?? ''));
}

function titleHasConflictingPlace(title, spot) {
  const lower = String(title ?? '').toLowerCase();
  const spotLower = String(spot.name ?? '').toLowerCase();
  return CONFLICTING_PLACES.some((place) => lower.includes(place) && !spotLower.includes(place));
}

function isRelevantGeoTitle(title, spot) {
  const lower = String(title ?? '').toLowerCase();
  if (NON_PHOTO_EXT.test(lower)) return false;
  if (IRRELEVANT_TITLE.test(lower)) return false;
  if (EVENT_TITLE.test(lower)) return false;
  if (HISTORIC_TITLE.test(lower) && !titleHasSpotNameMatch(title, spot)) return false;
  if (titleHasConflictingPlace(title, spot)) return false;
  if (STRUCTURE_TITLE.test(lower) && !titleHasSpotNameMatch(title, spot)) return false;
  return titleHasWaterContext(title) || titleHasSpotNameMatch(title, spot);
}

function distanceFromPage(page, spot) {
  const coord = page?.coordinates?.[0];
  if (!coord || spot.latitude == null || spot.longitude == null) return null;
  if (typeof page.dist === 'number' && Number.isFinite(page.dist)) return Math.round(page.dist);
  return Math.round(haversineKm(spot.latitude, spot.longitude, coord.lat, coord.lon) * 1000);
}

function pageToMediaItem(page, spot) {
  const info = page?.imageinfo?.[0];
  if (!info || !isPhotoMime(info.mime)) return null;

  const title = String(page.title ?? '')
    .replace(/^File:/i, '')
    .replace(/\.[^.]+$/, '')
    .trim();

  if (NON_PHOTO_EXT.test(title)) return null;

  const thumbnail = info.thumburl ?? info.url;
  const source = info.descriptionurl ?? info.url;
  if (!thumbnail || !source) return null;

  return {
    type: 'image',
    title: title || 'Spot photo',
    thumbnail_url: thumbnail,
    source_url: source,
    distance_m: spot ? distanceFromPage(page, spot) : null,
  };
}

function parseCommonsPages(data) {
  return Object.values(data?.query?.pages ?? {});
}

async function commonsRequest(params) {
  const url = new URL(COMMONS_API);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Wikimedia Commons API ${res.status}`);
  }
  const text = await res.text();
  if (text.startsWith('You are making too many requests')) {
    throw new Error('Wikimedia Commons API rate limited');
  }
  return JSON.parse(text);
}

async function fetchCommonsSearchImages(spot, limit) {
  const data = await commonsRequest({
    action: 'query',
    generator: 'search',
    gsrsearch: spotSearchQuery(spot),
    gsrnamespace: '6',
    gsrlimit: Math.min(Math.max(limit * 2, limit), 20),
    prop: 'imageinfo|coordinates',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '320',
  });
  return parseCommonsPages(data);
}

async function fetchCommonsGeoImages(spot, limit, radiusM) {
  const data = await commonsRequest({
    action: 'query',
    generator: 'geosearch',
    ggsprimary: 'all',
    ggsnamespace: '6',
    ggsradius: Math.max(500, Math.min(radiusM, 10000)),
    ggscoord: `${spot.latitude}|${spot.longitude}`,
    ggslimit: Math.min(Math.max(limit, 10), 50),
    prop: 'imageinfo|coordinates',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '320',
  });
  return parseCommonsPages(data);
}

function scoreMediaItem(item, spot) {
  const title = item.title ?? '';
  let score = 0;

  for (const token of spotNameTokens(spot)) {
    if (title.toLowerCase().includes(token)) score += 4;
  }
  if (titleHasWaterContext(title)) score += 2;
  if (titleHasConflictingPlace(title, spot)) score -= 8;
  if (EVENT_TITLE.test(title)) score -= 6;
  if (STRUCTURE_TITLE.test(title) && !titleHasSpotNameMatch(title, spot)) score -= 5;
  if (HISTORIC_TITLE.test(title) && !titleHasSpotNameMatch(title, spot)) score -= 4;

  const distanceM = item.distance_m;
  if (typeof distanceM === 'number') {
    if (distanceM <= 250) score += 10;
    else if (distanceM <= 600) score += 7;
    else if (distanceM <= 1200) score += 4;
    else if (distanceM <= 2000) score += 1;
    else score -= 4;
  }

  return score;
}

function isAcceptableMediaItem(item, spot) {
  const title = item.title ?? '';
  if (!isRelevantGeoTitle(title, spot)) return false;

  const score = scoreMediaItem(item, spot);
  if (score < 3) return false;

  const hasNameMatch = titleHasSpotNameMatch(title, spot);
  const distanceM = item.distance_m;

  if (hasNameMatch) return true;
  if (typeof distanceM === 'number' && distanceM <= 350 && titleHasWaterContext(title)) return true;
  if (typeof distanceM === 'number' && distanceM <= 900 && score >= 8) return true;

  return false;
}

function rankMediaItems(items, spot) {
  return [...items].sort((a, b) => scoreMediaItem(b, spot) - scoreMediaItem(a, spot));
}

function collectGeoCandidates(pages, spot, seen) {
  const items = [];
  for (const page of pages) {
    const item = pageToMediaItem(page, spot);
    if (!item || seen.has(item.source_url)) continue;
    if (!isRelevantGeoTitle(item.title, spot)) continue;
    seen.add(item.source_url);
    items.push(item);
  }
  return items;
}

function collectNameCandidates(pages, spot, seen) {
  const items = [];
  for (const page of pages) {
    const item = pageToMediaItem(page, spot);
    if (!item || seen.has(item.source_url)) continue;
    if (!titleHasSpotNameMatch(item.title, spot)) continue;
    if (!isRelevantGeoTitle(item.title, spot)) continue;
    seen.add(item.source_url);
    items.push(item);
  }
  return items;
}

/** Fetch geotagged photos near the spot, with strict name/location matching. */
async function fetchCommonsImageResults(spot, limit = 8) {
  if (spot.latitude == null || spot.longitude == null) return [];

  const seen = new Set();
  const candidates = [];

  for (const radiusM of GEO_RADII_M) {
    if (candidates.length >= limit * 3) break;
    const geoPages = await fetchCommonsGeoImages(spot, 30, radiusM);
    candidates.push(...collectGeoCandidates(geoPages, spot, seen));
  }

  if (candidates.filter((item) => isAcceptableMediaItem(item, spot)).length < limit) {
    const searchPages = await fetchCommonsSearchImages(spot, 20);
    candidates.push(...collectNameCandidates(searchPages, spot, seen));
  }

  return rankMediaItems(candidates, spot)
    .filter((item) => isAcceptableMediaItem(item, spot))
    .slice(0, limit);
}

module.exports = {
  spotSearchQuery,
  parseCommonsPages,
  pageToMediaItem,
  isRelevantGeoTitle,
  scoreMediaItem,
  isAcceptableMediaItem,
  rankMediaItems,
  fetchCommonsImageResults,
};
