async function fetchUserProfile(phone) {
  return null
}

function upsertUserProfile(db, profile) {
  const { phone, name, avatar, country } = profile
  db.run('INSERT INTO users (phone, name, avatar, country) VALUES (?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, country=COALESCE(excluded.country, users.country)', [phone, name || '', avatar || '', country || null])
}

module.exports = { fetchUserProfile, upsertUserProfile }