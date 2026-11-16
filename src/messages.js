// Готовые сообщения продавцу на немецком (с переводом): «ещё доступен?» и «с предложением цены».
// Цена предложения — та же, что в карточке: s_offer (🤝 при показе или после ночной перепроверки «давно висят»);
// если её нет — −10 % от цены объявления.

const SIGNATURE = 'Maksym';
const OFFER_DISCOUNT = 0.1; // запасной вариант: −10 %, округлено вниз до 10 €

function phoneName(item) {
  return [item.model || 'iPhone', item.storage].filter(Boolean).join(' ');
}

export function offerPrice(price) {
  if (price == null || price < 50) return null;
  return Math.floor((price * (1 - OFFER_DISCOUNT)) / 10) * 10;
}

/** @returns {{ de: string, deOffer: string|null, ru: string, ruOffer: string|null, offer: number|null, fromCard: boolean }} */
export function sellerMessages(item, cityName, { remote = false } = {}) {
  const phone = phoneName(item);
  const pickup = remote
    ? 'Wäre ein Versand mit „Sicher bezahlen“ über Kleinanzeigen möglich?'
    : `Ich könnte es zeitnah in ${cityName} persönlich abholen und bar bezahlen.`;
  const pickupRu = remote
    ? 'Возможна ли отправка через «Sicher bezahlen» на Kleinanzeigen?'
    : `Могу в ближайшее время забрать лично в ${cityName} и оплатить наличными.`;

  const base = (offerDe) =>
    ['Hallo,', '', `ich interessiere mich für Ihr ${phone}. Ist es noch verfügbar?`, offerDe, '', pickup, '', 'Viele Grüße', '', SIGNATURE]
      .filter((l) => l !== null)
      .join('\n');
  const baseRu = (offerRu) =>
    ['Здравствуйте,', '', `меня интересует ваш ${phone}. Он ещё доступен?`, offerRu, '', pickupRu, '', 'С уважением,', '', SIGNATURE]
      .filter((l) => l !== null)
      .join('\n');

  const current = item.cur_price ?? item.price;
  const fromCard = item.s_offer != null && current != null && item.s_offer < current;
  const offer = fromCard ? item.s_offer : offerPrice(current);
  return {
    de: base(null),
    deOffer: offer ? base(`Wären Sie mit ${offer} € einverstanden?`) : null,
    ru: baseRu(null),
    ruOffer: offer ? baseRu(`Вас устроит ${offer} €?`) : null,
    offer,
    fromCard,
  };
}
