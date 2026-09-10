const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  spotSearchQuery,
  parseCommonsPages,
  pageToMediaItem,
  isRelevantGeoTitle,
  scoreMediaItem,
  isAcceptableMediaItem,
  rankMediaItems,
} = require('../src/services/intelSources/wikimediaCommons');

describe('wikimediaCommons', () => {
  const anseSpot = { name: "L'anse à l'orme", latitude: 45.453, longitude: -73.938 };
  const okaSpot = { name: 'Oka Beach', latitude: 45.47, longitude: -74.09 };

  it('builds a name search query from spot name', () => {
    assert.equal(spotSearchQuery({ name: "L'anse à l'orme" }), "L anse à l orme Quebec");
  });

  it('maps commons pages to media items with distance', () => {
    const pages = parseCommonsPages({
      query: {
        pages: {
          1: {
            title: "File:Parc-nature de l'Anse-à-l'Orme (Aug 2017) 1.jpg",
            coordinates: [{ lat: 45.454, lon: -73.939 }],
            imageinfo: [
              {
                mime: 'image/jpeg',
                url: 'https://upload.wikimedia.org/full.jpg',
                thumburl: 'https://upload.wikimedia.org/thumb.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
              },
            ],
          },
        },
      },
    });
    const item = pageToMediaItem(pages[0], anseSpot);
    assert.equal(item.type, 'image');
    assert.ok(item.distance_m < 200);
    assert.ok(item.thumbnail_url.includes('thumb.jpg'));
  });

  it('rejects nearby photos of a different place', () => {
    const item = {
      title: 'Beach At Cap Saint Jacques - panoramio',
      distance_m: 1002,
    };
    assert.equal(isAcceptableMediaItem(item, anseSpot), false);
    assert.equal(isRelevantGeoTitle(item.title, anseSpot), false);
  });

  it('accepts geotagged photos near the spot when the title matches', () => {
    const item = {
      title: 'Plage du parc national d Oka, Oka, Québec, Canada',
      distance_m: 981,
    };
    assert.equal(isAcceptableMediaItem(item, okaSpot), true);
  });

  it('accepts name-matched park photos without coordinates', () => {
    const item = {
      title: "Parc-nature de l-Anse-a-l-Orme 003",
      distance_m: null,
    };
    assert.equal(isAcceptableMediaItem(item, anseSpot), true);
  });

  it('ranks closer spot-name photos above unrelated event shots', () => {
    const ranked = rankMediaItems(
      [
        { title: 'WTMTL T11 MG 7148', distance_m: 500 },
        { title: "Parc-nature de l-Anse-a-l-Orme 003", distance_m: null },
      ],
      anseSpot
    );
    assert.match(ranked[0].title, /Parc-nature/);
    assert.ok(scoreMediaItem(ranked[0], anseSpot) > scoreMediaItem(ranked[1], anseSpot));
  });

  it('filters irrelevant geo titles', () => {
    assert.equal(isRelevantGeoTitle('2019 GMC Sierra 1500 Crew Cab', okaSpot), false);
    assert.equal(isRelevantGeoTitle("Parc-nature de l'Anse-à-l'Orme sunset", anseSpot), true);
  });

  it('skips non-image mime types', () => {
    const item = pageToMediaItem({
      title: 'File:Catalogue.pdf',
      imageinfo: [{ mime: 'application/pdf', url: 'https://example.com/a.pdf' }],
    });
    assert.equal(item, null);
  });
});
