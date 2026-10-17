// Kleinanzeigen: новые объявления iPhone в городе (только частные продавцы, только предложения).

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class SourceError extends Error {}

export function searchUrl(city) {
  const page = city.page > 1 ? `seite:${city.page}/` : '';
  return (
    `https://www.kleinanzeigen.de/s-handy-telekom${city.slug ? `/${city.slug}` : ''}` +
    `/anbieter:privat/anzeige:angebote/${page}sortierung:neuste/iphone/k0c173${city.loc}`
  );
}

function parseNumber(text) {
  if (text == null) return null;
  const m = String(text).replace(/\./g, '').match(/\d+(,\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

// Текст между тегами, подходящий под шаблон. Шаблоны собраны один раз (на бесплатном тарифе 10 мс CPU).
const LOCATION_RE = />\s*(\d{5}\s[^<]*?)\s*</;
const PRICE_RE = />\s*([\d.,]+\s*€[^<]*?)\s*</;
function textMatching(fragment, re) {
  const m = fragment.match(re);
  return m ? m[1].replace(/&nbsp;|\s+/g, ' ').trim() : '';
}

/** Режет страницу на блоки <article data-adid=...>: только номер и сырой HTML, без разбора. */
function splitArticles(html) {
  const articles = [];
  let pos = html.indexOf('data-adid="');
  while (pos !== -1) {
    const begin = html.lastIndexOf('<article', pos);
    const end = html.indexOf('</article>', pos);
    if (begin === -1 || end === -1) break;
    const idStart = pos + 'data-adid="'.length;
    articles.push({ id: `ka:${html.slice(idStart, html.indexOf('"', idStart))}`, raw: html.slice(begin, end) });
    pos = html.indexOf('data-adid="', end);
  }
  return articles;
}

/**
 * Страница поиска города: список { id, raw } без разбора. Разбирать дорого, поэтому
 * разбираем потом только новые объявления — parseArticle().
 */
export async function fetchCity(city) {
  const request = () =>
    fetch(searchUrl(city), { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'de-DE,de;q=0.9' } });
  let r = await request();
  // Kleinanzeigen иногда разово отвечает 403/429 — одна повторная попытка через 5 секунд.
  if (r.status === 403 || r.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    r = await request();
  }
  if (!r.ok) throw new SourceError(`HTTP ${r.status}`);

  // Обычный r.text(): в Cloudflare он работает внутри движка и дешевле любого чтения по кускам
  // (проверено: поток — ~21 мс CPU, HTMLRewriter — ~18 мс, r.text() — ~10 мс).
  const html = await r.text();
  const articles = splitArticles(html);
  if (articles.length === 0 && !html.includes('srchrslt')) {
    throw new SourceError('страница без списка результатов (возможно, блокировка)');
  }
  return articles;
}

/** Полный разбор одного объявления. */
export function parseArticle({ id, raw }) {
  const href = (raw.match(/data-href="([^"]+)"/) || [])[1] || '';
  let ld = {};
  const ldStart = raw.indexOf('application/ld+json">');
  if (ldStart !== -1) {
    const from = ldStart + 'application/ld+json">'.length;
    try {
      ld = JSON.parse(raw.slice(from, raw.indexOf('</script>', from)));
    } catch {}
  }
  const price = textMatching(raw, PRICE_RE);
  return {
    id,
    title: ld.title || '',
    description: ld.description || '',
    price: parseNumber(price),
    negotiable: /VB/.test(price),
    location: textMatching(raw, LOCATION_RE),
    url: `https://www.kleinanzeigen.de${href}`,
    image: ld.contentUrl || null,
  };
}
