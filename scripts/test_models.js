// Локальный тест каталога моделей (src/catalog.js) на реальных заголовках Kleinanzeigen (собраны 14.11.2026)
// и на командах /sell, /price. Ожидания размечены вручную: [заголовок, ключ модели | null, вариант?, описание?].
// Вариант `undefined` — не проверяется.
import { identify } from '../src/catalog.js';
import { modelOf } from '../src/filters.js';
import { applySellCommand, applyPriceCommand } from '../src/settings.js';

const CASES = [
  // ---- iPhone
  ['IPhone 15 Pro Max - 256gb - Space grey - Neu unbenutzt', 'iPhone 15 Pro Max', '256 GB'],
  ['Apple iPhone 16 Pro 128GB – Titan Schwarz – OVP – 89% Akku', 'iPhone 16 Pro', '128 GB'],
  ['Apple iPhone 13 mini, 128GB, Blau, wie neu', 'iPhone 13 Mini', '128 GB'],
  ['Apple iPhone 16pro schwarz mit OVP und Ladekabel', 'iPhone 16 Pro', null],
  ['NEUWERTIG - iPhone 17 AIR 256GB Lichtgold I Akku 95%', 'iPhone Air', '256 GB'],
  ['iPhone 12 Mini Diamantschwarz', 'iPhone 12 Mini', null],
  ['NEUES IPhone 16 Pro Max. 265GB. Farbe Wüstensand', 'iPhone 16 Pro Max', null], // 265 GB не бывает
  ['iPhone 16 ProMax 256 GB titanschwarz | neu ausgetauscht', 'iPhone 16 Pro Max', '256 GB'],
  ['IPHONE 15PROMAX', 'iPhone 15 Pro Max', null],
  ['iPhone 16 pro*256Gb*', 'iPhone 16 Pro', '256 GB'],
  ['Apple iPhone 18 Pro Max 1TB mit rechnung', 'iPhone 18 Pro Max', '1 TB'],
  ['iPhone 11 128 GB rot GUT', 'iPhone 11', '128 GB'],
  ['iPhone 12 Pro – guter Zustand – inkl. 3 Handyhüllen & Ladekabel', 'iPhone 12 Pro', null],
  ['iPhone 14 128GB Weiß mit Zubehör & Handyhüllen', 'iPhone 14', '128 GB'],
  ['iPhone 16e 128 GB schwarz', 'iPhone 16e', '128 GB'],
  ['iPhone 15 einwandfrei', 'iPhone 15', null], // «e» из слова — не 15e
  ['iPhone 15 Problem mit Kamera', 'iPhone 15', null], // «pro» из слова — не Pro
  ['iPhone 13 grün - sehr guter Zustand', 'iPhone 13', '128 GB', 'Verkaufe mein iPhone 13 mit 128 GB Speicher'],
  ['Apple iPhone 7 Silber 128gb', null],
  ['Apple iPhone 8 Plus – 77 % Akku', null],
  ['iPhone XR - 64GB - Schwarz - Defekt', null],
  ['Apple iPhone', null],
  ['iPhone 14 Max 256GB', null], // Pro Max или Plus — непонятно
  ['iPhone 15 mini', null], // такой модели нет
  ['Hülle für iPhone 15 Pro', null],
  ['iPhone 15 Pro Max Hülle Leder', null],
  ['Suche iPhone 15 Pro', null],
  ['2x iPhone 13 128GB', null],
  ['iPhone 13 und iPhone 12 zu verkaufen', null],
  // ---- комплекты из разных устройств
  ['iPhone 16 pro Titan 128+Watch Ultra2, AirTag', null],
  ['iPhone 17 Pro Max 256GB Blau + Apple Watch 11 46mm – Top Zustand', null],
  ['Apple Set: iPhone 14 128GB + Watch Series 8 + AirPods 3, mit OVP', null],
  ['Tausch Möglich Google Pixel 11 Pro XL Gegen Apple Watch Ultra 4', null],
  // ---- Apple Watch
  ['Apple Smart Watch Ultra 3 GPS + Cellular 49mm + Gewährleistung', 'Apple Watch Ultra 3 49mm', null],
  ['Apple Watch Ultra 49 mm GPS + Cellular. WIE NEUE', 'Apple Watch Ultra 49mm', null],
  ['Apple Watch Ultra 1', 'Apple Watch Ultra 49mm', null],
  ['Apple Watch Ultra 2 GPS', 'Apple Watch Ultra 2 49mm', null],
  ['Apple Watch Ultra 3 100%', 'Apple Watch Ultra 3 49mm', null],
  ['Apple Watch Series 11 - 46 mm - nur 7 Monate alt', 'Apple Watch Series 11 46mm', 'GPS'],
  ['Apple Watch Serie 9 45 mm SILVER gps mit OVP', 'Apple Watch Series 9 45mm', 'GPS'],
  ['Apple Watch Series 8 45 mm GPS + Cellular – Aluminium Mitternacht', 'Apple Watch Series 8 45mm', 'LTE'],
  ['Apple Watch 8 41mm', 'Apple Watch Series 8 41mm', 'GPS'],
  ['Apple Watch 10 mit GPS & Cellular ( LTE ) 46mm in Diamantschwarz', 'Apple Watch Series 10 46mm', 'LTE'],
  ['Apple Watch Series 10 Aluminium Smartwatch 42mm Blau', 'Apple Watch Series 10 42mm', 'GPS'],
  ['Apple Watch 10 Series 46 mm Titan Gold', 'Apple Watch Series 10 46mm', 'LTE Titan'],
  ['Apple Watch 7', 'Apple Watch Series 7 45mm', 'GPS', 'Ich biete hier meine Apple Watch Serie 7 mit 45 mm Gehäuse zum Verkauf an.'],
  ['Apple Watch Series 7 schwarz', null], // размер неизвестен
  ['Apple Watch 10', null],
  ['Apple Watch Series 9 44mm', null], // у Series 9 нет 44 мм
  ['Apple Watch SE (GPS + Cellular-LTE) (2. Generation)Aluminium 32GB', null],
  ['Apple Watch SE 3 GPS 44 mm – Mitternacht – OVP', null],
  ['Apple Watch 5 Nike', null],
  ['Apple Watch Series 3 SpaceGrey 42mm', null],
  ['Appel watch 4 Ultra', null],
  ['Apple Watch Series 9 45mm Armband', null],
  // ---- Samsung
  ['Samsung Galaxy S25 Ultra 256 GB Titanium Black + OVP & Hülle', 'Galaxy S25 Ultra', '256 GB'],
  ['Samsung Galaxy s26 Neue mit Garantie', 'Galaxy S26', null],
  ['Samsung Galaxy Z Flip 8 mit 256 GB', 'Galaxy Z Flip8', '256 GB'],
  ['Samsung Galaxy S25 FE Navy Blau 128GB', 'Galaxy S25 FE', '128 GB'],
  ['Samsung Galaxy S21 FE 128Gb Schwarz inkl. Case', 'Galaxy S21 FE', '128 GB'],
  ['Samsung Galaxy Z Flip7 5G 256GB Jetblack OVP 100% Akkukapazität', 'Galaxy Z Flip7', '256 GB'],
  ['Samsung Galaxy S22 /128GB /schwarz', 'Galaxy S22', '128 GB'],
  ['Samsung Galaxy S21  5g | Phantom Violett | 128GB mit OVP', 'Galaxy S21', '128 GB'],
  ['Samsung Galaxy S25 Ultra - 256 GB - 12 GB RAM - Titanium Black', 'Galaxy S25 Ultra', '256 GB'],
  ['Samsung Galaxy S25+ - 256 GB - Navy (Ohne Simlock)', 'Galaxy S25+', '256 GB'],
  ['Samsung Galaxy Z Flip 6 inkl. OVP, Case und Schutzfolien', 'Galaxy Z Flip6', null],
  ['Samsung S23 Ultra 12GB RAM 512GB', 'Galaxy S23 Ultra', '512 GB'],
  ['Samsung Galaxy Z Fold 5 512GB', 'Galaxy Z Fold5', '512 GB'],
  ['SAMSUNG GALAXY A 16 5G WIE NEU MIT GARANTIE', null],
  ['Samsung Galaxy XCover6 Pro - Smartphone in OVP', null],
  ['Samsung Galaxy Watch', null],
  ['Galaxy Watch 4 (40mm)', null],
  ['Samsung Galaxy S10+ | 128 GB - Prism Blue | neuwertiger Zustand', null],
  ['Samsung Galaxy S3 mini Smartphone', null],
  ['Samsung Galaxy Note 8', null],
  ['Samsung Galaxy Z Flip 2', null],
  ['Samsung Galaxy S25 Ultra Hülle', null],
  // ---- Pixel
  ['Google Pixel 11 Pro XL olive 256 GB neu, versiegelt, ungeöffnet', 'Pixel 11 Pro XL', '256 GB'],
  ['Google pixel 10 a', 'Pixel 10a', null],
  ['Google Pixel 10a - 128GB - Lavender - NEU / OVP', 'Pixel 10a', '128 GB'],
  ['Google Pixel 11 5G 512GB 12GB Frost ohne simlock NEU&OVP', 'Pixel 11', '512 GB'],
  ['Google Pixel 6a mit Schutzhülle', 'Pixel 6a', null],
  ['Google Pixel 11 Pro Fold Neu 512 GB versiegelt', 'Pixel 11 Pro Fold', '512 GB'],
  ['Google Pixel 9 pro fold // 16+256Gb // Wie neu!', 'Pixel 9 Pro Fold', '256 GB'],
  ['Google Pixel 6 Pro 5G 128GB Stormy Black Smartphone', 'Pixel 6 Pro', '128 GB'],
  ['Google Pixel 7,Snow,128 GB mit OVP und Hülle', 'Pixel 7', '128 GB'],
  ['NEU Google Pixel 8 3 Monate in Benutzung gewesen', 'Pixel 8', null],
  ['Google Pixel Smartphone - Blau', null],
  ['Google Pixel 256 GB weiß', null],
  ['Google Pixel 7a 7 Pro Defekt Konvolut Smartphones', null],
  ['Google Pixel 2 XL, Akku defekt, noch voll funktionsfähig', null],
  ['Google Pixel 9 XL', null], // такой модели нет
  // ---- iPad
  ['iPad Air 5.Generation 256GB Space Grey OHNE BOX', 'iPad Air 5', '256 GB'],
  ['I Pad Air 2022 Gen. 5 WLAN 64 GB', 'iPad Air 5', '64 GB'],
  ['Apple iPad 9. Gen. 64 GB + Apple Pencil & Case Logic Tasche', 'iPad 9', '64 GB'],
  ['Ipad 9 Generation mit passenden Apple pencil', 'iPad 9', null],
  ['iPad 9. Generation 64GB in Space Grau 10,2 Zoll', 'iPad 9', '64 GB'],
  ['Apple iPad 11. Gen. A16, 128 GB, Wi-Fi Silber  Hülle Tastatur', 'iPad 11', '128 GB'],
  ['Apple iPad A16 128 GB Wi-Fi – Silber – Neu & versiegelt', 'iPad 11', '128 GB'],
  ['Apple iPad 11 Zoll, 128 GB, gelb, A16 Chip, 55 Ladezyklen, OVP.', 'iPad 11', '128 GB'],
  ['Apple iPad A16 - 11. Generation - Neu - Wifi + Cellular', 'iPad 11', '128 GB LTE', 'Apple iPad A16 mit 128 GB Speicher. Es ist die Wifi & Cellular Edition, mit eSim Funktion.'],
  ['iPad 10 64GB blau', 'iPad 10', '64 GB'],
  ['Apple IPad Pro 11“ 3. Generation', 'iPad Pro 11" M1', null],
  ['Apple iPad Pro 6. Gen 12,9 Zoll Wi‑Fi 128GB Silber+Stift&Tastatur', 'iPad Pro 12.9" M2', '128 GB'],
  ['Apple iPad Pro 11 Zoll M5 256GB Wi-Fi in silbernem Design', 'iPad Pro 11" M5', '256 GB'],
  ['iPad Pro 12.9-inch (5th Gen.) Wi-Fi 256GB + Zubehör Top Zustand', 'iPad Pro 12.9" M1', '256 GB'],
  ['iPad Pro 13" (M5, 2025) – 512 GB – Silber + Zubehör', 'iPad Pro 13" M5', '512 GB'],
  ['iPad Pro 11" 4.Gen M2 256GB SpaceGrau wie NEU Akku 100% Kickstand', 'iPad Pro 11" M2', '256 GB'],
  ['iPad Pro 11 M4 256Gb Schwarz', 'iPad Pro 11" M4', '256 GB'],
  ['iPad mini 6 256GB Cellular', 'iPad mini 6', '256 GB LTE'],
  ['iPad Air 13 Zoll M3 256GB', 'iPad Air 13" M3', '256 GB'],
  [
    'TOP*Apple iPad Pro 13"512GB WiFi Schwarz + Apple Pencil Pro - OVP',
    'iPad Pro 13" M5',
    '512 GB', // «Kein Cellular» в описании — не LTE
    'Apple iPad Pro 13" M5 – 512 GB WiFi Space Schwarz – 2025 + Apple Pencil Pro !!! Kein Cellular-Modell !!!',
  ],
  ['Apple Ipad 11"Air  WiFi Space Grey  + Zubehör', 'iPad Air 11" M2', '128 GB', 'Ipad Air 2024 128 GB Wi-fi Prozessor M2 Akkukapazität 100%'],
  ['TOP*Apple iPad Pro 13"512GB WiFi Schwarz + Apple Pencil Pro - OVP', null], // чип неизвестен
  ['iPad Pro 11“ Cellular 128 GB mit Tastatur und Apple Pencil', null],
  ['Apple IPad Pro / M1 / 128 GB / WLAN + Cellular 5G / Space Grau', null], // диагональ неизвестна
  ['iPad Pro 11" 4. Gen M4 256GB', null], // поколение и чип противоречат друг другу
  ['Apple iPad Pro 12,9 3. Gen mit Pencil & Magic Keyboard', null], // 2018, до M1
  ['iPad Pro 12.9 wifi 128 gb 2020  grau', null],
  ['Apple iPad 3, (3. Gen A1430) 64 GB Wi-Fi und Cellular', null],
  ['Apple IPad 8 Generation', null],
  ['Apple iPad 6. Gen. 32GB MR7F2FD/A A1893 9,7 Zoll Spacegrau OVP', null],
  ['Apple iPad 7 (2019) 10.2 Zoll inkl. Hülle und Stift 32 GB', null],
  ['iPad Air 2 Tablet', null],
  ['iPad Apple', null],
  ['Apple iPad mit Schutzhülle und Ladekabel', null],
  ['iPad Hülle für iPad 10', null],
  ['iPad Hülle 7th/8th/9th Generation', null],
  ['iPad Pro 11 Zoll Hülle', null],
  ['Apple Pencil 2. Generation Model A2051 weiß - magnetisch für iPad', null],
  ['Logitech Slim Folio Pro iPad Pro 12.9 (3. & 4. Gen) Tastatur DEU', null],
  ['Pad mini 6 256G | Apple Pencil | Zugu Case | 1. Hand', null],
  // ---- MacBook
  ["Apple MacBook Pro 14,2'' M5, 16GB RAM, 1TB SSD, Silber", 'MacBook Pro 14" M5 16GB', '1 TB'],
  ['Apple MacBook Air 13 Zoll M2 8GB/ 8C CPU/8C GPU / 512GB  2023', 'MacBook Air 13" M2 8GB', '512 GB'],
  ['Apple MacBook Air 13" M5 | 16GB | 512GB | Midnight | NEU OVP', 'MacBook Air 13" M5 16GB', '512 GB'],
  ['Apple MacBook Air M2 2022, 8GB RAM, 256GB, 98% Batterie', 'MacBook Air 13" M2 8GB', '256 GB'],
  ['MacBook Pro 14" (M6) 16GB RAM Neu', 'MacBook Pro 14" M6 16GB', null],
  ['Apple MacBook Air 15 Zoll | M2 | 8 GB | 256 GB | 2023', 'MacBook Air 15" M2 8GB', '256 GB'],
  ['Apple MacBook Air M1, 2020, 8GB RAM', 'MacBook Air 13" M1 8GB', null],
  ['Macbook Air M1 256 GB SSD 8 GB Ram - Sehr guter Zustand', 'MacBook Air 13" M1 8GB', '256 GB'],
  ['MacBook Pro 14" M1 Pro 10/16, 16 GB, 1 TB, Space Grau, OVP', 'MacBook Pro 14" M1 Pro 16GB', '1 TB'],
  ['Apple MacBook Pro 14“ M4 Pro - 24 GB RAM 100% Akku 24 Ladezyklen', 'MacBook Pro 14" M4 Pro 24GB', null],
  ['MacBook Pro 16 Zoll M3 Max 36GB 1TB', 'MacBook Pro 16" M3 Max 36GB', '1 TB'],
  ['MacBook Air 13 M3 16/512', 'MacBook Air 13" M3 16GB', '512 GB'],
  ['MacBook Air 15 Zoll M4 2025  im Neuwertigen Zustand', 'MacBook Air 15" M4 16GB', '256 GB', 'Verkaufe mein MacBook Air 15 Zoll M4 2025 Mitternachtblau mit 16GB RAM und 256GB Festplatte.'],
  ['MacBook Air 15 Zoll M4 2025  im Neuwertigen Zustand', null], // RAM неизвестна
  ['Macbook Air 13“ M4 mit Tasche & OVP', null],
  ['Apple MacBook Pro 14" M3 | 1TB SSD | 97% Akku | OVP | Top Zustand', null],
  ['Apple MacBook Pro M4, 24GB RAM, 500GB SSD, Neu', null], // диагональ неизвестна
  ['MACBOOK AIR M1 /// 256 GB guter Zustand', null],
  ['MacBook Air M2 8GB 256GB', null], // 13" или 15" — непонятно
  ['MacBook Air 13" M2 Pro 16GB', null], // у Air нет чипов Pro
  ['MacBook Pro 16" M2 16GB', null], // 16" с обычным M2 не было
  ['Apple MacBook Pro 8-Core Intel Core i9 16", 4 TTB SSD,32GB RAM', null],
  ['Macbook pro i9, 32GB ram, 1tb ssd.', null],
  ['Apple MacBook Pro 13,3” | Intel i5 | 8 GB RAM | 256 GB SSD', null],
  ['Apple MacBook Pro 13″ 2020 i7, 16 GB, 512 GB SSD, OVP,Top Zustand', null],
  ['MacBook 12 Zoll Retina (2017)  Space Grau, M3, 8 GB RAM, 256 GB', null], // Core m3, не Apple M3
  ['MacBook Neo 512 GB  Silber', null],
  ['Apple Macbook Netzteil Ladegerät MagSafe 1', null],
  ['Apple MacBook Originalverpackung', null],
  ['Suche defektes MacBook Pro (2018–2022)', null],
  ['2 Apple MacBook Pro Laptops - Defekt für Bastler', null],
  ['Razer Blade 14 RTX 3070, 4 TB SSD, Tausch gegen MacBook Air M3+', null],
];

