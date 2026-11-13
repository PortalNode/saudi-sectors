// صفحة المقارنة: تقرأ ملفات ‎*-financials.json‎ لكل قطاع.
const DATA_BASE = '';
const MAX_COMPANIES = 8; // ثمانية ألوان متمايزة ومتحقق منها؛ أكثر من ذلك يفقد الرسم وضوحه
const $ = id => document.getElementById(id);
const SECTORS = [
 ['الزراعة','agriculture'],['البنوك','banks'],['البتروكيماويات','petrochem'],['النفط و الغاز','oilgas'],['الاسمنت','cement'],['تجارة و تجزئة','retail'],['الأغذية والمشروبات','food'],['الصناعات التحويلية','industrial'],['العقارات','realestate'],['النقل','transport'],['الاتصالات','telecom'],['الرعاية الصحية','health'],['خدمات الرعاية الصحية','healthservices'],['التعليم و التدريب','education'],['تقنية المعلومات','information-technology'],['المواد الاساسية','materials'],['التعدين والمعادن','mining'],['المراكز الرياضية','sports'],['موردي الادوية','pharma'],['الفنادق و السياحة','hotels-tourism'],['وسائل الاعلام','media'],['متعددة الأنشطة','multi'],['المرافق والطاقة','utilities'],['خدمات الاعمال','business-services'],['المنتجات الزجاجية','glass'],['أسواق الاوراق المالية','exchange'],['السلع الاستهلاكية','consumer']
];
const LABELS = { revenue:'الإيرادات',grossIncome:'إجمالي الدخل',operatingIncome:'دخل العمليات',netProfit:'صافي الربح',epsBeforeExceptional:'ربح السهم قبل الاستثنائية',eps:'ربح السهم',grossMargin:'هامش إجمالي الربح',operatingMargin:'هامش دخل العمليات',netMargin:'هامش صافي الربح',assets:'الموجودات',financing:'التمويل / صافي القروض',deposits:'ودائع العملاء',equity:'حقوق المساهمين',netFinancingIncome:'صافي دخل التمويل والاستثمار',loansToDeposits:'القروض إلى الودائع',returnOnEquity:'العائد على حقوق المساهمين',retailFinancingShare:'نسبة تمويل الأفراد',corporateFinancingShare:'نسبة تمويل الشركات',internationalFinancingShare:'نسبة التمويل الدولي',pe:'مكرر الأرباح التاريخي',dilutedEps:'ربح السهم المخفض',recurringEps:'ربحية السهم المتكررة',provisions:'المخصصات',averageShares:'متوسط عدد الأسهم'};
const GROUPS = [
 ['income','قائمة الدخل',['revenue','grossIncome','operatingIncome','netProfit','netFinancingIncome','provisions']],
 ['balance','المركز المالي',['assets','financing','deposits','equity']],
 ['share','السهم',['epsBeforeExceptional','eps','dilutedEps','recurringEps','pe','averageShares']],
 ['ratio','الهوامش والنسب',['grossMargin','operatingMargin','netMargin','returnOnEquity','loansToDeposits','retailFinancingShare','corporateFinancingShare','internationalFinancingShare']],
];
// بنود لا يعني ارتفاعها «تحسنًا» بالضرورة: يظهر تغيرها بلون محايد
const NEUTRAL = new Set(['pe','provisions','loansToDeposits','averageShares','retailFinancingShare','corporateFinancingShare','internationalFinancingShare']);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = d => new Intl.NumberFormat('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const NF = [nf(0),nf(1),nf(2)];

const state = { sector:'agriculture', metric:'netProfit', years:[], symbols:[], view:'bars', sort:{key:null,dir:-1}, query:'' };
let companies = [], allYears = [], slots = new Map(), valueIndex = new Map();

const isPct = k => k.endsWith('Margin') || k.endsWith('Share') || k==='loansToDeposits' || k==='returnOnEquity';
const unit = k => isPct(k) ? '%' : ['eps','epsBeforeExceptional','dilutedEps','recurringEps'].includes(k) ? 'ريال' : k==='pe' ? 'مرة' : k==='averageShares' ? 'مليون سهم' : 'مليون ريال';
const label = k => LABELS[k] || k;
const valueAt = (c,y) => { const v = valueIndex.get(c.symbol)?.get(y)?.[state.metric]; return Number.isFinite(v) ? v : null; };
const color = c => `var(--s${(slots.get(c.symbol) ?? 0) + 1})`;
function fmt(v, signed=false){
  if(v==null) return '—';
  const x = isPct(state.metric) ? v*100 : v, a = Math.abs(x);
  const s = isPct(state.metric) ? NF[1].format(x)+'%' : (a>=1000?NF[0]:NF[2]).format(x);
  return (signed && x>0 ? '+' : '') + s;
}
const num = (v,signed) => `<span class="n">${fmt(v,signed)}</span>`;
const chosen = () => state.symbols.map(s => companies.find(c => c.symbol===s)).filter(Boolean);

/* التغير بين قيمتين: نقاط مئوية للبنود النسبية، نسبة عند أساس موجب، وإلا فرق مطلق */
function change(a,b){
  if(a==null || b==null) return null;
  const diff = b-a, dir = diff>0 ? 1 : diff<0 ? -1 : 0, sign = diff>0 ? '+' : '';
  let text;
  if(isPct(state.metric)) text = `${sign}${NF[1].format(diff*100)} نقطة`;
  else if(a>0) text = `${sign}${NF[1].format(diff/a*100)}%`;
  else text = fmt(diff,true);
  return { diff, dir, text, pct: !isPct(state.metric) && a>0 ? diff/a : null };
}
const dirClass = d => NEUTRAL.has(state.metric) || !d ? '' : d>0 ? 'cx-up' : 'cx-down';
const arrow = d => d>0 ? '▲' : d<0 ? '▼' : '•';

/* ---------- الحالة في الرابط ---------- */
function readHash(){
  const p = new URLSearchParams(location.hash.slice(1));
  if(SECTORS.some(([,s]) => s===p.get('s'))) state.sector = p.get('s');
  return { m:p.get('m'), y:(p.get('y')||'').split(',').map(Number).filter(Boolean), c:(p.get('c')||'').split(',').filter(Boolean), v:p.get('v') };
}
function writeHash(){
  const p = new URLSearchParams({ s:state.sector, m:state.metric, y:state.years.join(','), c:state.symbols.join(','), v:state.view });
  history.replaceState(null,'','#'+p.toString().replace(/%2C/g,','));
}

/* ---------- عناصر الاختيار ---------- */
function setSymbols(list){
  state.symbols = list.slice(0,MAX_COMPANIES);
  for(const s of [...slots.keys()]) if(!state.symbols.includes(s)) slots.delete(s);
  for(const s of state.symbols) if(!slots.has(s)){ const used = new Set(slots.values()); let i=0; while(used.has(i)) i++; slots.set(s,i); }
}
function availableMetrics(){ return [...new Set(companies.flatMap(c => (c.years||[]).flatMap(r => Object.keys(r.values||{}))))]; }
function metricGroups(){
  const keys = availableMetrics(), known = new Set(GROUPS.flatMap(g => g[2]));
  const groups = GROUPS.map(([id,name,list]) => [id,name,list.filter(k => keys.includes(k))]).filter(g => g[2].length);
  const rest = keys.filter(k => !known.has(k));
  if(rest.length) groups.push(['other','أخرى',rest]);
  return groups;
}
function renderMetrics(){
  const groups = metricGroups(), active = groups.find(g => g[2].includes(state.metric)) || groups[0];
  $('metric-groups').innerHTML = groups.map(([id,name]) => `<button type="button" data-group="${id}" aria-pressed="${id===active[0]}">${esc(name)}</button>`).join('');
  $('metric-groups').hidden = groups.length<2;
  $('metric-chips').innerHTML = active[2].map(k => `<button type="button" class="cx-chip" data-metric="${esc(k)}" aria-pressed="${k===state.metric}">${esc(label(k))}</button>`).join('');
}
function renderYears(){
  $('year-chips').innerHTML = allYears.map(y => `<button type="button" class="cx-chip" data-year="${y}" aria-pressed="${state.years.includes(y)}"><span class="n">${y}</span></button>`).join('');
}
function renderCompanies(){
  const full = state.symbols.length>=MAX_COMPANIES, q = state.query.trim();
  $('company-search').closest('.cx-company-tools').querySelector('.cx-search').hidden = companies.length<=12;
  $('company-chips').innerHTML = companies.filter(c => !q || state.symbols.includes(c.symbol) || c.name.includes(q) || String(c.symbol).includes(q)).map(c => {
    const on = state.symbols.includes(c.symbol);
    return `<button type="button" class="cx-chip" data-symbol="${esc(c.symbol)}" aria-pressed="${on}" ${!on&&full?'disabled':''} style="--c:${on?color(c):'transparent'}"><i></i>${esc(c.name)} <bdi>${esc(c.symbol)}</bdi></button>`;
  }).join('');
  $('selection-count').textContent = `${state.symbols.length} من ${companies.length}${full?' · الحد الأقصى':''}`;
}

/* ---------- أرقام سريعة ---------- */
function renderFigures(list){
  const y = state.years.at(-1), first = state.years[0];
  const withV = list.map(c => ({c, v:valueAt(c,y)})).filter(r => r.v!=null).sort((a,b) => b.v-a.v);
  const who = c => `<i style="--c:${color(c)}"></i>${esc(c.name)}`;
  const tiles = [];
  if(withV.length){
    const top = withV[0], low = withV.at(-1), avg = withV.reduce((s,r) => s+r.v,0)/withV.length;
    tiles.push([`الأعلى في ${y}`, num(top.v), who(top.c)]);
    tiles.push([`الأدنى في ${y}`, num(low.v), who(low.c)]);
    tiles.push([`متوسط الشركات المختارة`, num(avg), `من ${withV.length} شركات · ${esc(unit(state.metric))}`]);
  }
  const base = state.years.length>1 ? first : allYears[allYears.indexOf(y)-1];
  if(base!=null){
    const moves = list.map(c => ({c, ch:change(valueAt(c,base),valueAt(c,y))})).filter(r => r.ch);
    const usePct = moves.length && moves.every(r => r.ch.pct!=null);
    moves.sort((a,b) => usePct ? b.ch.pct-a.ch.pct : b.ch.diff-a.ch.diff);
    if(moves.length) tiles.push([`الأكثر ارتفاعًا ${base} ← ${y}`, `<span class="n ${dirClass(moves[0].ch.dir)}">${esc(moves[0].ch.text)}</span>`, who(moves[0].c)]);
  }
  $('cx-figures').innerHTML = tiles.map(([dt,dd,small]) => `<div class="key-figure"><dt>${dt}</dt><dd>${dd}</dd><small>${small}</small></div>`).join('');
}

/* ---------- الرسم ---------- */
function niceTicks(lo,hi,count=5){
  if(lo===hi){ hi = lo+1; }
  const raw = (hi-lo)/count, mag = 10**Math.floor(Math.log10(raw)), n = raw/mag;
  const step = (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;
  const start = Math.floor(lo/step)*step, end = Math.ceil(hi/step)*step, ticks = [];
  for(let v=start; v<=end+step/2; v+=step) ticks.push(Math.abs(v)<step/1e6 ? 0 : v);
  return ticks;
}
function axisFmt(v,step){
  const x = isPct(state.metric) ? v*100 : v, s = isPct(state.metric) ? step*100 : step;
  return new Intl.NumberFormat('en-US',{maximumFractionDigits: s>=1?0:s>=0.1?1:2}).format(x) + (isPct(state.metric)?'%':'');
}
function renderChart(list){
  const box = $('chart'), W = Math.max(280, box.clientWidth-20), H = matchMedia('(max-width:760px)').matches ? 290 : 340;
  const yrs = state.years, n = list.length;
  const vals = list.flatMap(c => yrs.map(y => valueAt(c,y))).filter(v => v!=null);
  if(!vals.length){ box.innerHTML = `<div class="cx-empty" style="direction:rtl;border:0;margin:0">لا توجد قيم متاحة لهذا البند في السنوات المختارة.</div>`; return; }
  const bars = state.view==='bars';
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if(bars || (lo>=0 && lo<hi*0.5)) lo = Math.min(0,lo);
  if(bars) hi = Math.max(0,hi);
  if(lo===hi){ lo -= Math.abs(lo)*0.1||1; hi += Math.abs(hi)*0.1||1; }
  const ticks = niceTicks(lo,hi), step = ticks[1]-ticks[0]; lo = ticks[0]; hi = ticks.at(-1);
  const tickText = ticks.map(t => axisFmt(t,step));
  const m = { l: 14 + Math.max(...tickText.map(t => t.length))*6.2, r: 8, t: 20, b: 30 };
  const pw = W-m.l-m.r, ph = H-m.t-m.b, gw = pw/yrs.length;
  const Y = v => m.t + (hi-v)/(hi-lo)*ph, cx = i => m.l + gw*(i+.5);
  let g = '';
  ticks.forEach((t,i) => { g += `<line class="${t===0?'zero':'grid'}" x1="${m.l}" x2="${W-m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l-8}" y="${Y(t)+3.5}" text-anchor="end">${tickText[i]}</text>`; });
  yrs.forEach((y,i) => { g += `<rect class="band" data-year="${y}" x="${m.l+gw*i}" y="${m.t-6}" width="${gw}" height="${ph+12}"/><text class="year" x="${cx(i)}" y="${H-8}" text-anchor="middle">${y}</text>`; });
  if(bars){
    const inner = gw*0.8, slot = inner/n, bw = Math.max(3, Math.min(36, slot-2)), showVal = slot>=42 && n*yrs.length<=18;
    yrs.forEach((y,i) => list.forEach((c,j) => {
      const v = valueAt(c,y); if(v==null) return;
      const x = cx(i) - (n*slot)/2 + j*slot + (slot-bw)/2, y0 = Y(0), y1 = Y(v), h = Math.max(1.5, Math.abs(y1-y0)), r = Math.min(3, bw/2, h);
      const d = v>=0
        ? `M${x},${y0}V${y0-h+r}q0,${-r} ${r},${-r}H${x+bw-r}q${r},0 ${r},${r}V${y0}Z`
        : `M${x},${y0}V${y0+h-r}q0,${r} ${r},${r}H${x+bw-r}q${r},0 ${r},${-r}V${y0}Z`;
      g += `<path class="mark" data-s="${esc(c.symbol)}" d="${d}" fill="${color(c)}"/>`;
      if(showVal) g += `<text class="val mark" data-s="${esc(c.symbol)}" x="${x+bw/2}" y="${v>=0 ? y0-h-5 : y0+h+13}" text-anchor="middle">${fmt(v)}</text>`;
    }));
  } else {
    list.forEach(c => {
      let d = '', pen = false, dots = '';
      yrs.forEach((y,i) => { const v = valueAt(c,y); if(v==null){ pen = false; return; } d += `${pen?'L':'M'}${cx(i)},${Y(v)}`; pen = true; dots += `<circle class="dot" cx="${cx(i)}" cy="${Y(v)}" r="4.5" fill="${color(c)}"/>`; });
      g += `<g class="mark" data-s="${esc(c.symbol)}"><path class="line" d="${d}" stroke="${color(c)}"/>${dots}</g>`;
    });
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label(state.metric))} حسب السنة">${g}</svg>`;
}
function showTip(year, x, y){
  const tip = $('cx-tip'), list = chosen();
  const rows = list.map(c => ({c, v:valueAt(c,year)})).sort((a,b) => (b.v??-Infinity)-(a.v??-Infinity));
  tip.innerHTML = `<h4>${esc(label(state.metric))} · <span class="n">${year}</span> · ${esc(unit(state.metric))}</h4>` + rows.map(r => `<div><i style="--c:${color(r.c)}"></i><span>${esc(r.c.name)}</span><b>${num(r.v)}</b></div>`).join('');
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth-w-8, x+14 + (x+14+w>innerWidth-8 ? -w-28 : 0))) + 'px';
  tip.style.top = Math.max(8, Math.min(innerHeight-h-8, y-h/2)) + 'px';
}
function hideTip(){ $('cx-tip').hidden = true; document.querySelectorAll('.cx-chart .band.on').forEach(b => b.classList.remove('on')); }
function highlight(symbol){
  for(const el of [$('chart'), $('rank-list')]) el.classList.toggle('dim', !!symbol);
  document.querySelectorAll('.cx-page [data-s]').forEach(el => el.classList.toggle('hl', el.dataset.s===symbol));
  document.querySelectorAll('#chart-legend button').forEach(b => b.classList.toggle('on', b.dataset.s===symbol));
}

