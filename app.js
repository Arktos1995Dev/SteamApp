const $ = (id) => document.getElementById(id);
const format = new Intl.NumberFormat('ru-RU');
const reviews = $('reviews'), positive = $('positive'), reviewsMinRange = $('reviews-min-range'), positiveMaxRange = $('positive-max-range'), reviewsNumber = $('reviews-number'), reviewsMin = $('reviews-min'), positiveNumber = $('positive-number'), positiveMax = $('positive-max'), button = $('search-button'), results = $('results');

function updateLabels() {
  $('reviews-output').textContent = `от ${format.format(reviewsMin.value)} до ${format.format(reviews.value)}`;
  $('reviews-min-copy').textContent = format.format(reviewsMin.value);
  $('reviews-copy').textContent = format.format(reviews.value);
  $('positive-output').textContent = `от ${positive.value} до ${positiveMax.value}%`;
  $('positive-copy').textContent = positive.value;
  $('positive-max-copy').textContent = positiveMax.value;
}
function syncRange(range, number) { range.addEventListener('input', () => { number.value = range.value; updateLabels(); }); number.addEventListener('input', () => { if (number.value !== '') { range.value = number.value; updateLabels(); } }); }\nfunction syncManual(slider, number) {
  slider.addEventListener('input', () => { number.value = slider.value; updateLabels(); });
  number.addEventListener('input', () => { if (number.value === '') return; slider.value = Math.min(+slider.max, Math.max(+slider.min, +number.value)); updateLabels(); });
  number.addEventListener('change', () => { if (number.value === '') number.value = slider.value; });
}
function setLoading() {
  results.innerHTML = '<div class="loading"><i></i><p>Ищем тихие хиты в Steam…</p></div>';
  button.disabled = true; button.innerHTML = 'ИЩЕМ… <span>◌</span>';
}
function renderGames(games, source = 'database', total = games.length) {
  $('result-title').textContent = games.length ? 'Находки для вашего радара' : 'Ничего не найдено';
  const sourceLabel = 'Источник: локальная БД';
  $('results-meta').textContent = total ? `${format.format(total)} игр соответствует вашим фильтрам · ${sourceLabel}` : `${sourceLabel} · попробуйте изменить фильтры`;
  results.innerHTML = '';
  if (!games.length) { results.innerHTML = '<div class="empty-state"><div class="radar-icon">⌁</div><h3>Радар пока молчит</h3><p>Ослабьте фильтры — редкие игры часто остаются за пределами выборки.</p></div>'; return; }
  const template = $('game-template');
  games.forEach(game => {
    const node = template.content.cloneNode(true);
    const link = node.querySelectorAll('a'); link.forEach(a => a.href = game.url);
    const image = node.querySelector('img'); image.src = game.image; image.alt = game.name; image.onerror = () => image.closest('.cover-link').classList.add('missing-image');
    node.querySelector('h3').textContent = game.name;
    node.querySelector('.price').textContent = game.price;
    node.querySelector('.rating b').textContent = `${game.positive}%`;
    node.querySelector('.reviews-count').textContent = `${format.format(game.reviews)} отзывов`;
    node.querySelector('.release').textContent = game.release ? `Релиз: ${game.release}` : 'Steam';
    results.append(node);
  });
}
async function search() {
  setLoading();
  const params = new URLSearchParams({ q: $('query').value, genre: $('genre').value, min: reviewsMin.value, max: reviewsNumber.value || reviews.value, positive: positiveNumber.value || positive.value, positiveMax: positiveMax.value, releaseFrom: $('release-from').value, releaseTo: $('release-to').value });
  try { const response = await fetch(`/api/games?${params}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); renderGames(data.games, data.source, data.total); }
  catch (error) { results.innerHTML = `<div class="empty-state"><div class="radar-icon">!</div><h3>Не удалось связаться со Steam</h3><p>${error.message || 'Попробуйте повторить поиск через минуту.'}</p></div>`; $('results-meta').textContent = 'Ошибка загрузки'; }
  finally { button.disabled = false; button.innerHTML = 'НАЙТИ ИГРЫ <span>→</span>'; }
}
syncManual(reviews, reviewsNumber); syncManual(positive, positiveNumber); syncRange(reviewsMinRange, reviewsMin); syncRange(positiveMaxRange, positiveMax);
reviewsMin.addEventListener('input', updateLabels); positiveMax.addEventListener('input', updateLabels);
button.addEventListener('click', search);
$('query').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
updateLabels();
const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(today.getDate() - 30);
const toDateInput = date => date.toISOString().slice(0, 10);
if (!$('release-from').value) $('release-from').value = toDateInput(thirtyDaysAgo);
if (!$('release-to').value) $('release-to').value = toDateInput(today);

