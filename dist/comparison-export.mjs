// حفظ المقارنة كصورة: تُرسم بطاقة مستقلة على Canvas (لا لقطة للصفحة) بدقة 4K وبمقاس شاشة الآيفون.
// الأبعاد المنطقية × 2 = أبعاد الملف. 2160×4680 ≈ 10 ملايين بكسل، تحت حد سفاري للـ Canvas (≈16.7 مليون).
export const SIZES = {
  iphone: { w:1080, h:2340, label:'شاشة آيفون', dims:'2160 × 4680' },
  story:  { w:1080, h:1920, label:'ستوري 9:16', dims:'2160 × 3840' },
  wide:   { w:1920, h:1080, label:'4K عرضي', dims:'3840 × 2160' },
};
const SCALE = 2;
const FONT = '"SF Arabic","SF Pro Arabic",system-ui,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif';
const PAL = {
  dark:  { bgTop:'#161e28', bg:'#0b0f14', glow:'rgba(245,158,11,.17)', panel:'#141b23', line:'#27303b', ink:'#f1f5f9', muted:'#94a3b3', gold:'#f59e0b', goldHi:'#fbbf24', neg:'#f05252', up:'#54e878', down:'#ff6b6b', grid:'#26303b', zero:'#5b6672', tile:'#232c37', chip:'#18202a', edge:'rgba(255,255,255,.16)', shadow:'rgba(0,0,0,.4)', track:'#212a34' },
  light: { bgTop:'#ffffff', bg:'#edf1f5', glow:'rgba(245,158,11,.13)', panel:'#ffffff', line:'#e1e7ee', ink:'#13202c', muted:'#64748b', gold:'#d97706', goldHi:'#f59e0b', neg:'#e34948', up:'#0f9d58', down:'#d64545', grid:'#e6ebf0', zero:'#94a3b3', tile:'#eef2f6', chip:'#f6f8fa', edge:'rgba(0,0,0,.10)', shadow:'rgba(15,23,42,.08)', track:'#edf1f5' },
};

/* ---------- أدوات الرسم ---------- */
// الأرقام داخل نص عربي تُعزل اتجاهيًا (LRI…PDI) فلا تنقلب الإشارة أو % في السطر العربي
// «Q3 2026» و«Q3 2025 – Q3 2026» تُعزل كوحدة واحدة
const TOKEN = /[+\-−]?[A-Za-z0-9][A-Za-z0-9.,%]*(?:(?:\s+|\s*–\s*)[A-Za-z0-9][A-Za-z0-9.,%]*)*/g;
const bidi = s => String(s ?? '').replace(TOKEN, m => '\u2066' + m + '\u2069');
const font = (ctx, size, weight) => { ctx.font = `${weight} ${size}px ${FONT}`; };
const measure = (ctx, s, size, weight=600) => { font(ctx, size, weight); return ctx.measureText(bidi(s)).width; };
function txt(ctx, s, x, y, { size=28, weight=600, color='#fff', align='right', dir='rtl', max=0 } = {}){
  s = bidi(s); let sz = size;
  font(ctx, sz, weight);
  if(max) while(sz > 12 && ctx.measureText(s).width > max){ sz -= 1; font(ctx, sz, weight); }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.direction = dir; ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}
