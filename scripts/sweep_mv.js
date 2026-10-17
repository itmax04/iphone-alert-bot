// Разово: обойти все страницы MV, вывести SQL цен (stdout) и JSON объявлений для анализа (файл).
import fs from 'node:fs';
import { fetchCity, parseArticle } from '../src/kleinanzeigen.js';
import { rejectReason, modelOf, storageOf, tagsOf } from '../src/filters.js';

const out = process.argv[2];
const esc = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = Date.now();
const all = [];
for (let page = 1; page <= 50; page++) {
  const city = { slug: 'mecklenburg-vorpommern', loc: 'l61', page };
  let items;
  try {
    items = (await fetchCity(city)).map(parseArticle);
  } catch (e) {
    console.error('page', page, e.message);
    break;
  }
  if (!items.length) break;
  for (const i of items) {
    const model = modelOf(i.title);
    const storage = storageOf(`${i.title} ${i.description}`);
    all.push({ ...i, model, storage, rejected: rejectReason(i), tags: tagsOf(i) });
    if (!rejectReason(i) && model && i.price != null && i.price >= 50)
      console.log(`INSERT OR IGNORE INTO prices (id, model, storage, price, seen_at) VALUES (${esc(i.id)}, ${esc(model)}, ${esc(storage)}, ${i.price}, ${now});`);
  }
  console.error('page', page, items.length);
  await new Promise((r) => setTimeout(r, 1000));
}
fs.writeFileSync(out, JSON.stringify(all));
console.error('total', all.length);
