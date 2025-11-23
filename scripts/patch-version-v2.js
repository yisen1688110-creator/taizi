// Enhanced /api/version route using assets directory listing instead of HTML regex.
// Assumes variables fs, path, FRONTEND_DIR, PORT are already defined in the main file.

app.get('/api/version', async (req, res) => {
  try {
    let backend = null;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join('/app', 'package.json'), 'utf-8'));
      backend = { name: pkg.name, version: pkg.version };
    } catch (_) {}

    const assetsDir = path.join(FRONTEND_DIR, 'assets');
    let jsFile = null, cssFile = null;
    try {
      const entries = await fs.readdir(assetsDir);
      jsFile = entries.find((f) => /^index-.*\.js$/.test(f)) || null;
      cssFile = entries.find((f) => /^index-.*\.css$/.test(f)) || null;
    } catch (_) {}

    const jsExists = jsFile ? await fs.access(path.join(assetsDir, jsFile)).then(() => true).catch(() => false) : false;
    const cssExists = cssFile ? await fs.access(path.join(assetsDir, cssFile)).then(() => true).catch(() => false) : false;

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