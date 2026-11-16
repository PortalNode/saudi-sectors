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
  const TYPES = [['line', 'خطي'], ['candles', 'شموع']];
  const INTERVALS = [['d', 'يومي'], ['w', 'أسبوعي'], ['m', 'شهري']];
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
  const TOOLS = [['hline', 'خط أفقي'], ['hray', 'شعاع أفقي'], ['trend', 'خط اتجاه'], ['fib', 'فيبوناتشي'], ['range', 'نطاق السعر']];
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
  const HINTS = {
    hline: 'اضغط على الشارت عند السعر المطلوب لرسم خط أفقي',
    hray: 'اضغط على نقطة البداية لرسم شعاع أفقي يمتد منها إلى اليمين',
    trend: 'اضغط على نقطة البداية ثم على النهاية، أو اسحب من البداية إلى النهاية · Esc للإلغاء',
    fib: 'اضغط على بداية الموجة (قمة أو قاع) ثم على نهايتها، أو اسحب بينهما · Esc للإلغاء',
    range: 'اضغط على السعر الأول ثم على الثاني، أو اسحب بينهما، لقياس الفرق ونسبته · Esc للإلغاء'
  };
  // أيقونات أزرار العرض: إعادة تعيين العرض، وملء الشاشة والخروج منه
  const svg = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_RESET = svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>');
  const ICON_FULL = svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>');
  const ICON_EXIT = svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>');
  // أيقونات الشريط الجانبي على نمط TradingView: خطوط رفيعة بمقاس 20
  const icon = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    cursor: icon('<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>'),
    trend: icon('<path d="M7.4 16.6l9.2-9.2"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/>'),
    hline: icon('<path d="M3 12h7M14 12h7"/><circle cx="12" cy="12" r="2"/>'),
    hray: icon('<circle cx="5" cy="12" r="2"/><path d="M7 12h14M18 9l3 3-3 3"/>'),
    fib: icon('<path d="M3 5h13M3 10h18M3 15h13M3 20h18"/><circle cx="18.5" cy="5" r="1.8"/><circle cx="18.5" cy="15" r="1.8"/>'),
    range: icon('<path d="M6 3.5h12M6 20.5h12M12 7v13"/><path d="M8.5 10L12 6.5 15.5 10"/>'),
    magnet: icon('<path d="M5 3.5h4.5V12a2.5 2.5 0 0 0 5 0V3.5H19V12a7 7 0 0 1-14 0z"/><path d="M5 7.5h4.5M14.5 7.5H19"/>'),
    ind: icon('<path d="M3 20.5h18"/><path d="M4 16c2.5-6 4.5-6 6.5-1.5S15 18 16.5 11 19 4 20.5 4"/>'),
    gear: icon('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    undo: icon('<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5 5 0 0 1 0 10H11"/>'),
    erase: icon('<path d="M14.5 4l5.5 5.5-9 9H6.5l-3-3z"/><path d="M9.5 9l5.5 5.5M11 20.5h9"/>'),
    lock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
    unlock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.7-1.5"/>'),
    eye: icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/>'),
    trash: icon('<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14M10 10.5v6.5M14 10.5v6.5"/>')
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
  let stockListPromise = null;
  const loadStockList = () => stockListPromise ??= fetch('data.json').then(r => r.json())
    .then(d => d.sectors.flatMap(sector => SECTOR_PAGES[sector.name] ? sector.stocks.map(x => ({ symbol: String(x.symbol), name: x.name, sector: sector.name, page: SECTOR_PAGES[sector.name] })) : []))
    .catch(() => { stockListPromise = null; return []; });
  // الرمز المطابق أولًا، ثم ما يبدأ به الرمز، ثم ما يبدأ به الاسم
  const searchRank = (x, q) => x.symbol === q ? 0 : x.symbol.startsWith(q) ? 1 : norm(x.name).startsWith(q) ? 2 : 3;
  function searchStocks(list, query) {
    const q = norm(query);
    if (!q) return list;
    return list.filter(x => x.symbol.includes(q) || norm(x.name).includes(q)).sort((a, b) => searchRank(a, q) - searchRank(b, q));
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
  function sma(values, n) { const out = []; let sum = 0; values.forEach((v, i) => { sum += v; if (i >= n) sum -= values[i - n]; out.push(i >= n - 1 ? sum / n : null); }); return out; }
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
  function macd(values) { const fast = ema(values, 12), slow = ema(values, 26), line = values.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null), signal = ema(line, 9); return line.map((m, i) => m == null ? null : { macd: m, signal: signal[i], hist: signal[i] == null ? null : m - signal[i] }); }

  /* ---------- الألوان من متغيرات الصفحة ---------- */
  function palette(el) {
    const css = getComputedStyle(el), v = name => css.getPropertyValue(name).trim();
    return { ink: v('--pf-ink') || '#eef2f5', muted: v('--pf-muted') || '#9da7b2', line: v('--pf-line') || '#27313b', up: v('--cq-up') || '#22c55e', down: v('--cq-down') || '#f05252', gold: v('--pf-gold') || '#f59e0b' };
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
  function mount(panel, file, { home = null, away = {}, keepFull = false } = {}) {
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
          <div class="cq-range" role="group" aria-label="نوع الشارت">${TYPES.map(([id, t]) => chip('type', id, t, id === state.type)).join('')}</div>
          <div class="cq-range" role="group" aria-label="الفترة الزمنية للشمعة">${INTERVALS.map(([id, t]) => chip('interval', id, t, id === state.interval)).join('')}</div>
          <div class="cq-range" role="group" aria-label="مدة العرض">${RANGES.map(([id, t]) => chip('crange', id, t, id === state.range)).join('')}</div>
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
          ${side('data-undo', ICONS.undo, 'تراجع عن آخر رسمة')}
          ${side('data-delete disabled', ICONS.erase, 'حذف الرسمة المحددة (Delete)')}
          ${side('data-lock', state.locked ? ICONS.lock : ICONS.unlock, LOCK_TIP(state.locked), state.locked)}
          ${side('data-hide', state.hidden ? ICONS.eyeOff : ICONS.eye, HIDE_TIP(state.hidden), state.hidden)}
          <hr>
          ${side('data-clear', ICONS.trash, 'مسح كل الرسوم')}
        </div>
        <div class="cc-main" dir="rtl">
          <div class="cc-legend" aria-live="polite"></div>
          <div class="cc-stage">
            <div class="cc-chart" dir="ltr"><p class="cq-empty">جار تحميل الشارت…</p></div>
            <div class="cc-float"><button type="button" data-reset title="إعادة تعيين عرض الرسم البياني (${RESET_KEY})" aria-label="إعادة تعيين عرض الرسم البياني">${ICON_RESET}</button></div>
          </div>
        </div>
        <div class="cc-flyout" dir="rtl" role="menu" hidden></div>
        <div class="cc-tip" dir="rtl" role="tooltip" hidden></div>
      </div>
      <p class="cc-hint" hidden></p>
      ${String(symbol) !== home.symbol ? `<p class="cc-away" role="status">يعرض الشارت <b>${esc(away.name || symbol)}</b> <bdi>${esc(symbol)}</bdi>${away.page ? ` · <a href="${esc(away.page)}?symbol=${encodeURIComponent(symbol)}">نتائج الشركة</a>` : ''} · <button type="button" data-home>العودة إلى ${esc(home.name || home.symbol)}</button></p>` : ''}
      <p class="cq-source">${bigJumps(file).length ? `<span class="cc-flag-note">▼ علامة على الشارت: قفزة تتجاوز 15% في جلسة واحدة، غالبًا إجراء على رأس المال. </span>` : ''}شموع يومية على أساس TradingView حتى آخر إغلاق رسمي من تداول السعودية، معدّلة لإجراءات رأس المال (المنح والتجزئة والتخفيض وحقوق الأولوية)، وللتوزيعات النقدية عند تفعيل ADJ كما في TradingView، والأسبوعية (الأحد – الخميس) والشهرية مجمّعة منها · اسحب للتنقل وكبّر بعجلة الماوس · الرسوم تُحفظ في هذا المتصفح فقط</p>`;
    const box = panel.querySelector('.cc-chart'), legend = panel.querySelector('.cc-legend'), changeEl = panel.querySelector('.cc-change'), hint = panel.querySelector('.cc-hint'), fibPanel = panel.querySelector('.cc-fib-settings');
    const searchBtn = panel.querySelector('[data-search]'), searchPop = panel.querySelector('.cc-search-pop'), searchInput = searchPop.querySelector('input'), searchList = searchPop.querySelector('ul');
    const body = panel.querySelector('.cc-body'), sideBar = panel.querySelector('.cc-side'), flyout = panel.querySelector('.cc-flyout'), tip = panel.querySelector('.cc-tip');
    let chart = null, LWC = null, colors = null, data = [], main = null, calc = {}, drawn = [], preview = null;
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
      const cell = (k, v, color) => `<span${color ? ` class="cc-ind" style="--c:${color}"` : ''}>${k} <bdi>${v}</bdi></span>`;
      const ind = INDICATORS.filter(x => state.ind.has(x.id) && x.kind !== 'volume').map(x => {
        const v = calc[x.id]?.[i];
        if (v == null) return '';
        if (x.id === 'bb') return cell('بولنجر', `${f2.format(v.low)} – ${f2.format(v.up)}`, x.color);
        if (x.id === 'macd') return cell('MACD', `${f2.format(v.macd)}${v.signal != null ? ` / ${f2.format(v.signal)}` : ''}`, x.color);
        return cell(x.label, f2.format(v), x.color);
      }).join('');
      // جلسة لم تصل شمعتها من المصدر: الإغلاق رسمي، والافتتاح والأعلى والأدنى والحجم تقديرية
      const estNote = state.interval === 'd' && estimated.has(b.time) ? '<span class="cc-est">تقديرية</span>' : '';
      legend.innerHTML = `<b>${when}</b>${estNote}${cell('افتتاح', f2.format(b.open))}${cell('أعلى', f2.format(b.high))}${cell('أدنى', f2.format(b.low))}${cell('إغلاق', f2.format(b.close))}${ch == null ? '' : `<span class="cq-${dir}"><bdi>${ch > 0 ? '+' : ''}${f2.format(ch)}%</bdi></span>`}${state.ind.has('vol') ? cell('الحجم', big.format(b.volume)) : ''}${ind}`;
    }

    // الرسوم محفوظة بالسعر والتاريخ، فتظهر في اليومي والأسبوعي والشهري (على أقرب شمعة)
    const barIndex = iso => { let k = 0; for (let i = 0; i < data.length && data[i].time <= iso; i++) k = i; return k; };
    // موضع نقطة الرسم: داخل الشموع على أقرب شمعة، وبعد آخر شمعة بعدد الفترات المقبلة
    const lastIndex = () => data.length - 1;
    const logicalOf = iso => iso > data[lastIndex()].time ? lastIndex() + periodsBetween(data[lastIndex()].time, iso, state.interval) : barIndex(iso);
    const timeAt = index => index <= lastIndex() ? data[Math.max(0, index)].time : addPeriods(data[lastIndex()].time, index - lastIndex(), state.interval);
    // الخط الأفقي يمتد بعرض الشارت كما في TradingView؛ خط الاتجاه وفيبوناتشي يُرسمان على اللوحة بين النقطتين
    function paintDrawings() {
      for (const d of drawn) d.remove();
      drawn = [];
      for (const d of state.hidden ? [] : drawings) if (d.type === 'hline') {
        const line = main.createPriceLine({ price: d.price, color: colors.gold, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '' });
        drawn.push({ remove: () => main.removePriceLine(line) });
      }
      // الشعاع الأفقي يُرسم على اللوحة من نقطة البداية؛ هنا سعره على المحور فقط
      for (const d of state.hidden ? [] : drawings) if (d.type === 'hray') {
        const line = main.createPriceLine({ price: d.a.price, color: colors.gold, lineVisible: false, axisLabelVisible: true, title: '' });
        drawn.push({ remove: () => main.removePriceLine(line) });
      }
      overlay.redraw();
    }
    const xy = p => { const x = chart.timeScale().logicalToCoordinate(p.logical ?? logicalOf(p.time)), y = main.priceToCoordinate(p.price); return x == null || y == null ? null : { x, y }; };
    function drawShapes(ctx) {
      const ts = chart.timeScale();
      const handle = (pt, color) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); };
      const dotAt = (pt, color) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
      const segment = (a, b, color, width, dash = []) => { ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };
      ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textBaseline = 'bottom';
      const drawSelection = () => drawings.forEach((d, i) => {
        if (i !== selected) return;
        if (d.type === 'hline') { const y = main.priceToCoordinate(d.price); if (y != null) { handle({ x: 24, y }, colors.gold); handle({ x: ts.width() - 24, y }, colors.gold); } return; }
        if (d.type === 'hray') { const A = xy(d.a); if (A) handle(A, colors.gold); return; }
        const A = xy(d.a), B = xy(d.b);
        if (A && B) { handle(A, colors.gold); handle(B, colors.gold); }
      });
      for (const d of [...(state.hidden ? [] : drawings), ...(preview ? [preview] : [])]) {
        if (d.type === 'hray') { const A = xy(d.a); if (A && A.x < ts.width()) { segment(A, { x: ts.width(), y: A.y }, colors.gold, 1.5); dotAt(A, colors.gold); } continue; }
        if (!['trend', 'fib', 'range'].includes(d.type)) continue;
        const A = xy(d.a), B = xy(d.b);
        if (!A || !B) continue;
        if (d.type === 'range') {
          // نطاق السعر: مستطيل بين السعرين، وسهم من الأول إلى الثاني، والفرق ونسبته
          const color = d.b.price >= d.a.price ? '#2962ff' : '#f23645';
          const x1 = Math.min(A.x, B.x), x2 = Math.max(A.x, B.x, x1 + 1), cx = (x1 + x2) / 2;
          ctx.fillStyle = color + '26'; ctx.fillRect(x1, Math.min(A.y, B.y), x2 - x1, Math.abs(B.y - A.y));
          segment({ x: x1, y: A.y }, { x: x2, y: A.y }, color, 1);
          segment({ x: x1, y: B.y }, { x: x2, y: B.y }, color, 1);
          segment({ x: cx, y: A.y }, { x: cx, y: B.y }, color, 1.5);
          const dir = B.y < A.y ? -1 : 1;
          if (Math.abs(B.y - A.y) > 8) { ctx.beginPath(); ctx.moveTo(cx, B.y); ctx.lineTo(cx - 5, B.y - dir * 7); ctx.lineTo(cx + 5, B.y - dir * 7); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); }
          const text = rangeLabel(d.a.price, d.b.price), w = ctx.measureText(text).width + 14, h = 20;
          const ly = dir < 0 ? B.y - h - 6 : B.y + 6;
          ctx.fillStyle = color; ctx.fillRect(cx - w / 2, ly, w, h);
          ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(text, cx, ly + h - 4);
          continue;
        }
        if (d.type === 'trend') { segment(A, B, colors.gold, 2); dotAt(A, colors.gold); dotAt(B, colors.gold); continue; }
        // فيبوناتشي: المستويات بين نقطتي الموجة (أو ممتدة حسب الإعداد)، والعناوين على يمينها فوق الخط كما في TradingView
        const paneWidth = ts.width();
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
        if (fib.trend) { segment(A, B, colors.muted, 1, [4, 4]); }
        dotAt(A, colors.muted); dotAt(B, colors.muted);
      }
      drawSelection();
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
      paneViews() { return [{ zOrder: () => 'top', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(({ context }) => drawShapes(context)) }) }]; }
    };

    function build(keepRange) {
      const saved = keepRange && chart ? chart.timeScale().getVisibleLogicalRange() : null;
      chart?.remove();
      box.innerHTML = '';
      daily = state.adj ? adjustDividends(raw, dividends) : raw;
      data = group(daily, state.interval);
      const closes = data.map(b => b.close);
      calc = {
        sma20: state.ind.has('sma20') ? sma(closes, 20) : null, sma50: state.ind.has('sma50') ? sma(closes, 50) : null,
        sma200: state.ind.has('sma200') ? sma(closes, 200) : null, ema20: state.ind.has('ema20') ? ema(closes, 20) : null,
        bb: state.ind.has('bb') ? bollinger(closes) : null, rsi: state.ind.has('rsi') ? rsi(closes) : null, macd: state.ind.has('macd') ? macd(closes) : null
      };
      const panes = ['rsi', 'macd'].filter(id => state.ind.has(id));
      box.style.setProperty('--cc-panes', panes.length);
      chart = LWC.createChart(box, {
        autoSize: true,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: colors.muted, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, panes: { separatorColor: colors.line, separatorHoverColor: colors.line } },
        grid: { vertLines: { visible: false }, horzLines: { color: colors.line } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: state.ind.has('vol') ? 0.24 : 0.06 } },
        timeScale: { borderVisible: false, rightOffset: 2, minBarSpacing: 0.4 },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        localization: { priceFormatter: p => f2.format(p) }
      });
      const { up, down } = colors;
      main = state.type === 'candles'
        ? chart.addSeries(LWC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineColor: colors.muted })
        : chart.addSeries(LWC.AreaSeries, { lineColor: colors.gold, topColor: colors.gold + '55', bottomColor: colors.gold + '00', lineWidth: 2, priceLineColor: colors.muted });
      main.setData(state.type === 'candles' ? data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) : data.map(b => ({ time: b.time, value: b.close })));
      if (state.ind.has('vol')) {
        const volume = chart.addSeries(LWC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volume.setData(data.map(b => ({ time: b.time, value: b.volume, color: (b.close >= b.open ? up : down) + '66' })));
      }
      const line = (values, color, pane = 0, opts = {}) => {
        const s = chart.addSeries(LWC.LineSeries, { color, lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...opts }, pane);
        s.setData(data.map((b, i) => values[i] == null ? { time: b.time } : { time: b.time, value: values[i] }));
        return s;
      };
      for (const x of INDICATORS) if (x.kind === 'overlay' && calc[x.id]) {
        if (x.id === 'bb') { line(calc.bb.map(v => v?.up ?? null), x.color, 0, { lineStyle: 2 }); line(calc.bb.map(v => v?.mid ?? null), x.color, 0, { lineWidth: 1 }); line(calc.bb.map(v => v?.low ?? null), x.color, 0, { lineStyle: 2 }); }
        else line(calc[x.id], x.color);
      }
      let pane = 1;
      if (calc.rsi) {
        const s = line(calc.rsi, INDICATORS.find(x => x.id === 'rsi').color, pane, { lastValueVisible: true, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } });
        for (const level of [70, 30]) s.createPriceLine({ price: level, color: colors.muted, lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: false });
        pane += 1;
      }
      if (calc.macd) {
        const hist = chart.addSeries(LWC.HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
        hist.setData(data.map((b, i) => { const v = calc.macd[i]?.hist; return v == null ? { time: b.time } : { time: b.time, value: v, color: (v >= 0 ? up : down) + '99' }; }));
        line(calc.macd.map(v => v?.macd ?? null), '#3987e5', pane, { lastValueVisible: true });
        line(calc.macd.map(v => v?.signal ?? null), '#d95926', pane);
      }
      chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
      if (state.interval === 'd') {
        // علامة D على شمعة استحقاق كل توزيع، كما في TradingView، وعلامة القفزات غير المفسَّرة
        const marks = bigJumps(file).filter(f => data.some(b => b.time === f.date)).map(f => ({ time: f.date, position: 'aboveBar', color: colors.gold, shape: 'arrowDown', text: `${f.change > 0 ? '+' : ''}${f2.format(f.change)}%` }));
        if (state.divMarks) for (const [date, amount] of dividends) { const b = data.find(x => x.time >= date); if (b) marks.push({ time: b.time, position: 'belowBar', color: colors.gold, shape: 'circle', text: `D ${f2.format(amount)}` }); }
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
    function finish(point) {
      if (point.logical === pending.logical) return; // النقطتان على الشمعة نفسها: انتظر نقطة أخرى
      const strip = p => ({ time: p.time, price: p.price });
      drawings.push({ type: state.tool, a: strip(pending), b: strip(point) });
      saveDrawings(symbol, drawings);
      setTool(null);
      paintDrawings();
    }
    box.addEventListener('pointerdown', event => {
      if (!state.tool || event.button !== 0) return;
      const point = pointFrom(event); if (!point) return;
      event.preventDefault();
      press = { x: event.clientX, y: event.clientY, point };
      if (state.tool === 'hline' || state.tool === 'hray') return;
      if (pending) { finish(point); press = null; return; }
      pending = point; preview = { type: state.tool, a: point, b: point };
      hint.textContent = state.tool === 'fib' ? 'حرّك المؤشر إلى نهاية الموجة واضغط، أو اسحب وأفلت' : 'حرّك المؤشر إلى النقطة الثانية واضغط، أو اسحب وأفلت';
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

    /* ---------- تحرير الرسوم بعد تثبيتها: تحديد، سحب الرسمة كاملة أو أحد طرفيها، حذف ---------- */
    const local = event => { const rect = box.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    function distanceToSegment(x, y, A, B) {
      const dx = B.x - A.x, dy = B.y - A.y, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / len)) : 0;
      return Math.hypot(x - (A.x + t * dx), y - (A.y + t * dy));
    }
    function hitTest(x, y) {
      if (state.hidden || state.locked) return null; // الرسوم المخفية أو المقفلة لا تُحدَّد ولا تُسحب
      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i];
        if (d.type === 'hline') { const py = main.priceToCoordinate(d.price); if (py != null && Math.abs(py - y) <= 5) return { index: i, part: 'body' }; continue; }
        if (d.type === 'hray') {
          const A = xy(d.a); if (!A) continue;
          if (Math.hypot(A.x - x, A.y - y) <= 9) return { index: i, part: 'a' };
          if (x >= A.x - 4 && Math.abs(A.y - y) <= 5) return { index: i, part: 'body' };
          continue;
        }
        const A = xy(d.a), B = xy(d.b);
        if (!A || !B) continue;
        if (Math.hypot(A.x - x, A.y - y) <= 9) return { index: i, part: 'a' };
        if (Math.hypot(B.x - x, B.y - y) <= 9) return { index: i, part: 'b' };
        const inBox = (x1, x2, y1, y2) => x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4;
        if (d.type === 'trend' && distanceToSegment(x, y, A, B) <= 6) return { index: i, part: 'body' };
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
      const button = panel.querySelector('[data-delete]');
      if (button) button.disabled = selected < 0;
      if (!state.tool) { hint.hidden = selected < 0; hint.textContent = selected < 0 ? '' : 'اسحب الرسمة لتحريكها، أو اسحب أحد طرفيها لتعديله · Delete للحذف · Esc لإلغاء التحديد'; }
      overlay.redraw();
    }
    function deleteSelected() {
      if (selected < 0 || !drawings[selected]) return;
      drawings.splice(selected, 1);
      saveDrawings(symbol, drawings);
      select(-1);
      paintDrawings();
    }
    // في مرحلة الالتقاط: قبل أن تبدأ المكتبة سحب الشارت
    box.addEventListener('pointerdown', event => {
      if (state.tool || event.button !== 0 || !chart || !main) return;
      const { x, y } = local(event);
      const hit = y <= chart.panes()[0].getHeight() ? hitTest(x, y) : null;
      if (!hit) { if (selected >= 0) select(-1); return; }
      chart.applyOptions({ handleScroll: false, handleScale: false });
      event.preventDefault(); event.stopPropagation();
      drag = { ...hit, logical: chart.timeScale().coordinateToLogical(x), price: main.coordinateToPrice(y), orig: structuredClone(drawings[hit.index]), moved: false };
      try { box.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      select(hit.index);
      applyCrosshair();
    }, true);
    box.addEventListener('pointermove', event => {
      if (state.tool) return;
      const { x, y } = local(event);
      if (!drag) {
        const hit = chart && main && y <= chart.panes()[0].getHeight() ? hitTest(x, y) : null;
        box.style.cursor = hit ? (hit.part === 'body' ? 'move' : 'grab') : '';
        return;
      }
      const d = drawings[drag.index];
      if (drag.part === 'body') {
        const dl = Math.round((chart.timeScale().coordinateToLogical(x) ?? drag.logical) - drag.logical);
        const dp = (main.coordinateToPrice(y) ?? drag.price) - drag.price;
        if (d.type === 'hline') d.price = Math.round((drag.orig.price + dp) * 100) / 100;
        else { const shift = p => ({ time: timeAt(Math.max(0, logicalOf(p.time) + dl)), price: p.price + dp }); d.a = shift(drag.orig.a); d.b = shift(drag.orig.b); }
      } else {
        // طرف الرسمة يتبع المؤشر، ويلتصق بالمغناطيس إن كان مفعّلًا
        const point = pointFrom(event);
        if (point) { d[drag.part] = { time: point.time, price: point.price }; if (d.type === 'hray') d.b = { ...d.a }; hover = point; }
      }
      drag.moved = true;
      if (d.type === 'hline' || d.type === 'hray') paintDrawings(); else overlay.redraw();
    });
    box.addEventListener('pointerup', () => {
      if (!drag) return;
      if (drag.moved) saveDrawings(symbol, drawings);
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
      if (state.tool === 'hline' && !moved) {
        drawings.push({ type: 'hline', price: Math.round(press.point.price * 100) / 100 });
        saveDrawings(symbol, drawings); setTool(null); paintDrawings();
      } else if (state.tool === 'hray' && !moved) {
        const a = { time: press.point.time, price: Math.round(press.point.price * 100) / 100 };
        drawings.push({ type: 'hray', a, b: { ...a } });
        saveDrawings(symbol, drawings); setTool(null); paintDrawings();
      } else if (pending && moved) { const point = pointFrom(event) ?? preview?.b; if (point) finish(point); }
      press = null;
    });
    document.addEventListener('keydown', event => {
      if (!box.isConnected || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)) return;
      if (event.key === 'Escape' && !flyout.hidden) { closeFlyout(); return; }
      if (event.key === 'Escape') { if (state.tool) setTool(null); else if (selected >= 0) select(-1); else if (isFull()) setFull(false); }
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
      flyout.innerHTML = kind === 'magnet'
        ? `<b>المغناطيس</b>${MAGNETS.map(([id, t]) => row('magnet', id, state.magnet === id, `<span>${t}<small>${id === 'weak' ? 'يلصق النقطة بأقرب سعر في الشمعة حين يقترب المؤشر منه' : id === 'strong' ? 'يلصق النقطة دائمًا بأقرب سعر (افتتاح، أعلى، أدنى، إغلاق)' : 'النقطة حيث المؤشر تمامًا'}</small></span>`)).join('')}`
        : `<b>المؤشرات الفنية</b>${INDICATORS.map(x => row('ind', x.id, state.ind.has(x.id), `<i style="background:${x.color || colors?.muted || '#9da7b2'}"></i><span>${x.title}</span>`)).join('')}`;
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
      if (!next) { if (button) button.textContent = String(symbol); hint.textContent = `لا تتوفر شموع للسهم ${sym} بعد`; return; }
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
      hint.hidden = !tool;
      hint.textContent = HINTS[tool] ?? '';
      applyCrosshair();
    }

    panel.addEventListener('click', event => {
      const b = event.target.closest('[data-home],[data-adj],[data-divmarks],[data-type],[data-interval],[data-crange],[data-ind],[data-tool],[data-clear],[data-undo],[data-fibset],[data-magnet],[data-delete],[data-reset],[data-full],[data-cursor],[data-menu],[data-lock],[data-hide],[data-search]'); if (!b) return;
      if (b.hasAttribute('data-search')) { openSearch(searchPop.hidden); return; }
      if (b.hasAttribute('data-home')) { show(home.symbol); return; }
      if (!chart) return;
      if (b.dataset.menu) { openFlyout(b.dataset.menu, b); return; }
      if (b.hasAttribute('data-cursor')) { setTool(null); return; }
      if (b.hasAttribute('data-lock')) { setLocked(!state.locked); return; }
      if (b.hasAttribute('data-hide')) { setHidden(!state.hidden); return; }
      if (b.hasAttribute('data-reset')) { resetView(); return; }
      if (b.hasAttribute('data-full')) { setFull(!isFull()); return; }
      if (b.hasAttribute('data-fibset')) { toggleFibSettings(); return; }
      if (b.dataset.magnet) { state.magnet = b.dataset.magnet; panel.querySelectorAll('[data-magnet]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.magnet === state.magnet))); sideBar.querySelector('[data-menu="magnet"]')?.setAttribute('aria-pressed', String(state.magnet !== 'off')); saveSettings(); applyCrosshair(); closeFlyout(); return; }
      let keep = true;
      if (b.dataset.tool) { setTool(state.tool === b.dataset.tool ? null : b.dataset.tool); return; }
      if (b.hasAttribute('data-delete')) { deleteSelected(); return; }
      if (b.hasAttribute('data-undo')) { select(-1); drawings.pop(); saveDrawings(symbol, drawings); setTool(null); paintDrawings(); return; }
      if (b.hasAttribute('data-clear')) { select(-1); drawings = []; saveDrawings(symbol, drawings); setTool(null); paintDrawings(); return; }
      if (b.dataset.adj) { state.adj = !state.adj; b.setAttribute('aria-pressed', String(state.adj)); }
      if (b.dataset.divmarks) { state.divMarks = !state.divMarks; b.setAttribute('aria-pressed', String(state.divMarks)); }
      if (b.dataset.type) state.type = b.dataset.type;
      if (b.dataset.interval) { state.interval = b.dataset.interval; state.range = DEFAULT_RANGE[state.interval]; keep = false; }
      if (b.dataset.crange) { state.range = b.dataset.crange; keep = false; }
      if (b.dataset.ind) { if (state.ind.has(b.dataset.ind)) state.ind.delete(b.dataset.ind); else state.ind.add(b.dataset.ind); }
      for (const [attr, key] of [['type', 'type'], ['interval', 'interval'], ['crange', 'range']]) panel.querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute('aria-pressed', String(x.dataset[attr] === state[key])));
      panel.querySelectorAll('[data-ind]').forEach(x => x.setAttribute('aria-pressed', String(state.ind.has(x.dataset.ind))));
      saveSettings();
      build(keep);
    });

    const theme = new MutationObserver(() => { if (!chart) return; colors = palette(panel); build(true); });
    current = { destroy({ keepFull = false } = {}) { if (isFull() && !keepFull) setFull(false); document.removeEventListener('fullscreenchange', onFullscreenChange); theme.disconnect(); chart?.remove(); chart = null; } };
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
  window.CompanyChart = { mount, load: loadCandleFile, calc: { joinCandles, adjustDividends, group, sma, ema, bollinger, rsi, macd, fibLevels, FIB_DEFAULT, nearestPrice, norm, searchStocks, SECTOR_PAGES, rangeLabel, addPeriods, periodsBetween } };
})();
