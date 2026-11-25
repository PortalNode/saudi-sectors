// قائمة المركز المالي وقائمة التدفقات النقدية بجانب قائمة الدخل في صفحات البيانات المالية.
// وحدة مستقلة: تقرأ القطاع من لوحة الصفحة (<slug>-panel أو bank-panel) والشركة من شارة الرمز
// في العنوان، فلا تحتاج أي تعديل في sector-results-page.mjs أو banks.js.
// البيانات من dist/<slug>-statements.json (يبنيه scripts/build-statements.py من ملفات XBRL في تداول).
const VERSION = 'statements-20261125b';
const STATEMENTS = { is: 'قائمة الدخل', bs: 'المركز المالي', cf: 'التدفقات النقدية' };
const VIEWS = { fy: 'سنوي', q: 'ربعي' };
const QUARTER_NAMES = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const numeric = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function formatAmount(value, unit) {
  value = numeric(value);
  if (value === null) return '<span class="missing" title="غير متاح">—</span>';
  if (unit === 'ratio') return `<span class="num">${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</span>`;
  const digits = Math.abs(value) >= 10000 ? 0 : 1;
  return `<span class="num${value < 0 ? ' down' : ''}">${value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}</span>`;
}

/** نسبة التغير عن الفترة السابقة بأسلوب جدول قائمة الدخل؛ «—» حين لا يمكن حسابها. */
export function formatChange(current, previous, unit) {
  current = numeric(current); previous = numeric(previous);
  if (current === null || previous === null || unit === 'ratio' || previous === 0) return '<span class="missing" title="لا يمكن حساب التغير">—</span>';
  const value = (current - previous) / Math.abs(previous) * 100;
  const zero = Math.abs(value) < 0.05;
  const trend = zero ? 'flat' : value > 0 ? 'up' : 'down';
  return `<span class="num ${trend}">${!zero && value > 0 ? '+' : ''}${(zero ? 0 : value).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%</span>`;
}

export function columnLabel(key) {
  const m = /^(\d{4})Q([1-4])$/.exec(key);
  return m ? `الربع ${QUARTER_NAMES[+m[2]]} ${m[1]}` : key;
}

export function validateStatements(data) {
  if (data?.schemaVersion !== 1 || !data.items?.bs || !data.items?.cf || !Array.isArray(data.companies)) throw new Error('invalid statements dataset');
  for (const company of data.companies) {
    if (!/^\d{4}$/.test(company.symbol)) throw new Error('invalid statements company');
    if (company.status === 'ok' && (!Array.isArray(company.years) || !Array.isArray(company.quarters) || typeof company.bs !== 'object' || typeof company.cf !== 'object')) throw new Error('invalid statements record');
  }
  return data;
}