/* ---------- الترتيب ---------- */
function renderRank(list){
  const y = state.years.at(-1), prev = allYears[allYears.indexOf(y)-1];
  const rows = list.map(c => ({c, v:valueAt(c,y)})).sort((a,b) => (b.v??-Infinity)-(a.v??-Infinity));
  const vs = rows.map(r => r.v).filter(v => v!=null), lo = Math.min(0,...vs), hi = Math.max(0,...vs), span = hi-lo || 1;
  $('rank-title').textContent = `الترتيب في ${y}`;
  $('rank-sub').textContent = prev!=null ? `مع التغير عن ${prev}` : '';
  $('rank-list').innerHTML = rows.map((r,i) => {
    const ch = prev!=null ? change(valueAt(r.c,prev), r.v) : null;
    const fill = r.v==null ? '' : `<span class="fill" style="left:${(Math.min(r.v,0)-lo)/span*100}%;width:${Math.abs(r.v)/span*100}%"></span>`;
    return `<li data-s="${esc(r.c.symbol)}" style="--c:${color(r.c)}"><span class="pos">${r.v==null?'—':i+1}</span><span class="who">${esc(r.c.name)} <bdi>${esc(r.c.symbol)}</bdi></span><span class="fig">${num(r.v)}</span><span class="track">${fill}${lo<0?`<span class="axis0" style="left:${-lo/span*100}%"></span>`:''}</span>${ch?`<span class="delta"><span class="n ${dirClass(ch.dir)}">${arrow(ch.dir)} ${esc(ch.text)}</span> عن ${prev}</span>`:''}</li>`;
  }).join('');
}

