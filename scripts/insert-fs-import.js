// Insert ESM import for fs/promises at the top of /app/src/index.js inside container
const fs = require('fs');

const SRC = '/app/src/index.js';

function main() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const hasFsPromises = /\bimport\s+fs\s+from\s+'fs\/promises'/.test(src);
  const hasFsAlias = /\bimport\s*\{\s*promises\s+as\s+fs\s*\}\s*from\s+'fs'/.test(src);
  if (hasFsPromises || hasFsAlias) {
    console.log('[insert] fs/promises import already present.');
    return;
  }
  const out = `import fs from 'fs/promises';\n` + src;
  fs.writeFileSync(SRC, out, 'utf-8');
  console.log('[insert] Added import fs from \"fs/promises\" at top of index.js');
}

main();