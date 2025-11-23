// Clean duplicate /api/version routes and insert the updated one.
// Expects the new route content to be available at /tmp/patch-version.js inside container.

const fs = require('fs');
const path = require('path');

const SRC = '/app/src/index.js';
const PATCH_FILE = '/tmp/patch-version.js';

function removeAllVersionRoutes(src) {
  // Remove any existing /api/version route blocks (flexible whitespace)
  const re = /app\.get\(\s*['"]\/api\/version['"][\s\S]*?\n\}\s*\)\s*;\s*\n/g;
  return src.replace(re, '');
}

function insertRouteBeforeRoot(src, route) {
  const marker = "app.get('/',"; // Root route marker
  const idx = src.indexOf(marker);
  if (idx > -1) {
    return src.slice(0, idx) + '\n' + route + '\n' + src.slice(idx);
  }
  // Fallback: append to end
  return src + '\n\n' + route + '\n';
}

function main() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const route = fs.readFileSync(PATCH_FILE, 'utf-8');

  const cleaned = removeAllVersionRoutes(src);
  const out = insertRouteBeforeRoot(cleaned, route);
  fs.writeFileSync(SRC, out, 'utf-8');
  console.log('[clean] Rewrote', SRC);
}

main();