/* ---------- الجدول ---------- */
function spark(c){
  const pts = state.years.map((y,i) => [i,valueAt(c,y)]).filter(p => p[1]!=null);
  if(pts.length<2) return '';
  const W=76,H=24,p=3, vs=pts.map(p=>p[1]), lo=Math.min(...vs), hi=Math.max(...vs), span=hi-lo||1, n=state.years.length-1||1;
  const X = i => p+i/n*(W-2*p), Yv = v => H-p-(v-lo)/span*(H-2*p);
  const zero = lo<0 && hi>0 ? `<line x1="0" x2="${W}" y1="${Yv(0)}" y2="${Yv(0)}"/>` : '';
  const last = pts.at(-1);
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${zero}<path d="${pts.map((q,i)=>`${i?'L':'M'}${X(q[0])},${Yv(q[1])}`).join('')}"/><circle cx="${X(last[0])}" cy="${Yv(last[1])}" r="2.5"/></svg>`;
}
function renderTable(list){
  const yrs = state.years, multi = yrs.length>1, a = yrs[0], b = yrs.at(-1);
  if(state.sort.key!=='chg' && state.sort.key!=='name' && !yrs.includes(state.sort.key)) state.sort = {key:b,dir:-1};
  if(state.sort.key==='chg' && !multi) state.sort = {key:b,dir:-1};
  const {key,dir} = state.sort;
  const keyOf = c => key==='name' ? null : key==='chg' ? (change(valueAt(c,a),valueAt(c,b))?.diff ?? null) : valueAt(c,key);
  const rows = [...list].sort((p,q) => {
    if(key==='name') return -dir*p.name.localeCompare(q.name,'ar');
    const pv = keyOf(p), qv = keyOf(q);
    if(pv==null || qv==null) return (pv==null)-(qv==null);
    return dir*(pv-qv);
  });
  const best = new Map(yrs.map(y => [y, Math.max(...list.map(c => valueAt(c,y) ?? -Infinity))]));
  const head = (k,text) => `<th><button type="button" data-sort="${k}" class="${key===k?'sorted'+(dir>0?' asc':''):''}">${text}</button></th>`;
  $('table-sub').textContent = `${label(state.metric)} · ${unit(state.metric)} · اضغط على عنوان العمود للترتيب`;
  $('cx-table').innerHTML = `<thead><tr>${head('name','الشركة')}${yrs.map(y => head(y,`<span class="n">${y}</span>`)).join('')}${multi?head('chg',`التغير <span class="n">${a} ← ${b}</span>`)+'<th>الاتجاه</th>':''}</tr></thead><tbody>${rows.map(c => {
    const ch = multi ? change(valueAt(c,a),valueAt(c,b)) : null;
    return `<tr data-s="${esc(c.symbol)}" style="--c:${color(c)}"><th scope="row"><span><i></i>${esc(c.name)} <bdi>${esc(c.symbol)}</bdi></span></th>${yrs.map(y => { const v = valueAt(c,y); return `<td class="${v==null?'miss':v<0?'neg':''}${v!=null&&v===best.get(y)&&list.length>1?' best':''}">${num(v)}</td>`; }).join('')}${multi?`<td class="chg">${ch?`<span class="n ${dirClass(ch.dir)}">${esc(ch.text)}</span>`:'<span class="miss">—</span>'}</td><td>${spark(c)}</td>`:''}</tr>`;
  }).join('')}</tbody>`;
}

/* ---------- التجميع ---------- */
function render(){
  renderMetrics(); renderYears(); renderCompanies();
  $('chart-view').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view===state.view)));
  const list = chosen(), ok = list.length>=2 && state.years.length>=1;
  $('cx-results').hidden = !ok; $('cx-empty').hidden = ok;
  const sectorName = SECTORS.find(([,s]) => s===state.sector)?.[0] || '';
  if(!ok){
    $('cx-empty').textContent = list.length<2 ? 'اختر شركتين على الأقل لعرض المقارنة.' : 'اختر سنة واحدة على الأقل لعرض المقارنة.';
    $('cx-summary').textContent = `قطاع ${sectorName}`;
    writeHash(); return;
  }
  const span = state.years.length>1 ? `${state.years[0]}–${state.years.at(-1)}` : `${state.years[0]}`;
  $('cx-summary').innerHTML = `<b>${esc(label(state.metric))}</b> · ${esc(unit(state.metric))} · ${list.length} شركات من قطاع ${esc(sectorName)} · <span class="n">${span}</span>`;
  $('chart-title').textContent = label(state.metric);
  $('chart-sub').textContent = `${unit(state.metric)} · مرّر على السنة لعرض القيم`;
  $('chart-legend').innerHTML = list.map(c => `<button type="button" data-s="${esc(c.symbol)}" style="--c:${color(c)}"><i></i>${esc(c.name)}</button>`).join('');
  renderFigures(list); renderChart(list); renderRank(list); renderTable(list);
  writeHash();
}

async function loadSector(slug, wanted={}){
  state.sector = slug; $('sector-select').value = slug;
  const data = await (await fetch(`${DATA_BASE}${slug}-financials.json?v=comparison-v4`)).json();
  companies = data.companies || data.banks || []; allYears = data.years || [];
  valueIndex = new Map(companies.map(c => [c.symbol, new Map((c.years||[]).map(r => [r.year, r.values||{}]))]));
  const keys = availableMetrics();
  state.metric = keys.includes(wanted.m) ? wanted.m : keys.includes(state.metric) ? state.metric : keys.includes('netProfit') ? 'netProfit' : keys[0];
  const ys = (wanted.y||[]).filter(y => allYears.includes(y)).sort((a,b) => a-b);
  state.years = ys.length ? ys : [...allYears];
  const cs = (wanted.c||[]).filter(s => companies.some(c => c.symbol===s));
  slots = new Map(); state.query = ''; $('company-search').value = '';
  setSymbols(cs.length ? cs : companies.slice(0,3).map(c => c.symbol));
  if(wanted.v==='lines' || wanted.v==='bars') state.view = wanted.v;
  state.sort = {key:null,dir:-1};
  render();
}

/* ---------- الأحداث ---------- */
$('sector-select').innerHTML = SECTORS.map(([name,slug]) => `<option value="${slug}">${esc(name)}</option>`).join('');
$('sector-select').addEventListener('change', e => loadSector(e.target.value).catch(fail));
$('metric-groups').addEventListener('click', e => { const b = e.target.closest('[data-group]'); if(!b) return; const g = metricGroups().find(g => g[0]===b.dataset.group); if(g && !g[2].includes(state.metric)){ state.metric = g[2][0]; render(); } });
$('metric-chips').addEventListener('click', e => { const b = e.target.closest('[data-metric]'); if(b){ state.metric = b.dataset.metric; render(); } });
$('year-chips').addEventListener('click', e => { const b = e.target.closest('[data-year]'); if(!b) return; const y = Number(b.dataset.year); state.years = (state.years.includes(y) ? state.years.filter(v => v!==y) : [...state.years,y]).sort((a,b) => a-b); render(); });
document.querySelector('[data-years]').parentElement.addEventListener('click', e => { const b = e.target.closest('[data-years]'); if(!b) return; state.years = b.dataset.years==='all' ? [...allYears] : allYears.slice(-Number(b.dataset.years)); render(); });
$('company-chips').addEventListener('click', e => { const b = e.target.closest('[data-symbol]'); if(!b) return; const s = b.dataset.symbol; setSymbols(state.symbols.includes(s) ? state.symbols.filter(v => v!==s) : [...state.symbols,s]); render(); });
$('company-search').addEventListener('input', e => { state.query = e.target.value; renderCompanies(); });
document.querySelector('[data-pick]').parentElement.addEventListener('click', e => {
  const b = e.target.closest('[data-pick]'); if(!b) return;
  if(b.dataset.pick==='reset') setSymbols(companies.slice(0,3).map(c => c.symbol));
  else { const y = state.years.at(-1) ?? allYears.at(-1), sign = b.dataset.pick==='top5' ? -1 : 1;
    setSymbols(companies.map(c => ({c, v:valueAt(c,y)})).filter(r => r.v!=null).sort((p,q) => sign*(p.v-q.v)).slice(0,5).map(r => r.c.symbol)); }
  render();
});
$('chart-view').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if(b){ state.view = b.dataset.view; render(); } });
$('cx-table').addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if(!b) return; const raw = b.dataset.sort, k = raw==='chg'||raw==='name' ? raw : Number(raw); state.sort = { key:k, dir: state.sort.key===k ? -state.sort.dir : -1 }; renderTable(chosen()); });
$('chart').addEventListener('pointermove', e => { const band = e.target.closest?.('.band') || document.elementsFromPoint(e.clientX,e.clientY).find(el => el.classList?.contains('band')); if(!band){ hideTip(); return; } document.querySelectorAll('.cx-chart .band.on').forEach(b => b!==band && b.classList.remove('on')); band.classList.add('on'); showTip(Number(band.dataset.year), e.clientX, e.clientY); });
$('chart').addEventListener('pointerleave', hideTip);
addEventListener('scroll', hideTip, {passive:true});
for(const id of ['chart-legend','rank-list','cx-table']){
  $(id).addEventListener('pointerover', e => { const el = e.target.closest('[data-s]'); if(el) highlight(el.dataset.s); });
  $(id).addEventListener('pointerleave', () => highlight(null));
}
$('cx-share').addEventListener('click', async e => { const b = e.currentTarget, t = b.textContent; try{ await navigator.clipboard.writeText(location.href); b.textContent = 'تم نسخ الرابط ✓'; }catch{ b.textContent = 'انسخ الرابط من شريط العنوان'; } setTimeout(() => b.textContent = t, 1800); });
let lastW = 0;
new ResizeObserver(() => { const w = $('chart').clientWidth; if(w && w!==lastW && !$('cx-results').hidden){ lastW = w; renderChart(chosen()); } }).observe($('chart'));
const fail = e => { $('cx-results').hidden = true; $('cx-empty').hidden = false; $('cx-empty').textContent = 'تعذر تحميل بيانات القطاع.'; console.error(e); };
const wanted = readHash();
loadSector(state.sector, wanted).catch(fail);
