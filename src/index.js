// Alert Bot: следит за новыми объявлениями на Kleinanzeigen (iPhone 11+, iPad, MacBook, Apple Watch, Samsung, Pixel)
// в трёх регионах — Берлин, Гамбург, вся Mecklenburg-Vorpommern — и присылает их в Telegram.
//
// Один запуск — одна страница одной ленты (лимит бесплатного тарифа: 10 мс CPU на запуск). Два расписания:
//  • каждую минуту: 3 ленты телефонов по кругу, каждая раз в 3 минуты;
//  • каждые 2 минуты: 9 остальных лент (планшеты, MacBook, Apple Watch), каждая раз в 18 минут.
// Ленты, расписание и разбор новых объявлений — src/feeds.js. Данные — в D1.

import { fetchFeed, feedUrl, parseArticle } from './kleinanzeigen.js';
import { recognize } from './filters.js';
import { describeSellTable } from './settings.js';
import { eurRate, getSellTable, recomputeMarket } from './market.js';
import { handleUpdate, statsText, COMMANDS } from './commands.js';
import { FEEDS, CRON_FAST, feedFor, runFeed, berlinDay } from './feeds.js';
import { sendText, call, escapeHtml } from './telegram.js';

const KEEP_DAYS = 30;
const DAILY_REPORT_HOUR = 21;
const NIGHT_HOUR = 3; // пересчёт медиан и чистка (Europe/Berlin)
const DAY = 24 * 3600 * 1000;

function berlinParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => f.find((p) => p.type === t).value;
  return { hour: parseInt(get('hour'), 10), minute: parseInt(get('minute'), 10) };
}

async function sellReminder(env) {
  const [table, rate] = await Promise.all([getSellTable(env), eurRate(env)]);
  await sendText(
    env,
    `🗓 <b>Понедельник: проверьте цены продажи на OLX</b>\nБот считает маржу по этой таблице, курс НБУ сегодня: ${rate?.uahPerEur ?? '?'} ₴ за €.\n\n` +
      `${escapeHtml(describeSellTable(table, rate))}\n\nИзменить: <code>/sell 15 Pro 256 32000</code>`,
    { disable_notification: true },
  );
}

async function dailyReport(env) {
  await sendText(env, `📊 <b>Итоги дня</b>\n\n${await statsText(env, berlinDay())}`);
}

export default {
  async scheduled(event, env) {
    const date = new Date(event.scheduledTime);
    await runFeed(env, feedFor(event.cron, date)).catch((e) => console.error('run failed', e));
    if (event.cron !== CRON_FAST) return; // отчёты и чистка — только в основном расписании

    const { hour, minute } = berlinParts(date);
    if (hour === DAILY_REPORT_HOUR && minute === 0) await dailyReport(env).catch((e) => console.error('report failed', e));
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(date);
    if (weekday === 'Mon' && hour === 10 && minute === 0) await sellReminder(env).catch((e) => console.error('reminder failed', e));
    // Раз в сутки ночью (Берлин): пересчёт медиан рынка, затем чистка старых записей.
    if (hour === NIGHT_HOUR && minute === 20) await recomputeMarket(env).catch((e) => console.error('market failed', e));
    if (hour === NIGHT_HOUR && minute === 30) {
      const cutoff = Date.now() - KEEP_DAYS * DAY;
      // seen, deal_seen, mv_seen, deals больше не пополняются (остались от мониторинга городов) — дочищаем до удаления таблиц.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM seen WHERE first_seen < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM items WHERE sent_at < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM prices WHERE seen_at < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM deal_seen WHERE ts < ?').bind(Date.now() - 3 * DAY),
        env.DB.prepare('DELETE FROM mv_seen WHERE ts < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM deals WHERE found_at < ?').bind(Date.now() - 7 * DAY),
      ]);
    }
  },

  // /telegram — команды и кнопки (секрет в заголовке знает только Telegram).
  // /setup?key=<RUN_KEY> — подключить webhook и меню. /run?key=<RUN_KEY>&feed=<id ленты>|report|market — ручной запуск.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/telegram' && request.method === 'POST') {
      if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        await handleUpdate(env, await request.json());
      } catch (e) {
        console.error('telegram update failed', e);
      }
      return new Response('ok');
    }
    const authorized = env.RUN_KEY && url.searchParams.get('key') === env.RUN_KEY;
    if (!authorized) return new Response('Alert Bot');
    if (url.pathname === '/setup') {
      const webhook = await call(
        env,
        'setWebhook',
        { url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true },
        { withChat: false },
      );
      const commands = await call(env, 'setMyCommands', { commands: COMMANDS }, { withChat: false });
      return Response.json({ webhook: webhook.ok, commands: commands.ok });
    }
    if (url.pathname === '/run') {
      const id = url.searchParams.get('feed');
      if (id === 'report') {
        await dailyReport(env);
        return Response.json({ report: 'sent' });
      }
      if (id === 'market') return Response.json(await recomputeMarket(env).then(() => ({ market: 'recomputed' })));
      const feed = FEEDS.find((f) => f.id === id);
      if (!feed) return Response.json({ error: 'unknown feed', feeds: FEEDS.map((f) => f.id) }, { status: 400 });
      // debug=1: только показать разобранные объявления, без записи в базу и без Telegram.
      if (url.searchParams.get('debug')) {
        const parsed = (await fetchFeed(feed)).map(parseArticle);
        return Response.json(
          parsed
            .slice(0, 6)
            .map((i) => {
              const rec = recognize(i.title, i.description);
              return { id: i.id, price: i.price, vb: i.negotiable, location: i.location, title: i.title.slice(0, 60), model: rec?.model ?? null, variant: rec?.variant ?? null, img: Boolean(i.image) };
            })
            .concat([{ total: parsed.length, url: feedUrl(feed) }]),
        );
      }
      return Response.json(await runFeed(env, feed));
    }
    return new Response('Alert Bot');
  },
};
