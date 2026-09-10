const { getSpotById, getSpotIntelCache, setSpotIntelCache } = require('../db');
const { buildMediaGalleryFallback } = require('./googleMedia');
const {
  fetchGoogleImageResults,
  isCseConfigured,
  galleryHasPlaceholderMedia,
} = require('./intelSources/googleMediaFetch');
const { fetchCommonsImageResults } = require('./intelSources/wikimediaCommons');

const MAX_STRIP_ITEMS = 10;
const INTEL_CACHE_TTL_MS = parseInt(process.env.INTEL_CACHE_TTL_MS ?? '3600000', 10);

function splitMediaItems(items) {
  const images = [];
  const videos = [];
  for (const item of items ?? []) {
    if (item.type === 'video') videos.push(item);
    else images.push({ ...item, type: 'image' });
  }
  return { images, videos };
}

function mergeStripItems(gallery) {
  const merged = [...(gallery.images ?? []), ...(gallery.videos ?? [])];
  return merged.slice(0, MAX_STRIP_ITEMS);
}

function cacheIsFresh(fetchedAt) {
  if (!fetchedAt) return false;
  return Date.now() - fetchedAt < INTEL_CACHE_TTL_MS;
}

function normalizeGallery(parsed, sport, spot) {
  const fallback = buildMediaGalleryFallback(spot, sport);

  if (Array.isArray(parsed.items)) {
    const { images, videos } = splitMediaItems(parsed.items);
    return {
      sport: parsed.sport ?? sport,
      images,
      videos,
      google_images_url: fallback.google_images_url,
      google_videos_url: fallback.google_videos_url,
    };
  }

  return {
    sport: parsed.sport ?? sport,
    images: parsed.images ?? [],
    videos: parsed.videos ?? [],
    google_images_url: fallback.google_images_url,
    google_videos_url: fallback.google_videos_url,
  };
}

function parseMediaGallery(raw, sport, spot) {
  if (!raw) return normalizeGallery({ items: [] }, sport, spot);

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return normalizeGallery({ items: [] }, sport, spot);
    }
  }

  if (galleryHasPlaceholderMedia(parsed)) {
    return normalizeGallery({ items: [] }, sport, spot);
  }

  return normalizeGallery(parsed, sport, spot);
}

async function persistMediaGallery(db, spot, sport, items, source) {
  if (!items.length) return null;
  const fallback = buildMediaGalleryFallback(spot, sport);
  const payload = {
    sport,
    source,
    items,
    google_images_url: fallback.google_images_url,
    google_videos_url: fallback.google_videos_url,
  };
  setSpotIntelCache(db, spot.id, {
    fetched_at: Date.now(),
    media_gallery: JSON.stringify(payload),
  });
  return normalizeGallery(payload, sport, spot);
}

function cacheHasMedia(raw) {
  if (!raw) return false;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  if (Array.isArray(parsed.items)) return parsed.items.length > 0;
  return (parsed.images?.length ?? 0) + (parsed.videos?.length ?? 0) > 0;
}

async function resolveMediaGallery(db, spot, sport) {
  const cache = getSpotIntelCache(db, spot.id);
  const cacheValid =
    cache?.media_gallery &&
    cacheHasMedia(cache.media_gallery) &&
    cacheIsFresh(cache.fetched_at) &&
    !galleryHasPlaceholderMedia(cache.media_gallery);

  if (cacheValid) {
    return parseMediaGallery(cache.media_gallery, sport, spot);
  }

  try {
    const commonsItems = await fetchCommonsImageResults(spot, MAX_STRIP_ITEMS);
    if (commonsItems.length) {
      const gallery = await persistMediaGallery(db, spot, sport, commonsItems, 'wikimedia_commons');
      if (gallery) return gallery;
    }
  } catch (err) {
    console.warn(`[spotIntel] Wikimedia Commons fetch failed for ${spot.name}:`, err.message);
  }

  if (isCseConfigured()) {
    try {
      const items = await fetchGoogleImageResults(spot, MAX_STRIP_ITEMS);
      if (items.length) {
        const gallery = await persistMediaGallery(db, spot, sport, items, 'google_cse');
        if (gallery) return gallery;
      }
    } catch (err) {
      console.warn(`[spotIntel] Google image fetch failed for ${spot.name}:`, err.message);
    }
  }

  return parseMediaGallery(null, sport, spot);
}

async function getSpotIntel(db, spotId, sport = 'wingfoiling') {
  const spot = getSpotById(db, spotId);
  if (!spot) return null;

  const mediaGallery = await resolveMediaGallery(db, spot, sport);
  const strip = mergeStripItems(mediaGallery);
  const cache = getSpotIntelCache(db, spot.id);

  return {
    spot_id: spotId,
    fetched_at: cache?.fetched_at ?? null,
    media_gallery: {
      ...mediaGallery,
      strip,
    },
  };
}

module.exports = { getSpotIntel, mergeStripItems, parseMediaGallery, MAX_STRIP_ITEMS };
