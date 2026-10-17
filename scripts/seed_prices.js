// Разово: собрать текущие цены iPhone 13+ со всех городов и вывести SQL для таблицы prices.
import { CITIES } from '../src/cities.js';
import { fetchCity, parseArticle } from '../src/kleinanzeigen.js';
import { rejectReason, modelOf, storageOf } from '../src/filters.js';

const esc = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = Date.now();
let rows = 0;
for (const city of CITIES) {
  try {
    for (const i of (await fetchCity(city)).map(parseArticle)) {
      const model = modelOf(i.title);
      if (rejectReason(i) || !model || i.price == null || i.price < 50) continue;
      console.log(`INSERT OR IGNORE INTO prices (id, model, storage, price, seen_at) VALUES (${esc(i.id)}, ${esc(model)}, ${esc(storageOf(`${i.title} ${i.description}`))}, ${i.price}, ${now});`);
      rows += 1;
    }
  } catch (e) {
    console.error(city.name, e.message);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`rows: ${rows}`);
