/** Curated spot media seed — thumbnails for Montreal-region proof spots (v1 manual cache). */

const SPOT_MEDIA_BY_NAME = {
  'Oka Beach': {
    items: [
      { type: 'image', title: 'Launch at Plage d\'Oka', thumbnail_url: 'https://picsum.photos/seed/oka-launch/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Plage+d%27Oka+wingfoil' },
      { type: 'image', title: 'Beach overview', thumbnail_url: 'https://picsum.photos/seed/oka-beach/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Oka+Beach+kitesurf' },
      { type: 'image', title: 'Water conditions', thumbnail_url: 'https://picsum.photos/seed/oka-water/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Lac+des+Deux+Montagnes+wing' },
      { type: 'video', title: 'Session clip', thumbnail_url: 'https://picsum.photos/seed/oka-video-1/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Oka+Beach+wingfoil', duration: '1:42' },
      { type: 'image', title: 'Rigging area', thumbnail_url: 'https://picsum.photos/seed/oka-rig/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Oka+launch+area' },
      { type: 'video', title: 'On-water footage', thumbnail_url: 'https://picsum.photos/seed/oka-video-2/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Plage+d%27Oka+kite', duration: '3:08' },
      { type: 'image', title: 'Sunset session', thumbnail_url: 'https://picsum.photos/seed/oka-sunset/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Oka+sunset+wingfoil' },
    ],
  },
  'Hudson Beach': {
    items: [
      { type: 'image', title: 'Hudson launch', thumbnail_url: 'https://picsum.photos/seed/hudson-launch/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Hudson+Beach+wingfoil' },
      { type: 'image', title: 'Beach strip', thumbnail_url: 'https://picsum.photos/seed/hudson-beach/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Hudson+Quebec+kitesurf' },
      { type: 'video', title: 'Wing session', thumbnail_url: 'https://picsum.photos/seed/hudson-video/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Hudson+Beach+wing', duration: '2:14' },
      { type: 'image', title: 'Parking and access', thumbnail_url: 'https://picsum.photos/seed/hudson-access/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Hudson+Beach+parking' },
      { type: 'image', title: 'Choppy afternoon', thumbnail_url: 'https://picsum.photos/seed/hudson-chop/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Lac+Saint-Louis+Hudson' },
      { type: 'video', title: 'Kite launch', thumbnail_url: 'https://picsum.photos/seed/hudson-kite/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Hudson+Beach+kite', duration: '0:58' },
    ],
  },
  'Verdun Waterfront': {
    items: [
      { type: 'image', title: 'Verdun launch', thumbnail_url: 'https://picsum.photos/seed/verdun-launch/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Verdun+waterfront+wingfoil' },
      { type: 'image', title: 'St Lawrence view', thumbnail_url: 'https://picsum.photos/seed/verdun-view/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Verdun+beach+kitesurf' },
      { type: 'video', title: 'River session', thumbnail_url: 'https://picsum.photos/seed/verdun-video/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Verdun+wingfoil', duration: '1:20' },
      { type: 'image', title: 'Urban waterfront', thumbnail_url: 'https://picsum.photos/seed/verdun-urban/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Verdun+Montreal+wing' },
      { type: 'image', title: 'Evening foil', thumbnail_url: 'https://picsum.photos/seed/verdun-evening/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Verdun+foil+session' },
    ],
  },
  'Lac Saint-Louis (Lachine)': {
    items: [
      { type: 'image', title: 'Lachine launch', thumbnail_url: 'https://picsum.photos/seed/lachine-launch/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Lachine+wingfoil' },
      { type: 'image', title: 'Lac Saint-Louis', thumbnail_url: 'https://picsum.photos/seed/lachine-lake/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Lac+Saint-Louis+kitesurf' },
      { type: 'video', title: 'Foil run', thumbnail_url: 'https://picsum.photos/seed/lachine-video/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Lac+Saint-Louis+wingfoil', duration: '2:45' },
      { type: 'image', title: 'Wind line', thumbnail_url: 'https://picsum.photos/seed/lachine-wind/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Lachine+beach+wing' },
      { type: 'image', title: 'Crowd level', thumbnail_url: 'https://picsum.photos/seed/lachine-crowd/400/260', source_url: 'https://www.google.com/search?tbm=isch&q=Lachine+kite+beach' },
      { type: 'video', title: 'Session highlight', thumbnail_url: 'https://picsum.photos/seed/lachine-clip/400/260', source_url: 'https://www.google.com/search?tbm=vid&q=Lachine+Montreal+kite', duration: '1:05' },
    ],
  },
};

function matchSeedMedia(spotName) {
  if (SPOT_MEDIA_BY_NAME[spotName]) return SPOT_MEDIA_BY_NAME[spotName];
  const lower = spotName.toLowerCase();
  for (const [key, value] of Object.entries(SPOT_MEDIA_BY_NAME)) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) || keyLower.includes(lower)) return value;
    const keyToken = keyLower.split(/[\s(]+/)[0];
    if (keyToken.length >= 3 && lower.includes(keyToken)) return value;
  }
  return null;
}

module.exports = { SPOT_MEDIA_BY_NAME, matchSeedMedia };
