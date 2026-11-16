// صفحة «التحليل الفني»: شارت السهم كاملًا (company-chart.js) في صفحة مستقلة.
// السهم من ?symbol= في الرابط، وإن لم يوجد أو لم يكن في القائمة يُعرض أرامكو (2222).
// اختيار سهم آخر يتم من زر البحث داخل الشارت نفسه، كما كان في صفحات النتائج.
(() => {
  const DEFAULT_SYMBOL = '2222';
  const status = document.getElementById('ta-status');
  const panel = document.getElementById('ta-chart');
  const params = new URLSearchParams(location.search);

  function fail(message) {
    if (status) status.textContent = message;
  }

  async function start() {
    let data;
    try {
      data = await fetch('data.json').then(r => r.json());
    } catch (error) {
      console.warn('Price snapshot unavailable:', error);
      return fail('تعذر تحميل قائمة الأسهم.');
    }
    const stocks = new Map(data.sectors.flatMap(sector => sector.stocks).map(stock => [String(stock.symbol), stock]));
    const requested = params.get('symbol');
    const symbol = requested && stocks.has(requested) ? requested : DEFAULT_SYMBOL;
    const stock = stocks.get(symbol);
    if (!stock) return fail('لا يوجد سهم بهذا الرمز.');

    document.title = `${stock.name} · التحليل الفني | السوق السعودي`;
    if (!window.CompanyChart) return fail('تعذر تحميل مكتبة الشارت.');
    const file = await window.CompanyChart.load(symbol);
    if (!file) return fail(`لا تتوفر شموع للسهم ${symbol} بعد.`);

    if (status) status.remove();
    window.CompanyChart.mount(panel, file, { home: { symbol, file, name: stock.name } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
