import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';

const db = new DatabaseSync('steam-games.db');
const mode = process.argv[2] || 'update';
db.exec(`CREATE TABLE IF NOT EXISTS games (
  app_id INTEGER PRIMARY KEY, name TEXT NOT NULL, release_date TEXT, genres TEXT, positive_percent INTEGER,
  total_reviews INTEGER, updated_at TEXT NOT NULL
)`);
try { db.exec('ALTER TABLE games ADD COLUMN release_date TEXT'); } catch {}
try { db.exec('ALTER TABLE games ADD COLUMN genres TEXT'); } catch {}
const upsert = db.prepare(`INSERT INTO games(app_id,name,positive_percent,total_reviews,updated_at)
  VALUES(?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET name=excluded.name,
  positive_percent=excluded.positive_percent,total_reviews=excluded.total_reviews,updated_at=excluded.updated_at`);
const addOnly = db.prepare(`INSERT OR IGNORE INTO games(app_id,name,release_date,genres,positive_percent,total_reviews,updated_at) VALUES(?,?,?,?,?,?,?)`);
const updateOnly = db.prepare(`UPDATE games SET name=?, release_date=?, genres=?, positive_percent=?, total_reviews=?, updated_at=? WHERE app_id=?`);

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'UnderTheRadarSync/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
let list;
try {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error('STEAM_API_KEY is missing');
  const allApps = [];
  const requestedEnd = Math.max(0, Number(process.env.START_OFFSET || 0)) + Math.max(0, Number(process.env.LIMIT || 50000));
  let lastAppId = 0;
  do {
    const cursor = lastAppId ? `&last_appid=${lastAppId}` : '';
    const page = await json(`https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${encodeURIComponent(key)}&max_results=50000&include_games=1&include_dlc=0&include_software=0&include_videos=0&include_hardware=0&include_music=0${cursor}`);
    const appsPage = page.response?.apps || [];
    allApps.push(...appsPage);
    const next = page.response?.last_appid || appsPage.at(-1)?.appid || 0;
    console.log(`Каталог: загружено ${allApps.length}`);
    if (allApps.length >= requestedEnd || !appsPage.length || next <= lastAppId || !page.response?.have_more_results) break;
    lastAppId = next;
  } while (true);
  list = { response: { apps: allApps } };
} catch (error) {
  console.error('Не удалось получить каталог Steam. Проверьте API key и доступ к Steam Web API.');
  process.exitCode = 1;
  process.exit();
}
const rawApps = list.applist?.apps || list.response?.apps || [];
const apps = rawApps.map(app => ({ appid: app.appid, name: app.name || app.app_name, type: app.type || app.app_type })).filter(app => app.name?.trim() && (!app.type || app.type === 'game' || app.type === 1));
const limit = Number(process.env.LIMIT || apps.length);
const startOffset = Math.max(0, Number(process.env.START_OFFSET || 0));
if (!['add', 'update'].includes(mode)) throw new Error('Режим: node sync.js add или node sync.js update');
console.log(`Режим: ${mode}. Получено названий: ${apps.length}. К обработке: ${Math.min(limit, apps.length)}.`);
const totalToProcess = Math.min(startOffset + limit, apps.length);
const batchSize = Number(process.env.CONCURRENCY || 10);
const delayMs = Math.max(0, Number(process.env.DELAY_MS || 1000));
let successful = 0, failed = 0;
for (let start = startOffset; start < totalToProcess; start += batchSize) {
  const batch = apps.slice(Math.max(start, startOffset), Math.min(start + batchSize, totalToProcess));
  await Promise.all(batch.map(async app => {
    try {
      const data = await json(`https://store.steampowered.com/appreviews/${app.appid}?json=1&language=all&purchase_type=all&filter=all`);
      let releaseDate = null;
      let genres = '';
      let isGame = true;
      try { const details = await json(`https://store.steampowered.com/api/appdetails?appids=${app.appid}&l=english`); const info = details[app.appid]?.data; isGame = !info?.type || info.type === 'game'; genres = (info?.genres || []).map(item => item.description).join(', '); const raw = info?.release_date?.date; const parsed = raw && new Date(raw); releaseDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : raw || null; } catch (error) { console.error(`[appdetails] ${app.appid} — ${app.name}: ${error.message}`); }
      if (!isGame) return;
      const summary = data.query_summary || {};
      const total = summary.total_reviews || 0;
      const positive = total ? Math.round((summary.total_positive || 0) / total * 100) : 0;
      const now = new Date().toISOString();
      if (mode === 'add') addOnly.run(app.appid, app.name, releaseDate, genres, positive, total, now);
      else updateOnly.run(app.name, releaseDate, genres, positive, total, now, app.appid);
      successful++;
    } catch (error) {
      failed++;
      console.error(`[appreviews] ${app.appid} — ${app.name}: ${error.message}`);
    }
  }));
  const done = Math.min(start + batchSize, totalToProcess);
  if (done % 25 === 0 || done === totalToProcess) console.log(`Обработано ${done}/${totalToProcess} · успешно: ${successful}, ошибок: ${failed}`);
  await wait(delayMs);
}
console.log(`Синхронизация завершена. Успешно: ${successful}, ошибок: ${failed}. База: steam-games.db`);
