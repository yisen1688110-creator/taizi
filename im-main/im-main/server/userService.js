async function fetchUserProfile(phone) {
  try {
    const base = process.env.MXG_API_BASE || 'http://127.0.0.1:5210';
    const url = `${base.replace(/\/$/, '')}/api/public/user_profile?phone=${encodeURIComponent(phone)}`;
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.phone) return null;
    return { phone: String(data.phone), name: String(data.name || ''), avatar: String(data.avatar || ''), country: String(data.country || '') };
  } catch (_) {
    return null;
  }
}

function upsertUserProfile(db, profile) {
  const { phone, name, avatar, country } = profile
  db.run('INSERT INTO users (phone, name, avatar, country) VALUES (?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, country=COALESCE(excluded.country, users.country)', [phone, name || '', avatar || '', country || null])
}

module.exports = { fetchUserProfile, upsertUserProfile }