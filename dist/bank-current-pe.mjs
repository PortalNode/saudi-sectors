import { escapeHtml } from './bank-metrics.mjs';

const numberFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

// Accept finite numeric strings, but never coerce missing values or booleans to 0.
function safeNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPeriod(period, now) {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period)) return false;
  const date = new Date(`${period}T00:00:00Z`);
  // ISO round-trip rejects rollover dates such as February 30.
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === period
    && period >= '2020-01-01' && date.getTime() <= now.getTime();
}

function providerLabel(provider) {
  if (provider === 'Saudi Exchange') return 'تداول السعودية';
  if (provider === 'TradingView') return 'تريدينغ فيو';
  return provider || null;
}

/** Build independent current records; annual FY values and stored PE are never used. */
export function buildCurrentBankPE(annualBanks, priceData, financialMap = null, now = new Date()) {
  const stocks = new Map();
  const duplicates = new Set();
  for (const sector of Array.isArray(priceData?.sectors) ? priceData.sectors : []) {
    for (const stock of Array.isArray(sector?.stocks) ? sector.stocks : []) {
      if (!stock || typeof stock.symbol !== 'string') continue;
      if (stocks.has(stock.symbol)) duplicates.add(stock.symbol);
      else stocks.set(stock.symbol, stock);
    }
  }

  const source = priceData?.priceSource ?? {};
  return annualBanks.map(bank => {
    const ambiguous = duplicates.has(bank.symbol);
    const stock = ambiguous ? null : stocks.get(bank.symbol);
    const candidate = safeNumber(stock?.price);
    const price = candidate !== null && candidate > 0 ? candidate : null;
    let eps = null, epsKind = null, epsSource = null, epsPeriod = null, epsDateKind = null;
    // A duplicate symbol fails closed even when an independent EPS snapshot exists.
    const snapshot = financialMap?.snapshot;
    const record = !ambiguous && snapshot && Object.hasOwn(snapshot, bank.symbol)
      ? snapshot[bank.symbol] : null;
    if (record && validPeriod(record.period, now)) {
      const recurring = safeNumber(record.recurring);
      const reported = safeNumber(record.reported);
      eps = recurring ?? reported;
      if (eps !== null) {
        epsKind = recurring !== null ? 'متكررة' : 'معلنة';
        epsSource = 'أرقام';
        epsPeriod = record.period;
        epsDateKind = record.dateKind ?? null;
      }
    }
    if (eps === null && stock) {
      eps = safeNumber(stock.eps);
      epsKind = 'ملف الأسعار';
      epsSource = 'تداول السعودية';
      epsPeriod = priceData?.financialPeriod ?? null;
    }

    const status = price === null ? 'missing-price' : eps === null ? 'missing-eps'
      : eps < 0 ? 'loss' : eps === 0 ? 'zero-eps' : 'available';
    const ratio = status === 'available' ? price / eps : null;
    return {
      symbol: bank.symbol,
      name: bank.name,
      price,
      eps,
      pe: Number.isFinite(ratio) ? ratio : null,
      status,
      epsKind,
      epsSource,
      epsPeriod,
      epsDateKind,
      priceDate: stock?.priceDate || source.officialDate || source.priceDate || priceData?.priceDate || null,
      priceStatus: price === null ? 'unavailable' : stock.priceStatus
        || (source.mode === 'close' ? 'official_close' : source.mode === 'delayed' || source.mode === 'intraday' ? 'delayed' : null),
      priceSource: providerLabel(stock?.priceSource || source.provider),
      checkedAt: stock?.priceCheckedAt ?? stock?.checkedAt ?? source.checkedAt ?? null
    };
  });
}

