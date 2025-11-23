// Enhanced /api/version route. This file is appended to /app/src/index.js inside the container.
// Assumes variables fs, path, FRONTEND_DIR, PORT are already defined in the main file.

app.get('/api/version', async (req, res) => {
  try {
    let backend = null;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join('/app', 'package.json'), 'utf-8'));
      backend = { name: pkg.name, version: pkg.version };
    } catch (_) {}

    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    let jsFile = null, cssFile = null, jsExists = false, cssExists = false;
    try {
      const html = await fs.readFile(indexPath, 'utf-8');
      const jsMatch = html.match(/src="\/assets\/(index-[^"]+\.js)"/);
      const cssMatch = html.match(/href="\/assets\/(index-[^"]+\.css)"/);
      jsFile = jsMatch?.[1] || null;
      cssFile = cssMatch?.[1] || null;
      jsExists = jsFile ? await fs.access(path.join(FRONTEND_DIR, 'assets', jsFile)).then(() => true).catch(() => false) : false;
      cssExists = cssFile ? await fs.access(path.join(FRONTEND_DIR, 'assets', cssFile)).then(() => true).catch(() => false) : false;
    } catch (_) {}

    let buildInfo = null;
    try {
      buildInfo = JSON.parse(await fs.readFile(path.join(FRONTEND_DIR, 'build-info.json'), 'utf-8'));
    } catch (_) {}

    res.json({
      ok: true,
      port: PORT,
      nodeEnv: process.env.NODE_ENV || 'unset',
      backend,
      frontend: {
        js: { file: jsFile, exists: jsExists },
        css: { file: cssFile, exists: cssExists },
      },
      buildInfo,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});