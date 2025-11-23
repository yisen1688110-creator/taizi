const fs = require('fs').promises;
const path = require('path');

(async () => {
  try {
    const FRONTEND_DIR = '/app/moxige/dist';
    const assetsDir = path.join(FRONTEND_DIR, 'assets');
    console.log('FRONTEND_DIR =', FRONTEND_DIR);
    console.log('assetsDir =', assetsDir);

    const entries = await fs.readdir(assetsDir);
    console.log('assets entries:', entries);
    const jsFile = entries.find(f => /^index-.*\.js$/.test(f)) || null;
    const cssFile = entries.find(f => /^index-.*\.css$/.test(f)) || null;
    console.log('jsFile:', jsFile, 'cssFile:', cssFile);

    try {
      const pkg = JSON.parse(await fs.readFile('/app/package.json', 'utf-8'));
      console.log('backend pkg:', { name: pkg.name, version: pkg.version });
    } catch (e) {
      console.log('backend pkg read error:', e.message);
    }

    try {
      const bi = JSON.parse(await fs.readFile(path.join(FRONTEND_DIR, 'build-info.json'), 'utf-8'));
      console.log('build-info:', bi);
    } catch (e) {
      console.log('build-info read error:', e.message);
    }
  } catch (e) {
    console.error('fatal error:', e);
    process.exit(1);
  }
})();