const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'assets');
const dest = path.join(__dirname, '..', 'public', 'assets');

function syncAssets() {
  if (!fs.existsSync(src)) {
    throw new Error('Missing assets/ directory');
  }
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(src)) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
    count += 1;
  }
  return count;
}

if (require.main === module) {
  try {
    const n = syncAssets();
    console.log(`Synced ${n} PNG assets to public/assets`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { syncAssets };