const displayNumber = value => {
  const number = safeNumber(value);
  return number === null ? '—' : numberFormat.format(number);
};
const displayText = value => escapeHtml(value ?? 'غير متاح');
function displayCheckedTime(value) {
  if (!value) return 'غير متاح';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return displayText(value);
  return escapeHtml(new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', calendar: 'gregory', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date) + ' بتوقيت الرياض');
}

function epsDateNote(record) {
  if (record.epsSource !== 'أرقام') return `الفترة المالية: ${record.epsPeriod ?? 'غير متاحة'}`;
  if (record.epsDateKind === 'checked') {
    return `فُحصت بيانات الشركة في ${record.epsPeriod ?? 'غير متاح'}؛ ليس تاريخ نهاية الفترة المالية أو تحديث القطاع`;
  }
  if (record.epsDateKind === 'sector') return `آخر تحديث للقطاع: ${record.epsPeriod ?? 'غير متاح'}`;
  return `تاريخ بيانات الربحية: ${record.epsPeriod ?? 'غير متاح'}${record.epsDateKind ? ` · نوع التاريخ: ${record.epsDateKind}` : ''}`;
}

/** Return standalone HTML; all input text is escaped, including metadata. */
export function renderCurrentBankPECard(record) {
  const ratio = safeNumber(record.pe);
  const currentPE = record.status === 'available' && ratio !== null && ratio > 0
    ? `${numberFormat.format(ratio)} مرة` : record.status === 'loss' ? 'خاسرة' : '—';
  const reason = {
    'missing-price': 'سعر السهم غير متاح؛ لا يمكن حساب المكرر.',
    'missing-eps': 'ربحية السهم غير متاحة؛ لا يمكن حساب المكرر.',
    loss: 'ربحية السهم سالبة؛ لا يُعرض مكرر ربح رقمي.',
    'zero-eps': 'ربحية السهم تساوي صفرًا؛ لا يمكن القسمة على صفر.'
  }[record.status] || (ratio === null ? 'المكرر غير متاح.' : '');
  const priceMode = record.priceStatus === 'official_close' ? 'إغلاق رسمي'
    : record.priceStatus === 'delayed' ? 'سعر متأخر · غير مؤكد رسميًا'
    : record.priceStatus === 'unavailable' ? 'السعر غير متاح' : record.priceStatus || 'حالة السعر غير متاحة';

  return `<article class="bank-current-pe-card" data-symbol="${escapeHtml(record.symbol)}" data-status="${escapeHtml(record.status)}">
  <h3>${escapeHtml(record.name)} · مكرر الربح الحالي</h3>
  <strong class="bank-current-pe-value" data-metric="currentPE">${currentPE}</strong>
  ${reason ? `<p class="bank-current-pe-status">${escapeHtml(reason)}</p>` : ''}
  <dl>
    <div><dt>سعر السهم</dt><dd><bdi>${displayNumber(record.price)}</bdi> ريال</dd></div>
    <div><dt>ربحية السهم · ${displayText(record.epsKind)}</dt><dd><bdi>${displayNumber(record.eps)}</bdi> ريال</dd></div>
    <div><dt>تاريخ السعر</dt><dd><bdi>${displayText(record.priceDate)}</bdi></dd></div>
    <div><dt>آخر فحص لنسخة الأسعار</dt><dd><time datetime="${displayText(record.checkedAt)}">${displayCheckedTime(record.checkedAt)}</time></dd></div>
  </dl>
  <p class="bank-current-pe-source">مصدر السعر: ${displayText(record.priceSource)} · ${escapeHtml(priceMode)}</p>
  <p class="bank-current-pe-source">مصدر الربحية: ${displayText(record.epsSource)} · ${displayText(record.epsKind)} · ${escapeHtml(epsDateNote(record))}</p>
  <p class="bank-current-pe-note">سعر السهم ÷ ربحية السهم؛ محسوب من أحدث لقطة بيانات متاحة، وليس سعرًا لحظيًا. لا يستخدم ربحية السهم أو مكرر الأرباح التاريخي من الجداول السنوية.</p>
</article>`;
}
