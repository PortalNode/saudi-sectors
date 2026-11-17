// شارت السهم المتقدم: خطي أو شموع، يومي أو أسبوعي أو شهري، مع أدوات التحليل الفني الأساسية:
// المتوسطات المتحركة، بولنجر، RSI، MACD، الحجم، وأدوات رسم (خط أفقي وخط اتجاه) تُحفظ لكل سهم في هذا المتصفح.
// يرسمه Lightweight Charts (مكتبة TradingView مفتوحة المصدر ومجانية، رخصة Apache-2.0).
// البيانات من ohlc/<الرمز>.json: شموع يومية لخمس سنوات، والأسبوعية والشهرية تُبنى منها هنا
// (أسبوع تداول = الأحد إلى الخميس) فتطابق شموع TradingView الأسبوعية والشهرية.
(() => {
  const LIB = 'vendor/lightweight-charts-5.2.1.js'; // نسخة محفوظة داخل الموقع (الرخصة في vendor/lightweight-charts-LICENSE.txt)
  const f2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const big = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const longDate = iso => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const dot = iso => iso.split('-').reverse().join('.');
  // تاريخ مؤشر الشارت بأسلوب TradingView: «الاثنين 16 نوفمبر '26»، والشهري «نوفمبر '26»
  const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const crosshairDate = (time, interval) => {
    const d = typeof time === 'string' ? new Date(time + 'T00:00:00Z')
      : typeof time === 'number' ? new Date(time * 1000)
      : new Date(Date.UTC(time.year, time.month - 1, time.day));
    const yy = `'${String(d.getUTCFullYear()).slice(-2)}`;
    const month = MONTHS[d.getUTCMonth()];
    return interval === 'm' ? `${month} ${yy}` : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${month} ${yy}`;
  };
  const TYPES = [['line', 'خطي'], ['candles', 'شموع']];
  // أيقونات نوع الشارت كما في TradingView: الشموع والخط
  const TYPE_ICONS = {
    candles: '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5v4M9 19.5v4M19 6v4M19 18v4"/><rect x="6.5" y="8.5" width="5" height="11" rx=".8"/><rect x="16.5" y="10" width="5" height="8" rx=".8"/></svg>',
    line: '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l6.5-6.5 4.5 3.5L24 7.5"/></svg>'
  };
  const INTERVALS = [['d', 'يوم'], ['w', 'أسبوع'], ['m', 'شهر']];
  const RANGES = [['3m', '3 أشهر', 3], ['6m', '6 أشهر', 6], ['1y', 'سنة', 12], ['3y', '3 سنوات', 36], ['5y', '5 سنوات', 60], ['all', 'الكل', null]];
  const DEFAULT_RANGE = { d: '1y', w: '3y', m: '5y' };
  // المؤشرات: على الشارت نفسه (overlay) أو في لوحة تحته (pane)
  const INDICATORS = [
    { id: 'sma20', label: 'متوسط 20', title: 'متوسط متحرك بسيط 20', kind: 'overlay', color: '#3987e5' },
    { id: 'sma50', label: 'متوسط 50', title: 'متوسط متحرك بسيط 50', kind: 'overlay', color: '#d95926' },
    { id: 'sma200', label: 'متوسط 200', title: 'متوسط متحرك بسيط 200', kind: 'overlay', color: '#9085e9' },
    { id: 'ema20', label: 'متوسط أسي 20', title: 'متوسط متحرك أسي 20', kind: 'overlay', color: '#199e70' },
    { id: 'bb', label: 'بولنجر', title: 'نطاقات بولنجر (20، 2)', kind: 'overlay', color: '#c98500' },
    { id: 'vol', label: 'الحجم', title: 'حجم التداول', kind: 'volume' },
    { id: 'rsi', label: 'RSI', title: 'مؤشر القوة النسبية (14)', kind: 'pane', color: '#9085e9' },
    { id: 'macd', label: 'MACD', title: 'الماكد (12، 26، 9)', kind: 'pane', color: '#3987e5' }
  ];
  // إعدادات كل مؤشر كما في TradingView: المدخلات، والنمط (الألوان والسماكة وما يظهر من خطوط)،
  // والظهور (على أي فترة شمعة يظهر)، والإخفاء المؤقت. تُحفظ في هذا المتصفح، وcolor: null يعني لون الموقع.
  const SOURCES = [['close', 'إغلاق'], ['open', 'افتتاح'], ['high', 'أعلى'], ['low', 'أدنى'], ['hl2', '(أعلى+أدنى)/2'], ['hlc3', '(أعلى+أدنى+إغلاق)/3'], ['ohlc4', '(افتتاح+أعلى+أدنى+إغلاق)/4']];
  const srcOf = (b, key) => key === 'open' ? b.open : key === 'high' ? b.high : key === 'low' ? b.low : key === 'hl2' ? (b.high + b.low) / 2
    : key === 'hlc3' ? (b.high + b.low + b.close) / 3 : key === 'ohlc4' ? (b.open + b.high + b.low + b.close) / 4 : b.close;
  const plot = (color, width = 1.5) => ({ color, width, on: true });
  const maDefault = color => ({ inputs: { length: 0, source: 'close' }, plots: { ma: plot(color) } });
  const IND_DEFAULT = {
    sma20: { ...maDefault('#3987e5'), inputs: { length: 20, source: 'close' } },
    sma50: { ...maDefault('#d95926'), inputs: { length: 50, source: 'close' } },
    sma200: { ...maDefault('#9085e9'), inputs: { length: 200, source: 'close' } },
    ema20: { ...maDefault('#199e70'), inputs: { length: 20, source: 'close' } },
    bb: { inputs: { length: 20, mult: 2, source: 'close' }, plots: { basis: plot('#c98500', 1), upper: plot('#c98500'), lower: plot('#c98500') } },
    vol: { inputs: {}, plots: { up: plot(null), down: plot(null) } },
    rsi: { inputs: { length: 14, source: 'close', upper: 70, lower: 30 }, plots: { rsi: plot('#9085e9'), upper: plot(null, 1), lower: plot(null, 1) } },
    macd: { inputs: { source: 'close', fast: 12, slow: 26, signal: 9, osc: 'EMA', sig: 'EMA' }, plots: { hist: { on: true, colors: ['#26a69a', '#b2dfdb', '#ffcdd2', '#ff5252'] }, macd: plot('#3987e5'), signal: plot('#d95926'), zero: plot(null, 1) } }
  };
  for (const s of Object.values(IND_DEFAULT)) Object.assign(s, { hidden: false, vis: { d: true, w: true, m: true }, scaleLabels: true, statusValues: true, statusInputs: true });
  // دمج المحفوظ مع الافتراضي حقلًا حقلًا، فلا يكسر إعدادٌ قديم أو تالف الشارت
  function mergeInd(def, saved) {
    const out = structuredClone(def);
    if (!saved || typeof saved !== 'object') return out;
    for (const k of ['hidden', 'scaleLabels', 'statusValues', 'statusInputs']) if (typeof saved[k] === 'boolean') out[k] = saved[k];
    for (const k of ['d', 'w', 'm']) if (typeof saved.vis?.[k] === 'boolean') out.vis[k] = saved.vis[k];
    for (const k of Object.keys(out.inputs)) if (typeof saved.inputs?.[k] === typeof out.inputs[k]) out.inputs[k] = saved.inputs[k];
    for (const [k, p] of Object.entries(out.plots)) {
      const s = saved.plots?.[k]; if (!s) continue;
      if (typeof s.on === 'boolean') p.on = s.on;
      if ('color' in p && (s.color === null || /^#[0-9a-f]{6}$/i.test(s.color))) p.color = s.color;
      if ('width' in p && [1, 1.5, 2, 3, 4].includes(s.width)) p.width = s.width;
      if (p.colors && Array.isArray(s.colors) && s.colors.length === 4 && s.colors.every(c => /^#[0-9a-f]{6}$/i.test(c))) p.colors = [...s.colors];
    }
    return out;
  }
  const loadInd = () => { let saved = {}; try { saved = JSON.parse(localStorage.getItem('cc-ind') || '{}') || {}; } catch { /* ignore */ } return Object.fromEntries(Object.entries(IND_DEFAULT).map(([id, def]) => [id, mergeInd(def, saved[id])])); };
  const saveInd = () => { try { localStorage.setItem('cc-ind', JSON.stringify(indCfg)); } catch { /* ignore */ } };
  let indCfg = loadInd();
  // اسم المؤشر ومدخلاته في سطر الحالة كما في TradingView: «MACD close 12 26 9»
  const IND_NAME = { sma20: 'SMA', sma50: 'SMA', sma200: 'SMA', ema20: 'EMA', bb: 'BB', vol: 'Vol', rsi: 'RSI', macd: 'MACD' };
  const indParams = (id, s = indCfg[id]) => {
    const i = s.inputs;
    if (id === 'vol') return [];
    if (id === 'bb') return [i.length, i.source, i.mult];
    if (id === 'macd') return [i.source, i.fast, i.slow, i.signal];
    return [i.length, i.source];
  };
  const indTitle = (id, s = indCfg[id]) => {
    const i = s.inputs;
    return { sma20: `متوسط متحرك بسيط ${i.length}`, sma50: `متوسط متحرك بسيط ${i.length}`, sma200: `متوسط متحرك بسيط ${i.length}`, ema20: `متوسط متحرك أسي ${i.length}`,
      bb: `نطاقات بولنجر (${i.length}، ${i.mult})`, vol: 'حجم التداول', rsi: `مؤشر القوة النسبية (${i.length})`, macd: `الماكد (${i.fast}، ${i.slow}، ${i.signal})` }[id];
  };
  const TOOLS = [['vline', 'خط عمودي'], ['hline', 'خط أفقي'], ['hray', 'شعاع أفقي'], ['trend', 'خط اتجاه'], ['ray', 'شعاع'], ['ext', 'خط ممتد'], ['arrow', 'سهم'], ['rect', 'مستطيل'], ['fib', 'فيبوناتشي'], ['range', 'نطاق السعر'], ['text', 'نص']];
  // الألوان والسماكات الافتراضية كما في TradingView: الأزرق #2962FF، والخطوط الأفقية والعمودية رفيعة، وخط الاتجاه والسهم والشعاع أعرض
  const TV_BLUE = '#2962ff';
  const DRAW_DEFAULT = {
    vline: { color: TV_BLUE, width: 1, line: 'solid' },
    hline: { color: TV_BLUE, width: 1, line: 'solid' },
    hray: { color: TV_BLUE, width: 1, line: 'solid' },
    trend: { color: TV_BLUE, width: 2, line: 'solid', extL: false, extR: false },
    ray: { color: TV_BLUE, width: 2, line: 'solid', extL: false, extR: true },
    ext: { color: TV_BLUE, width: 2, line: 'solid', extL: true, extR: true },
    arrow: { color: TV_BLUE, width: 2, line: 'solid' },
    rect: { color: TV_BLUE, width: 1, line: 'solid', fill: false },
    text: { size: 14 }
  };
  const LINE_OPTIONS = [['solid', 'متصل'], ['dotted', 'منقط'], ['dashed', 'متقطع']];
  const TEXT_SIZES = [10, 12, 14, 16, 20, 24, 32];
  // أدوات تُوضع بنقرة واحدة (لا بنقطتين)
  const SINGLE_CLICK_TOOLS = ['hline', 'hray', 'vline', 'text'];
  const DRAW_TITLE = { vline: 'خط عمودي', hline: 'خط أفقي', hray: 'شعاع أفقي', trend: 'خط اتجاه', ray: 'شعاع', ext: 'خط ممتد', arrow: 'سهم', rect: 'مستطيل', fib: 'فيبوناتشي', range: 'نطاق السعر', text: 'نص' };
  // نمط الخط على الشاشة: المنقط والمتقطع يتناسبان مع السماكة
  const dashFor = (line, width) => { const u = Math.max(1, width || 1); return line === 'dotted' ? [u, 3 * u] : line === 'dashed' ? [6 * u, 4 * u] : []; };
  // المغناطيس كما في TradingView: يلصق نقطة الرسم بأقرب سعر من الشمعة (افتتاح، أعلى، أدنى، إغلاق)؛
  // «ضعيف» حين يقترب المؤشر منه فقط، و«قوي» دائمًا
  const MAGNETS = [['off', 'إيقاف'], ['weak', 'ضعيف'], ['strong', 'قوي']];
  const WEAK_MAGNET_PX = 14;
  function nearestPrice(prices, toY, y, mode) {
    if (mode === 'off') return null;
    let best = null;
    for (const price of prices) {
      const py = toY(price);
      if (py == null) continue;
      const distance = Math.abs(py - y);
      if (!best || distance < best.distance) best = { price, distance };
    }
    return best && (mode === 'strong' || best.distance <= WEAK_MAGNET_PX) ? best.price : null;
  }
  // نص نطاق السعر: الفرق ونسبته من النقطة الأولى
  function rangeLabel(from, to) {
    const diff = to - from, pct = from ? diff / from * 100 : 0, sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}${fmt.format(Math.abs(diff))} (${sign}${fmt.format(Math.abs(pct))}%)`;
  }
  // مستويات تصحيح فيبوناتشي كما في TradingView: 1 عند النقطة الأولى و0 عند الثانية
  // إعدادات فيبوناتشي الافتراضية على نمط TradingView (المستويات المفعّلة وألوانها وموضع العناوين)،
  // ويغيّرها الزائر من زر الإعدادات فتُحفظ في متصفحه
  const FIB_DEFAULT = {
    levels: [
      [-2.618, '#2962ff', true], [-0.618, '#00bcd4', true], [-0.27, '#f23645', true], [0, '#787b86', true], [0.236, '#f23645', false],
      [0.382, '#ff9800', true], [0.5, '#4caf50', true], [0.618, '#089981', true], [0.764, '#e91e63', true], [0.786, '#00bcd4', false],
      [1, '#787b86', true], [1.272, '#ff9800', true], [1.618, '#2962ff', true], [2, '#089981', true], [2.272, '#ff9800', true],
      [2.414, '#e91e63', true], [2.618, '#f23645', true], [3.272, '#434651', false], [3.618, '#089981', true], [4, '#b22833', false],
      [4.272, '#9c27b0', false], [4.618, '#a0522d', false]
    ].map(([value, color, on]) => ({ value, color, on })),
    trend: true,       // خط الاتجاه المنقط بين النقطتين
    background: false, // تظليل بين المستويات
    reverse: false,    // عكس اتجاه المستويات
    prices: true,      // السعر بين قوسين
    showLevels: true,  // اسم المستوى
    levelsAs: 'percent', // percent: 61.80%، values: 0.618
    labels: 'right',   // موضع العناوين: يمين أو يسار المستويات
    extend: 'none'     // none | right | left | both
  };
  const loadFib = () => { try { const saved = JSON.parse(localStorage.getItem('cc-fib') || 'null'); return saved?.levels?.length ? { ...FIB_DEFAULT, ...saved } : structuredClone(FIB_DEFAULT); } catch { return structuredClone(FIB_DEFAULT); } };
  const saveFib = () => { try { localStorage.setItem('cc-fib', JSON.stringify(fib)); } catch { /* ignore */ } };
  let fib = loadFib();
  // كما في TradingView: المستوى 1 عند النقطة الأولى و0 عند الثانية (والانعكاس يبدّلهما)
  const fibLevels = (a, b, settings = FIB_DEFAULT) => {
    const [p1, p0] = settings.reverse ? [b, a] : [a, b];
    return settings.levels.filter(level => level.on && Number.isFinite(level.value)).sort((x, y) => x.value - y.value)
      .map(level => ({ ratio: level.value, color: level.color, price: p0 + (p1 - p0) * level.value }));
  };
  // أيقونات أزرار العرض: إعادة تعيين العرض، وملء الشاشة والخروج منه
  const svg = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_RESET = svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>');
  const ICON_FULL = svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>');
  const ICON_EXIT = svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>');
  // أيقونات الشريط الجانبي مرسومة من جديد على شبكة TradingView (28×28): خط 1.2 رفيع، ودوائر نقاط الارتكاز مفرغة بنصف قطر 2.5
  const icon = d => `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    cursor: icon('<path d="M14 4.5v7.5M14 16v7.5M4.5 14H12M16 14h7.5"/><circle cx="14" cy="14" r=".9" fill="currentColor"/>'),
    vline: icon('<path d="M14 4v4.5M14 12.5v3M14 19.5V24"/><circle cx="14" cy="10.5" r="2"/><circle cx="14" cy="17.5" r="2"/>'),
    hline: icon('<path d="M4 14h7.5M16.5 14H24"/><circle cx="14" cy="14" r="2.5"/>'),
    hray: icon('<path d="M10 14h14M21 10.5l3.5 3.5-3.5 3.5"/><circle cx="7.5" cy="14" r="2.5"/>'),
    trend: icon('<path d="M9.8 18.2l8.4-8.4"/><circle cx="8" cy="20" r="2.5"/><circle cx="20" cy="8" r="2.5"/>'),
    ray: icon('<path d="M9 19l13-13M16.5 6H22v5.5"/><circle cx="7.5" cy="20.5" r="2.5"/>'),
    ext: icon('<path d="M4 24l5.4-5.4M12.6 15.4l2.8-2.8M18.6 9.4L24 4"/><circle cx="11" cy="17" r="2"/><circle cx="17" cy="11" r="2"/>'),
    arrow: icon('<path d="M6 22L22 6M12 6h10v10"/>'),
    rect: icon('<rect x="5" y="8" width="18" height="12" rx="1.5"/><path d="M5 14h18"/>'),
    fib: icon('<path d="M4 6h15M4 11.5h20M4 17h15M4 22.5h20"/><circle cx="22" cy="6" r="2"/><circle cx="22" cy="17" r="2"/>'),
    range: icon('<path d="M8 4.5h12M8 23.5h12M14 8.5v15M10.5 12L14 8.5l3.5 3.5"/>'),
    text: icon('<path d="M7 7.5h14M14 7.5v14M11 21.5h6"/>'),
    magnet: icon('<path d="M7 4.5h5V14a2 2 0 0 0 4 0V4.5h5V14a7 7 0 0 1-14 0z"/><path d="M7 9h5M16 9h5"/>'),
    ind: icon('<path d="M4 23.5h20"/><path d="M5 18c2.5-7 5-7 7.5-2.5S17.5 20 19.5 12 22.5 5 23.5 4.5"/>'),
    gear: icon('<path d="M14 4l8.7 5v10L14 24l-8.7-5V9z"/><circle cx="14" cy="14" r="3.5"/>'),
    undo: icon('<path d="M10.5 7.5L5.5 12.5l5 5M5.5 12.5H17a5.5 5.5 0 0 1 0 11h-4"/>'),
    redo: icon('<path d="M17.5 7.5l5 5-5 5M22.5 12.5H11a5.5 5.5 0 0 0 0 11h4"/>'),
    lock: icon('<rect x="6.5" y="13" width="15" height="10.5" rx="2"/><path d="M9.5 13V9.5a4.5 4.5 0 0 1 9 0V13"/><circle cx="14" cy="18.2" r="1" fill="currentColor"/>'),
    unlock: icon('<rect x="6.5" y="13" width="15" height="10.5" rx="2"/><path d="M9.5 13V9.5a4.5 4.5 0 0 1 8.7-1.6"/><circle cx="14" cy="18.2" r="1" fill="currentColor"/>'),
    eye: icon('<path d="M3.5 14S7.5 7.5 14 7.5 24.5 14 24.5 14 20.5 20.5 14 20.5 3.5 14 3.5 14z"/><circle cx="14" cy="14" r="3.2"/>'),
    eyeOff: icon('<path d="M3.5 14S7.5 7.5 14 7.5 24.5 14 24.5 14 20.5 20.5 14 20.5 3.5 14 3.5 14z"/><circle cx="14" cy="14" r="3.2"/><path d="M5 23L23 5"/>'),
    trash: icon('<path d="M5.5 8.5h17M11 8.5V5.5h6v3M8 8.5l1.2 15h9.6l1.2-15M12 12.5v7M16 12.5v7"/>')
  };

  const LOCK_TIP = locked => locked ? 'فتح قفل الرسوم' : 'قفل الرسوم (يمنع تحريكها وتعديلها)';
  const HIDE_TIP = hidden => hidden ? 'إظهار الرسوم' : 'إخفاء الرسوم';
  // البحث عن سهم: كل أسهم الموقع من data.json، واختيار سهم يفتح صفحة نتائجه (صفحة قطاعه ?symbol=)
  const SECTOR_PAGES = {
    'البنوك': 'banks.html', 'التعدين والمعادن': 'mining.html', 'الاتصالات': 'telecom.html', 'المرافق والطاقة': 'utilities.html',
    'خدمات الرعاية الصحية': 'healthservices.html', 'المواد الاساسية': 'materials.html', 'البتروكيماويات': 'petrochem.html',
    'النفط و الغاز': 'oilgas.html', 'الاسمنت': 'cement.html', 'تجارة و تجزئة': 'retail.html', 'الأغذية والمشروبات': 'food.html',
    'الزراعة': 'agriculture.html', 'متعددة الأنشطة': 'multi.html', 'الصناعات التحويلية': 'industrial.html', 'العقارات': 'realestate.html',
    'النقل': 'transport.html', 'وسائل الاعلام': 'media.html', 'الفنادق و السياحة': 'hotels-tourism.html',
    'تقنية المعلومات': 'information-technology.html', 'خدمات الاعمال': 'business-services.html', 'التعليم و التدريب': 'education.html',
    'المراكز الرياضية': 'sports.html', 'موردي الادوية': 'pharma.html', 'الرعاية الصحية': 'health.html', 'المنتجات الزجاجية': 'glass.html',
    'السلع الاستهلاكية': 'consumer.html', 'أسواق الاوراق المالية': 'exchange.html', 'الخدمات المالية': 'financial-services.html',
    'التأمين': 'insurance.html', 'التمويل': 'finance.html', 'الصناديق العقارية المتداولة': 'reits.html'
  };
  // تطبيع البحث العربي كما في الصفحة الرئيسية: بلا تشكيل، والهمزات ألف، والتاء المربوطة هاء، والألف المقصورة ياء
  const norm = value => String(value ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase().trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // مؤشر السوق السعودي في بحث الشارت كأنه سهم: رمزه TASI وشموعه في ohlc/TASI.json وشعاره في logos/TASI.svg
  const INDEX_ENTRY = { symbol: 'TASI', name: 'مؤشر السوق السعودي (تاسي)', sector: 'المؤشر', page: null };
  let stockListPromise = null;
  const loadStockList = () => stockListPromise ??= fetch('data.json').then(r => r.json())
    .then(d => [INDEX_ENTRY, ...d.sectors.flatMap(sector => SECTOR_PAGES[sector.name] ? sector.stocks.map(x => ({ symbol: String(x.symbol), name: x.name, sector: sector.name, page: SECTOR_PAGES[sector.name] })) : [])])
    .catch(() => { stockListPromise = null; return []; });
  // الرمز المطابق أولًا، ثم ما يبدأ به الرمز، ثم ما يبدأ به الاسم
  // الرمز يُقارن بحروف صغيرة لأن الاستعلام مُطبَّع هكذا (رمز المؤشر TASI حروف لا أرقام)
  const symbolOf = x => x.symbol.toLowerCase();
  const searchRank = (x, q) => symbolOf(x) === q ? 0 : symbolOf(x).startsWith(q) ? 1 : norm(x.name).startsWith(q) ? 2 : 3;
  function searchStocks(list, query) {
    const q = norm(query);
    if (!q) return list;
    return list.filter(x => symbolOf(x).includes(q) || norm(x.name).includes(q)).sort((a, b) => searchRank(a, q) - searchRank(b, q));
  }
  const ICON_SEARCH = svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>');
  const RESET_KEY = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '') ? '⌥ + R' : 'Alt + R';
  const bigJumps = file => (file.flags || []).filter(f => Math.abs(f.change) >= 15);

  const state = { adj: true, divMarks: true, type: 'candles', interval: 'd', range: '1y', ind: new Set(['vol', 'sma50']), tool: null, magnet: 'off', locked: false, hidden: false };
  try { const saved = JSON.parse(localStorage.getItem('cc-settings') || 'null'); if (saved) { if (typeof saved.adj === 'boolean') state.adj = saved.adj; if (typeof saved.divMarks === 'boolean') state.divMarks = saved.divMarks; if (saved.type) state.type = saved.type; if (Array.isArray(saved.ind)) state.ind = new Set(saved.ind); if (MAGNETS.some(([id]) => id === saved.magnet)) state.magnet = saved.magnet; state.locked = saved.locked === true; state.hidden = saved.hidden === true; } } catch { /* storage unavailable */ }
  const saveSettings = () => { try { localStorage.setItem('cc-settings', JSON.stringify({ adj: state.adj, divMarks: state.divMarks, type: state.type, ind: [...state.ind], magnet: state.magnet, locked: state.locked, hidden: state.hidden })); } catch { /* ignore */ } };
  const loadDrawings = symbol => { try { return JSON.parse(localStorage.getItem(`cc-draw-${symbol}`) || '[]'); } catch { return []; } };
  const saveDrawings = (symbol, list) => { try { localStorage.setItem(`cc-draw-${symbol}`, JSON.stringify(list)); } catch { /* ignore */ } };

  let libPromise = null, current = null;
  const loadLib = () => libPromise ??= new Promise((resolve, reject) => {
    if (window.LightweightCharts) return resolve(window.LightweightCharts);
    const s = document.createElement('script'); s.src = LIB; s.async = true;
    s.onload = () => resolve(window.LightweightCharts); s.onerror = () => { libPromise = null; reject(new Error('chart library unavailable')); };
    document.head.append(s);
  });

  /* ---------- البيانات ---------- */
  const bars = file => file.d.map((d, i) => ({ time: d, open: file.o[i], high: file.h[i], low: file.l[i], close: file.c[i], volume: file.v[i] }));
  const weekStart = iso => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
  // تعديل التوزيعات النقدية كما في TradingView (ADJ): كل سعر قبل تاريخ الاستحقاق يُضرب في
  // (1 − التوزيع ÷ إغلاق الجلسة السابقة له). الحجم لا يتغير.
  function adjustDividends(daily, dividends = []) {
    const factor = new Array(daily.length).fill(1);
    for (const [date, amount] of dividends) {
      const i = daily.findIndex(b => b.time >= date);
      if (i <= 0 || !(amount > 0) || !(daily[i - 1].close > amount)) continue;
      const f = 1 - amount / daily[i - 1].close;
      for (let j = 0; j < i; j++) factor[j] *= f;
    }
    return daily.map((b, i) => factor[i] === 1 ? b : { ...b, open: b.open * factor[i], high: b.high * factor[i], low: b.low * factor[i], close: b.close * factor[i] });
  }
  function group(daily, interval) {
    if (interval === 'd') return daily;
    const key = interval === 'w' ? b => weekStart(b.time) : b => b.time.slice(0, 7);
    const out = [];
    for (const b of daily) {
      const last = out.at(-1);
      if (last && last.key === key(b)) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume; last.end = b.time; }
      else out.push({ key: key(b), time: b.time, end: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    }
    return out;
  }
  // تواريخ بعد آخر شمعة (للرسم في المستقبل كما في TradingView): جلسات تداول الأحد – الخميس في اليومي،
  // وأسابيع في الأسبوعي، وأشهر في الشهري. لا تُحسب العطل الرسمية المقبلة.
  const isTradingDay = d => d.getUTCDay() !== 5 && d.getUTCDay() !== 6;
  function addPeriods(iso, n, interval) {
    const d = new Date(`${iso}T12:00:00Z`);
    if (interval === 'w') d.setUTCDate(d.getUTCDate() + 7 * n);
    else if (interval === 'm') d.setUTCMonth(d.getUTCMonth() + n);
    else for (let left = n; left > 0;) { d.setUTCDate(d.getUTCDate() + 1); if (isTradingDay(d)) left -= 1; }
    return d.toISOString().slice(0, 10);
  }
  function periodsBetween(fromIso, toIso, interval) {
    const from = new Date(`${fromIso}T12:00:00Z`), to = new Date(`${toIso}T12:00:00Z`);
    if (to <= from) return 0;
    if (interval === 'w') return Math.round((to - from) / (7 * 864e5));
    if (interval === 'm') return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
    let count = 0; for (const d = new Date(from); d < to;) { d.setUTCDate(d.getUTCDate() + 1); if (isTradingDay(d)) count += 1; }
    return count;
  }
  const fromDate = (lastIso, months) => { const d = new Date(`${lastIso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };

  /* ---------- المؤشرات (القيمة null حتى تكتمل الفترة) ---------- */
  // يتخطى القيم الفارغة في أول السلسلة (مثل خط الماكد قبل اكتماله)
  function sma(values, n) {
    const out = []; let sum = 0, run = 0;
    values.forEach((v, i) => {
      if (v == null) { sum = 0; run = 0; out.push(null); return; }
      sum += v; run += 1;
      if (run > n) { sum -= values[i - n]; run = n; }
      out.push(run === n ? sum / n : null);
    });
    return out;
  }
  function ema(values, n) {
    // تبدأ بمتوسط بسيط لأول n قيمة كاملة، كما في TradingView
    const k = 2 / (n + 1), out = []; let prev = null, run = [];
    for (const v of values) {
      if (v == null) { out.push(null); run = []; continue; }
      if (prev == null) { run.push(v); if (run.length === n) prev = run.reduce((a, b) => a + b, 0) / n; out.push(prev); continue; }
      prev = v * k + prev * (1 - k); out.push(prev);
    }
    return out;
  }
  function bollinger(values, n = 20, mult = 2) { const mid = sma(values, n); return values.map((_, i) => { if (mid[i] == null) return null; const w = values.slice(i - n + 1, i + 1), sd = Math.sqrt(w.reduce((a, v) => a + (v - mid[i]) ** 2, 0) / n); return { mid: mid[i], up: mid[i] + mult * sd, low: mid[i] - mult * sd }; }); }
  function rsi(values, n = 14) { // تنعيم وايلدر كما في TradingView
    const out = [null]; let gain = 0, loss = 0;
    for (let i = 1; i < values.length; i++) {
      const ch = values[i] - values[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)); } else out.push(null); }
      else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)); }
    }
    return out;
  }
  const maOf = (values, n, type) => type === 'SMA' ? sma(values, n) : ema(values, n);
  function macd(values, fastLen = 12, slowLen = 26, signalLen = 9, oscType = 'EMA', signalType = 'EMA') {
    const fast = maOf(values, fastLen, oscType), slow = maOf(values, slowLen, oscType);
    const line = values.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null), signal = maOf(line, signalLen, signalType);
    return line.map((m, i) => m == null ? null : { macd: m, signal: signal[i], hist: signal[i] == null ? null : m - signal[i] });
  }
  // ألوان المدرج كما في TradingView: 0 فوق الصفر ويزيد، 1 فوق الصفر ويتراجع، 2 تحت الصفر ويرتفع، 3 تحت الصفر ويهبط
  const histColorIndex = (v, prev) => v >= 0 ? (prev == null || v >= prev ? 0 : 1) : (prev == null || v >= prev ? 2 : 3);

  /* ---------- الألوان من متغيرات الصفحة ---------- */
  function palette(el) {
    const css = getComputedStyle(el), v = name => css.getPropertyValue(name).trim();
    return { ink: v('--pf-ink') || '#eef2f5', muted: v('--pf-muted') || '#9da7b2', line: v('--pf-line') || '#27313b', up: v('--cq-up') || '#22c55e', down: v('--cq-down') || '#f05252', gold: v('--pf-gold') || '#f59e0b', bg: v('--pf-bg2') || '#11161c' };
  }
  // زر في الشريط الجانبي: أيقونة فقط، واسمه في تلميح يظهر بجانبه
  const side = (attrs, svgIcon, tip, pressed) => `<button type="button" ${attrs} aria-label="${tip}" data-tip="${tip}"${pressed == null ? '' : ` aria-pressed="${pressed}"`}>${svgIcon}</button>`;
  const chip = (attr, id, label, on, title = '') => `<button type="button" data-${attr}="${id}" aria-pressed="${on}"${title ? ` title="${title}"` : ''}>${label}</button>`;

  // شموع الأسهم التي فُتحت من بحث الشارت (الملفات تتغير يوميًا، فلا تُؤخذ من ذاكرة المتصفح)
  // لكل سهم ملفان: ohlc/<الرمز>.json للجلسات الأخيرة (يتحدث يوميًا)، وohlc/history/<الرمز>.json لما قبلها منذ 2010
  function joinCandles(recent, history) {
    if (!history?.d?.length || !recent.historyThrough) return recent;
    const keep = history.d.map((d, i) => i).filter(i => history.d[i] < recent.d[0]);
    const full = { ...recent, est: [...(history.est || []), ...(recent.est || [])], flags: [...(history.flags || []), ...(recent.flags || [])] };
    for (const key of ['d', 'o', 'h', 'l', 'c', 'v']) full[key] = [...keep.map(i => history[key][i]), ...recent[key]];
    return full;
  }
  const getJson = url => fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const candleFiles = new Map();
  const loadCandleFile = sym => {
    if (!candleFiles.has(sym)) candleFiles.set(sym, getJson(`ohlc/${encodeURIComponent(sym)}.json`)
      .then(async recent => recent?.historyThrough ? joinCandles(recent, await getJson(`ohlc/history/${encodeURIComponent(sym)}.json`)) : recent)
      .then(d => d?.d?.length > 1 ? d : null)
      .then(d => { if (!d) candleFiles.delete(sym); return d; }));
    return candleFiles.get(sym);
  };

  // home: سهم الصفحة. اختيار سهم آخر من البحث يغيّر الشارت وحده دون إعادة تحميل الصفحة، كما في TradingView
  // away: اسم السهم المعروض وصفحة قطاعه حين يختلف عن سهم الصفحة
  // levels: [{price, title, color}] — خطوط سعر مرجعية (دخول/وقف/أهداف) من الماسح؛ لا تُحفظ ولا تُعدَّل كرسومات المستخدم
  function mount(panel, file, { home = null, away = {}, keepFull = false, levels = [] } = {}) {
    current?.destroy({ keepFull });
    home ??= { symbol: String(file.symbol), file };
    const raw = bars(file), symbol = file.symbol, estimated = new Set(file.est || []), dividends = (file.div || []).filter(([d]) => d > raw[0]?.time && d <= raw.at(-1)?.time);
    let daily = state.adj ? adjustDividends(raw, dividends) : raw;
    let drawings = loadDrawings(symbol), pending = null;
    panel.innerHTML = `
      <div class="cc-toolbar">
        <div class="cc-search">
          <button type="button" class="cc-search-btn" data-search aria-haspopup="listbox" aria-expanded="false" title="البحث عن سهم">${ICON_SEARCH}<b>${esc(symbol)}</b><span class="cc-search-name"></span></button>
          <div class="cc-search-pop" hidden>
            <input type="search" placeholder="ابحث باسم الشركة أو الرمز" aria-label="ابحث عن سهم باسم الشركة أو الرمز" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cc-search-list-${esc(symbol)}">
            <ul class="cc-search-list" id="cc-search-list-${esc(symbol)}" role="listbox" aria-label="الأسهم"></ul>
          </div>
        </div>
        <div class="cc-groups">
          <div class="cq-range cc-typegroup" role="group" aria-label="نوع الشارت">${TYPES.map(([id, t]) => `<button type="button" data-type="${id}" aria-pressed="${id === state.type}" aria-label="${t}" title="${t}">${TYPE_ICONS[id]}</button>`).join('')}</div>
          <div class="cq-range" role="group" aria-label="الفترة الزمنية للشمعة">${INTERVALS.map(([id, t]) => chip('interval', id, t, id === state.interval)).join('')}</div>
          ${dividends.length ? `<div class="cq-range" role="group" aria-label="التوزيعات">${chip('adj', '1', 'ADJ', state.adj, 'تعديل الأسعار للتوزيعات النقدية، كما في زر ADJ في TradingView')}${chip('divmarks', '1', 'علامات D', state.divMarks, 'إظهار علامة D على شمعة استحقاق كل توزيع نقدي أو إخفاؤها')}</div>` : ''}
        </div>
        <div class="cc-end">
          <span class="cq-range-change cc-change"></span>
          <button type="button" class="cc-full-btn" data-full aria-pressed="false" title="تكبير الرسم البياني ليملأ الشاشة">${ICON_FULL}<span>ملء الشاشة</span></button>
        </div>
      </div>
      <div class="cc-fib-settings" hidden></div>
      <div class="cc-body" dir="ltr">
        <div class="cc-side" role="toolbar" aria-orientation="vertical" aria-label="أدوات الرسم والمؤشرات">
          ${side('data-cursor', ICONS.cursor, 'المؤشر (بدون أداة رسم)', !state.tool)}
          ${TOOLS.map(([id, t]) => side(`data-tool="${id}"`, ICONS[id], t, state.tool === id)).join('')}
          <hr>
          ${side('data-menu="magnet" aria-haspopup="true" aria-expanded="false"', ICONS.magnet, 'المغناطيس', state.magnet !== 'off')}
          ${side('data-menu="ind" aria-haspopup="true" aria-expanded="false"', ICONS.ind, 'المؤشرات الفنية')}
          ${side('data-fibset aria-expanded="false"', ICONS.gear, 'إعدادات فيبوناتشي')}
          <hr>
          ${side('data-undo', ICONS.undo, 'تراجع (Ctrl+Z)')}
          ${side('data-redo', ICONS.redo, 'إعادة (Ctrl+Shift+Z)')}
          ${side('data-lock', state.locked ? ICONS.lock : ICONS.unlock, LOCK_TIP(state.locked), state.locked)}
          ${side('data-hide', state.hidden ? ICONS.eyeOff : ICONS.eye, HIDE_TIP(state.hidden), state.hidden)}
          <hr>
          ${side('data-menu="trash" aria-haspopup="true" aria-expanded="false"', ICONS.trash, 'حذف الرسوم')}
        </div>
        <div class="cc-main" dir="rtl">
          <div class="cc-legend" aria-live="polite"></div>
          <div class="cc-head" dir="ltr"><img class="cc-head-logo" src="logos/${esc(symbol)}.svg" alt="" width="24" height="24" onerror="this.remove()"><b class="cc-head-sym">${esc(symbol)}</b><span class="cc-head-int">${INTERVALS.find(([id]) => id === state.interval)?.[1] ?? ''}</span></div>
          <div class="cc-stage">
            <div class="cc-chart" dir="ltr"><p class="cq-empty">جار تحميل الشارت…</p></div><div class="cc-ftb" role="toolbar" aria-label="خيارات الرسم المحدد" hidden><input type="color" data-ftb="color" aria-label="لون الرسم" title="لون الرسم"><select data-ftb="width" aria-label="السماكة" title="السماكة">${[1, 2, 3, 4].map(w => `<option value="${w}">${w}px</option>`).join('')}</select><select data-ftb="line" aria-label="نمط الخط" title="نمط الخط">${LINE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><span class="cc-ftb-sep"></span><button type="button" data-ftb="lock" aria-pressed="false" aria-label="قفل الرسم" title="قفل الرسم">${ICONS.unlock}</button><button type="button" data-ftb="hide" aria-label="إخفاء الرسم" title="إخفاء الرسم">${ICONS.eye}</button><button type="button" data-ftb="settings" aria-label="إعدادات الرسم" title="إعدادات الرسم">${ICONS.gear}</button><button type="button" data-ftb="delete" aria-label="حذف الرسم" title="حذف الرسم (Delete)">${ICONS.trash}</button></div>
            <div class="cc-ilegend" dir="ltr"></div>
            <div class="cc-float"><button type="button" data-reset title="إعادة تعيين عرض الرسم البياني (${RESET_KEY})" aria-label="إعادة تعيين عرض الرسم البياني">${ICON_RESET}</button></div>
          </div>
        </div>
        <div class="cc-flyout" dir="rtl" role="menu" hidden></div>
        <div class="cc-tip" dir="rtl" role="tooltip" hidden></div>
      </div>
      <div class="cc-bottom" role="group" aria-label="مدة العرض">${RANGES.map(([id, t]) => chip('crange', id, t, id === state.range)).join('')}<span class="cc-clock" dir="ltr" aria-label="توقيت السعودية"></span></div>
      <p class="cc-hint" hidden></p>
      <div class="cc-dlg" hidden></div><div class="cc-dlg cc-ddlg" hidden></div>
      ${bigJumps(file).length ? `<p class="cq-source"><span class="cc-flag-note">▼ علامة على الشارت: قفزة تتجاوز 15% في جلسة واحدة، غالبًا إجراء على رأس المال.</span></p>` : ''}`;
    const box = panel.querySelector('.cc-chart'), legend = panel.querySelector('.cc-legend'), changeEl = panel.querySelector('.cc-change'), hint = panel.querySelector('.cc-hint'), fibPanel = panel.querySelector('.cc-fib-settings');
    const searchBtn = panel.querySelector('[data-search]'), searchPop = panel.querySelector('.cc-search-pop'), searchInput = searchPop.querySelector('input'), searchList = searchPop.querySelector('ul');
    const body = panel.querySelector('.cc-body'), sideBar = panel.querySelector('.cc-side'), flyout = panel.querySelector('.cc-flyout'), tip = panel.querySelector('.cc-tip');
    // ساعة بتوقيت السعودية في الشريط السفلي كما في TradingView (UTC+3)
    const clock = panel.querySelector('.cc-clock');
    if (clock) {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const tick = () => { if (!clock.isConnected) return clearInterval(timer); clock.textContent = `UTC+3  ${fmt.format(new Date())}`; };
      const timer = setInterval(tick, 1000);
      tick();
    }
    const ilegend = panel.querySelector('.cc-ilegend'), stage = panel.querySelector('.cc-stage'), dlg = panel.querySelector('.cc-dlg');
    let chart = null, LWC = null, colors = null, data = [], main = null, calc = {}, drawn = [], preview = null;
    // المؤشرات على الشارت: المؤشر المحدد، ولوحة كل مؤشر، وخطوطه (لتحديده بالضغط عليه)
    let selInd = null, paneIds = [null], indLines = [], selPrims = [];
    // تحرير الرسوم: الرسمة المحددة، والسحب الجاري، ونقطة المغناطيس تحت المؤشر قبل الضغطة الأولى
    let selected = -1, drag = null, hover = null;

    function visibleChange() {
      const range = chart?.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const inView = data.slice(Math.max(0, Math.ceil(range.from)), Math.min(data.length, Math.floor(range.to) + 1));
      if (inView.length < 2) { changeEl.textContent = ''; return; }
      const ch = (inView.at(-1).close / inView[0].close - 1) * 100, dir = ch > 0 ? 'up' : ch < 0 ? 'down' : 'flat';
      changeEl.innerHTML = `<span class="cq-${dir}"><bdi>${ch > 0 ? '+' : ''}${f2.format(ch)}%</bdi></span> من <bdi>${dot(inView[0].time)}</bdi> إلى <bdi>${dot(inView.at(-1).end ?? inView.at(-1).time)}</bdi>`;
    }
    function showLegend(time) {
      const i = time == null ? data.length - 1 : data.findIndex(b => b.time === time);
      const b = data[i]; if (!b) return;
      const prev = data[i - 1], ch = prev ? (b.close / prev.close - 1) * 100 : null, dir = ch > 0 ? 'up' : ch < 0 ? 'down' : 'flat';
      const when = state.interval === 'd' ? longDate(b.time) : state.interval === 'w' ? `أسبوع ${longDate(b.time)} – ${longDate(b.end)}` : `${MONTHS[Number(b.time.slice(5, 7)) - 1]} ${b.time.slice(0, 4)}`;
      const cell = (k, v) => `<span>${k} <bdi>${v}</bdi></span>`;
      showIndValues(i);
      // جلسة لم تصل شمعتها من المصدر: الإغلاق رسمي، والافتتاح والأعلى والأدنى والحجم تقديرية
      const estNote = state.interval === 'd' && estimated.has(b.time) ? '<span class="cc-est">تقديرية</span>' : '';
      // التوزيع المستحق في هذه الجلسة يظهر في السطر نفسه (العلامة على الشارت حرف D فقط كما في TradingView)
      const paid = state.interval === 'd' ? dividends.find(([d]) => d === b.time || (d > (data[i - 1]?.time ?? '') && d <= b.time)) : null;
      const divNote = paid ? `<span class="cc-est">توزيع ${f2.format(paid[1])} ريال</span>` : '';
      legend.innerHTML = `<b>${when}</b>${estNote}${divNote}${cell('افتتاح', f2.format(b.open))}${cell('أعلى', f2.format(b.high))}${cell('أدنى', f2.format(b.low))}${cell('إغلاق', f2.format(b.close))}${ch == null ? '' : `<span class="cq-${dir}"><bdi>${ch > 0 ? '+' : ''}${f2.format(ch)}%</bdi></span>`}`;
    }

    /* ---------- سطر حالة كل مؤشر على الشارت، كما في TradingView: الاسم والمدخلات والقيم، وأزرار الإخفاء والإعدادات والحذف ---------- */
    const plotColor = (id, key) => indCfg[id].plots[key].color ?? (id === 'vol' ? colors[key] : colors.muted);
    const shownInd = id => state.ind.has(id) && indCfg[id].vis[state.interval];
    function renderIndRows() {
      const ids = INDICATORS.map(x => x.id).filter(shownInd);
      const groups = [['vol', 'sma20', 'sma50', 'sma200', 'ema20', 'bb'].filter(id => ids.includes(id)), ...paneIds.slice(1).map(id => [id])];
      const row = id => {
        const s = indCfg[id], params = s.statusInputs ? indParams(id).join(' ') : '';
        return `<div class="cc-irow${s.hidden ? ' cc-off' : ''}${selInd === id ? ' cc-sel' : ''}" data-irow="${id}">
          <button type="button" class="cc-iname" data-ipick="${id}" title="${esc(indTitle(id))}">${IND_NAME[id]}${params ? ` <span>${esc(params)}</span>` : ''}</button>
          <span class="cc-ivals"></span>
          <span class="cc-ibtns">
            <button type="button" data-ieye="${id}" title="${s.hidden ? 'إظهار' : 'إخفاء'}" aria-label="${s.hidden ? 'إظهار' : 'إخفاء'} ${esc(indTitle(id))}">${s.hidden ? ICONS.eyeOff : ICONS.eye}</button>
            <button type="button" data-iset="${id}" title="الإعدادات" aria-label="إعدادات ${esc(indTitle(id))}">${ICONS.gear}</button>
            <button type="button" data-idel="${id}" title="حذف" aria-label="حذف ${esc(indTitle(id))}">${ICONS.trash}</button>
          </span>
        </div>`;
      };
      ilegend.innerHTML = groups.map((list, pane) => list.length ? `<div class="cc-igroup" data-pane="${pane}">${list.map(row).join('')}</div>` : '').join('');
      rowsKey = '';
      positionIndRows();
    }
    // كل مجموعة أعلى لوحتها: لوحة السعر، ثم لوحة كل مؤشر
    let rowsKey = '';
    function positionIndRows() {
      if (!chart) return;
      // يُستدعى مع كل رسم للشارت، فلا يعيد الحساب إلا إن تغيرت أحجام اللوحات
      const key = `${chart.panes().map(p => p.getHeight()).join(',')}|${ilegend.childElementCount}`;
      if (key === rowsKey) return;
      rowsKey = key;
      const top0 = stage.getBoundingClientRect().top;
      let fallback = 0;
      chart.panes().forEach((p, i) => {
        const el = p.getHTMLElement?.(), top = el ? el.getBoundingClientRect().top - top0 : fallback;
        fallback += p.getHeight() + 1;
        const g = ilegend.querySelector(`[data-pane="${i}"]`);
        if (g) g.style.top = `${Math.round(top) + 4}px`;
      });
    }
    function showIndValues(i) {
      const b = data[i];
      for (const r of ilegend.querySelectorAll('[data-irow]')) {
        const id = r.dataset.irow, s = indCfg[id], out = r.querySelector('.cc-ivals');
        if (!s.statusValues || s.hidden || !b) { out.innerHTML = ''; continue; }
        const val = (v, color) => v == null ? '' : `<bdi style="color:${color}">${f2.format(v)}</bdi>`;
        const v = calc[id]?.[i];
        if (id === 'vol') out.innerHTML = `<bdi style="color:${plotColor('vol', b.close >= b.open ? 'up' : 'down')}">${big.format(b.volume)}</bdi>`;
        else if (id === 'bb') out.innerHTML = v ? `${val(v.mid, plotColor(id, 'basis'))}${val(v.up, plotColor(id, 'upper'))}${val(v.low, plotColor(id, 'lower'))}` : '';
        else if (id === 'macd') {
          const prev = calc.macd[i - 1]?.hist, hist = v?.hist;
          out.innerHTML = v ? `${hist == null ? '' : val(hist, s.plots.hist.colors[histColorIndex(hist, prev)])}${val(v.macd, plotColor(id, 'macd'))}${val(v.signal, plotColor(id, 'signal'))}` : '';
        } else out.innerHTML = val(v, plotColor(id, id === 'rsi' ? 'rsi' : 'ma'));
      }
    }
    function selectInd(id) {
      selInd = id;
      ilegend.querySelectorAll('[data-irow]').forEach(r => r.classList.toggle('cc-sel', r.dataset.irow === id));
      for (const p of selPrims) p.request?.();
      if (id && selected >= 0) select(-1);
    }
    function removeInd(id) {
      state.ind.delete(id);
      if (selInd === id) selInd = null;
      panel.querySelectorAll(`[data-ind="${id}"]`).forEach(x => x.setAttribute('aria-pressed', 'false'));
      saveSettings(); build(true);
    }
    // أي مؤشر تحت الضغطة: لوحة المؤشر كلها له، وفي لوحة السعر الخط القريب من المؤشر (6px)
    function indAt(x, y) {
      if (!chart) return null;
      const panes = chart.panes();
      let top = 0, pane = -1;
      for (let i = 0; i < panes.length; i++) { const h = panes[i].getHeight(); if (y >= top && y < top + h) { pane = i; break; } top += h + 1; }
      if (pane > 0) return paneIds[pane] ?? null;
      if (pane < 0) return null;
      const logical = Math.round(chart.timeScale().coordinateToLogical(x) ?? -1);
      for (const { id, series, values } of indLines) {
        const v = values[logical]; if (v == null) continue;
        const py = series.priceToCoordinate(v);
        if (py != null && Math.abs(py - y) <= 6) return id;
      }
      return null;
    }
    // دوائر على خطوط المؤشر المحدد كما في TradingView
    function selectionMarks(id, values, color) {
      const p = {
        series: null, request: null,
        attached({ requestUpdate }) { this.request = requestUpdate; }, detached() { this.request = null; }, updateAllViews() {},
        paneViews() {
          return [{ zOrder: () => 'top', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(({ context }) => {
            if (selInd !== id || !chart || !p.series) return;
            const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if (!r) return;
            const from = Math.max(0, Math.ceil(r.from)), to = Math.min(values.length - 1, Math.floor(r.to)), step = Math.max(1, Math.round((to - from) / 7));
            for (let i = to; i >= from; i -= step) {
              const v = values[i]; if (v == null) continue;
              const x = ts.logicalToCoordinate(i), y = p.series.priceToCoordinate(v); if (x == null || y == null) continue;
              context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fillStyle = colors.bg; context.fill(); context.lineWidth = 1.5; context.strokeStyle = color; context.stroke();
            }
          }) }) }];
        }
      };
      selPrims.push(p);
      return p;
    }
    ilegend.addEventListener('click', event => {
      const b = event.target.closest('[data-ipick],[data-ieye],[data-iset],[data-idel]'); if (!b || !chart) return;
      if (b.dataset.ipick) { selectInd(selInd === b.dataset.ipick ? null : b.dataset.ipick); return; }
      if (b.dataset.ieye) { const s = indCfg[b.dataset.ieye]; s.hidden = !s.hidden; saveInd(); build(true); return; }
      if (b.dataset.iset) { openIndSettings(b.dataset.iset); return; }
      if (b.dataset.idel) removeInd(b.dataset.idel);
    });

    /* ---------- نافذة إعدادات المؤشر: مدخلات، نمط، الظهور ---------- */
    let dlgState = null, dlgFrame = 0;
    const toHex = color => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000000'; c.fillStyle = color; return /^#[0-9a-f]{6}$/i.test(c.fillStyle) ? c.fillStyle : '#888888'; };
    const PLOT_LABELS = { ma: 'المتوسط', basis: 'الأساس', upper: 'الحد العلوي', lower: 'الحد السفلي', up: 'شمعة صاعدة', down: 'شمعة هابطة', rsi: 'RSI', hist: 'المدرج التكراري', macd: 'الماكد', signal: 'خط الإشارة', zero: 'خط الصفر' };
    const HIST_LABELS = ['فوق الصفر ويزيد', 'فوق الصفر ويتراجع', 'تحت الصفر ويرتفع', 'تحت الصفر ويهبط'];
    const INPUT_FIELDS = {
      ma: [['length', 'الطول', 'int'], ['source', 'المصدر', SOURCES]],
      bb: [['length', 'الطول', 'int'], ['source', 'المصدر', SOURCES], ['mult', 'الانحراف المعياري', 'num']],
      rsi: [['length', 'طول RSI', 'int'], ['source', 'المصدر', SOURCES], ['upper', 'الحد العلوي', 'num'], ['lower', 'الحد السفلي', 'num']],
      macd: [['source', 'المصدر', SOURCES], ['fast', 'طول الخط السريع', 'int'], ['slow', 'طول الخط البطيء', 'int'], ['signal', 'طول خط الإشارة', 'int'], ['osc', 'نوع متوسط المذبذب', [['EMA', 'EMA'], ['SMA', 'SMA']]], ['sig', 'نوع متوسط الإشارة', [['EMA', 'EMA'], ['SMA', 'SMA']]]],
      vol: []
    };
    const fieldsOf = id => INPUT_FIELDS[id] ?? INPUT_FIELDS.ma;
    function renderIndSettings() {
      const { id, tab } = dlgState, s = indCfg[id];
      const check = (attr, on, label) => `<label class="cc-dlg-check"><input type="checkbox" ${attr}${on ? ' checked' : ''}><span>${label}</span></label>`;
      const color = (attr, value) => `<input type="color" ${attr} value="${toHex(value)}" aria-label="اللون">`;
      const widthSel = key => `<select data-dw="${key}" aria-label="السماكة">${[1, 1.5, 2, 3, 4].map(w => `<option value="${w}"${s.plots[key].width === w ? ' selected' : ''}>${w}px</option>`).join('')}</select>`;
      let content = '';
      if (tab === 'inputs') {
        const fields = fieldsOf(id);
        content = fields.length ? fields.map(([key, label, kind]) => `<label class="cc-dlg-row"><span>${label}</span>${Array.isArray(kind)
          ? `<select data-din="${key}">${kind.map(([v, t]) => `<option value="${v}"${s.inputs[key] === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`
          : `<input type="number" data-din="${key}" value="${s.inputs[key]}" ${kind === 'int' ? 'min="1" max="1000" step="1"' : key === 'mult' ? 'min="0.1" max="10" step="0.1"' : 'min="0" max="100" step="1"'} dir="ltr">`}</label>`).join('')
          : '<p class="cc-dlg-note">لا توجد مدخلات لهذا المؤشر.</p>';
      } else if (tab === 'style') {
        content = Object.entries(s.plots).map(([key, p]) => key === 'hist'
          ? `<div class="cc-dlg-plot">${check(`data-don="hist"`, p.on, PLOT_LABELS.hist)}</div>${p.colors.map((c, k) => `<div class="cc-dlg-plot cc-dlg-sub"><span>لون ${k} <small>${HIST_LABELS[k]}</small></span>${color(`data-dhc="${k}"`, c)}</div>`).join('')}`
          : `<div class="cc-dlg-plot">${check(`data-don="${key}"`, p.on, PLOT_LABELS[key])}${color(`data-dc="${key}"`, plotColor(id, key))}${id === 'vol' ? '' : widthSel(key)}</div>`).join('')
          + `<h4>قيم الإخراج</h4>${check('data-dopt="scaleLabels"', s.scaleLabels, 'الملصقات على مقياس السعر')}${check('data-dopt="statusValues"', s.statusValues, 'القيم في سطر الحالة')}`
          + `<h4>قيم الإدخال</h4>${check('data-dopt="statusInputs"', s.statusInputs, 'المدخلات في سطر الحالة')}`;
      } else {
        content = `<p class="cc-dlg-note">يظهر المؤشر على فترات الشموع المحددة فقط.</p>${INTERVALS.map(([k]) => check(`data-dvis="${k}"`, s.vis[k], { d: 'الأيام (يومي)', w: 'الأسابيع (أسبوعي)', m: 'الشهور (شهري)' }[k])).join('')}`;
      }
      const tabBtn = (k, t) => `<button type="button" role="tab" data-dtab="${k}" aria-selected="${tab === k}">${t}</button>`;
      dlg.innerHTML = `<div class="cc-dlg-box" role="dialog" aria-modal="true" aria-label="إعدادات ${esc(indTitle(id))}" dir="rtl">
        <div class="cc-dlg-head"><b>${IND_NAME[id]}</b><small>${esc(indTitle(id))}</small><button type="button" data-dclose aria-label="إغلاق">✕</button></div>
        <div class="cc-dlg-tabs" role="tablist">${tabBtn('inputs', 'مدخلات')}${tabBtn('style', 'نمط')}${tabBtn('vis', 'الظهور')}</div>
        <div class="cc-dlg-body">${content}</div>
        <div class="cc-dlg-foot"><button type="button" data-dreset>الإعدادات الافتراضية</button><button type="button" data-dcancel>إلغاء</button><button type="button" data-dok class="cc-dlg-ok">موافق</button></div>
      </div>`;
    }
    function openIndSettings(id) {
      closeFlyout();
      dlgState = { id, tab: 'inputs', backup: structuredClone(indCfg[id]) };
      renderIndSettings(); dlg.hidden = false;
      dlg.querySelector('[data-dtab="inputs"]')?.focus();
    }
    function closeIndSettings(keep) {
      if (!dlgState) return;
      cancelAnimationFrame(dlgFrame);
      if (keep) saveInd(); else indCfg[dlgState.id] = dlgState.backup;
      build(true);
      dlgState = null; dlg.hidden = true; dlg.innerHTML = '';
    }
    // معاينة فورية: يُعاد رسم الشارت مع كل تعديل، ويُحفظ عند «موافق» فقط
    const previewInd = () => { cancelAnimationFrame(dlgFrame); dlgFrame = requestAnimationFrame(() => build(true)); };
    dlg.addEventListener('input', event => {
      if (!dlgState) return;
      const t = event.target, s = indCfg[dlgState.id];
      if (t.dataset.din) {
        const key = t.dataset.din, kind = fieldsOf(dlgState.id).find(f => f[0] === key)?.[2];
        if (Array.isArray(kind)) s.inputs[key] = t.value;
        else { const v = kind === 'int' ? Math.round(Number(t.value)) : Number(t.value); if (!Number.isFinite(v) || t.value === '' || v < Number(t.min) || v > Number(t.max)) return; s.inputs[key] = v; }
      } else if (t.dataset.don) s.plots[t.dataset.don].on = t.checked;
      else if (t.dataset.dc) s.plots[t.dataset.dc].color = t.value;
      else if (t.dataset.dhc) s.plots.hist.colors[Number(t.dataset.dhc)] = t.value;
      else if (t.dataset.dw) s.plots[t.dataset.dw].width = Number(t.value);
      else if (t.dataset.dopt) s[t.dataset.dopt] = t.checked;
      else if (t.dataset.dvis) s.vis[t.dataset.dvis] = t.checked;
      else return;
      previewInd();
    });
    dlg.addEventListener('click', event => {
      if (!dlgState) return;
      if (event.target === dlg || event.target.closest('[data-dclose],[data-dcancel]')) { closeIndSettings(false); return; }
      if (event.target.closest('[data-dok]')) { closeIndSettings(true); return; }
      const tab = event.target.closest('[data-dtab]');
      if (tab) { dlgState.tab = tab.dataset.dtab; renderIndSettings(); dlg.querySelector(`[data-dtab="${dlgState.tab}"]`)?.focus(); return; }
      if (event.target.closest('[data-dreset]')) { indCfg[dlgState.id] = structuredClone(IND_DEFAULT[dlgState.id]); renderIndSettings(); previewInd(); }
    });
    dlg.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeIndSettings(false); }
      else if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type === 'number') { event.preventDefault(); closeIndSettings(true); }
    });

    // الرسوم محفوظة بالسعر والتاريخ، فتظهر في اليومي والأسبوعي والشهري (على أقرب شمعة)
    const barIndex = iso => { let k = 0; for (let i = 0; i < data.length && data[i].time <= iso; i++) k = i; return k; };
    const lastIndex = () => data.length - 1;
    const logicalOf = iso => iso > data[lastIndex()].time ? lastIndex() + periodsBetween(data[lastIndex()].time, iso, state.interval) : barIndex(iso);
    const timeAt = index => index <= lastIndex() ? data[Math.max(0, index)].time : addPeriods(data[lastIndex()].time, index - lastIndex(), state.interval);
    // نمط كل رسم: الافتراضي لنوعه، مع ما خصّصه المستخدم له
    const styleOf = d => ({ ...(DRAW_DEFAULT[d.type] || {}), ...(d.style || {}) });
    // لون الرسم؛ نطاق السعر أزرق للصعود وأحمر للهبوط إن لم يُخصَّص، وفيبوناتشي لونه من إعداداتها
    const colorOf = d => styleOf(d).color ?? (d.type === 'range' ? (d.b.price >= d.a.price ? TV_BLUE : '#f23645') : colors.ink);
    const textFont = s => `${s.size ?? 14}px ${getComputedStyle(document.body).fontFamily}`;
    const measureCtx = document.createElement('canvas').getContext('2d');
    // مستطيل النص كما يُرسم، من أعلى يسار نقطته
    function textBox(d, A) {
      const s = styleOf(d);
      measureCtx.font = textFont(s);
      return { x: A.x, y: A.y, w: measureCtx.measureText(d.text || ' ').width, h: (s.size ?? 14) * 1.3 };
    }
    // الخط الأفقي يمتد بعرض الشارت كما في TradingView، ويُرسم كخط سعر على المحور؛ الشعاع الأفقي يُرسم على اللوحة من نقطته
    function paintDrawings() {
      for (const d of drawn) d.remove();
      drawn = [];
      if (!state.hidden) for (const d of drawings) {
        if (d.hidden || (d.type !== 'hline' && d.type !== 'hray')) continue;
        const s = styleOf(d), isH = d.type === 'hline';
        const line = main.createPriceLine({ price: isH ? d.price : d.a.price, color: colorOf(d), lineWidth: Math.round(s.width) || 1, lineStyle: LWC.LineStyle[{ dotted: 'Dotted', dashed: 'Dashed' }[s.line] || 'Solid'], lineVisible: isH, axisLabelVisible: true, title: '' });
        drawn.push({ remove: () => main.removePriceLine(line) });
      }
      // المحور يتسع للمستويات المرجعية (وإلا خرجت الأهداف خارج النطاق المرئي)
      const lvPrices = levels.map(lv => lv.price).filter(p => p > 0);
      if (lvPrices.length) main.applyOptions({ autoscaleInfoProvider: base => { const r = base(); if (!r) return r; return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...lvPrices), maxValue: Math.max(r.priceRange.maxValue, ...lvPrices) } }; } });
      for (const lv of levels) {
        if (!(lv.price > 0)) continue;
        const line = main.createPriceLine({ price: lv.price, color: lv.color || colors.gold, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, lineVisible: true, axisLabelVisible: true, title: lv.title || '' });
        drawn.push({ remove: () => main.removePriceLine(line) });
      }
      overlay.redraw();
      syncFtb();
      positionFtb();
    }
    const xy = p => { const x = chart.timeScale().logicalToCoordinate(p.logical ?? logicalOf(p.time)), y = main.priceToCoordinate(p.price); return x == null || y == null ? null : { x, y }; };
    const paneH = () => chart.panes()[0].getHeight();
    // طرفا الخط بعد التمديد: يُمدّ إلى ما بعد حدود اللوحة، فيقصّه الرسم عند الحدّ
    function ends(A, B, left, right) {
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
      if (!len || (!left && !right)) return [A, B];
      const k = 2 * Math.max(chart.timeScale().width(), paneH()) / len;
      return [left ? { x: A.x - dx * k, y: A.y - dy * k } : A, right ? { x: B.x + dx * k, y: B.y + dy * k } : B];
    }
    function drawShapes(ctx) {
      const ts = chart.timeScale(), W = ts.width(), H = paneH();
      const font12 = `600 12px ${getComputedStyle(document.body).fontFamily}`;
      const handle = (pt, color) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); };
      const dotAt = (pt, color) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
      const segment = (a, b, color, width, dash = []) => { ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };
      // رأس السهم عند النقطة الثانية
      const headAt = (from, to, color, width) => { const a = Math.atan2(to.y - from.y, to.x - from.x), s = 6 + width * 3; ctx.beginPath(); ctx.fillStyle = color; ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - s * Math.cos(a - 0.45), to.y - s * Math.sin(a - 0.45)); ctx.lineTo(to.x - s * Math.cos(a + 0.45), to.y - s * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill(); };
      const drawOne = d => {
        const s = styleOf(d), color = colorOf(d), dash = dashFor(s.line, s.width);
        ctx.font = font12; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        if (d.type === 'hline') return; // يُرسم على المحور في paintDrawings
        if (d.type === 'hray') { const A = xy(d.a); if (A && A.x < W) { segment(A, { x: W, y: A.y }, color, s.width, dash); dotAt(A, color); } return; }
        if (d.type === 'vline') { const x = ts.logicalToCoordinate(logicalOf(d.a.time)); if (x != null) segment({ x, y: 0 }, { x, y: H }, color, s.width, dash); return; }
        if (d.type === 'text') {
          const A = xy(d.a); if (!A) return;
          ctx.font = textFont(s); ctx.textBaseline = 'top'; ctx.fillStyle = color;
          ctx.fillText(d.text || '', A.x, A.y);
          return;
        }
        const A = xy(d.a), B = d.b ? xy(d.b) : null;
        if (!A || !B) return;
        if (d.type === 'trend' || d.type === 'ray' || d.type === 'ext') { const [P, Q] = ends(A, B, !!s.extL, !!s.extR); segment(P, Q, color, s.width, dash); return; }
        if (d.type === 'arrow') { segment(A, B, color, s.width, dash); headAt(A, B, color, s.width); return; }
        if (d.type === 'rect') {
          const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y), w = Math.abs(B.x - A.x), h = Math.abs(B.y - A.y);
          if (s.fill) { ctx.fillStyle = color + '26'; ctx.fillRect(x, y, w, h); }
          ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = s.width; ctx.strokeStyle = color; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
          return;
        }
        if (d.type === 'range') {
          // نطاق السعر: مستطيل بين السعرين، وسهم من الأول إلى الثاني، والفرق ونسبته
          const x1 = Math.min(A.x, B.x), x2 = Math.max(A.x, B.x, x1 + 1), cx = (x1 + x2) / 2;
          ctx.fillStyle = color + '26'; ctx.fillRect(x1, Math.min(A.y, B.y), x2 - x1, Math.abs(B.y - A.y));
          segment({ x: x1, y: A.y }, { x: x2, y: A.y }, color, 1);
          segment({ x: x1, y: B.y }, { x: x2, y: B.y }, color, 1);
          segment({ x: cx, y: A.y }, { x: cx, y: B.y }, color, 1.5);
          const dir = B.y < A.y ? -1 : 1;
          if (Math.abs(B.y - A.y) > 8) { ctx.beginPath(); ctx.moveTo(cx, B.y); ctx.lineTo(cx - 5, B.y - dir * 7); ctx.lineTo(cx + 5, B.y - dir * 7); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); }
          const label = rangeLabel(d.a.price, d.b.price), w = ctx.measureText(label).width + 14, h = 20;
          const ly = dir < 0 ? B.y - h - 6 : B.y + 6;
          ctx.fillStyle = color; ctx.fillRect(cx - w / 2, ly, w, h);
          ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(label, cx, ly + h - 4);
          return;
        }
        // فيبوناتشي: المستويات بين نقطتي الموجة (أو ممتدة حسب الإعداد)، والعناوين على يمينها فوق الخط كما في TradingView
        const paneWidth = W;
        const x1 = ['left', 'both'].includes(fib.extend) ? 0 : Math.min(A.x, B.x);
        const x2 = ['right', 'both'].includes(fib.extend) ? paneWidth : Math.max(A.x, B.x);
        const levels = fibLevels(d.a.price, d.b.price, fib).map(level => ({ ...level, y: main.priceToCoordinate(level.price) })).filter(level => level.y != null);
        if (fib.background) for (let i = 1; i < levels.length; i++) { ctx.fillStyle = levels[i].color + '22'; ctx.fillRect(x1, Math.min(levels[i - 1].y, levels[i].y), Math.max(x2 - x1, 1), Math.abs(levels[i].y - levels[i - 1].y)); }
        for (const level of levels) {
          segment({ x: x1, y: level.y }, { x: x2, y: level.y }, level.color, 1);
          const name = fib.showLevels ? (fib.levelsAs === 'values' ? String(level.ratio) : `${(level.ratio * 100).toFixed(2)}%`) : '';
          const text = [name, fib.prices ? `(${f2.format(level.price)})` : ''].filter(Boolean).join(' ');
          if (!text) continue;
          ctx.fillStyle = level.color;
          // يمين نهاية المستوى (أو يساره) وفوق الخط؛ وإن امتد المستوى إلى طرف اللوحة يبقى العنوان داخلها
          let x, align;
          if (fib.labels === 'right') [x, align] = x2 >= paneWidth - 1 ? [paneWidth - 6, 'right'] : [x2 + 6, 'left'];
          else [x, align] = x1 <= 1 ? [6, 'left'] : [x1 - 6, 'right'];
          ctx.textAlign = align;
          ctx.fillText(text, x, level.y - 2);
        }
        if (fib.trend) segment(A, B, colors.muted, 1, [4, 4]);
        dotAt(A, colors.muted); dotAt(B, colors.muted);
      };
      // إطار التحديد: مقابض عند الطرفين، وللنص إطار منقط
      const drawSelection = d => {
        if (d.type === 'hline') { const y = main.priceToCoordinate(d.price); if (y != null) { handle({ x: 24, y }, colors.gold); handle({ x: W - 24, y }, colors.gold); } return; }
        if (d.type === 'vline') { const x = ts.logicalToCoordinate(logicalOf(d.a.time)); if (x != null) handle({ x, y: H / 2 }, colors.gold); return; }
        if (d.type === 'hray') { const A = xy(d.a); if (A) handle(A, colors.gold); return; }
        if (d.type === 'text') {
          const A = xy(d.a); if (!A) return;
          const bb = textBox(d, A);
          ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = colors.gold; ctx.strokeRect(bb.x - 3, bb.y - 3, bb.w + 6, bb.h + 6); ctx.restore();
          return;
        }
        const A = xy(d.a), B = d.b ? xy(d.b) : null;
        if (A && B) { handle(A, colors.gold); handle(B, colors.gold); }
      };
      if (!state.hidden) for (const d of drawings) if (!d.hidden) drawOne(d);
      if (preview) drawOne(preview);
      if (selected >= 0 && drawings[selected] && !drawings[selected].hidden) drawSelection(drawings[selected]);
      // نقطة المغناطيس قبل الضغطة الأولى وأثناء الرسم: دائرة حيث ستقع النقطة فعلًا
      if (hover && (state.tool || drag)) { const h = xy(hover); if (h) handle(h, hover.snapped ? colors.gold : colors.muted); }
    }
    // طبقة رسم على الشارت (primitive): تُعاد رسمها مع كل تحريك أو تكبير
    const overlay = {
      request: null,
      redraw() { this.request?.(); },
      attached({ requestUpdate }) { this.request = requestUpdate; },
      detached() { this.request = null; },
      updateAllViews() {},
      paneViews() { return [{ zOrder: () => 'top', renderer: () => ({ draw: target => { target.useMediaCoordinateSpace(({ context }) => drawShapes(context)); queueMicrotask(() => { positionIndRows(); positionFtb(); }); } }) }]; }
    };

    function build(keepRange) {
      const saved = keepRange && chart ? chart.timeScale().getVisibleLogicalRange() : null;
      chart?.remove();
      box.innerHTML = '';
      daily = state.adj ? adjustDividends(raw, dividends) : raw;
      data = group(daily, state.interval);
      // كل مؤشر بمدخلاته، ولا يُحسب ما لا يظهر على فترة الشمعة الحالية
      const source = key => data.map(b => srcOf(b, key));
      calc = {};
      for (const id of INDICATORS.map(x => x.id).filter(shownInd)) {
        const i = indCfg[id].inputs;
        if (id === 'sma20' || id === 'sma50' || id === 'sma200') calc[id] = sma(source(i.source), i.length);
        else if (id === 'ema20') calc[id] = ema(source(i.source), i.length);
        else if (id === 'bb') calc[id] = bollinger(source(i.source), i.length, i.mult);
        else if (id === 'rsi') calc[id] = rsi(source(i.source), i.length);
        else if (id === 'macd') calc[id] = macd(source(i.source), i.fast, i.slow, i.signal, i.osc, i.sig);
      }
      const panes = ['rsi', 'macd'].filter(shownInd);
      paneIds = [null, ...panes];
      box.style.setProperty('--cc-panes', panes.length);
      chart = LWC.createChart(box, {
        autoSize: true,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: colors.muted, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, panes: { separatorColor: colors.line, separatorHoverColor: colors.line } },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: shownInd('vol') ? 0.24 : 0.06 } },
        timeScale: { borderVisible: false, rightOffset: 2, minBarSpacing: 0.05 },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        localization: { priceFormatter: p => f2.format(p), timeFormatter: t => crosshairDate(t, state.interval) }
      });
      const { up, down } = colors;
      main = state.type === 'candles'
        ? chart.addSeries(LWC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineColor: colors.muted })
        : chart.addSeries(LWC.AreaSeries, { lineColor: colors.gold, topColor: colors.gold + '55', bottomColor: colors.gold + '00', lineWidth: 2, priceLineColor: colors.muted });
      main.setData(state.type === 'candles' ? data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) : data.map(b => ({ time: b.time, value: b.close })));
      indLines = []; selPrims = [];
      if (shownInd('vol')) {
        const s = indCfg.vol, upC = plotColor('vol', 'up'), downC = plotColor('vol', 'down');
        const volume = chart.addSeries(LWC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false, visible: !s.hidden });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volume.setData(data.map(b => { const plotKey = b.close >= b.open ? 'up' : 'down'; return s.plots[plotKey].on ? { time: b.time, value: b.volume, color: (plotKey === 'up' ? upC : downC) + '66' } : { time: b.time }; }));
      }
      // خط من خطوط المؤشر بلونه وسماكته؛ يُسجَّل لتحديد المؤشر بالضغط عليه ولدوائر التحديد
      const line = (id, key, values, pane = 0, opts = {}) => {
        const s = indCfg[id], p = s.plots[key];
        if (!p.on) return null;
        const color = plotColor(id, key);
        const series = chart.addSeries(LWC.LineSeries, { color, lineWidth: p.width, lastValueVisible: s.scaleLabels, priceLineVisible: false, crosshairMarkerVisible: false, visible: !s.hidden, ...opts }, pane);
        series.setData(data.map((b, i) => values[i] == null ? { time: b.time } : { time: b.time, value: values[i] }));
        const marks = selectionMarks(id, values, color); series.attachPrimitive(marks); marks.series = series;
        if (pane === 0) indLines.push({ id, series, values });
        return series;
      };
      for (const id of ['sma20', 'sma50', 'sma200', 'ema20']) if (calc[id]) line(id, 'ma', calc[id]);
      if (calc.bb) {
        line('bb', 'upper', calc.bb.map(v => v?.up ?? null), 0, { lineStyle: 2 });
        line('bb', 'basis', calc.bb.map(v => v?.mid ?? null));
        line('bb', 'lower', calc.bb.map(v => v?.low ?? null), 0, { lineStyle: 2 });
      }
      // خط ثابت (حدود RSI وخط صفر الماكد) على لوحة المؤشر
      const level = (series, id, key, price) => { const p = indCfg[id].plots[key]; if (p.on && series && !indCfg[id].hidden) series.createPriceLine({ price, color: plotColor(id, key), lineWidth: Math.max(1, Math.round(p.width)), lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false }); };
      // سلسلة غير مرئية تثبّت لوحة المؤشر حتى لو أُطفئت كل خطوطه
      const anchor = (values, pane) => { const s = chart.addSeries(LWC.LineSeries, { visible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, pane); s.setData(data.map((b, i) => values[i] == null ? { time: b.time } : { time: b.time, value: values[i] })); return s; };
      let pane = 1;
      if (calc.rsi) {
        const s = indCfg.rsi;
        const base = line('rsi', 'rsi', calc.rsi, pane, { priceFormat: { type: 'price', precision: 1, minMove: 0.1 } }) ?? anchor(calc.rsi, pane);
        level(base, 'rsi', 'upper', s.inputs.upper); level(base, 'rsi', 'lower', s.inputs.lower);
        pane += 1;
      }
      if (calc.macd) {
        const s = indCfg.macd;
        if (s.plots.hist.on) {
          const hist = chart.addSeries(LWC.HistogramSeries, { lastValueVisible: false, priceLineVisible: false, visible: !s.hidden }, pane);
          hist.setData(data.map((b, i) => { const v = calc.macd[i]?.hist; return v == null ? { time: b.time } : { time: b.time, value: v, color: s.plots.hist.colors[histColorIndex(v, calc.macd[i - 1]?.hist)] }; }));
        }
        const m = line('macd', 'macd', calc.macd.map(v => v?.macd ?? null), pane);
        const sig = line('macd', 'signal', calc.macd.map(v => v?.signal ?? null), pane);
        level(m ?? sig ?? anchor(calc.macd.map(v => v?.macd ?? null), pane), 'macd', 'zero', 0);
      }
      chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
      if (selInd && !shownInd(selInd)) selInd = null;
      renderIndRows();
      requestAnimationFrame(positionIndRows); setTimeout(positionIndRows, 80); // بعد أن ترسم المكتبة اللوحات بأحجامها
      if (state.interval === 'd') {
        // علامة D على شمعة استحقاق كل توزيع، كما في TradingView، وعلامة القفزات غير المفسَّرة
        const marks = bigJumps(file).filter(f => data.some(b => b.time === f.date)).map(f => ({ time: f.date, position: 'aboveBar', color: colors.gold, shape: 'arrowDown', text: `${f.change > 0 ? '+' : ''}${f2.format(f.change)}%` }));
        if (state.divMarks) for (const [date, amount] of dividends) { const b = data.find(x => x.time >= date); if (b) marks.push({ time: b.time, position: 'belowBar', color: colors.gold, shape: 'circle', text: 'D', size: 0.6 }); }
        if (marks.length) LWC.createSeriesMarkers(main, marks.sort((a, b) => a.time < b.time ? -1 : 1));
      }
      main.attachPrimitive(overlay);
      drawn = []; paintDrawings();
      if (state.tool) chart.applyOptions({ handleScroll: false, handleScale: false });
      applyCrosshair();
      chart.subscribeCrosshairMove(p => showLegend(p?.time ?? null));
      chart.timeScale().subscribeVisibleLogicalRangeChange(visibleChange);
      // بعد أن تطبّق المكتبة البيانات (في الإطار التالي)، وإلا أعادت ضبط المدى
      const apply = saved ? () => chart.timeScale().setVisibleLogicalRange(saved) : fitRange;
      apply(); requestAnimationFrame(() => requestAnimationFrame(apply));
      showLegend(null);
    }

    // العرض الافتراضي لمدة العرض المختارة، مع مساحة فارغة بعد آخر شمعة (نحو 8% من العرض) للرسم في المستقبل كما في TradingView
    function fitRange() {
      if (!chart || !data.length) return;
      const months = RANGES.find(r => r[0] === state.range)?.[2];
      const from = months == null ? data[0].time : fromDate(data.at(-1).time, months);
      const start = Math.max(0, data.findIndex(b => b.time >= from)), room = Math.max(3, Math.round((data.length - start) * 0.08));
      chart.timeScale().setVisibleLogicalRange({ from: start - 0.5, to: data.length - 1 + room });
    }
    // إعادة تعيين عرض الرسم البياني كما في TradingView: يعيد المدى الزمني الافتراضي للمدة المختارة،
    // ويعيد مقياس السعر في كل اللوحات إلى الضبط التلقائي بعد سحبه أو تكبيره يدويًا. الرسوم لا تتأثر.
    function resetView() {
      if (!chart) return;
      for (const p of chart.panes()) for (const s of p.getSeries()) s.priceScale().applyOptions({ autoScale: true });
      fitRange();
    }

    /* ---------- ملء الشاشة: Fullscreen API إن توفّر، وإلا تغطية الصفحة بالـ CSS (آيفون) ---------- */
    const isFull = () => panel.classList.contains('cc-full');
    function setFull(on) {
      panel.classList.toggle('cc-full', on);
      document.documentElement.classList.toggle('cc-lock', on);
      const button = panel.querySelector('[data-full]');
      if (button) {
        button.setAttribute('aria-pressed', String(on));
        button.title = on ? 'الخروج من ملء الشاشة (Esc)' : 'تكبير الرسم البياني ليملأ الشاشة';
        button.innerHTML = `${on ? ICON_EXIT : ICON_FULL}<span>${on ? 'خروج من ملء الشاشة' : 'ملء الشاشة'}</span>`;
      }
      if (on && panel.requestFullscreen && !document.fullscreenElement) panel.requestFullscreen().catch(() => { /* تبقى التغطية بالـ CSS */ });
      if (!on && document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    }
    // الخروج بزر المتصفح أو Esc في وضع ملء الشاشة الأصلي
    const onFullscreenChange = () => { if (!document.fullscreenElement && isFull()) setFull(false); };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // نقطة الرسم من موضع المؤشر: شمعة أقرب + السعر عند ذلك الارتفاع، داخل لوحة السعر فقط
    function pointFrom(event) {
      if (!chart || !main) return null;
      const rect = box.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (y < 0 || y > chart.panes()[0].getHeight()) return null;
      const logical = chart.timeScale().coordinateToLogical(x), price = main.coordinateToPrice(y);
      if (logical == null || price == null) return null;
      const index = Math.max(0, Math.round(logical));
      // بعد آخر شمعة: لا شمعة يلتصق بها المغناطيس، فالنقطة حيث المؤشر
      if (index > lastIndex()) return { time: timeAt(index), price, logical: index, snapped: false };
      const b = data[index];
      const snapped = nearestPrice(state.type === 'candles' ? [b.open, b.high, b.low, b.close] : [b.close], value => main.priceToCoordinate(value), y, state.magnet);
      return { time: b.time, price: snapped ?? price, logical: index, snapped: snapped != null };
    }
    let press = null;
    // التراجع والإعادة: كل تعديل يحفظ نسخة من الرسوم قبله
    const past = [], future = [];
    let liveBefore = null; // نسخة قبل سلسلة تعديلات مباشرة (لون يُسحب في الشريط، أو نافذة إعدادات مفتوحة)
    const snap = () => structuredClone(drawings);
    function record(before) { past.push(before); if (past.length > 80) past.shift(); future.length = 0; }
    function commit(mutate) { const before = snap(); mutate(); record(before); saveDrawings(symbol, drawings); paintDrawings(); }
    function restoreDrawings(list) { drawings = list; select(-1); saveDrawings(symbol, drawings); paintDrawings(); }
    function undo() { if (!past.length) return; future.push(snap()); restoreDrawings(past.pop()); }
    function redo() { if (!future.length) return; past.push(snap()); restoreDrawings(future.pop()); }

    // الرسم بنقطتين: النقطة الثانية تُثبّت الرسم
    function finish(point) {
      if (point.logical === pending.logical) return; // النقطتان على الشمعة نفسها: انتظر نقطة أخرى
      const strip = p => ({ time: p.time, price: p.price });
      const d = { type: state.tool, a: strip(pending), b: strip(point) };
      commit(() => drawings.push(d));
      setTool(null);
    }
    // الرسم بنقرة واحدة: يُثبَّت الرسم في مكان النقرة، والنص يفتح نافذته فورًا ليُكتب
    function placeAt(point) {
      const type = state.tool, before = snap();
      let d;
      if (type === 'hline') d = { type, price: Math.round(point.price * 100) / 100 };
      else if (type === 'hray') { const a = { time: point.time, price: Math.round(point.price * 100) / 100 }; d = { type, a, b: { ...a } }; }
      else if (type === 'vline') d = { type, a: { time: point.time, price: point.price } };
      else d = { type, a: { time: point.time, price: point.price }, text: '' };
      drawings.push(d);
      setTool(null);
      if (type === 'text') { openDrawDialog(drawings.length - 1, before); return; }
      record(before); saveDrawings(symbol, drawings); paintDrawings();
    }
    box.addEventListener('pointerdown', event => {
      if (!state.tool || event.button !== 0) return;
      const point = pointFrom(event); if (!point) return;
      event.preventDefault();
      press = { x: event.clientX, y: event.clientY, point };
      if (SINGLE_CLICK_TOOLS.includes(state.tool)) return;
      if (pending) { finish(point); press = null; return; }
      pending = point; preview = { type: state.tool, a: point, b: point };
      try { box.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      overlay.redraw();
    });
    box.addEventListener('pointermove', event => {
      if (!state.tool) return;
      const point = pointFrom(event);
      hover = point;
      if (point && pending && preview) preview.b = point;
      overlay.redraw();
    });
    box.addEventListener('pointerleave', () => { if (hover) { hover = null; overlay.redraw(); } if (!drag) box.style.cursor = ''; });

    /* ---------- تحرير الرسوم بعد تثبيتها: تحديد، سحب الرسم كاملًا أو أحد طرفيه، قفل وإخفاء، حذف ---------- */
    const local = event => { const rect = box.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    function distanceToSegment(x, y, A, B) {
      const dx = B.x - A.x, dy = B.y - A.y, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / len)) : 0;
      return Math.hypot(x - (A.x + t * dx), y - (A.y + t * dy));
    }
    // أي رسم تحت الضغطة: الطرف أولًا (مقبض)، ثم جسم الرسم. الرسوم المخفية لا تُحدَّد
    function hitTest(x, y) {
      if (state.hidden || state.locked) return null; // الرسوم المخفية أو المقفلة كلها لا تُحدَّد ولا تُسحب
      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i];
        if (d.hidden) continue;
        if (d.type === 'hline') { const py = main.priceToCoordinate(d.price); if (py != null && Math.abs(py - y) <= 5) return { index: i, part: 'body' }; continue; }
        if (d.type === 'vline') { const px = chart.timeScale().logicalToCoordinate(logicalOf(d.a.time)); if (px != null && Math.abs(px - x) <= 5) return { index: i, part: 'body' }; continue; }
        if (d.type === 'hray') {
          const A = xy(d.a); if (!A) continue;
          if (Math.hypot(A.x - x, A.y - y) <= 9) return { index: i, part: 'a' };
          if (x >= A.x - 4 && Math.abs(A.y - y) <= 5) return { index: i, part: 'body' };
          continue;
        }
        if (d.type === 'text') {
          const A = xy(d.a); if (!A) continue;
          const bb = textBox(d, A);
          if (x >= bb.x - 4 && x <= bb.x + bb.w + 4 && y >= bb.y - 4 && y <= bb.y + bb.h + 4) return { index: i, part: 'body' };
          continue;
        }
        const A = xy(d.a), B = d.b ? xy(d.b) : null;
        if (!A || !B) continue;
        if (Math.hypot(A.x - x, A.y - y) <= 9) return { index: i, part: 'a' };
        if (Math.hypot(B.x - x, B.y - y) <= 9) return { index: i, part: 'b' };
        const inBox = (x1, x2, y1, y2) => x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4;
        if (['trend', 'ray', 'ext', 'arrow'].includes(d.type)) {
          const s = styleOf(d), [P, Q] = d.type === 'arrow' ? [A, B] : ends(A, B, !!s.extL, !!s.extR);
          if (distanceToSegment(x, y, P, Q) <= 6) return { index: i, part: 'body' };
          continue;
        }
        if (d.type === 'rect') {
          const x1 = Math.min(A.x, B.x), x2 = Math.max(A.x, B.x), y1 = Math.min(A.y, B.y), y2 = Math.max(A.y, B.y);
          const edges = [[{ x: x1, y: y1 }, { x: x2, y: y1 }], [{ x: x2, y: y1 }, { x: x2, y: y2 }], [{ x: x2, y: y2 }, { x: x1, y: y2 }], [{ x: x1, y: y2 }, { x: x1, y: y1 }]];
          const inside = x >= x1 && x <= x2 && y >= y1 && y <= y2;
          if ((styleOf(d).fill && inside) || edges.some(([P, Q]) => distanceToSegment(x, y, P, Q) <= 6)) return { index: i, part: 'body' };
          continue;
        }
        if (d.type === 'range' && inBox(Math.min(A.x, B.x), Math.max(A.x, B.x), Math.min(A.y, B.y), Math.max(A.y, B.y))) return { index: i, part: 'body' };
        if (d.type === 'fib') {
          const width = chart.timeScale().width();
          const x1 = ['left', 'both'].includes(fib.extend) ? 0 : Math.min(A.x, B.x), x2 = ['right', 'both'].includes(fib.extend) ? width : Math.max(A.x, B.x);
          if (x < x1 - 4 || x > x2 + 4) continue;
          const ys = fibLevels(d.a.price, d.b.price, fib).map(level => main.priceToCoordinate(level.price)).filter(v => v != null);
          if (ys.some(v => Math.abs(v - y) <= 5) || inBox(x1, x2, Math.min(A.y, B.y), Math.max(A.y, B.y))) return { index: i, part: 'body' };
        }
      }
      return null;
    }
    function select(index) {
      selected = index;
      if (index >= 0 && selInd) selectInd(null);
      overlay.redraw();
      syncFtb();
      positionFtb();
    }
    function deleteSelected() {
      if (selected < 0 || !drawings[selected]) return;
      const index = selected;
      commit(() => drawings.splice(index, 1));
      select(-1);
    }
    // في مرحلة الالتقاط: قبل أن تبدأ المكتبة سحب الشارت
    box.addEventListener('pointerdown', event => {
      if (state.tool || event.button !== 0 || !chart || !main) return;
      const { x, y } = local(event);
      const hit = y <= chart.panes()[0].getHeight() ? hitTest(x, y) : null;
      if (!hit) { if (selected >= 0) select(-1); return; }
      event.preventDefault(); event.stopPropagation();
      const d = drawings[hit.index];
      chart.applyOptions({ handleScroll: false, handleScale: false });
      drag = { ...hit, logical: chart.timeScale().coordinateToLogical(x), price: main.coordinateToPrice(y), orig: structuredClone(d), before: snap(), locked: !!d.locked, moved: false };
      try { box.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      select(hit.index);
      applyCrosshair();
    }, true);
    // نقرتان على الرسم تفتحان نافذة إعداداته كما في TradingView
    box.addEventListener('dblclick', event => {
      if (state.tool || event.button !== 0 || !chart || !main) return;
      const { x, y } = local(event);
      const hit = y <= chart.panes()[0].getHeight() ? hitTest(x, y) : null;
      if (!hit) return;
      select(hit.index);
      openDrawDialog(hit.index);
    });
    box.addEventListener('pointermove', event => {
      if (state.tool) return;
      const { x, y } = local(event);
      if (!drag) {
        const hit = chart && main && y <= chart.panes()[0].getHeight() ? hitTest(x, y) : null;
        // المؤشر على الرسم يصير يدًا بإصبع مرفوع، كما يُعرف الرسم القابل للتحديد
        box.style.cursor = hit ? 'pointer' : '';
        return;
      }
      if (drag.locked) return; // الرسم المقفل يُحدَّد ولا يتحرك
      const d = drawings[drag.index];
      if (drag.part === 'body') {
        const dl = Math.round((chart.timeScale().coordinateToLogical(x) ?? drag.logical) - drag.logical);
        const dp = (main.coordinateToPrice(y) ?? drag.price) - drag.price;
        if (d.type === 'hline') d.price = Math.round((drag.orig.price + dp) * 100) / 100;
        else {
          const shift = p => ({ time: timeAt(Math.max(0, logicalOf(p.time) + dl)), price: p.price + dp });
          if (drag.orig.a) d.a = shift(drag.orig.a);
          if (drag.orig.b) d.b = shift(drag.orig.b);
        }
      } else {
        // طرف الرسم يتبع المؤشر، ويلتصق بالمغناطيس إن كان مفعّلًا
        const point = pointFrom(event);
        if (point) { d[drag.part] = { time: point.time, price: point.price }; if (d.type === 'hray') d.b = { ...d.a }; hover = point; }
      }
      drag.moved = true;
      if (d.type === 'hline' || d.type === 'hray') paintDrawings(); else overlay.redraw();
    });
    box.addEventListener('pointerup', () => {
      if (!drag) return;
      if (drag.moved) { record(drag.before); saveDrawings(symbol, drawings); }
      drag = null; hover = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      applyCrosshair();
      paintDrawings();
    });
    // خط التقاطع يلتصق هو أيضًا بأسعار الشمعة مع المغناطيس القوي أثناء الرسم أو تعديل طرف
    function applyCrosshair() {
      if (!chart || !LWC) return;
      const snapping = state.magnet === 'strong' && (state.tool || (drag && drag.part !== 'body'));
      chart.applyOptions({ crosshair: { mode: snapping ? (state.type === 'candles' ? LWC.CrosshairMode.MagnetOHLC : LWC.CrosshairMode.Magnet) : LWC.CrosshairMode.Normal } });
    }
    box.addEventListener('pointerup', event => {
      if (!state.tool || !press) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6;
      if (SINGLE_CLICK_TOOLS.includes(state.tool)) { if (!moved) placeAt(press.point); }
      else if (pending && moved) { const point = pointFrom(event) ?? preview?.b; if (point) finish(point); }
      press = null;
    });
    // الضغط على خط مؤشر (أو داخل لوحته) يحدده فتظهر أزراره، والضغط في مكان آخر يلغي التحديد
    let indPress = null;
    box.addEventListener('pointerdown', event => { indPress = state.tool || event.button !== 0 ? null : { x: event.clientX, y: event.clientY }; });
    box.addEventListener('pointerup', event => {
      positionIndRows(); // بعد سحب الفاصل بين اللوحات
      const p = indPress; indPress = null;
      if (!p || state.tool || selected >= 0 || Math.hypot(event.clientX - p.x, event.clientY - p.y) > 5) return;
      const { x, y } = local(event);
      selectInd(indAt(x, y));
    });
    const resizeWatch = new ResizeObserver(() => positionIndRows());
    resizeWatch.observe(box);

    /* ---------- الشريط العائم فوق الرسم المحدد: لون وسماكة ونمط وقفل وإخفاء وإعدادات وحذف ---------- */
    const ftb = panel.querySelector('.cc-ftb');
    const ftbInput = name => ftb.querySelector(`[data-ftb="${name}"]`);
    // تعديل نمط الرسم المحدد. الحي (سحب اللون) يُسجَّل تراجعًا واحدًا عند الانتهاء
    function styleSet(key, value, live = false) {
      const d = drawings[selected]; if (!d) return;
      const before = liveBefore ?? snap();
      liveBefore = live ? before : null;
      d.style = { ...(d.style || {}), [key]: value };
      if (!live) record(before);
      saveDrawings(symbol, drawings); paintDrawings();
    }
    function patchSelected(mutate) {
      const d = drawings[selected]; if (!d) return;
      commit(() => mutate(d));
      syncFtb();
    }
    ftb.addEventListener('input', event => { if (event.target.dataset.ftb === 'color') styleSet('color', event.target.value, true); });
    ftb.addEventListener('change', event => {
      const t = event.target.dataset.ftb;
      if (t === 'color') styleSet('color', event.target.value);
      else if (t === 'width') styleSet('width', Number(event.target.value));
      else if (t === 'line') styleSet('line', event.target.value);
    });
    ftb.addEventListener('click', event => {
      const b = event.target.closest('[data-ftb]'); if (!b) return;
      const t = b.dataset.ftb;
      if (t === 'lock') patchSelected(d => { d.locked = !d.locked; });
      else if (t === 'hide') { patchSelected(d => { d.hidden = true; }); select(-1); }
      else if (t === 'settings') { if (selected >= 0) openDrawDialog(selected); }
      else if (t === 'delete') deleteSelected();
    });
    // قيم الشريط تتبع الرسم المحدد، ولا تُكتب فوق ما يختاره المستخدم الآن
    function syncFtb() {
      const d = drawings[selected];
      if (!ftb || !d) return;
      const s = styleOf(d), setVal = (el, v) => { if (el.value !== v) el.value = v; };
      const noStyle = d.type === 'fib', noLine = ['text', 'fib', 'range'].includes(d.type);
      ftbInput('color').hidden = noStyle;
      ftbInput('width').hidden = noLine;
      ftbInput('line').hidden = noLine;
      setVal(ftbInput('color'), toHex(colorOf(d)));
      setVal(ftbInput('width'), String(s.width ?? 1));
      setVal(ftbInput('line'), s.line ?? 'solid');
      const lock = ftbInput('lock');
      lock.innerHTML = d.locked ? ICONS.lock : ICONS.unlock;
      lock.setAttribute('aria-pressed', String(!!d.locked));
      lock.title = d.locked ? 'فتح قفل الرسم' : 'قفل الرسم (يمنع تحريكه وتعديله)';
    }
    // موضع الشريط: فوق منتصف الرسم، أو تحته إن لم يتسع الأعلى
    function selectedAnchor() {
      const d = drawings[selected];
      if (!d || d.hidden || !chart || !main) return null;
      const ts = chart.timeScale();
      if (d.type === 'hline') { const y = main.priceToCoordinate(d.price); return y == null ? null : { x: ts.width() / 2, y }; }
      if (d.type === 'vline') { const x = ts.logicalToCoordinate(logicalOf(d.a.time)); return x == null ? null : { x, y: 40 }; }
      const A = xy(d.a), B = d.b ? xy(d.b) : A;
      if (!A || !B) return null;
      return { x: (A.x + B.x) / 2, y: Math.min(A.y, B.y) };
    }
    function positionFtb() {
      if (!ftb) return;
      const a = !state.tool && !state.hidden ? selectedAnchor() : null;
      ftb.hidden = !a;
      if (!a) return;
      const rect = box.getBoundingClientRect(), base = stage.getBoundingClientRect();
      const ox = rect.left - base.left, oy = rect.top - base.top, bw = ftb.offsetWidth, bh = ftb.offsetHeight;
      let top = oy + a.y - bh - 10;
      if (top < 0) top = oy + a.y + 12;
      const left = Math.max(4, Math.min(ox + a.x - bw / 2, base.width - bw - 4));
      ftb.style.left = `${Math.round(left)}px`;
      ftb.style.top = `${Math.round(top)}px`;
    }

    /* ---------- حذف الرسوم: من القائمة المنسدلة لسلة المهملات، أو من الشريط العائم ---------- */
    function deleteAction(t) {
      closeFlyout();
      if (t === 'sel') deleteSelected();
      else if (t === 'all') { if (drawings.length && window.confirm('حذف كل الرسوم في هذا السهم؟ يمكن التراجع بـ Ctrl+Z.')) { commit(() => { drawings = []; }); select(-1); setTool(null); } }
      else if (t === 'show') commit(() => drawings.forEach(d => { d.hidden = false; }));
      else if (t === 'ind') { state.ind.clear(); panel.querySelectorAll('[data-ind]').forEach(x => x.setAttribute('aria-pressed', 'false')); if (selInd) selInd = null; saveSettings(); build(true); }
    }
    function trashMenu() {
      const hiddenCount = drawings.filter(d => d.hidden).length;
      const item = (attr, label, extra = '', disabled = false) => `<button type="button" role="menuitem" data-tdel="${attr}"${disabled ? ' disabled' : ''}>${label}${extra ? `<small>${extra}</small>` : ''}</button>`;
      return `<b>حذف الرسوم</b>`
        + item('sel', 'حذف الرسم المحدد', 'Delete', selected < 0)
        + item('all', 'حذف كل الرسوم في هذا السهم', '', drawings.length === 0)
        + (hiddenCount ? item('show', `إظهار الرسوم المخفية (${hiddenCount})`) : '')
        + item('ind', 'حذف كل المؤشرات', '', !state.ind.size);
    }

    /* ---------- نافذة إعدادات الرسم: نمط وإحداثيات، تُفتح بنقرتين أو من الشريط العائم ---------- */
    const ddlg = panel.querySelector('.cc-ddlg');
    let ddState = null;
    const drawColorRow = value => `<label class="cc-dlg-row"><span>اللون</span><input type="color" data-dd="color" value="${toHex(value)}" aria-label="لون الرسم"></label>`;
    function renderDrawDialog() {
      const { index, tab } = ddState, d = drawings[index];
      if (!d) return;
      const s = styleOf(d), t = d.type;
      const check = (key, on, label) => `<label class="cc-dlg-check"><input type="checkbox" data-dd="${key}"${on ? ' checked' : ''}><span>${label}</span></label>`;
      const widthRow = `<label class="cc-dlg-row"><span>السماكة</span><select data-dd="width">${[1, 2, 3, 4].map(w => `<option value="${w}"${s.width === w ? ' selected' : ''}>${w}px</option>`).join('')}</select></label>`;
      const lineRow = `<label class="cc-dlg-row"><span>نمط الخط</span><select data-dd="line">${LINE_OPTIONS.map(([v, l]) => `<option value="${v}"${(s.line ?? 'solid') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
      let content = '';
      if (tab === 'style') {
        if (t === 'fib') content = `<p class="cc-dlg-note">مستويات فيبوناتشي وألوانها تُضبط من زر الإعدادات في الشريط، وتنطبق على كل رسوم فيبوناتشي.</p><button type="button" class="cc-dlg-link" data-ddfib>فتح إعدادات فيبوناتشي</button>`;
        else if (t === 'text') content = `<label class="cc-dlg-row"><span>النص</span><input type="text" data-dd="text" value="${esc(d.text || '')}" maxlength="300"></label>${drawColorRow(colorOf(d))}<label class="cc-dlg-row"><span>حجم الخط</span><select data-dd="size">${TEXT_SIZES.map(v => `<option value="${v}"${s.size === v ? ' selected' : ''}>${v}px</option>`).join('')}</select></label>`;
        else if (t === 'range') content = drawColorRow(colorOf(d)) + `<p class="cc-dlg-note">يظهر الصعود بالأزرق والهبوط بالأحمر ما لم تختر لونًا.</p>`;
        else content = drawColorRow(colorOf(d)) + widthRow + lineRow
          + (t === 'trend' || t === 'ext' ? check('extL', s.extL, 'تمديد إلى اليسار') + check('extR', s.extR, 'تمديد إلى اليمين') : '')
          + (t === 'rect' ? check('fill', s.fill, 'تعبئة داخلية') : '');
      } else {
        const rows = t === 'hline' ? [['السعر', 'price']] : t === 'vline' ? [['التاريخ', 'a']] : (t === 'hray' || t === 'text') ? [['النقطة', 'a']] : [['النقطة الأولى', 'a'], ['النقطة الثانية', 'b']];
        content = rows.map(([label, key]) => key === 'price'
          ? `<label class="cc-dlg-row"><span>${label}</span><input type="number" step="0.01" min="0" data-dcp="price" value="${d.price}" dir="ltr"></label>`
          : `<div class="cc-dlg-row"><span>${label}</span><span class="cc-dd-pt">${t === 'vline' ? '' : `<input type="number" step="0.01" min="0" data-dcp="${key}" value="${d[key].price}" dir="ltr">`}<bdi dir="ltr">${dot(d[key].time)}</bdi></span></div>`).join('')
          + `<p class="cc-dlg-note">يمكن تعديل السعر مباشرة، والتاريخ يتغير بسحب الرسم في الشارت.</p>`;
      }
      const tabBtn = (k, label) => `<button type="button" role="tab" data-ddtab="${k}" aria-selected="${tab === k}">${label}</button>`;
      ddlg.innerHTML = `<div class="cc-dlg-box" role="dialog" aria-modal="true" aria-label="إعدادات ${esc(DRAW_TITLE[t])}" dir="rtl">
        <div class="cc-dlg-head"><b>${esc(DRAW_TITLE[t])}</b><button type="button" data-ddclose aria-label="إغلاق">✕</button></div>
        <div class="cc-dlg-tabs" role="tablist">${tabBtn('style', 'نمط')}${tabBtn('coords', 'إحداثيات')}</div>
        <div class="cc-dlg-body">${content}</div>
        <div class="cc-dlg-foot"><button type="button" data-ddreset>الإعدادات الافتراضية</button><button type="button" data-ddcancel>إلغاء</button><button type="button" data-ddok class="cc-dlg-ok">موافق</button></div>
      </div>`;
    }
    // backup: حالة الرسوم قبل الفتح. الرسم الجديد (نص) يمرّ به قبل أن يُكتب، فيُلغى إن أُغلقت النافذة فارغة
    function openDrawDialog(index, backup = null) {
      if (!drawings[index]) return;
      closeFlyout();
      ddState = { index, tab: 'style', backup: backup ?? snap(), fresh: backup !== null };
      renderDrawDialog(); ddlg.hidden = false;
      (ddlg.querySelector('[data-dd="text"]') || ddlg.querySelector('[data-ddtab="style"]'))?.focus();
    }
    function closeDrawDialog(keep) {
      if (!ddState) return;
      const { index, backup, fresh } = ddState;
      ddState = null; ddlg.hidden = true; ddlg.innerHTML = '';
      if (keep && !(fresh && !drawings[index]?.text)) {
        if (JSON.stringify(backup) !== JSON.stringify(drawings)) record(backup);
        saveDrawings(symbol, drawings);
        select(index < drawings.length ? index : -1);
      } else {
        drawings = backup;
        select(-1);
      }
      paintDrawings();
    }
    ddlg.addEventListener('input', event => {
      if (!ddState) return;
      const d = drawings[ddState.index], t = event.target;
      if (!d) return;
      const key = t.dataset.dd, cp = t.dataset.dcp;
      if (cp) {
        const v = Number(t.value);
        if (t.value === '' || !Number.isFinite(v) || v <= 0) return;
        if (cp === 'price') d.price = v; else d[cp].price = v;
      } else if (key === 'text') d.text = t.value;
      else if (key) d.style = { ...(d.style || {}), [key]: t.type === 'checkbox' ? t.checked : (key === 'width' || key === 'size') ? Number(t.value) : t.value };
      else return;
      paintDrawings();
    });
    ddlg.addEventListener('click', event => {
      if (!ddState) return;
      if (event.target === ddlg || event.target.closest('[data-ddclose],[data-ddcancel]')) { closeDrawDialog(false); return; }
      if (event.target.closest('[data-ddok]')) { closeDrawDialog(true); return; }
      const tab = event.target.closest('[data-ddtab]');
      if (tab) { ddState.tab = tab.dataset.ddtab; renderDrawDialog(); ddlg.querySelector(`[data-ddtab="${ddState.tab}"]`)?.focus(); return; }
      if (event.target.closest('[data-ddfib]')) { closeDrawDialog(true); toggleFibSettings(true); return; }
      if (event.target.closest('[data-ddreset]')) { const d = drawings[ddState.index]; if (d) delete d.style; renderDrawDialog(); paintDrawings(); }
    });
    ddlg.addEventListener('keydown', event => {
      if (!ddState) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDrawDialog(false); }
      else if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'color') { event.preventDefault(); closeDrawDialog(true); }
    });

    const SHORTCUT_MOD = event => event.ctrlKey || event.metaKey;
    document.addEventListener('keydown', event => {
      if (!box.isConnected || !dlg.hidden || !ddlg.hidden || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)) return;
      if (event.key === 'Escape' && !flyout.hidden) { closeFlyout(); return; }
      if (event.key === 'Escape') { if (state.tool) setTool(null); else if (selected >= 0) select(-1); else if (selInd) selectInd(null); else if (isFull()) setFull(false); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selInd && selected < 0 && !state.tool) { event.preventDefault(); removeInd(selInd); return; }
      // التراجع والإعادة كما في TradingView: Ctrl+Z وCtrl+Shift+Z وCtrl+Y (وكذلك ⌘ على ماك)
      if (SHORTCUT_MOD(event) && !event.altKey && event.code === 'KeyZ') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (SHORTCUT_MOD(event) && !event.altKey && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
      // Alt/⌥ + R كما في TradingView (الحرف بالموضع حتى يعمل مع لوحة المفاتيح العربية و⌥ في ماك)
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyR') { event.preventDefault(); resetView(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected >= 0 && !state.tool) { event.preventDefault(); deleteSelected(); }
    });

    /* ---------- إعدادات فيبوناتشي ---------- */
    function renderFibSettings() {
      const opt = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
      const check = (key, label) => `<label class="cc-fs-check"><input type="checkbox" data-fib-opt="${key}"${fib[key] ? ' checked' : ''}>${label}</label>`;
      fibPanel.innerHTML = `
        <div class="cc-fs-head"><b>إعدادات فيبوناتشي</b><span>تُطبّق على كل رسوم فيبوناتشي وتُحفظ في هذا المتصفح</span><button type="button" data-fib-reset>الإعدادات الافتراضية</button><button type="button" data-fib-close aria-label="إغلاق">✕</button></div>
        <div class="cc-fs-levels">${fib.levels.map((level, i) => `<div class="cc-fs-level"><input type="checkbox" data-fib-on="${i}"${level.on ? ' checked' : ''} aria-label="تفعيل المستوى"><input type="number" step="0.001" value="${level.value}" data-fib-value="${i}" aria-label="قيمة المستوى" dir="ltr"><input type="color" value="${level.color}" data-fib-color="${i}" aria-label="لون المستوى"></div>`).join('')}</div>
        <div class="cc-fs-options">
          ${check('trend', 'خط الاتجاه')}${check('background', 'الخلفية')}${check('reverse', 'انعكاس')}${check('prices', 'أسعار')}${check('showLevels', 'مستويات')}
          <label>عرض المستويات <select data-fib-opt="levelsAs">${opt('percent', 'نسب مئوية', fib.levelsAs)}${opt('values', 'قيم', fib.levelsAs)}</select></label>
          <label>العناوين <select data-fib-opt="labels">${opt('right', 'يمين', fib.labels)}${opt('left', 'يسار', fib.labels)}</select></label>
          <label>تمديد <select data-fib-opt="extend">${opt('none', 'لا تقم بالتمديد', fib.extend)}${opt('right', 'لليمين', fib.extend)}${opt('left', 'لليسار', fib.extend)}${opt('both', 'للجهتين', fib.extend)}</select></label>
        </div>`;
    }
    fibPanel.addEventListener('input', event => {
      const t = event.target, i = Number(t.dataset.fibOn ?? t.dataset.fibValue ?? t.dataset.fibColor);
      if (t.dataset.fibOn != null) fib.levels[i].on = t.checked;
      else if (t.dataset.fibValue != null) { const v = parseFloat(t.value); if (Number.isFinite(v)) fib.levels[i].value = v; }
      else if (t.dataset.fibColor != null) fib.levels[i].color = t.value;
      else if (t.dataset.fibOpt) fib[t.dataset.fibOpt] = t.type === 'checkbox' ? t.checked : t.value;
      else return;
      saveFib(); overlay.redraw();
    });
    fibPanel.addEventListener('click', event => {
      if (event.target.closest('[data-fib-close]')) toggleFibSettings(false);
      if (event.target.closest('[data-fib-reset]')) { fib = structuredClone(FIB_DEFAULT); saveFib(); renderFibSettings(); overlay.redraw(); }
    });
    function toggleFibSettings(open = fibPanel.hidden) {
      if (open) renderFibSettings();
      fibPanel.hidden = !open;
      panel.querySelector('[data-fibset]')?.setAttribute('aria-expanded', String(open));
    }

    /* ---------- الشريط الجانبي: قوائم المغناطيس والمؤشرات، والتلميحات، والقفل والإخفاء ---------- */
    function closeFlyout() {
      flyout.hidden = true; flyout.dataset.kind = '';
      sideBar.querySelectorAll('[data-menu]').forEach(x => x.setAttribute('aria-expanded', 'false'));
    }
    function openFlyout(kind, button) {
      if (!flyout.hidden && flyout.dataset.kind === kind) { closeFlyout(); return; }
      const row = (attr, id, on, inner) => `<button type="button" role="menuitemcheckbox" data-${attr}="${id}" aria-pressed="${on}">${inner}</button>`;
      flyout.innerHTML = kind === 'trash' ? trashMenu() : kind === 'magnet'
        ? `<b>المغناطيس</b>${MAGNETS.map(([id, t]) => row('magnet', id, state.magnet === id, `<span>${t}<small>${id === 'weak' ? 'يلصق النقطة بأقرب سعر في الشمعة حين يقترب المؤشر منه' : id === 'strong' ? 'يلصق النقطة دائمًا بأقرب سعر (افتتاح، أعلى، أدنى، إغلاق)' : 'النقطة حيث المؤشر تمامًا'}</small></span>`)).join('')}`
        : `<b>المؤشرات الفنية</b>${INDICATORS.map(x => { const p = Object.values(indCfg[x.id].plots)[0]; return row('ind', x.id, state.ind.has(x.id), `<i style="background:${p.color || p.colors?.[0] || colors?.muted || '#9da7b2'}"></i><span>${esc(indTitle(x.id))}</span>`); }).join('')}`;
      flyout.dataset.kind = kind; flyout.hidden = false; tip.hidden = true;
      sideBar.querySelectorAll('[data-menu]').forEach(x => x.setAttribute('aria-expanded', String(x === button)));
      // بجانب الزر، ولا تتجاوز أسفل منطقة الشارت
      const top = button.getBoundingClientRect().top - body.getBoundingClientRect().top;
      flyout.style.top = `${Math.max(0, Math.min(top, body.clientHeight - flyout.offsetHeight))}px`;
    }
    document.addEventListener('pointerdown', event => {
      if (!flyout.hidden && body.isConnected && !flyout.contains(event.target) && !event.target.closest?.('[data-menu]')) closeFlyout();
    });
    sideBar.addEventListener('pointerover', event => {
      const b = event.target.closest('button[data-tip]');
      if (!b || event.pointerType !== 'mouse' || (!flyout.hidden && b.dataset.menu === flyout.dataset.kind)) { tip.hidden = true; return; }
      tip.textContent = b.dataset.tip; tip.hidden = false;
      tip.style.top = `${b.getBoundingClientRect().top - body.getBoundingClientRect().top + b.offsetHeight / 2}px`;
    });
    sideBar.addEventListener('pointerleave', () => { tip.hidden = true; });
    sideBar.addEventListener('scroll', () => { tip.hidden = true; });
    const setSide = (attr, svgIcon, label, on) => {
      const b = sideBar.querySelector(`[${attr}]`); if (!b) return;
      b.innerHTML = svgIcon; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', label); b.dataset.tip = label;
      if (!tip.hidden) tip.textContent = label;
    };
    function setLocked(on) {
      state.locked = on; if (on && selected >= 0) select(-1);
      setSide('data-lock', on ? ICONS.lock : ICONS.unlock, LOCK_TIP(on), on); saveSettings();
    }
    function setHidden(on) {
      state.hidden = on; if (on && selected >= 0) select(-1);
      setSide('data-hide', on ? ICONS.eyeOff : ICONS.eye, HIDE_TIP(on), on); saveSettings();
      if (chart) paintDrawings();
    }

    /* ---------- البحث عن سهم ---------- */
    let stockList = [], matches = [], active = 0;
    loadStockList().then(list => { stockList = list; const me = list.find(x => x.symbol === String(symbol)); if (me) panel.querySelector('.cc-search-name').textContent = me.name; if (!home.name) home.name = list.find(x => x.symbol === home.symbol)?.name; });
    function markActive() {
      searchList.querySelectorAll('[data-pick]').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      const li = searchList.children[active];
      if (li?.dataset.pick) { li.scrollIntoView({ block: 'nearest' }); searchInput.setAttribute('aria-activedescendant', li.id); }
    }
    function renderMatches() {
      matches = searchStocks(stockList, searchInput.value); active = 0;
      searchList.innerHTML = matches.length
        ? matches.map(x => `<li role="option" id="cc-opt-${x.symbol}" data-pick="${esc(x.symbol)}" aria-selected="false"${x.symbol === String(symbol) ? ' class="cc-current"' : ''}><bdi class="cc-sym">${esc(x.symbol)}</bdi><span>${esc(x.name)}</span><small>${esc(x.sector)}</small></li>`).join('')
        : `<li class="cc-none">${stockList.length ? 'لا توجد نتائج مطابقة' : 'جار تحميل قائمة الأسهم…'}</li>`;
      markActive();
    }
    function openSearch(open) {
      searchPop.hidden = !open; searchBtn.setAttribute('aria-expanded', String(open));
      if (!open) return;
      searchInput.value = ''; renderMatches(); searchInput.focus();
      if (!stockList.length) loadStockList().then(list => { stockList = list; if (!searchPop.hidden) renderMatches(); });
    }
    function pick(sym) {
      const target = stockList.find(x => x.symbol === sym);
      if (!target) return;
      if (target.symbol === String(symbol)) { openSearch(false); return; }
      openSearch(false);
      show(target.symbol, { name: target.name, page: target.page });
    }
    // يبدّل الشارت إلى سهم آخر في المكان نفسه (مع ملء الشاشة إن كان مفعّلًا)، وبقية الصفحة لسهمها
    async function show(sym, away = {}) {
      const button = panel.querySelector('.cc-search-btn b'); if (button) button.textContent = sym;
      const next = sym === home.symbol ? home.file : await loadCandleFile(sym);
      if (!box.isConnected) return;
      if (!next) { if (button) button.textContent = String(symbol); hint.textContent = `لا تتوفر شموع للسهم ${sym} بعد`; hint.hidden = false; return; }
      mount(panel, next, { home, away, keepFull: isFull() });
    }
    searchInput.addEventListener('input', renderMatches);
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (matches.length) { active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; markActive(); } }
      else if (event.key === 'Enter') { event.preventDefault(); if (matches[active]) pick(matches[active].symbol); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); openSearch(false); searchBtn.focus(); }
    });
    searchList.addEventListener('click', event => { const li = event.target.closest('[data-pick]'); if (li) pick(li.dataset.pick); });
    searchList.addEventListener('pointermove', event => { const li = event.target.closest('[data-pick]'); const i = li ? [...searchList.children].indexOf(li) : -1; if (i >= 0 && i !== active) { active = i; markActive(); } });
    document.addEventListener('pointerdown', event => {
      if (!searchPop.hidden && searchPop.isConnected && !searchPop.contains(event.target) && !searchBtn.contains(event.target)) openSearch(false);
    });

    function setTool(tool) {
      state.tool = tool; pending = null; preview = null; hover = null;
      if (tool && selected >= 0) select(-1);
      // أثناء الرسم لا يتحرك الشارت بالسحب ولا يتكبّر، حتى لا يتعارض مع تحديد النقاط
      chart?.applyOptions({ handleScroll: !tool, handleScale: !tool });
      overlay.redraw();
      panel.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tool === tool)));
      panel.querySelector('[data-cursor]')?.setAttribute('aria-pressed', String(!tool));
      if (tool && state.hidden) setHidden(false); // الرسم الجديد يحتاج أن تكون الرسوم ظاهرة
      box.classList.toggle('cc-drawing', !!tool);
      applyCrosshair();
      positionFtb();
    }

    panel.addEventListener('click', event => {
      const b = event.target.closest('[data-home],[data-adj],[data-divmarks],[data-type],[data-interval],[data-crange],[data-ind],[data-tool],[data-tdel],[data-undo],[data-redo],[data-fibset],[data-magnet],[data-reset],[data-full],[data-cursor],[data-menu],[data-lock],[data-hide],[data-search]'); if (!b) return;
      if (b.hasAttribute('data-search')) { openSearch(searchPop.hidden); return; }
      if (b.hasAttribute('data-home')) { show(home.symbol); return; }
      if (!chart) return;
      if (b.dataset.menu) { openFlyout(b.dataset.menu, b); return; }
      if (b.dataset.tdel) { deleteAction(b.dataset.tdel); return; }
      if (b.hasAttribute('data-cursor')) { setTool(null); return; }
      if (b.hasAttribute('data-lock')) { setLocked(!state.locked); return; }
      if (b.hasAttribute('data-hide')) { setHidden(!state.hidden); return; }
      if (b.hasAttribute('data-reset')) { resetView(); return; }
      if (b.hasAttribute('data-full')) { setFull(!isFull()); return; }
      if (b.hasAttribute('data-fibset')) { toggleFibSettings(); return; }
      if (b.hasAttribute('data-undo')) { undo(); return; }
      if (b.hasAttribute('data-redo')) { redo(); return; }
      if (b.dataset.magnet) { state.magnet = b.dataset.magnet; panel.querySelectorAll('[data-magnet]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.magnet === state.magnet))); sideBar.querySelector('[data-menu="magnet"]')?.setAttribute('aria-pressed', String(state.magnet !== 'off')); saveSettings(); applyCrosshair(); closeFlyout(); return; }
      let keep = true;
      if (b.dataset.tool) { setTool(state.tool === b.dataset.tool ? null : b.dataset.tool); return; }
      if (b.dataset.adj) { state.adj = !state.adj; b.setAttribute('aria-pressed', String(state.adj)); }
      if (b.dataset.divmarks) { state.divMarks = !state.divMarks; b.setAttribute('aria-pressed', String(state.divMarks)); }
      if (b.dataset.type) state.type = b.dataset.type;
      if (b.dataset.interval) { state.interval = b.dataset.interval; state.range = DEFAULT_RANGE[state.interval]; keep = false; }
      if (b.dataset.crange) { state.range = b.dataset.crange; keep = false; }
      if (b.dataset.ind) { if (state.ind.has(b.dataset.ind)) state.ind.delete(b.dataset.ind); else state.ind.add(b.dataset.ind); }
      for (const [attr, key] of [['type', 'type'], ['interval', 'interval'], ['crange', 'range']]) panel.querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute('aria-pressed', String(x.dataset[attr] === state[key])));
      panel.querySelectorAll('[data-ind]').forEach(x => x.setAttribute('aria-pressed', String(state.ind.has(x.dataset.ind))));
      saveSettings();
      { const head = panel.querySelector('.cc-head-int'); if (head) head.textContent = INTERVALS.find(([id]) => id === state.interval)?.[1] ?? ''; }
      build(keep);
    });

    const theme = new MutationObserver(() => { if (!chart) return; colors = palette(panel); build(true); });
    current = { destroy({ keepFull = false } = {}) { if (isFull() && !keepFull) setFull(false); document.removeEventListener('fullscreenchange', onFullscreenChange); theme.disconnect(); resizeWatch.disconnect(); chart?.remove(); chart = null; } };
    loadLib().then(lib => {
      LWC = lib; colors = palette(panel);
      setTool(null);
      build(false);
      if (keepFull) setFull(true);
      try { if (sessionStorage.getItem('cc-full')) { sessionStorage.removeItem('cc-full'); setFull(true); } } catch { /* ignore */ }
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }).catch(() => { box.innerHTML = '<p class="cq-empty">تعذر تحميل مكتبة الشارت.</p>'; });
  }

  // الحسابات مكشوفة للاختبارات
  window.CompanyChart = { mount, load: loadCandleFile, indexEntry: INDEX_ENTRY, calc: { joinCandles, adjustDividends, group, sma, ema, bollinger, rsi, macd, fibLevels, FIB_DEFAULT, nearestPrice, IND_DEFAULT, mergeInd, indParams, srcOf, histColorIndex, crosshairDate, norm, searchStocks, SECTOR_PAGES, rangeLabel, addPeriods, periodsBetween } };
})();
