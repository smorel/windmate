const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'img', 'stickers');
const tiers = {
  cool: { fill: '#059669', stroke: '#6ee7b7', line: 'COOL' },
  nice: { fill: '#0ea5e9', stroke: '#7dd3fc', line: 'NICE' },
  amazing: { fill: '#a855f7', stroke: '#d8b4fe', line: 'AMAZING' },
  epic: { fill: '#f59e0b', stroke: '#fcd34d', line: 'EPIC!' },
};
const flairs = { 'quick-hit': 'QUICK', glass: 'GLASS', marathon: 'LONG' };

function svg(tier, flairLine) {
  const t = tiers[tier];
  const mainSize = t.line.length > 5 ? 8 : 11;
  const mainY = flairLine ? 30 : 36;
  const flairText = flairLine
    ? `<text x="32" y="44" text-anchor="middle" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="8" font-weight="700">${flairLine}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img">
  <path d="M8 12 L56 8 L52 56 L12 52 Z" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  <text x="32" y="${mainY}" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="${mainSize}" font-weight="700">${t.line}</text>
  ${flairText}
</svg>`;
}

for (const tier of Object.keys(tiers)) {
  for (const [flairKey, flairLine] of Object.entries(flairs)) {
    const key = `${tier}--${flairKey}`;
    fs.writeFileSync(path.join(dir, `${key}.svg`), svg(tier, flairLine));
  }
}

console.log(`Wrote ${Object.keys(tiers).length * Object.keys(flairs).length} combo stickers to ${dir}`);
