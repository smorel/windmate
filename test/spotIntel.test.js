const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGoogleImagesUrl,
  buildGoogleVideosUrl,
  buildMediaGalleryFallback,
  buildSpotMediaQuery,
  sportTerms,
} = require('../src/services/googleMedia');
const { galleryHasPlaceholderMedia } = require('../src/services/intelSources/googleMediaFetch');
const { mergeStripItems, parseMediaGallery } = require('../src/services/spotIntel');

describe('googleMedia', () => {
  it('builds Google Images URL from spot name and region', () => {
    const url = buildGoogleImagesUrl("L'anse à l'orme", 'wingfoiling', 'Montreal Quebec');
    assert.ok(url.includes('tbm=isch'));
    assert.ok(decodeURIComponent(url).includes("L'anse"));
    assert.ok(!url.includes('wingfoil'));
    assert.ok(!url.includes('OR'));
  });

  it('builds Google Videos URL from spot name and region', () => {
    const url = buildGoogleVideosUrl('Hudson Beach', 'kitesurfing', 'Quebec');
    assert.ok(url.includes('tbm=vid'));
    assert.ok(url.includes('Hudson'));
    assert.ok(!url.includes('kitesurf'));
  });

  it('falls back to wingfoil terms for unknown sport', () => {
    assert.deepEqual(sportTerms('unknown'), sportTerms('wingfoiling'));
  });

  it('builds fallback gallery with link-out URLs', () => {
    const gallery = buildMediaGalleryFallback({ name: 'Verdun Waterfront' }, 'wingfoiling');
    assert.ok(gallery.google_images_url);
    assert.ok(gallery.google_videos_url);
    assert.deepEqual(gallery.images, []);
    assert.deepEqual(gallery.videos, []);
  });

  it('uses the same query for link-out and CSE fetch', () => {
    const spot = { name: "L'anse à l'orme" };
    const query = buildSpotMediaQuery(spot);
    assert.ok(decodeURIComponent(buildGoogleImagesUrl(spot.name, 'wingfoiling')).includes(query));
  });
});

describe('spotIntel media gallery', () => {
  const spot = { name: 'Oka Beach', region: 'Montreal Quebec' };

  it('parses seeded items JSON into images and videos', () => {
    const raw = JSON.stringify({
      sport: 'wingfoiling',
      items: [
        { type: 'image', thumbnail_url: 'a', source_url: 'b' },
        { type: 'video', thumbnail_url: 'c', source_url: 'd', duration: '1:00' },
      ],
    });
    const gallery = parseMediaGallery(raw, 'wingfoiling', spot);
    assert.equal(gallery.images.length, 1);
    assert.equal(gallery.videos.length, 1);
  });

  it('caps strip items at 10', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      type: 'image',
      thumbnail_url: `t${i}`,
      source_url: `s${i}`,
    }));
    const strip = mergeStripItems({ images: items, videos: [] });
    assert.equal(strip.length, 10);
  });

  it('rejects placeholder picsum galleries', () => {
    const raw = JSON.stringify({
      items: [{ type: 'image', thumbnail_url: 'https://picsum.photos/seed/x/400/260', source_url: 'x' }],
    });
    assert.equal(galleryHasPlaceholderMedia(raw), true);
    const gallery = parseMediaGallery(raw, 'wingfoiling', spot);
    assert.equal(gallery.images.length, 0);
  });
});