/** HTML جدول قائمة لشركة؛ البنود التي لا قيمة لها في كل الأعمدة لا تظهر. */
export function renderStatement(data, company, stmt, view) {
  const title = STATEMENTS[stmt];
  if (!company || company.status !== 'ok') return `<p class="statements-empty">بيانات ${title} لهذه الشركة غير متوفرة حاليًا.</p>`;
  const columns = view === 'q' ? company.quarters : company.years.map(String);
  const values = company[stmt] || {};
  // بند بلا قيمة في آخر فترتين (توقفت الشركة عن الإفصاح عنه) لا يُعرض، فلا يمتلئ الجدول بالشرطات
  const recent = columns.slice(-2);
  const items = data.items[stmt].filter(item => recent.some(col => numeric(values[item.key]?.[col]) !== null));
  if (!columns.length || !items.length) return `<p class="statements-empty">لا تتوفر بيانات ${title} ${view === 'q' ? 'الربعية' : 'السنوية'} لهذه الشركة حاليًا.</p>`;
  const span = columns.length * 2;
  let group = null;
  const rows = [];
  for (const item of items) {
    if (item.group && item.group !== group) {
      group = item.group;
      rows.push(`<tr class="annual-group"><th scope="colgroup" colspan="${span}">${escapeHtml(group)}</th></tr>`);
    }
    const cls = [item.total ? 'statement-total' : '', item.computed ? 'statement-computed' : ''].filter(Boolean).join(' ');
    const series = values[item.key] || {};
    // أول عمود بلا مقارنة، ثم «نسبة التغير» عن الفترة السابقة قبل كل عمود (كما في جدول قائمة الدخل)
    const cells = columns.map((col, i) => (i ? `<td class="annual-change">${formatChange(series[col], series[columns[i - 1]], item.unit)}</td>` : '') + `<td>${formatAmount(series[col], item.unit)}</td>`).join('');
    rows.push(`<tr data-item="${escapeHtml(item.key)}"${cls ? ` class="${cls}"` : ''}><th scope="row" class="annual-label">${escapeHtml(item.label)}${item.unit === 'ratio' ? ' (%)' : ''}</th>${cells}</tr>`);
  }
  const range = view === 'q' ? 'آخر الأرباع' + (stmt === 'cf' ? ' (كل ربع منفرد)' : '') : `السنوي ${columns[0]}–${columns.at(-1)}`;
  const changeHead = view === 'q' ? 'التغير عن الربع السابق' : 'نسبة التغير';
  const head = columns.map((col, i) => (i ? `<th scope="col" class="annual-change-heading">${changeHead}</th>` : '') + `<th scope="col"${i === columns.length - 1 ? ' class="period-latest"' : ''}>${escapeHtml(columnLabel(col))}</th>`).join('');
  const colgroup = `<col class="annual-col-label"><col class="annual-col-value">${columns.slice(1).map(() => '<col class="annual-col-change"><col class="annual-col-value">').join('')}`;
  return `<table class="annual-table statements-table" data-statement="${stmt}"><caption>${escapeHtml(`${company.name} · ${title} ${range} — مليون ريال`)}</caption><colgroup>${colgroup}</colgroup><thead><tr><th scope="col" class="annual-label">البند</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function readState() {
  const params = new URLSearchParams(location.search);
  return { stmt: STATEMENTS[params.get('stmt')] ? params.get('stmt') : 'is', view: params.get('view') === 'q' ? 'q' : 'fy' };
}

function writeState(state) {
  const url = new URL(location.href);
  if (state.stmt === 'is') url.searchParams.delete('stmt'); else url.searchParams.set('stmt', state.stmt);
  if (state.stmt === 'is' || state.view === 'fy') url.searchParams.delete('view'); else url.searchParams.set('view', state.view);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', next);
}

export async function initStatements(doc = document) {
  const panel = doc.querySelector('section.bank-panel');
  if (!panel) return;
  const slug = panel.id === 'bank-panel' ? 'banks' : panel.id.replace(/-panel$/, '');
  let data;
  try {
    const response = await fetch(`${slug}-statements.json?v=${VERSION}`);
    if (!response.ok) return; // قطاع بلا ملف قوائم: الصفحة تبقى كما هي
    data = validateStatements(await response.json());
  } catch (error) {
    console.error(`${slug} statements could not be loaded:`, error);
    return;
  }
  let state = readState();
  const bar = doc.createElement('div');
  bar.className = 'statement-bar';
  bar.innerHTML = `<div class="period-seg statement-seg" role="group" aria-label="القائمة المالية">${Object.entries(STATEMENTS).map(([key, label]) => `<button type="button" data-stmt="${key}">${label}</button>`).join('')}</div>`
    + `<div class="period-seg small statement-view" role="group" aria-label="سنوي أو ربعي">${Object.entries(VIEWS).map(([key, label]) => `<button type="button" data-stview="${key}">${label}</button>`).join('')}</div>`;
  const wrap = doc.createElement('div');
  wrap.className = 'table-wrap statements-wrap';
  wrap.tabIndex = 0;
  wrap.hidden = true;

  function mount() {
    // مباشرة فوق الجدول (بعد شريط الفترات وأهم الأرقام)، مهما كان ترتيب تحميل بقية البطاقات
    const income = panel.querySelector('.annual-table-wrap');
    if (!income) return;
    const above = income.previousElementSibling?.classList.contains('m-view') ? income.previousElementSibling : income;
    if (bar.nextElementSibling !== above) above.before(bar);
    if (!wrap.isConnected) income.after(wrap);
  }

  function render() {
    mount();
    const symbol = panel.querySelector('h2 .symbol-badge')?.textContent.trim();
    if (!symbol) return;
    const company = data.companies.find(item => item.symbol === symbol);
    const statementsView = state.stmt !== 'is';
    for (const button of bar.querySelectorAll('[data-stmt]')) button.setAttribute('aria-pressed', String(button.dataset.stmt === state.stmt));
    for (const button of bar.querySelectorAll('[data-stview]')) {
      button.setAttribute('aria-pressed', String(button.dataset.stview === state.view));
      button.disabled = button.dataset.stview === 'q' && !(company?.quarters?.length);
    }
    bar.querySelector('.statement-view').hidden = !statementsView;
    // في المركز المالي والتدفقات: يُخفى جدول الدخل وشريط فتراته والرسم
    for (const el of panel.querySelectorAll('.annual-table-wrap, .m-view, .period-bar, .bank-charts')) el.classList.toggle('statements-hidden', statementsView);
    wrap.hidden = !statementsView;
    panel.classList.toggle('showing-statements', statementsView);
    if (statementsView) {
      wrap.innerHTML = renderStatement(data, company, state.stmt, state.view === 'q' && company?.quarters?.length ? 'q' : 'fy');
      wrap.scrollLeft = 0;
    }
    writeState(state);
  }

  bar.addEventListener('click', event => {
    const stmtButton = event.target.closest('[data-stmt]');
    const viewButton = event.target.closest('[data-stview]');
    if (stmtButton) state = { ...state, stmt: stmtButton.dataset.stmt };
    else if (viewButton && !viewButton.disabled) state = { ...state, view: viewButton.dataset.stview };
    else return;
    render();
  });
  // الشركة تتغير بتغير العنوان (الأزرار، القائمة، الرجوع في المتصفح)
  const title = panel.querySelector('h2');
  if (title) new MutationObserver(render).observe(title, { childList: true, subtree: true, characterData: true });
  // شريط الفترات قد يُضاف بعد التحميل؛ نخفيه إن ظهر ونحن في قائمة أخرى
  new MutationObserver(() => { if (state.stmt !== 'is') for (const el of panel.querySelectorAll('.period-bar, .m-view')) el.classList.add('statements-hidden'); }).observe(panel, { childList: true });
  window.addEventListener('popstate', () => { state = readState(); render(); });
  render();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') initStatements();
