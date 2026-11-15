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
    { id: 'sma20', label: 'م.م 20', title: 'متوسط متحرك بسيط 20', kind: 'overlay', color: '#3987e5' },
    { id: 'sma50', label: 'م.م 50', title: 'متوسط متحرك بسيط 50', kind: 'overlay', color: '#d95926' },
    { id: 'sma200', label: 'م.م 200', title: 'متوسط متحرك بسيط 200', kind: 'overlay', color: '#9085e9' },
    { id: 'ema20', label: 'أسي 20', title: 'متوسط متحرك أسي 20', kind: 'overlay', color: '#199e70' },
    { id: 'bb', label: 'بولنجر', title: 'نطاقات بولنجر (20، 2)', kind: 'overlay', color: '#c98500' },
    { id: 'vol', label: 'الحجم', title: 'حجم التداول', kind: 'volume' },
    { id: 'rsi', label: 'RSI', title: 'مؤشر القوة النسبية (14)', kind: 'pane', color: '#9085e9' },
    { id: 'macd', label: 'MACD', title: 'الماكد (12، 26، 9)', kind: 'pane', color: '#3987e5' }
  ];
  const TOOLS = [['hline', 'خط أفقي'], ['trend', 'خط اتجاه']];
  const bigJumps = file => (file.flags || []).filter(f => Math.abs(f.change) >= 15);

  const state = { type: 'candles', interval: 'd', range: '1y', ind: new Set(['vol', 'sma50']), tool: null };
  try { const saved = JSON.parse(localStorage.getItem('cc-settings') || 'null'); if (saved) { if (saved.type) state.type = saved.type; if (Array.isArray(saved.ind)) state.ind = new Set(saved.ind); } } catch { /* storage unavailable */ }
  const saveSettings = () => { try { localStorage.setItem('cc-settings', JSON.stringify({ type: state.type, ind: [...state.ind] })); } catch { /* ignore */ } };
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
        <div class="cc-chips" role="group" aria-label="أدوات الرسم">${TOOLS.map(([id, t]) => chip('tool', id, t, state.tool === id)).join('')}<button type="button" data-clear>مسح الرسوم</button></div>
      </div>
      <div class="cc-legend" aria-live="polite"></div>
      <div class="cc-chart" dir="ltr"><p class="cq-empty">جار تحميل الشارت…</p></div>
      <p class="cc-hint" hidden></p>
      <p class="cq-source">${bigJumps(file).length ? `<span class="cc-flag-note">▼ علامة على الشارت: قفزة تتجاوز 15% في جلسة واحدة، غالبًا إجراء على رأس المال. </span>` : ''}شموع يومية حتى آخر إغلاق رسمي، والأسبوعية (الأحد – الخميس) والشهرية مجمّعة منها · اسحب للتنقل وكبّر بعجلة الماوس · الرسوم تُحفظ في هذا المتصفح فقط</p>`;
    const box = panel.querySelector('.cc-chart'), legend = panel.querySelector('.cc-legend'), changeEl = panel.querySelector('.cc-change'), hint = panel.querySelector('.cc-hint');
    let chart = null, LWC = null, colors = null, data = [], main = null, calc = {}, drawn = [];

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
    const barAt = iso => { let k = 0; for (let i = 0; i < data.length && data[i].time <= iso; i++) k = i; return data[k]?.time; };
    function paintDrawings() {
      for (const d of drawn) d.remove();
      drawn = [];
      for (const d of drawings) {
        if (d.type === 'hline') { const line = main.createPriceLine({ price: d.price, color: colors.gold, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '' }); drawn.push({ remove: () => main.removePriceLine(line) }); }
        if (d.type === 'trend') {
          const t1 = barAt(d.a.time), t2 = barAt(d.b.time);
          if (!t1 || !t2 || t1 === t2) continue;
          const s = chart.addSeries(LWC.LineSeries, { color: colors.gold, lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: true });
          s.setData([{ time: t1, value: d.a.price }, { time: t2, value: d.b.price }].sort((x, y) => x.time < y.time ? -1 : 1));
          drawn.push({ remove: () => chart.removeSeries(s) });
        }
      }
    }

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
      drawn = []; paintDrawings();
      chart.subscribeCrosshairMove(p => showLegend(p?.time ?? null));
      chart.subscribeClick(onChartClick);
      chart.timeScale().subscribeVisibleLogicalRangeChange(visibleChange);
      // بعد أن تطبّق المكتبة البيانات (في الإطار التالي)، وإلا أعادت ضبط المدى
      const apply = saved ? () => chart.timeScale().setVisibleLogicalRange(saved) : () => {
        const from = fromDate(data.at(-1).time, RANGES.find(r => r[0] === state.range)[2]);
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.findIndex(b => b.time >= from)) - 0.5, to: data.length - 1 + 2 });
      };
      apply(); requestAnimationFrame(() => requestAnimationFrame(apply));
      showLegend(null);
    }

    function onChartClick(p) {
      if (!state.tool || !p?.point || (p.paneIndex ?? 0) > 0) return;
      const price = main.coordinateToPrice(p.point.y), time = p.time ?? data.at(-1)?.time;
      if (price == null || !time) return;
      if (state.tool === 'hline') { drawings.push({ type: 'hline', price: Math.round(price * 100) / 100 }); setTool(null); }
      else if (!pending) { pending = { time, price }; hint.textContent = 'اختر النقطة الثانية لخط الاتجاه'; return; }
      else if (barAt(time) === barAt(pending.time)) return; // النقطتان على الشمعة نفسها: انتظر نقطة أخرى
      else { drawings.push({ type: 'trend', a: pending, b: { time, price } }); setTool(null); }
      saveDrawings(symbol, drawings);
      paintDrawings();
    }
    function setTool(tool) {
      state.tool = tool; pending = null;
      panel.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tool === tool)));
      box.classList.toggle('cc-drawing', !!tool);
      hint.hidden = !tool;
      hint.textContent = tool === 'hline' ? 'اضغط على الشارت عند السعر المطلوب لرسم خط أفقي' : tool === 'trend' ? 'اضغط على نقطة البداية ثم نقطة النهاية لرسم خط اتجاه' : '';
    }

    panel.addEventListener('click', event => {
      const b = event.target.closest('[data-type],[data-interval],[data-crange],[data-ind],[data-tool],[data-clear]'); if (!b || !chart) return;
      let keep = true;
      if (b.dataset.tool) { setTool(state.tool === b.dataset.tool ? null : b.dataset.tool); return; }
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
  window.CompanyChart = { mount, calc: { group, sma, ema, bollinger, rsi, macd } };
})();
