// Локальная проверка ночного пересчёта медиан (node:sqlite, без Cloudflare): нечётная/чётная выборка,
// >400 цен (честная медиана, а не по 400 самым дешёвым), порог MIN_SAMPLES, строка модели без памяти, окно 30 дней.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { recomputeStatements, marketMedian } from '../src/market.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

// Минимальная имитация D1: prepare().bind() -> { sql, args }, batch() выполняет по порядку.
const run = (st) => {
  const s = sqlite.prepare(st.sql);
  return /^\s*(SELECT|WITH)/i.test(st.sql) ? s.all(...st.args) : s.run(...st.args);
};
const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a), first: async () => run(stmt(sql, args))[0] ?? null, all: async () => ({ results: run(stmt(sql, args)) }) });
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => list.forEach(run) };
const env = { DB };

const now = Date.now();
let id = 0;
const add = (model, storage, price, age = 0) =>
  sqlite.prepare('INSERT INTO prices (id, model, storage, price, seen_at) VALUES (?,?,?,?,?)').run(`t${id++}`, model, storage, price, now - age * 86400000);

[100, 200, 300, 400, 500].forEach((p) => add('odd', '128 GB', p)); // нечётная: 300
[100, 200, 300, 400].forEach((p) => add('even', '128 GB', p));
[100, 200, 300, 400, 500].forEach((p) => add('even', '256 GB', p)); // 5 шт, медиана 300
for (let i = 1; i <= 1000; i++) add('big', '256 GB', i); // 1000 цен 1..1000: честная медиана 500.5
[1, 2, 3, 4].forEach((p) => add('few', '64 GB', p)); // < 5 — ключа быть не должно
add('old', '128 GB', 1, 40); // старше 30 дней
[10, 20, 30, 40, 50].forEach((p) => add('old', '128 GB', p, 40));
[7, 8, 9, 10, 11].forEach((p) => add('nostor', null, p)); // без памяти: только строка модели

for (const s of recomputeStatements(DB, now)) run(s);

const got = Object.fromEntries(sqlite.prepare("SELECT model||'|'||storage k, median, p25, count FROM market").all().map((r) => [r.k, r]));
const checks = [
  ['odd|128 GB median', got['odd|128 GB']?.median, 300],
  ['even|128 GB too few (4)', got['even|128 GB'], undefined],
  ['even|256 GB median', got['even|256 GB']?.median, 300],
  ['even|* median (9 prices, odd n)', got['even|*']?.median, 300],
  ['big|256 GB median (1000, even)', got['big|256 GB']?.median, 500.5],
  ['big|256 GB p25', got['big|256 GB']?.p25, 250],
  ['big|256 GB count', got['big|256 GB']?.count, 1000],
  ['few|64 GB absent', got['few|64 GB'], undefined],
  ['old|* absent (older than 30 d)', got['old|*'], undefined],
  ['nostor|* median', got['nostor|*']?.median, 9],
  ['nostor has no storage row', Object.keys(got).some((k) => k.startsWith('nostor|') && k !== 'nostor|*'), false],
  ['_meta present', got['_meta|*'] !== undefined, true],
];
let bad = 0;
for (const [name, actual, expected] of checks) {
  const ok = actual === expected;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (ожидалось ${JSON.stringify(expected)})`}`);
}

// marketMedian читает таблицу (и округляет), а не prices.
const m = await marketMedian(env, 'big', '256 GB');
const okM = m?.median === 501 && m.count === 1000;
if (!okM) bad++;
console.log(`${okM ? 'PASS' : 'FAIL'}  marketMedian(big,256 GB) = ${JSON.stringify(m)}`);
console.log(bad ? `FAILED: ${bad}` : 'ALL PASS');
process.exit(bad ? 1 : 0);