let bad = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    bad++;
    console.log(`FAIL  ${name}: ${JSON.stringify(actual)} (ожидалось ${JSON.stringify(expected)})`);
  }
  return ok;
};

let passed = 0;
for (const [title, model, variant, description] of CASES) {
  const r = identify(title, description || '');
  let ok = check(`модель «${title}»`, r ? r.model : null, model);
  if (ok && model && variant !== undefined) ok = check(`вариант «${title}»`, r.variant, variant);
  if (ok) passed++;
}
console.log(`${passed === CASES.length ? 'PASS' : 'FAIL'}  распознавание: ${passed}/${CASES.length} заголовков`);

// Ленты: все категории каталога, iPhone — с 11-го.
const ACTIVE = [
  ['iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max'],
  ['iPhone 13 Mini', 'iPhone 13 Mini'],
  ['iPhone 12 Pro 128GB', 'iPhone 12 Pro'],
  ['iPhone 11 128 GB rot GUT', 'iPhone 11'],
  ['Samsung Galaxy S25 Ultra 256 GB', 'Galaxy S25 Ultra'],
  ['iPad Pro 11 M4 256Gb Schwarz', 'iPad Pro 11" M4'],
  ['iPhone XR 64GB', null],
];
let okActive = 0;
for (const [title, expected] of ACTIVE) if (check(`modelOf «${title}»`, modelOf(title), expected)) okActive++;
console.log(`${okActive === ACTIVE.length ? 'PASS' : 'FAIL'}  ленты (все категории, iPhone 11+): ${okActive}/${ACTIVE.length}`);

