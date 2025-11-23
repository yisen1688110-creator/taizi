const fs = require('fs');
const path = require('path');

const SRC = '/app/src/index.js';
const PATCH = '/tmp/patch-version.js';

function main() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const newRoute = fs.readFileSync(PATCH, 'utf-8');
  const re = /app\.get\(\s*['"]\/api\/version['"][\s\S]*?\n\}\);\n/;

  let out;
  if (re.test(src)) {
    out = src.replace(re, newRoute + '\n');
    console.log('[patch] Replaced existing /api/version route.');
  } else {
    out = src + '\n\n' + newRoute + '\n';
    console.log('[patch] Existing route not found, appended new route.');
  }

  fs.writeFileSync(SRC, out, 'utf-8');
  console.log('[patch] Written updated file:', SRC);
}

main();