function rr(ctx, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath(); ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r); ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath();
}
function alpha(hex, a){ const n = parseInt(hex.slice(1), 16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
function card(ctx, P, x, y, w, h, r=24){
  ctx.save(); ctx.shadowColor = P.shadow; ctx.shadowBlur = 34; ctx.shadowOffsetY = 10;
  rr(ctx, x, y, w, h, r); ctx.fillStyle = P.panel; ctx.fill(); ctx.restore();
  rr(ctx, x+.75, y+.75, w-1.5, h-1.5, r); ctx.strokeStyle = P.line; ctx.lineWidth = 1.5; ctx.stroke();
}
function logo(ctx, P, c, x, y, L, ring=''){
  const r = L*0.26;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = L*0.2; ctx.shadowOffsetY = L*0.05;
  rr(ctx, x, y, L, L, r); ctx.fillStyle = c.img ? '#ffffff' : P.tile; ctx.fill(); ctx.restore();
  ctx.save(); rr(ctx, x, y, L, L, r); ctx.clip();
  if(c.img) ctx.drawImage(c.img, x, y, L, L);
  else txt(ctx, c.initial, x+L/2, y+L*0.68, { size:L*0.5, weight:700, color:P.ink, align:'center' });
  ctx.restore();
  rr(ctx, x+.75, y+.75, L-1.5, L-1.5, r); ctx.strokeStyle = ring || P.edge; ctx.lineWidth = ring ? 3.5 : 1.5; ctx.stroke();
}
const loadImg = src => new Promise(res => {
  if(!src) return res(null);
  const i = new Image(); i.decoding = 'async';
  i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
});

/* ---------- الأقسام ---------- */
function drawBackground(ctx, P, W, H){
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, P.bgTop); g.addColorStop(1, P.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const R = Math.max(W, H)*0.75, r = ctx.createRadialGradient(W*0.88, 0, 0, W*0.88, 0, R);
  r.addColorStop(0, P.glow); r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
}
// الرأس: شعار الموقع، اسم البند، ثم الفترة والوحدة والقطاع والمدى
function drawHeader(ctx, P, d, x0, x1, y, brand, big=72){
  const B = 54;
  if(brand){ ctx.save(); rr(ctx, x1-B, y, B, B, 14); ctx.clip(); ctx.drawImage(brand, x1-B, y, B, B); ctx.restore(); }
  txt(ctx, d.site, x1-B-16, y+38, { size:30, weight:800, color:P.ink });
  txt(ctx, 'مقارنة النتائج المالية', x0, y+38, { size:24, weight:600, color:P.muted, align:'left' });
  txt(ctx, d.title, x1, y+B+big+14, { size:big, weight:800, color:P.ink, max:x1-x0 });
  const sy = y+B+big+66, w = txt(ctx, d.sub, x1, sy, { size:28, weight:600, color:P.muted, max:(x1-x0)*0.62 });
  txt(ctx, `·  ${d.span}`, x1-w-14, sy, { size:28, weight:800, color:P.gold, max:x1-x0-w-14 });
  return B+big+80;
}
function legendLayout(ctx, d, x0, x1, L, size){
  const H = L+16, gap = 12, items = []; let x = x1, y = 0;
  for(const c of d.companies){
    const w = 16 + L + 12 + measure(ctx, c.name, size, 700) + 10 + measure(ctx, c.symbol, size*0.78, 600) + 22;
    if(x-w < x0 && x !== x1){ x = x1; y += H+gap; }
    items.push({ c, x:x-w, y, w }); x -= w+gap;
  }
  return { items, h: y+H, L, size, H };
}
function drawLegend(ctx, P, lay, y0, colors){
  for(const { c, x, y, w } of lay.items){
    const top = y0+y, L = lay.L;
    rr(ctx, x, top, w, lay.H, lay.H/2); ctx.fillStyle = P.chip; ctx.fill(); ctx.strokeStyle = colors ? c.color : P.line; ctx.lineWidth = colors ? 2.5 : 1.5; ctx.stroke();
    logo(ctx, P, c, x+w-8-L, top+8, L);
    const nr = x+w-8-L-12, base = top+8+L*0.7;
    const nw = txt(ctx, c.name, nr, base, { size:lay.size, weight:700, color:P.ink });
    txt(ctx, c.symbol, nr-nw-10, base, { size:lay.size*0.78, weight:600, color:P.muted, dir:'ltr' });
  }
}
function drawTiles(ctx, P, d, x0, x1, y, cols, h, gap=18){
  const w = (x1-x0-gap*(cols-1))/cols;
  d.figures.forEach((f, i) => {
    const col = i%cols, row = Math.floor(i/cols), tx = x1-(col+1)*w-col*gap, ty = y+row*(h+gap), pad = 24, r = tx+w-pad;
    // ثلاثة أسطر بمواضع ثابتة: العنوان، القيمة، ثم الشركة أو الملاحظة
    const vs = Math.round(Math.min(h*0.29, 54)), titleY = ty+pad+20, valY = titleY+12+vs, whoY = ty+h-pad+2;
    card(ctx, P, tx, ty, w, h, 20);
    txt(ctx, f.title, r, titleY, { size:23, weight:600, color:P.muted, max:w-pad*2 });
    txt(ctx, f.text, r, valY, { size:vs, weight:800, color: f.dir>0 ? P.up : f.dir<0 ? P.down : f.neg ? P.neg : P.ink, max:w-pad*2 });
    if(f.company){
      const L = 32; logo(ctx, P, f.company, r-L, whoY-L+6, L);
      txt(ctx, f.company.name, r-L-12, whoY, { size:23, weight:700, color:P.ink, max:w-pad*2-L-12 });
    } else txt(ctx, f.note, r, whoY, { size:22, weight:600, color:P.muted, max:w-pad*2 });
  });
  const rows = Math.ceil(d.figures.length/cols);
  return rows*h + (rows-1)*gap;
}
function niceTicks(lo, hi, count=5){
  if(lo===hi) hi = lo+1;
  const raw = (hi-lo)/count, mag = 10**Math.floor(Math.log10(raw)), n = raw/mag;
  const step = (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;
  const start = Math.floor(lo/step)*step, end = Math.ceil(hi/step)*step, ticks = [];
  for(let v = start; v <= end+step/2; v += step) ticks.push(Math.abs(v) < step/1e6 ? 0 : v);
  return ticks;
}
// هل تتسع الأعمدة لشعار فوق كل عمود؟ إن لم تتسع تُلوَّن الأعمدة بألوان الشركات
const fullBars = (d, w) => d.view==='bars' && (w-130)/d.periods.length*0.8/d.companies.length >= 40;
function drawChart(ctx, P, d, x, y, w, h){
  const yrs = d.periods, list = d.companies, n = list.length, bars = d.view==='bars';
  const vals = list.flatMap(c => c.values).filter(v => v!=null);
  if(!vals.length){ txt(ctx, 'لا توجد قيم متاحة', x+w/2, y+h/2, { align:'center', color:P.muted }); return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if(bars || (lo>=0 && lo<hi*0.5)) lo = Math.min(0, lo);
  if(bars) hi = Math.max(0, hi);
  if(lo===hi){ lo -= Math.abs(lo)*0.1 || 1; hi += Math.abs(hi)*0.1 || 1; }
  const ticks = niceTicks(lo, hi), step = ticks[1]-ticks[0]; lo = ticks[0]; hi = ticks.at(-1);
  const TS = 24, LS = 26, tickText = ticks.map(t => d.axisFmt(t, step));
  const ml = Math.max(...tickText.map(t => measure(ctx, t, TS))) + 20;
  const gw0 = (w-ml-10)/yrs.length;
  const wide = Math.max(...yrs.map(t => measure(ctx, t, LS, 700))) + 18;
  const twoLine = gw0 < wide && yrs.some(t => t.includes(' '));
  const part = twoLine ? Math.max(...yrs.flatMap(t => t.split(' ')).map(t => measure(ctx, t, LS, 700))) + 18 : wide;
  const every = Math.max(1, Math.ceil(part/gw0));
  const full = fullBars(d, w+48), slot0 = gw0*0.8/n, L = full ? Math.min(64, slot0-10) : 0;
  // القيمة فوق الشعار: يصغر خطها حتى يتسع لمكان العمود، وتُحذف إن صار أصغر من 17
  const labW = full ? Math.max(...list.flatMap(c => c.values).filter(v => v!=null).map(v => measure(ctx, d.fmt(v), 25, 800))) : 0;
  const valSize = full ? Math.min(25, 25*(slot0-6)/labW) : 0, showVal = full && valSize >= 17 && n*yrs.length <= 30;
  const room = full ? L+16+(showVal ? valSize+14 : 0) : 0, endL = 52;
  const neg = lo < 0;
  const m = { l:ml, r: bars ? 10 : endL+34, t: 24+room, b: (twoLine ? 78 : 48) + (neg && full ? room : 0) };
  const pw = w-m.l-m.r, ph = h-m.t-m.b, gw = pw/yrs.length, X0 = x+m.l;
  const Y = v => y+m.t+(hi-v)/(hi-lo)*ph, cx = i => X0+gw*(i+.5);
  ticks.forEach((t, i) => {
    ctx.beginPath(); ctx.moveTo(X0, Y(t)); ctx.lineTo(x+w-m.r, Y(t));
    ctx.strokeStyle = t===0 ? P.zero : P.grid; ctx.lineWidth = t===0 ? 2.5 : 1.5; ctx.setLineDash(t===0 ? [] : [6, 9]); ctx.stroke(); ctx.setLineDash([]);
    txt(ctx, tickText[i], X0-14, Y(t)+8, { size:TS, color:P.muted, dir:'ltr' });
  });
  yrs.forEach((name, i) => {
    if((yrs.length-1-i) % every) return;
    const col = i===yrs.length-1 ? P.ink : P.muted, [a, b] = name.split(' ');
    if(twoLine && b){ txt(ctx, a, cx(i), y+h-42, { size:LS, weight:700, color:col, align:'center', dir:'ltr' }); txt(ctx, b, cx(i), y+h-8, { size:LS-2, weight:600, color:col, align:'center', dir:'ltr' }); }
    else txt(ctx, name, cx(i), y+h-10, { size:LS, weight:700, color:col, align:'center', dir:'ltr' });
  });
  if(bars){
    const inner = gw*0.8, sl = inner/n, bw = Math.max(4, Math.min(120, sl-(full ? 12 : 5)));
    // داخل كل فترة: الأعلى قيمة أولًا ثم الأقل، كما في الصفحة
    yrs.forEach((_, i) => [...list].sort((p, q) => (q.values[i] ?? -Infinity)-(p.values[i] ?? -Infinity)).forEach((c, j) => {
      const v = c.values[i]; if(v==null) return;
      const bx = cx(i)-inner/2+j*sl+(sl-bw)/2, y0 = Y(0), hgt = Math.max(3, Math.abs(Y(v)-y0)), up = v >= 0, last = i===yrs.length-1;
      const tip = up ? y0-hgt : y0+hgt, r = Math.min(9, bw/2, hgt);
      const base = v < 0 ? P.neg : full ? (last ? P.goldHi : P.gold) : c.color;
      const g = ctx.createLinearGradient(0, tip, 0, y0);
      g.addColorStop(0, alpha(base, last ? 1 : .82)); g.addColorStop(1, alpha(base, last ? .22 : .1));
      ctx.beginPath();
      if(up){ ctx.moveTo(bx, y0); ctx.lineTo(bx, tip+r); ctx.arcTo(bx, tip, bx+r, tip, r); ctx.lineTo(bx+bw-r, tip); ctx.arcTo(bx+bw, tip, bx+bw, tip+r, r); ctx.lineTo(bx+bw, y0); }
      else { ctx.moveTo(bx, y0); ctx.lineTo(bx, tip-r); ctx.arcTo(bx, tip, bx+r, tip, r); ctx.lineTo(bx+bw-r, tip); ctx.arcTo(bx+bw, tip, bx+bw, tip-r, r); ctx.lineTo(bx+bw, y0); }
      ctx.closePath();
      ctx.save(); if(last){ ctx.shadowColor = alpha(base, .45); ctx.shadowBlur = 22; } ctx.fillStyle = g; ctx.fill(); ctx.restore();
      const inset = Math.min(3, bw/4); rr(ctx, bx+inset, up ? tip : tip-4, bw-inset*2, 4, 2); ctx.fillStyle = base; ctx.fill();
      if(full){
        const lx = bx+bw/2-L/2, ly = up ? tip-12-L : tip+12;
        logo(ctx, P, c, lx, ly, L);
        if(showVal) txt(ctx, d.fmt(v), bx+bw/2, up ? ly-12 : ly+L+valSize+8, { size:valSize, weight:800, color: v<0 ? P.neg : P.ink, align:'center', dir:'ltr' });
      }
    }));
  } else {
    for(const c of list){
      ctx.beginPath(); let pen = false;
      c.values.forEach((v, i) => { if(v==null){ pen = false; return; } pen ? ctx.lineTo(cx(i), Y(v)) : ctx.moveTo(cx(i), Y(v)); pen = true; });
      ctx.strokeStyle = c.color; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      c.values.forEach((v, i) => { if(v==null) return; ctx.beginPath(); ctx.arc(cx(i), Y(v), 8, 0, Math.PI*2); ctx.fillStyle = c.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = P.panel; ctx.stroke(); });
    }
    const lx = x+w-m.r+18, topY = y+endL/2+4, botY = y+m.t+ph;
    const ends = list.map(c => { const i = c.values.findLastIndex(v => v!=null); return i < 0 ? null : { c, px:cx(i), py:Y(c.values[i]) }; }).filter(Boolean).sort((a, b) => a.py-b.py);
    // الشعارات المتقاربة تتباعد، وإن ضاق الارتفاع يصغر الشعار والمسافة فتبقى كلها داخل الرسم
    const gap = Math.min(endL+6, ends.length > 1 ? (botY-topY)/(ends.length-1) : endL+6), EL = Math.min(endL, gap-4);
    // تمريرة من الأعلى ثم من الأسفل: يتحرك المتزاحم فقط ويبقى البعيد عند نهاية خطه
    ends.forEach((e, k) => { e.ly = Math.max(e.py, k ? ends[k-1].ly+gap : topY); });
    for(let k = ends.length-1; k >= 0; k--) ends[k].ly = Math.min(ends[k].ly, k < ends.length-1 ? ends[k+1].ly-gap : botY);
    for(const e of ends){
      ctx.beginPath(); ctx.moveTo(e.px+9, e.py); ctx.lineTo(lx-3, e.ly); ctx.strokeStyle = alpha(e.c.color, .7); ctx.lineWidth = 2; ctx.setLineDash([4, 5]); ctx.stroke(); ctx.setLineDash([]);
      logo(ctx, P, e.c, lx, e.ly-EL/2, EL, e.c.color);
    }
  }
}
// الترتيب في عمود واحد أو أكثر (الأول يمينًا)؛ الخطوط والشعار تكبر وتصغر مع ارتفاع السطر
function drawRank(ctx, P, d, x, y, w, rowH, cols=1){
  const rows = d.rank.rows, per = Math.ceil(rows.length/cols), h = 104+per*rowH;
  card(ctx, P, x, y, w, h);
  const pad = 34, gapC = 40, cw = (w-pad*2-gapC*(cols-1))/cols;
  txt(ctx, d.rank.title, x+w-pad, y+60, { size:34, weight:800, color:P.gold });
  if(d.rank.sub) txt(ctx, d.rank.sub, x+pad, y+58, { size:23, weight:600, color:P.muted, align:'left' });
  const vs = rows.map(r => r.v).filter(v => v!=null);
  const lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), span = hi-lo || 1;
  // حد أدنى للخط: الصورة تُعرض على الآيفون بنحو 0.4 من حجمها المنطقي، فأقل من 24 يصعب قراءته
  const k = Math.max(0.85, Math.min(1.35, rowH/100)), compact = rowH < 80;
  const L = Math.min(54*k, rowH-16), nameSize = Math.max(25, (compact ? 28 : 30)*k), valSize = Math.max(27, (compact ? 32 : 36)*k), small = Math.max(20, 21*Math.min(k, 1.2)), posW = 40*k;
  const nameW = Math.min(cw*0.38, Math.max(120, ...rows.map(r => measure(ctx, r.company.name, nameSize, 700))));
  const valW = Math.min(cw*0.32, Math.max(...rows.map(r => Math.max(measure(ctx, r.text, valSize, 800), compact ? 0 : measure(ctx, r.delta, small, 700)))) + 20*k);
  rows.forEach((r, i) => {
    const c = Math.floor(i/per), j = i%per, x1 = x+w-pad-c*(cw+gapC), x0 = x1-cw, ry = y+96+j*rowH, mid = ry+rowH/2;
    if(j){ ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x1, ry); ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.stroke(); }
    txt(ctx, r.v==null ? '—' : String(i+1), x1, mid+10*k, { size:28*k, weight:800, color:P.muted, dir:'ltr' });
    logo(ctx, P, r.company, x1-posW-L, mid-L/2, L);
    const nr = x1-posW-L-16*k;
    if(compact) txt(ctx, r.company.name, nr, mid+nameSize*0.36, { size:nameSize, weight:700, color:P.ink, max:nameW });
    else { txt(ctx, r.company.name, nr, mid-2*k, { size:nameSize, weight:700, color:P.ink, max:nameW }); txt(ctx, r.company.symbol, nr, mid+30*k, { size:small, weight:600, color:P.muted }); }
    txt(ctx, r.text, x0, compact ? mid+valSize*0.36 : mid+2*k, { size:valSize, weight:800, color: r.v!=null && r.v<0 ? P.neg : P.ink, align:'left', dir:'ltr', max:valW });
    if(!compact && r.delta) txt(ctx, r.delta, x0, mid+32*k, { size:small, weight:700, color: r.dir>0 ? P.up : r.dir<0 ? P.down : P.muted, align:'left', max:valW });
    const t0 = x0+valW, t1 = nr-nameW-24, th = 12*Math.min(k, 1.2);
    if(t1-t0 > 60){
      rr(ctx, t0, mid-th/2, t1-t0, th, th/2); ctx.fillStyle = P.track; ctx.fill();
      if(r.v!=null){
        const X = v => t0+(v-lo)/span*(t1-t0); // كما في الصفحة: الموجب يمتد يمين الصفر
        const fx = Math.min(X(0), X(r.v)), fw = Math.max(4, Math.abs(X(r.v)-X(0)));
        const g = ctx.createLinearGradient(fx, 0, fx+fw, 0), col = r.v<0 ? P.neg : P.gold;
        g.addColorStop(r.v<0 ? 1 : 0, alpha(col, 1)); g.addColorStop(r.v<0 ? 0 : 1, alpha(col, .55));
        rr(ctx, fx, mid-th/2, fw, th, th/2); ctx.fillStyle = g; ctx.fill();
        if(lo < 0){ ctx.fillStyle = P.zero; ctx.fillRect(X(0)-1, mid-th, 2, th*2); }
      }
    }
  });
  return h;
}
function drawFooter(ctx, P, d, x0, x1, y){
  txt(ctx, d.url, x1, y, { size:23, weight:700, color:P.muted, dir:'ltr' });
  txt(ctx, d.stamp, x0, y, { size:22, weight:600, color:P.muted, align:'left' });
}

/* ---------- التخطيط ---------- */
// parts: ما اختاره المستخدم في البطاقة (الأرقام السريعة، الرسم، الترتيب). مفتاح الشركات يظهر مع الرسم فقط لأن الترتيب يذكر الأسماء.
const legendSize = n => n > 8 ? [34, 22] : [42, 26];
function layoutTall(ctx, P, d, S, key, brand, parts){
  const W = S.w, H = S.h, PAD = 56, x0 = PAD, x1 = W-PAD, CW = x1-x0, GAP = 30;
  // هامش علوي وسفلي يترك مكان شريط الحالة وشريط الرجوع عند عرض الصورة كاملة على الآيفون
  const top = key==='iphone' ? 150 : 88, bottom = H-(key==='iphone' ? 100 : 60);
  const n = d.companies.length, chart = parts.chart, rank = parts.rank;
  // مفتاح الشركات فقط حين تميّزها الألوان (خطوط «اتجاه» أو أعمدة مزدحمة)؛ مع شعار فوق كل عمود لا حاجة له
  const colors = !fullBars(d, CW-48), lay = chart && colors ? legendLayout(ctx, d, x0, x1, ...legendSize(n)) : null;
  const headerH = 206, tileH = 178, tileRows = Math.ceil(d.figures.length/2), tilesH = tileRows*tileH+(tileRows-1)*18;
  let tiles = parts.figures && d.figures.length > 0;
  const avail = bottom-30-GAP-top; // 30 للتذييل
  const fixed = () => headerH+GAP+(lay ? lay.h+GAP : 0)+(tiles ? tilesH+GAP : 0);
  // مع الرسم وأكثر من 8 شركات يُقسم الترتيب عمودين فيبقى السطر مقروءًا ويبقى للرسم مكانه
  const cols = rank && chart && n > 8 ? 2 : 1, per = Math.ceil(n/cols);
  let rowH = 0, chartH = 0;
  if(rank){
    const cap = chart ? (per <= 4 ? 100 : 82) : 150;
    const room = () => avail-fixed()-104-(chart ? H*0.28+GAP : 0);
    rowH = Math.min(cap, room()/per);
    if(rowH < 60 && tiles){ tiles = false; rowH = Math.min(cap, room()/per); }
    rowH = Math.max(60, rowH);
  }
  const rankH = rank ? 104+per*rowH : 0;
  if(chart) chartH = Math.max(H*0.18, avail-fixed()-(rank ? rankH+GAP : 0));
  let y = top;
  y += drawHeader(ctx, P, d, x0, x1, y, brand) + GAP;
  if(lay){ drawLegend(ctx, P, lay, y, colors); y += lay.h+GAP; }
  if(tiles) y += drawTiles(ctx, P, d, x0, x1, y, 2, tileH) + GAP;
  if(chart){ card(ctx, P, x0, y, CW, chartH); drawChart(ctx, P, d, x0+24, y+30, CW-48, chartH-54); y += chartH+GAP; }
  // الترتيب وحده: يتوسط المساحة الباقية إن لم يملأها
  if(rank) drawRank(ctx, P, d, x0, chart ? y : y+Math.max(0, (bottom-30-GAP-y-rankH)/2), CW, rowH, cols);
  drawFooter(ctx, P, d, x0, x1, bottom);
}
function layoutWide(ctx, P, d, S, key, brand, parts){
  const W = S.w, H = S.h, PAD = 56, x0 = PAD, x1 = W-PAD, GAP = 24, top = 44, bottom = H-36;
  const n = d.companies.length, chart = parts.chart, rank = parts.rank;
  let y = top;
  y += drawHeader(ctx, P, d, x0, x1, y, brand, 58) + GAP-6;
  const both = chart && rank, chartW = both ? Math.round((x1-x0-GAP)*0.6) : x1-x0, sideW = x1-x0-GAP-chartW;
  if(chart && !fullBars(d, chartW-48)){ const lay = legendLayout(ctx, d, x0, x1, ...legendSize(n).map(v => v-4)); drawLegend(ctx, P, lay, y, true); y += lay.h+GAP; }
  const areaBottom = bottom-30-GAP;
  const fitRank = (h, maxCols) => { // أقل عدد أعمدة يعطي سطرًا لا يقل عن 60
    for(let c = 1; c <= maxCols; c++){ const per = Math.ceil(n/c), rh = (h-104)/per; if(rh >= 60 || c===maxCols) return [Math.min(c===1 ? 100 : 92, Math.max(44, rh)), c]; }
  };
  if(both){
    const areaH = areaBottom-y;
    card(ctx, P, x1-chartW, y, chartW, areaH); drawChart(ctx, P, d, x1-chartW+24, y+28, chartW-48, areaH-50);
    // العمود الأيسر: الأرقام السريعة ثم الترتيب؛ تُحذف الأرقام إن ضاق المكان على الترتيب
    const tileH = 164, tileRows = Math.ceil(d.figures.length/2), tilesH = tileRows*tileH+(tileRows-1)*16;
    let ry = y, rh = areaH;
    if(parts.figures && d.figures.length && (rh-tilesH-GAP-104)/n >= 60){ drawTiles(ctx, P, d, x0, x0+sideW, y, 2, tileH, 16); ry += tilesH+GAP; rh -= tilesH+GAP; }
    const [rowH, cols] = fitRank(rh, 2);
    drawRank(ctx, P, d, x0, ry, sideW, rowH, cols);
  } else {
    // جزء واحد: الأرقام السريعة صفًّا بعرض الصورة، ثم الرسم أو الترتيب بالعرض كله
    if(parts.figures && d.figures.length){ y += drawTiles(ctx, P, d, x0, x1, y, Math.min(4, d.figures.length), 150, 16) + GAP; }
    const areaH = areaBottom-y;
    if(chart){ card(ctx, P, x0, y, x1-x0, areaH); drawChart(ctx, P, d, x0+24, y+28, x1-x0-48, areaH-50); }
    else { const [rowH, cols] = fitRank(areaH, 3), rankH = 104+Math.ceil(n/cols)*rowH; drawRank(ctx, P, d, x0, y+Math.max(0, (areaH-rankH)/2), x1-x0, rowH, cols); }
  }
  drawFooter(ctx, P, d, x0, x1, bottom);
}

export async function renderComparison(data, key='iphone', parts={ figures:true, chart:true, rank:true }){
  const S = SIZES[key] || SIZES.iphone, P = PAL[data.theme] || PAL.dark;
  await document.fonts?.ready;
  const companies = data.companies.map(c => ({ ...c }));
  const [brand, ...imgs] = await Promise.all([loadImg('apple-touch-icon.png'), ...companies.map(c => loadImg(c.logo))]);
  companies.forEach((c, i) => c.img = imgs[i]);
  const by = new Map(companies.map(c => [c.symbol, c]));
  const d = { ...data, companies,
    figures: data.figures.map(f => ({ ...f, company: f.symbol ? by.get(f.symbol) : null })),
    rank: { ...data.rank, rows: data.rank.rows.map(r => ({ ...r, company: by.get(r.symbol) })) } };
  const cv = document.createElement('canvas'); cv.width = S.w*SCALE; cv.height = S.h*SCALE;
  const ctx = cv.getContext('2d'); ctx.scale(SCALE, SCALE);
  drawBackground(ctx, P, S.w, S.h);
  (S.w > S.h ? layoutWide : layoutTall)(ctx, P, d, S, key, brand, parts);
  return cv;
}

/* ---------- نافذة الحفظ ---------- */
// تعرض معاينة الصورة واختيار المقاس والمحتوى، وزر «حفظ في الصور» يفتح قائمة المشاركة (على الآيفون: Save Image)
const PARTS = [['figures','الأرقام السريعة'],['chart','الرسم البياني'],['rank','الترتيب']];
const PARTS_KEY = 'cx-export-parts';
function loadParts(){
  try{ const p = JSON.parse(localStorage.getItem(PARTS_KEY)); if(p && (p.chart || p.rank)) return { figures:!!p.figures, chart:!!p.chart, rank:!!p.rank }; }catch{}
  return { figures:true, chart:true, rank:true };
}
let dlg = null, seq = 0;
async function build(){
  const my = ++seq, img = dlg.querySelector('img'), busy = dlg.querySelector('.cx-export-busy'), key = dlg._key, parts = dlg._parts;
  dlg.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size===key)));
  dlg.querySelectorAll('[data-part]').forEach(b => b.setAttribute('aria-pressed', String(parts[b.dataset.part])));
  busy.hidden = false; img.style.opacity = '.35';
  const data = dlg._getData(), cv = await renderComparison(data, key, parts);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if(my!==seq || !blob) return;
  if(dlg._url) URL.revokeObjectURL(dlg._url);
  const what = parts.chart && parts.rank ? '' : parts.chart ? '-الرسم' : '-الترتيب';
  const name = `مقارنة-${data.title}${what}-${data.span}-${SIZES[key].dims.replace(/\s/g, '')}.png`.replace(/[\\/:*?"<>|]/g, '-');
  dlg._url = URL.createObjectURL(blob); dlg._file = new File([blob], name, { type:'image/png' });
  img.src = dlg._url; img.style.opacity = ''; busy.hidden = true;
  const dl = dlg.querySelector('.cx-export-dl'); dl.href = dlg._url; dl.download = name;
  dlg.querySelector('.cx-export-share').hidden = !navigator.canShare?.({ files:[dlg._file] });
}
export function openExportDialog(getData){
  if(!dlg){
    dlg = document.createElement('dialog'); dlg.id = 'cx-export'; dlg.className = 'cx-export';
    dlg.innerHTML = `<form method="dialog" class="cx-export-head"><h3>حفظ المقارنة كصورة</h3><button class="cx-export-x" aria-label="إغلاق">×</button></form>
      <div class="cx-export-body">
        <div class="cx-export-row"><span class="cx-export-label">المقاس</span><div class="cx-seg cx-export-sizes" role="group" aria-label="مقاس الصورة">${Object.entries(SIZES).map(([k, s]) => `<button type="button" data-size="${k}" aria-pressed="false"><span>${s.label}</span><small class="n" dir="ltr">${s.dims}</small></button>`).join('')}</div></div>
        <div class="cx-export-row"><span class="cx-export-label">المحتوى</span><div class="cx-export-parts" role="group" aria-label="ما يظهر في الصورة">${PARTS.map(([k, t]) => `<button type="button" class="cx-chip" data-part="${k}" aria-pressed="true">${t}</button>`).join('')}</div></div>
        <div class="cx-export-stage"><img alt="معاينة صورة المقارنة"><span class="cx-export-busy">جارٍ تجهيز الصورة…</span></div>
        <div class="cx-export-actions"><button type="button" class="cx-export-share">حفظ في الصور / مشاركة</button><a class="cx-export-dl" href="#" download>تنزيل PNG</a></div>
        <p class="cx-export-hint">على الآيفون: «حفظ في الصور» ثم «Save Image»، أو اضغط مطولًا على الصورة. يبقى الرسم أو الترتيب واحدًا على الأقل.</p>
      </div>`;
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if(e.target===dlg) dlg.close(); });
    dlg.querySelector('.cx-export-sizes').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if(b){ dlg._key = b.dataset.size; build(); } });
    dlg.querySelector('.cx-export-parts').addEventListener('click', e => {
      const b = e.target.closest('[data-part]'); if(!b) return;
      const next = { ...dlg._parts, [b.dataset.part]: !dlg._parts[b.dataset.part] };
      if(!next.chart && !next.rank) return; // لا صورة بلا رسم ولا ترتيب
      dlg._parts = next; try{ localStorage.setItem(PARTS_KEY, JSON.stringify(next)); }catch{}
      build();
    });
    dlg.querySelector('.cx-export-share').addEventListener('click', async () => {
      const f = dlg._file; if(!f) return;
      try{ await navigator.share({ files:[f], title:f.name }); }catch(err){ if(err?.name!=='AbortError') dlg.querySelector('.cx-export-dl').click(); }
    });
    dlg.addEventListener('close', () => { if(dlg._url) URL.revokeObjectURL(dlg._url); dlg._url = null; dlg._file = null; });
  }
  dlg._getData = getData; dlg._key = dlg._key || 'iphone'; dlg._parts = loadParts();
  if(!dlg.open) dlg.showModal();
  build();
}
