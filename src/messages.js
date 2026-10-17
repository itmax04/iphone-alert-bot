// Готовые сообщения продавцу на немецком (с переводом): «ещё доступен?» и «с предложением цены».

const SIGNATURE = 'Maksym';
const OFFER_DISCOUNT = 0.1; // предложение цены: −10 %, округлено вниз до 10 €

function phoneName(item) {
  return [item.model || 'iPhone', item.storage].filter(Boolean).join(' ');
}

export function offerPrice(price) {
  if (price == null || price < 50) return null;
  return Math.floor((price * (1 - OFFER_DISCOUNT)) / 10) * 10;
}

/** @returns {{ de: string, deOffer: string|null, ru: string, ruOffer: string|null, offer: number|null }} */
export function sellerMessages(item, cityName, { remote = false } = {}) {
  const phone = phoneName(item);
  const questions = [
    'Ist das Gerät frei von iCloud-/Aktivierungssperre?',
    item.battery ? null : 'Wie ist der Akkuzustand (in %)?',
  ].filter(Boolean);
  const questionsRu = ['Телефон отвязан от iCloud (нет блокировки активации)?', item.battery ? null : 'Какое состояние аккумулятора (в %)?'].filter(Boolean);

  const base = (extraDe) =>
    [
      'Hallo,',
      '',
      `ich interessiere mich für Ihr ${phone}. Ist es noch verfügbar?`,
      extraDe,
      questions.join(' '),
      remote
        ? 'Wäre ein Versand mit „Sicher bezahlen“ über Kleinanzeigen möglich?'
        : `Ich könnte es zeitnah in ${cityName} persönlich abholen und bar bezahlen.`,
      '',
      'Viele Grüße',
      SIGNATURE,
    ]
      .filter((l) => l !== null)
      .join('\n');

  const offer = offerPrice(item.price);
  const de = base(null);
  const deOffer = offer ? base(`Wären Sie mit ${offer} € einverstanden?`) : null;

  const baseRu = (extraRu) =>
    [
      'Здравствуйте,',
      `меня интересует ваш ${phone}. Он ещё доступен?`,
      extraRu,
      questionsRu.join(' '),
      remote
        ? 'Возможна ли отправка через «Sicher bezahlen» на Kleinanzeigen?'
        : `Могу в ближайшее время забрать лично в ${cityName} и оплатить наличными.`,
      `С уважением, ${SIGNATURE}`,
    ]
      .filter((l) => l !== null)
      .join('\n');

  return { de, deOffer, ru: baseRu(null), ruOffer: offer ? baseRu(`Вас устроит ${offer} €?`) : null, offer };
}
