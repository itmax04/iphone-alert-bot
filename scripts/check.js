// Локальная проверка на живых страницах: загрузка лент, разбор и распознавание (без Telegram и D1).
//   node scripts/check.js          — все 12 лент
//   node scripts/check.js ph-be    — одна лента (id из src/feeds.js)
import { fetchFeed, feedUrl, parseArticle } from '../src/kleinanzeigen.js';
import { recognize, batteryOf, tagsOf } from '../src/filters.js';
import { FEEDS } from '../src/feeds.js';

const only = process.argv[2];
const feeds = FEEDS.filter((f) => !only || f.id === only);
if (!feeds.length) {
  console.error(`Нет такой ленты: ${only}. Есть: ${FEEDS.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
let errors = 0;
for (const feed of feeds) {
  try {
    const items = (await fetchFeed(feed)).map(parseArticle);
    const recs = items.map((i) => recognize(i.title, i.description));
    console.log(`\n=== ${feed.id} · ${feed.name}: ${items.length} объявлений, распознано ${recs.filter(Boolean).length}\n    ${feedUrl(feed)}`);
    if (!items.length) {
      errors++;
      console.log('    ОШИБКА: на странице нет объявлений');
    }
    items.forEach((i, n) => {
      const rec = recs[n];
      const battery = batteryOf(`${i.title} ${i.description}`);
      console.log(
        `${rec ? '✓' : '✗'} ${String(i.price ?? '?').padStart(5)}€${i.negotiable ? ' VB' : '   '} | ${(rec?.model || '-').padEnd(30)} ${(rec?.variant || '').padEnd(13)} ${battery ? `${battery}%` : '   '} | ${i.location.slice(0, 22).padEnd(22)} | ${i.title.slice(0, 50)} ${rec ? tagsOf(i, rec).join(' ') : ''}`,
      );
    });
  } catch (e) {
    errors++;
    console.log(`\n=== ${feed.id} · ${feed.name}: ОШИБКА ${e.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
console.log(`\n${errors ? `ОШИБОК: ${errors}` : `OK: лент проверено ${feeds.length}`}`);
process.exit(errors ? 1 : 0);
