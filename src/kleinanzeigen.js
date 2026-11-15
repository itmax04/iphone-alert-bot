// Kleinanzeigen: страница ленты (регион + категория, только частные продавцы, только предложения) и разбор объявления.

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class SourceError extends Error {}

/**
 * Адрес ленты: регион + категория, частные продавцы, только предложения, цена от MIN_PRICE €, сначала новые.
 * Без поискового слова — «c<категория><место>», со словом — «<слово>/k0c<категория><место>».
 */
export const MIN_PRICE = 150;
export function feedUrl(feed, page = 1) {
  const { group, region } = feed;
  return (
    `https://www.kleinanzeigen.de/${group.path}/${region.slug}/anbieter:privat/anzeige:angebote/preis:${MIN_PRICE}:/` +
    `${page > 1 ? `seite:${page}/` : ''}sortierung:neuste/${group.query ? `${group.query}/k0` : ''}c${group.cat}${region.loc}`
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
const POSTED_RE = /<span>((?:Heute|Gestern),\s*\d{1,2}:\d{2}|\d{2}\.\d{2}\.\d{4})<\/span>/; // «Heute, 11:50», «Gestern, 09:15», «12.11.2026»
const OLD_PRICE_RE = /line-through">\s*([\d.,]+)\s*€/; // зачёркнутая прежняя цена — цена уже снижена
function textMatching(fragment, re) {
  const m = fragment.match(re);
  return m ? m[1].replace(/&nbsp;|\s+/g, ' ').trim() : '';
}

/** Режет страницу на блоки <article data-adid=...>: только номер (id — строка «ka:N», num — число) и сырой HTML, без разбора. */
function splitArticles(html) {
  const articles = [];
  let pos = html.indexOf('data-adid="');
  while (pos !== -1) {
    const begin = html.lastIndexOf('<article', pos);
    const end = html.indexOf('</article>', pos);
    if (begin === -1 || end === -1) break;
    const idStart = pos + 'data-adid="'.length;
    const num = html.slice(idStart, html.indexOf('"', idStart));
    articles.push({ id: `ka:${num}`, num: Number(num), raw: html.slice(begin, end) });
    pos = html.indexOf('data-adid="', end);
  }
  return articles;
}

/**
 * Страница ленты: список { id, num, raw } без разбора. Разбирать дорого, поэтому
 * разбираем потом только новые объявления — parseArticle().
 */
export async function fetchFeed(feed, page = 1) {
  const request = () =>
    fetch(feedUrl(feed, page), { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'de-DE,de;q=0.9' } });
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
  return articles.filter((a) => Number.isFinite(a.num));
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
    posted: (raw.match(POSTED_RE) || [])[1] || null,
    oldPrice: parseNumber((raw.match(OLD_PRICE_RE) || [])[1]),
    location: textMatching(raw, LOCATION_RE),
    url: `https://www.kleinanzeigen.de${href}`,
    image: ld.contentUrl || null,
  };
}
