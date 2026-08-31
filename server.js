import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const database = new DatabaseSync('steam-games.db');
const demoGames = [
  { id: 1245620, name: 'Elden Pixels', price: '$9.99', reviews: 482, positive: 96, release: '2024', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg' },
  { id: 1629520, name: 'Little Locked Rooms', price: '$7.99', reviews: 719, positive: 94, release: '2023', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1629520/header.jpg' },
  { id: 1786940, name: 'Sandtrails', price: '$11.99', reviews: 1160, positive: 91, release: '2024', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1786940/header.jpg' },
  { id: 1818980, name: 'Nova Drift', price: '$14.99', reviews: 2640, positive: 95, release: '2022', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/858210/header.jpg' },
  { id: 1350850, name: 'The Palace on the Hill', price: '$10.99', reviews: 382, positive: 90, release: '2024', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1350850/header.jpg' },
  { id: 2400160, name: 'Minishoot Adventures', price: '$13.99', reviews: 1892, positive: 98, release: '2024', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2400160/header.jpg' },
  { id: 2042430, name: 'The Crimson Diamond', price: '$12.99', reviews: 944, positive: 97, release: '2024', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2042430/header.jpg' },
  { id: 2031280, name: 'WitchHand', price: '$8.99', reviews: 142, positive: 88, release: '2024', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2031280/header.jpg' }
].map(game => ({ ...game, url: `https://store.steampowered.com/app/${game.id}` }));

async function steamJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'UnderTheRadarSteam/1.0' } });
  if (!response.ok) throw new Error(`Steam responded with ${response.status}`);
  return response.json();
}

async function searchGames(params) {
  const term = params.get('q')?.trim() || 'indie';
  const min = Math.max(0, Number(params.get('min')) || 0);
  const max = Math.max(min, Number(params.get('max')) || 3000);
  const positive = Math.min(100, Math.max(0, Number(params.get('positive')) || 70));
  const pages = await Promise.all([0, 50, 100, 150].map(offset => steamJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=us&start_offset=${offset}`)));
  const candidates = pages.flatMap(page => page.items || []).filter((game, index, all) => all.findIndex(item => item.id === game.id) === index).slice(0, 150);
  const enriched = await Promise.all(candidates.map(async game => {
    try {
      const reviews = await steamJson(`https://store.steampowered.com/appreviews/${game.id}?json=1&language=all&purchase_type=all&filter=all`);
      const summary = reviews.query_summary || {};
      const total = summary.total_reviews || 0;
      const percent = total ? Math.round((summary.total_positive || 0) / total * 100) : 0;
      if (total < min || total > max || percent < positive) return null;
      return {
        id: game.id, name: game.name, price: game.price?.final_formatted || '—',
        image: game.tiny_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`,
        reviews: total, positive: percent, release: game.release_date || '',
        url: `https://store.steampowered.com/app/${game.id}`
      };
    } catch { return null; }
  }));
  return enriched.filter(Boolean).sort((a, b) => b.positive - a.positive || a.reviews - b.reviews).slice(0, 18);
}

function offlineSearch(params) {
  const term = (params.get('q') || '').trim().toLowerCase();
  const min = Math.max(0, Number(params.get('min')) || 0);
  const max = Math.max(min, Number(params.get('max')) || 3000);
  const positive = Math.min(100, Math.max(0, Number(params.get('positive')) || 70));
  const filtered = demoGames.filter(game => game.reviews >= min && game.reviews <= max && game.positive >= positive);
  const matching = term && term !== 'indie' ? filtered.filter(game => game.name.toLowerCase().includes(term)) : filtered;
  return matching.sort((a, b) => b.positive - a.positive || a.reviews - b.reviews);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/games') {
    try {
      const term = (url.searchParams.get('q') || '').trim();
      const genre = (url.searchParams.get('genre') || '').trim();
      const max = Math.max(0, Number(url.searchParams.get('max')) || 3000);
      const positive = Math.min(100, Math.max(0, Number(url.searchParams.get('positive')) || 0));
      const positiveMax = Math.min(100, Math.max(0, Number(url.searchParams.get('positiveMax')) || 100));
      const releaseFrom = url.searchParams.get('releaseFrom') || '';
      const releaseTo = url.searchParams.get('releaseTo') || '9999-12-31';
      const minReviews = Math.max(0, Number(url.searchParams.get('min')) || 0);
      const whereArgs = [minReviews, max, positive, positiveMax, releaseFrom, releaseTo, term, term, genre, genre];
      const clause = `total_reviews IS NOT NULL AND total_reviews >= ? AND total_reviews <= ? AND positive_percent >= ? AND positive_percent <= ? AND (release_date IS NULL OR release_date >= ?) AND (release_date IS NULL OR release_date <= ?) AND (? = '' OR lower(name) LIKE '%' || lower(?) || '%') AND (? = '' OR lower(genres) LIKE '%' || lower(?) || '%')`;
      const count = database.prepare(`SELECT COUNT(*) count FROM games WHERE ${clause}`).get(...whereArgs).count;
      const rows = database.prepare(`SELECT app_id id, name, release_date release, total_reviews reviews, positive_percent positive FROM games WHERE ${clause} ORDER BY positive_percent DESC, total_reviews ASC LIMIT 100`).all(...whereArgs);
      const games = rows.map(game => ({ ...game, price: '—', image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`, url: `https://store.steampowered.com/app/${game.id}` }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ games, total: count, source: 'database' }));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Steam temporarily did not respond. Please try again.' }));
    }
  }
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Under the Radar is running at http://localhost:${port}`));
