'use strict';
(function () {
  const endpoint = 'https://api.emotional-harbor.ru/pricing';
  let current = null, pending = null;
  const number = value => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(value / 100);
  const format = () => current ? number(current.price_kopecks) + ' ₽' : '…';
  function render() {
    document.querySelectorAll('[data-harbor-price]').forEach(el => { el.textContent = format(); });
    document.querySelectorAll('[data-harbor-price-main]').forEach(el => {
      const currency = document.createElement('span'); currency.textContent = '₽';
      el.replaceChildren(current ? number(current.price_kopecks) : '…', currency);
    });
    document.querySelectorAll('[data-harbor-price-label]').forEach(el => {
      el.setAttribute('aria-label', 'Получить ключи' + (current ? ', ' + format() : ''));
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const schema = JSON.parse(el.textContent);
        if (schema['@type'] !== 'Product') return;
        if (current) schema.offers = {'@type': 'Offer', price: (current.price_kopecks / 100).toFixed(2),
          priceCurrency: 'RUB', availability: 'https://schema.org/InStock', url: 'https://emotional-harbor.ru/'};
        else delete schema.offers;
        el.textContent = JSON.stringify(schema);
      } catch (_) { /* Other structured data does not affect checkout. */ }
    });
    window.dispatchEvent(new Event('harbor:pricing'));
  }
  function load() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch(endpoint, {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw Error('Price unavailable');
        const data = await response.json();
        if (data.product_id !== 'harbor' || data.currency !== 'RUB' ||
            !Number.isSafeInteger(data.price_kopecks) || data.price_kopecks <= 0 || data.price_kopecks > 4294967295) {
          throw Error('Invalid price');
        }
        current = {product_id: 'harbor', currency: 'RUB', price_kopecks: data.price_kopecks};
        render(); return current;
      } catch (error) {
        current = null; render(); throw error;
      } finally { pending = null; }
    })();
    return pending;
  }
  window.HarborPricing = {load, format, get current() {return current;}};
  load().catch(() => {});
})();
