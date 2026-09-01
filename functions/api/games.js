function numberParam(params, name, fallback, min, max) {
  const value = Number(params.get(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return Response.json({ error: 'D1 binding DB is not configured.' }, { status: 500 });
  }

  const params = new URL(request.url).searchParams;
  const title = (params.get('q') || '').trim();
  const genre = (params.get('genre') || '').trim();
  const minReviews = numberParam(params, 'min', 0, 0, 100000000);
  const maxReviews = numberParam(params, 'max', 3000, minReviews, 100000000);
  const minPositive = numberParam(params, 'positive', 0, 0, 100);
  const maxPositive = numberParam(params, 'positiveMax', 100, minPositive, 100);
  const releaseFrom = params.get('releaseFrom') || '';
  const releaseTo = params.get('releaseTo') || '9999-12-31';

  const where = `
    total_reviews IS NOT NULL
    AND total_reviews >= ? AND total_reviews <= ?
    AND positive_percent IS NOT NULL
    AND positive_percent >= ? AND positive_percent <= ?
    AND (release_date IS NULL OR release_date >= ?)
    AND (release_date IS NULL OR release_date <= ?)
    AND (? = '' OR lower(name) LIKE '%' || lower(?) || '%')
    AND (? = '' OR lower(COALESCE(genres, '')) LIKE '%' || lower(?) || '%')
  `;
  const binds = [minReviews, maxReviews, minPositive, maxPositive, releaseFrom, releaseTo, title, title, genre, genre];

  const countResult = await env.DB.prepare(`SELECT COUNT(*) AS total FROM games WHERE ${where}`).bind(...binds).first();
  const result = await env.DB.prepare(`
    SELECT app_id AS id, name, release_date AS release, genres,
      positive_percent AS positive, total_reviews AS reviews
    FROM games WHERE ${where}
    ORDER BY positive_percent DESC, total_reviews ASC
    LIMIT 100
  `).bind(...binds).all();

  const games = (result.results || []).map(game => ({
    ...game,
    price: '—',
    image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`,
    url: `https://store.steampowered.com/app/${game.id}`
  }));

  return Response.json({ games, total: countResult?.total || 0, source: 'database' });
}