// Команды: ключ таблицы /sell и лимиты /price.
const SELL = [
  ['/sell 15 Pro 256 32000', 'iPhone 15 Pro|256 GB', 32000],
  ['/sell 13 Pro 15500', 'iPhone 13 Pro|*', 15500],
  ['/sell iphone 16e 128 21000', 'iPhone 16e|128 GB', 21000],
  ['/sell 15 pro max 1024 50000', 'iPhone 15 Pro Max|1 TB', 50000],
  ['/sell 11 128 7000', 'iPhone 11|128 GB', 7000],
  ['/sell s24 ultra 256 25000', 'Galaxy S24 Ultra|256 GB', 25000],
  ['/sell flip 6 14000', 'Galaxy Z Flip6|*', 14000],
  ['/sell pixel 8 pro 18000', 'Pixel 8 Pro|*', 18000],
  ['/sell ipad air 5 256 lte 20000', 'iPad Air 5|256 GB LTE', 20000],
  ['/sell ipad pro 11 m4 256 38000', 'iPad Pro 11" M4|256 GB', 38000],
  ['/sell ipad 10 64 11000', 'iPad 10|64 GB', 11000],
  ['/sell watch 9 45mm lte 12000', 'Apple Watch Series 9 45mm|LTE', 12000],
  ['/sell watch 9 45mm 11000', 'Apple Watch Series 9 45mm|*', 11000],
  ['/sell ultra 2 24000', 'Apple Watch Ultra 2 49mm|*', 24000],
  ['/sell macbook air 13 m2 16/512 40000', 'MacBook Air 13" M2 16GB|512 GB', 40000],
  ['/sell macbook pro 14 m3 pro 18gb 60000', 'MacBook Pro 14" M3 Pro 18GB|*', 60000],
  ['/sell air 13 m3 8/256 35000', 'MacBook Air 13" M3 8GB|256 GB', 35000],
];
let okSell = 0;
for (const [cmd, key, uah] of SELL) {
  const r = applySellCommand(cmd, {});
  if (check(cmd, r.error ? r.error : r.table, { [key]: uah })) okSell++;
}
for (const cmd of ['/sell macbook air m2 40000', '/sell galaxy a54 9000', '/sell watch se 44mm 6000', '/sell 9 Pro 10000']) {
  if (check(`${cmd} → ошибка`, Boolean(applySellCommand(cmd, {}).error), true)) okSell++;
}
console.log(`${okSell === SELL.length + 4 ? 'PASS' : 'FAIL'}  /sell: ${okSell}/${SELL.length + 4}`);

const PRICE = [
  ['/price 15 Pro 550', { 'iPhone 15 Pro': 550 }],
  ['/price s24 ultra 500', { 'Galaxy S24 Ultra': 500 }],
  ['/price ipad air 5 300', { 'iPad Air 5': 300 }],
  ['/price macbook pro 14 m3 pro 18gb 1200', { 'MacBook Pro 14" M3 Pro 18GB': 1200 }],
];
let okPrice = 0;
for (const [cmd, models] of PRICE) {
  const r = applyPriceCommand(cmd, { min: null, max: null, models: {} });
  if (check(cmd, r.error ? r.error : r.filter.models, models)) okPrice++;
}
if (check('/price 600 → общий максимум', applyPriceCommand('/price 600', { models: {} }).filter?.max, 600)) okPrice++;
if (check('/price 100-600', applyPriceCommand('/price 100-600', { models: {} }).filter?.min, 100)) okPrice++;
console.log(`${okPrice === PRICE.length + 2 ? 'PASS' : 'FAIL'}  /price: ${okPrice}/${PRICE.length + 2}`);

console.log(bad ? `FAILED: ${bad}` : 'ALL PASS');
process.exit(bad ? 1 : 0);
