// أعمدة المقارنة بأسلوب الموقع الأمريكي (el7): يعيد تنسيق الرسوم التي تنتجها *-charts.mjs بعد رسمها
// دون تغيير الأرقام أو مواضعها: تدرّج يتلاشى للأسفل بزوايا علوية دائرية، آخر فترة مميزة بتوهّج،
// نسبة التغير عن الفترة السابقة فوق كل عمود، وملخص أعلى البطاقة. الألوان من el7-theme.css.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const f2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let uid = 0;

  const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  const topRounded = (x, top, w, h, up) => {
    const r = Math.min(8, w / 2, h);
    return up
      ? `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`
      : `M${x},${top}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + w - r}Q${x + w},${top + h} ${x + w},${top + h - r}V${top}Z`;
  };

  function gradient(id, flip, a, b) {
    const g = el('linearGradient', { id, x1: '0', y1: flip ? '1' : '0', x2: '0', y2: flip ? '0' : '1' });
    for (const [offset, stop] of [['0', a], ['1', b]]) {
      const s = el('stop', { offset });
      if (stop.cls) s.setAttribute('class', stop.cls);
      else { s.setAttribute('stop-color', stop.color); s.setAttribute('stop-opacity', stop.opacity); }
      g.append(s);
    }
    return g;
  }

  function enhance(svg) {
    if (svg.dataset.e7) return;
    svg.dataset.e7 = '1';
    const rects = [...svg.querySelectorAll('rect.chart-bar')];
    const card = svg.closest('.bank-chart-card');
    if (!rects.length) return;
    const id = `e7c${++uid}`;
    const seriesKeys = [...new Set(rects.map(r => r.dataset.series))];
    const single = seriesKeys.length === 1;
    // مقارنة الشركات (مكرر الربحية الحالي) ليست سلسلة زمنية: لا نسب تغير ولا تمييز لآخر عمود
    const timeSeries = single && !card?.classList.contains('bank-current-pe-comparison');
    const zero = num(svg.dataset.zeroY) ?? Math.max(...rects.map(r => num(r.getAttribute('y')) + num(r.getAttribute('height'))));
    const plot = svg.querySelector(':scope > g') || svg;
    svg.classList.add('e7c-svg');
    card?.classList.add('e7c');

    // التدرّجات: سلسلة واحدة بالذهبي من el7-theme.css، والسلاسل المزدوجة بلون كل سلسلة
    const defs = el('defs');
    if (single) {
      defs.append(
        gradient(`${id}-up`, false, { cls: 'e7c-up-a' }, { cls: 'e7c-up-b' }),
        gradient(`${id}-up-last`, false, { cls: 'e7c-upl-a' }, { cls: 'e7c-upl-b' }),
        gradient(`${id}-down`, true, { cls: 'e7c-dn-a' }, { cls: 'e7c-dn-b' }),
        gradient(`${id}-down-last`, true, { cls: 'e7c-dnl-a' }, { cls: 'e7c-dnl-b' })
      );
    } else {
      seriesKeys.forEach((key, i) => {
        const color = rects.find(r => r.dataset.series === key).getAttribute('fill') || '#f59e0b';
        defs.append(
          gradient(`${id}-s${i}`, false, { color, opacity: '.95' }, { color, opacity: '.18' }),
          gradient(`${id}-s${i}-down`, true, { color, opacity: '.95' }, { color, opacity: '.18' })
        );
      });
    }
    const filter = el('filter', { id: `${id}-glow`, x: '-50%', y: '-20%', width: '200%', height: '140%' });
    filter.append(el('feDropShadow', { dx: '0', dy: '0', stdDeviation: '7', class: 'e7c-glow' }));
    defs.append(filter);
    svg.prepend(defs);

    // الفترات بترتيبها في الرسم (من الأقدم إلى الأحدث)
    const years = [];
    for (const r of rects) if (!years.includes(r.dataset.year)) years.push(r.dataset.year);
    for (const t of svg.querySelectorAll('text.chart-year')) if (!years.includes(t.dataset.year)) years.push(t.dataset.year);
    const yearLabels = new Map([...svg.querySelectorAll('text.chart-year')].map(t => [t.dataset.year, t]));
    const centers = years.map(y => num(yearLabels.get(y)?.getAttribute('x')));
    const step = centers.length > 1 && centers[0] != null && centers[1] != null ? Math.abs(centers[1] - centers[0]) : 80;
    const last = years.length - 1;
    const valueLabel = (year, key) => [...svg.querySelectorAll('text.chart-value')].find(t => t.dataset.year === year && t.dataset.series === key);
    const ownText = t => t ? [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim() : '';
    const isPercent = rects.some(r => /%$/.test(ownText(valueLabel(r.dataset.year, r.dataset.series))));
    const showChips = timeSeries && !isPercent && step >= 58;
    const points = [];

    years.forEach((year, k) => {
      const g = el('g', { class: `e7c-bar${timeSeries && k === last ? ' is-last' : ''}`, style: `--i:${k}` });
      const cx = centers[k];
      if (cx != null) g.append(el('rect', { class: 'e7c-hit', x: cx - step / 2, y: 0, width: step, height: zero + 30 }));
      seriesKeys.forEach((key, si) => {
        const rect = rects.find(r => r.dataset.year === year && r.dataset.series === key);
        const label = valueLabel(year, key);
        if (rect) {
          const x = num(rect.getAttribute('x')), y = num(rect.getAttribute('y')), w = num(rect.getAttribute('width'));
          const h = Math.max(num(rect.getAttribute('height')), 1.5), value = num(rect.dataset.chartValue);
          const up = !(value < 0);
          if (!up) g.classList.add('is-neg');
          const fill = single ? `url(#${id}-${up ? 'up' : 'down'}${timeSeries && k === last ? '-last' : ''})` : `url(#${id}-s${si}${up ? '' : '-down'})`;
          const path = el('path', { d: topRounded(x, y, w, h, up), fill });
          for (const a of rect.attributes) if (!['x', 'y', 'width', 'height', 'fill'].includes(a.name)) path.setAttribute(a.name, a.value);
          path.setAttribute('class', `${rect.getAttribute('class')} e7c-fill`);
          if (single && timeSeries && k === last && up) path.setAttribute('filter', `url(#${id}-glow)`);
          path.append(...rect.childNodes);
          rect.replaceWith(path);
          g.append(path);
          const cap = el('rect', { class: 'e7c-cap', x: x + 3, y: up ? y : y + h - 3, width: Math.max(w - 6, 1), height: 3, rx: 1.5 });
          if (!single) cap.style.fill = rect.getAttribute('fill');
          g.append(cap);
          points.push({ year, key, value, up, text: ownText(label), labelY: num(label?.getAttribute('y')), cx: x + w / 2 });
        }
        if (label) g.append(label);
      });
      const yearText = yearLabels.get(year);
      if (yearText) g.append(yearText);
      plot.append(g);
    });

    // نسبة التغير عن الفترة السابقة فوق كل عمود
    if (showChips) {
      points.forEach((p, i) => {
        const prev = points[i - 1];
        if (!prev || prev.value == null || p.value == null || prev.value === 0) return;
        const d = (p.value - prev.value) / Math.abs(prev.value) * 100;
        const t = `${d > 0 ? '+' : ''}${f2.format(d)}%`;
        const w = t.length * 6.3 + 14;
        const chipY = p.up ? (p.labelY ?? zero) - 30 : zero - 24;
        const chip = el('g', { class: `e7c-chip ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}` });
        chip.append(el('rect', { x: p.cx - w / 2, y: chipY, width: w, height: 17, rx: 8.5 }));
        const text = el('text', { x: p.cx, y: chipY + 12.5 });
        text.textContent = t;
        chip.append(text);
        svg.querySelector(`.e7c-bar[style="--i:${years.indexOf(p.year)}"]`)?.append(chip);
      });
    }

    // الملخص أعلى البطاقة: التغير من أول فترة إلى آخرها، وآخر قيمة، والأعلى
    if (timeSeries && card && points.length) {
      card.querySelector(':scope > .e7c-head')?.remove();
      const first = points[0], end = points[points.length - 1];
      const best = points.reduce((a, b) => (b.value > a.value ? b : a), first);
      let pills = '';
      if (points.length > 1 && !isPercent && first.value) {
        const d = (end.value - first.value) / Math.abs(first.value) * 100;
        pills += `<span class="e7c-pill ${d > 0 ? 'up' : d < 0 ? 'down' : ''}"><i></i>من ${esc(first.year)} إلى ${esc(end.year)}: <bdi>${d > 0 ? '+' : ''}${f2.format(d)}%</bdi></span>`;
      }
      pills += `<span class="e7c-pill gold"><i></i>آخر قيمة: <bdi>${esc(end.text)}</bdi></span>`;
      if (points.length > 2) pills += `<span class="e7c-pill"><i></i>الأعلى: ${esc(best.year)} · <bdi>${esc(best.text)}</bdi></span>`;
      const head = document.createElement('div');
      head.className = 'e7c-head';
      head.innerHTML = pills;
      card.querySelector(':scope > .bank-chart-canvas')?.before(head);
    }
  }

  let queued = false;
  const scan = () => {
    queued = false;
    for (const svg of document.querySelectorAll('svg.bank-chart-svg:not([data-e7])')) {
      try { enhance(svg); } catch (error) { console.warn('e7-bars', error); }
    }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  queue();
})();
