/** Sport-aware Google Images/Videos search URLs for spot media discovery. */

const SPORT_MEDIA_TERMS = {
  wingfoiling: ['wingfoil', 'wing foil', 'wingfoiling', 'aile', 'foil'],
  kitesurfing: ['kitesurf', 'kiteboarding', 'kite', 'cerf-volant'],
  sailing: ['sailing', 'sailboat', 'dinghy', 'voile', 'deriveur'],
  windsurfing: ['windsurf', 'windsurfing', 'windsurfer', 'planche a voile'],
  kitefoiling: ['kitefoil', 'kite foil', 'kitefoiling', 'foil kite'],
  parawing: ['parawing', 'paraglide wing', 'parawing foil', 'aile parapente'],
};

const DEFAULT_SPORT = 'wingfoiling';

function sportTerms(sport) {
  return SPORT_MEDIA_TERMS[sport] ?? SPORT_MEDIA_TERMS[DEFAULT_SPORT];
}

function regionHint(spot) {
  return spot.region ?? spot.water_body ?? 'Montreal Quebec';
}

function buildQuery(spotName, hint) {
  return `${spotName} ${hint}`;
}

function encodeGoogleQuery(query) {
  return encodeURIComponent(query.trim());
}

function buildGoogleImagesUrl(spotName, _sport, hint = 'Montreal Quebec') {
  const q = encodeGoogleQuery(buildQuery(spotName, hint));
  return `https://www.google.com/search?tbm=isch&q=${q}`;
}

function buildGoogleVideosUrl(spotName, _sport, hint = 'Montreal Quebec') {
  const q = encodeGoogleQuery(buildQuery(spotName, hint));
  return `https://www.google.com/search?tbm=vid&q=${q}`;
}

function buildMediaGalleryFallback(spot, sport) {
  const hint = regionHint(spot);
  return {
    sport,
    images: [],
    videos: [],
    google_images_url: buildGoogleImagesUrl(spot.name, sport, hint),
    google_videos_url: buildGoogleVideosUrl(spot.name, sport, hint),
  };
}

function buildSpotMediaQuery(spot) {
  return buildQuery(spot.name, regionHint(spot));
}

module.exports = {
  SPORT_MEDIA_TERMS,
  sportTerms,
  buildGoogleImagesUrl,
  buildGoogleVideosUrl,
  buildMediaGalleryFallback,
  buildSpotMediaQuery,
  regionHint,
};
