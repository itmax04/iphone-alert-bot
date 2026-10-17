// Локальная проверка: разбор сохранённых или живых страниц и отбор (без Telegram).
import { CITIES } from '../src/cities.js';
import { fetchCity, parseArticle } from '../src/kleinanzeigen.js';
import { rejectReason, modelOf, storageOf, batteryOf, tagsOf } from '../src/filters.js';

const only = process.argv[2];
for (const city of CITIES.filter((c) => !only || c.slug === only)) {
  try {
    const items = (await fetchCity(city)).map(parseArticle);
    const ok = items.filter((i) => !rejectReason(i));
    console.log(`\n=== ${city.name} (${city.priority}): ${items.length} объявлений, подходит ${ok.length}`);
    for (const i of items) {
      const r = rejectReason(i);
      const text = `${i.title} ${i.description}`;
      console.log(
        `${r ? '✗' : '✓'} ${String(i.price ?? '?').padStart(5)}€${i.negotiable ? ' VB' : '   '} | ${(modelOf(i.title) || '-').padEnd(20)} ${(storageOf(text) || '').padEnd(7)} ${batteryOf(text) ? batteryOf(text) + '%' : '   '} | ${i.location.slice(0, 22).padEnd(22)} | ${i.title.slice(0, 50)} ${tagsOf(i).join(' ')}`,
      );
    }
  } catch (e) {
    console.log(`\n=== ${city.name}: ОШИБКА ${e.message}`);
  }
}
