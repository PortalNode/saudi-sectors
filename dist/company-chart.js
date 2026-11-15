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
  const RANGES = [['3m', '3 أشهر', 3], ['6m', '6 أشهر', 6], ['1y', 'سنة', 12], ['3y', '3 سنوات', 36], ['5y', '5 سنوات', 60]];
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
  const TOOLS = [['hline', 'خط أفقي'], ['trend', 'خط اتجاه'], ['fib', 'فيبوناتشي'], ['range', 'نطاق السعر']];
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
    trend: 'اضغط على نقطة البداية ثم على النهاية، أو اسحب من البداية إلى النهاية · Esc للإلغاء',
    fib: 'اضغط على بداية الموجة (قمة أو قاع) ثم على نهايتها، أو اسحب بينهما · Esc للإلغاء',
    range: 'اضغط على السعر الأول ثم على الثاني، أو اسحب بينهما، لقياس الفرق ونسبته · Esc للإلغاء'
  };
  const bigJumps = file => (file.flags || []).filter(f => Math.abs(f.change) >= 15);

  const state = { type: 'candles', interval: 'd', range: '1y', ind: new Set(['vol', 'sma50']), tool: null, magnet: 'off' };
  try { const saved = JSON.parse(localStorage.getItem('cc-settings') || 'null'); if (saved) { if (saved.type) state.type = saved.type; if (Array.isArray(saved.ind)) state.ind = new Set(saved.ind); if (MAGNETS.some(([id]) => id === saved.magnet)) state.magnet = saved.magnet; } } catch { /* storage unavailable */ }
  const saveSettings = () => { try { localStorage.setItem('cc-settings', JSON.stringify({ type: state.type, ind: [...state.ind], magnet: state.magnet })); } catch { /* ignore */ } };
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
  const chip = (attr, id, label, on, title = '') => `<button type="button" data-${attr}="${id}" aria-pressed="${on}"${title ? ` title="${title}"` : ''}>${label}</button>`;

  function mount(panel, file) {
    current?.destroy();
    const daily = bars(file), symbol = file.symbol;
    let drawings = loadDrawings(symbol), pending = null;
    panel.innerHTML = `
      <div class="cc-toolbar">
        <div class="cq-range" role="group" aria-label="نوع الشارت">${TYPES.map(([id, t]) => chip('type', id, t, id === state.type)).join('')}</div>
        <div class="cq-range" role="group" aria-label="الفترة الزمنية للشمعة">${INTERVALS.map(([id, t]) => chip('interval', id, t, id === state.interval)).join('')}</div>
        <div class="cq-range" role="group" aria-label="مدة العرض">${RANGES.map(([id, t]) => chip('crange', id, t, id === state.range)).join('')}</div>
        <span class="cq-range-change cc-change"></span>
      </div>
      <div class="cc-toolbar cc-tools">
        <span class="cc-tools-label">المؤشرات</span>
        <div class="cc-chips" role="group" aria-label="المؤشرات الفنية">${INDICATORS.map(x => chip('ind', x.id, `${x.color ? `<i style="background:${x.color}"></i>` : ''}${x.label}`, state.ind.has(x.id), x.title)).join('')}</div>
        <span class="cc-tools-label">الرسم</span>
        <div class="cc-chips" role="group" aria-label="أدوات الرسم">${TOOLS.map(([id, t]) => chip('tool', id, t, state.tool === id)).join('')}<button type="button" data-fibset title="إعدادات فيبوناتشي" aria-expanded="false">⚙ إعدادات فيبوناتشي</button><button type="button" data-undo>تراجع</button><button type="button" data-clear>مسح الرسوم</button></div>
        <span class="cc-tools-label">المغناطيس</span>
        <div class="cq-range" role="group" aria-label="المغناطيس">${MAGNETS.map(([id, t]) => chip('magnet', id, t, state.magnet === id, id === 'weak' ? 'يلصق النقطة بأقرب سعر في الشمعة حين يقترب المؤشر منه' : id === 'strong' ? 'يلصق النقطة دائمًا بأقرب سعر في الشمعة (افتتاح، أعلى، أدنى، إغلاق)' : '')).join('')}</div>
      </div>
      <div class="cc-fib-settings" hidden></div>
      <div class="cc-legend" aria-live="polite"></div>
      <div class="cc-chart" dir="ltr"><p class="cq-empty">جار تحميل الشارت…</p></div>
      <p class="cc-hint" hidden></p>
      <p class="cq-source">${bigJumps(file).length ? `<span class="cc-flag-note">▼ علامة على الشارت: قفزة تتجاوز 15% في جلسة واحدة، غالبًا إجراء على رأس المال. </span>` : ''}شموع يومية حتى آخر إغلاق رسمي، والأسبوعية (الأحد – الخميس) والشهرية مجمّعة منها · اسحب للتنقل وكبّر بعجلة الماوس · الرسوم تُحفظ في هذا المتصفح فقط</p>`;
    const box = panel.querySelector('.cc-chart'), legend = panel.querySelector('.cc-legend'), changeEl = panel.querySelector('.cc-change'), hint = panel.querySelector('.cc-hint'), fibPanel = panel.querySelector('.cc-fib-settings');
    let chart = null, LWC = null, colors = null, data = [], main = null, calc = {}, drawn = [], preview = null;

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
      legend.innerHTML = `<b>${when}</b>${cell('افتتاح', f2.format(b.open))}${cell('أعلى', f2.format(b.high))}${cell('أدنى', f2.format(b.low))}${cell('إغلاق', f2.format(b.close))}${ch == null ? '' : `<span class="cq-${dir}"><bdi>${ch > 0 ? '+' : ''}${f2.format(ch)}%</bdi></span>`}${state.ind.has('vol') ? cell('الحجم', big.format(b.volume)) : ''}${ind}`;
    }

    // الرسوم محفوظة بالسعر والتاريخ، فتظهر في اليومي والأسبوعي والشهري (على أقرب شمعة)
    const barIndex = iso => { let k = 0; for (let i = 0; i < data.length && data[i].time <= iso; i++) k = i; return k; };
    // الخط الأفقي يمتد بعرض الشارت كما في TradingView؛ خط الاتجاه وفيبوناتشي يُرسمان على اللوحة بين النقطتين
    function paintDrawings() {
      for (const d of drawn) d.remove();
      drawn = [];
      for (const d of drawings) if (d.type === 'hline') {
        const line = main.createPriceLine({ price: d.price, color: colors.gold, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '' });
        drawn.push({ remove: () => main.removePriceLine(line) });
      }
      overlay.redraw();
    }
    function drawShapes(ctx) {
      const ts = chart.timeScale();
      const xy = p => { const x = ts.logicalToCoordinate(p.logical ?? barIndex(p.time)), y = main.priceToCoordinate(p.price); return x == null || y == null ? null : { x, y }; };
      const dotAt = (pt, color) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
      const segment = (a, b, color, width, dash = []) => { ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };
      ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textBaseline = 'bottom';
      for (const d of [...drawings, ...(preview ? [preview] : [])]) {
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
      if (state.interval === 'd' && bigJumps(file).length) {
        LWC.createSeriesMarkers(main, bigJumps(file).filter(f => data.some(b => b.time === f.date)).map(f => ({ time: f.date, position: 'aboveBar', color: colors.gold, shape: 'arrowDown', text: `${f.change > 0 ? '+' : ''}${f2.format(f.change)}%` })));
      }
      main.attachPrimitive(overlay);
      drawn = []; paintDrawings();
      if (state.tool) chart.applyOptions({ handleScroll: false, handleScale: false });
      chart.subscribeCrosshairMove(p => showLegend(p?.time ?? null));
      chart.timeScale().subscribeVisibleLogicalRangeChange(visibleChange);
      // بعد أن تطبّق المكتبة البيانات (في الإطار التالي)، وإلا أعادت ضبط المدى
      const apply = saved ? () => chart.timeScale().setVisibleLogicalRange(saved) : () => {
        const from = fromDate(data.at(-1).time, RANGES.find(r => r[0] === state.range)[2]);
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.findIndex(b => b.time >= from)) - 0.5, to: data.length - 1 + 2 });
      };
      apply(); requestAnimationFrame(() => requestAnimationFrame(apply));
      showLegend(null);
    }

    // نقطة الرسم من موضع المؤشر: شمعة أقرب + السعر عند ذلك الارتفاع، داخل لوحة السعر فقط
    function pointFrom(event) {
      if (!chart || !main) return null;
      const rect = box.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (y < 0 || y > chart.panes()[0].getHeight()) return null;
      const logical = chart.timeScale().coordinateToLogical(x), price = main.coordinateToPrice(y);
      if (logical == null || price == null) return null;
      const index = Math.max(0, Math.min(data.length - 1, Math.round(logical))), b = data[index];
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
      if (state.tool === 'hline') return;
      if (pending) { finish(point); press = null; return; }
      pending = point; preview = { type: state.tool, a: point, b: point };
      hint.textContent = state.tool === 'fib' ? 'حرّك المؤشر إلى نهاية الموجة واضغط، أو اسحب وأفلت' : 'حرّك المؤشر إلى النقطة الثانية واضغط، أو اسحب وأفلت';
      try { box.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      overlay.redraw();
    });
    box.addEventListener('pointermove', event => {
      if (!pending || !preview) return;
      const point = pointFrom(event); if (!point) return;
      preview.b = point; overlay.redraw();
    });
    box.addEventListener('pointerup', event => {
      if (!state.tool || !press) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6;
      if (state.tool === 'hline' && !moved) {
        drawings.push({ type: 'hline', price: Math.round(press.point.price * 100) / 100 });
        saveDrawings(symbol, drawings); setTool(null); paintDrawings();
      } else if (pending && moved) { const point = pointFrom(event) ?? preview?.b; if (point) finish(point); }
      press = null;
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.tool && box.isConnected) setTool(null); });
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

    function setTool(tool) {
      state.tool = tool; pending = null; preview = null;
      // أثناء الرسم لا يتحرك الشارت بالسحب ولا يتكبّر، حتى لا يتعارض مع تحديد النقاط
      chart?.applyOptions({ handleScroll: !tool, handleScale: !tool });
      overlay.redraw();
      panel.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tool === tool)));
      box.classList.toggle('cc-drawing', !!tool);
      hint.hidden = !tool;
      hint.textContent = HINTS[tool] ?? '';
    }

    panel.addEventListener('click', event => {
      const b = event.target.closest('[data-type],[data-interval],[data-crange],[data-ind],[data-tool],[data-clear],[data-undo],[data-fibset],[data-magnet]'); if (!b || !chart) return;
      if (b.hasAttribute('data-fibset')) { toggleFibSettings(); return; }
      if (b.dataset.magnet) { state.magnet = b.dataset.magnet; panel.querySelectorAll('[data-magnet]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.magnet === state.magnet))); saveSettings(); return; }
      let keep = true;
      if (b.dataset.tool) { setTool(state.tool === b.dataset.tool ? null : b.dataset.tool); return; }
      if (b.hasAttribute('data-undo')) { drawings.pop(); saveDrawings(symbol, drawings); setTool(null); paintDrawings(); return; }
      if (b.hasAttribute('data-clear')) { drawings = []; saveDrawings(symbol, drawings); setTool(null); paintDrawings(); return; }
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
    current = { destroy() { theme.disconnect(); chart?.remove(); chart = null; } };
    loadLib().then(lib => {
      LWC = lib; colors = palette(panel);
      setTool(null);
      build(false);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }).catch(() => { box.innerHTML = '<p class="cq-empty">تعذر تحميل مكتبة الشارت.</p>'; });
  }

  // الحسابات مكشوفة للاختبارات
  window.CompanyChart = { mount, calc: { group, sma, ema, bollinger, rsi, macd, fibLevels, FIB_DEFAULT, nearestPrice, rangeLabel } };
})();
