const { buildSpotMediaQuery } = require('../googleMedia');

const PLACEHOLDER_HOSTS = ['picsum.photos'];

function isCseConfigured() {
  return Boolean(process.env.GOOGLE_CSE_API_KEY?.trim() && process.env.GOOGLE_CSE_CX?.trim());
}

function isPlaceholderMediaUrl(url) {
  if (!url) return true;
  return PLACEHOLDER_HOSTS.some((host) => url.includes(host));
}

function galleryHasPlaceholderMedia(raw) {
  if (!raw) return false;
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.includes('picsum.photos')) return false;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw.includes('picsum.photos');
    }
  }

  const items = parsed.items ?? [...(parsed.images ?? []), ...(parsed.videos ?? [])];
  return items.some((item) => isPlaceholderMediaUrl(item.thumbnail_url));
}

/** Fetch image results via Google Custom Search — same query as link-out search. */
async function fetchGoogleImageResults(spot, limit = 8) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) return [];

  const q = buildSpotMediaQuery(spot);
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set('safe', 'active');

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google CSE ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }

  const data = await res.json();
  return (data.items ?? []).map((item) => ({
    type: 'image',
    title: item.title?.trim() || spot.name,
    thumbnail_url: item.image?.thumbnailLink ?? item.link,
    source_url: item.image?.contextLink ?? item.link,
  }));
}

module.exports = {
  isCseConfigured,
  isPlaceholderMediaUrl,
  galleryHasPlaceholderMedia,
  fetchGoogleImageResults,
};
