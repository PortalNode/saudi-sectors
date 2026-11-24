// صفحة المقارنة: تقرأ ملفات ‎*-financials.json‎ (سنوي) و‎*-quarterly-financials.json‎ (ربعي) لكل قطاع.
import { DEFAULT_PERIOD_SPEC, sumQuarters, withMargins, quarterLabel, monthRange, isCalendarYear, MONTH_NAMES, QUARTER_NAMES } from './quarterly-periods.mjs?v=quarterly-20261115';
import { marketCapMap, sortByMarketCap } from './market-cap-order.mjs?v=mcap-order-20261115';
import { openExportDialog } from './comparison-export.mjs?v=export-20261123j-multi-vs2';
import { MARKET_KEYS, isMarketKey, marketIndex, marketDate } from './comparison-market.mjs?v=market-20261124';
const DATA_BASE = '';
const VERSION = 'comparison-v6';
const MAX_COMPANIES = 15; // خمسة عشر لونًا في comparison-page.css؛ الأعمدة بلون موحّد والشعار يميّز الشركة
const MAX_METRICS = 8; // «عدة بنود»: مواجهة بين شركتين في فترة واحدة، صف لكل بند
const VS_COMPANIES = 2;
const maxCompanies = () => state.multiPick ? VS_COMPANIES : MAX_COMPANIES;
const $ = id => document.getElementById(id);
const SECTORS = [
 ['الزراعة','agriculture'],['البنوك','banks'],['التأمين','insurance'],['التمويل','finance'],['الخدمات المالية','financial-services'],['البتروكيماويات','petrochem'],['النفط و الغاز','oilgas'],['الاسمنت','cement'],['تجارة و تجزئة','retail'],['الأغذية والمشروبات','food'],['الصناعات التحويلية','industrial'],['العقارات','realestate'],['الصناديق العقارية المتداولة','reits'],['النقل','transport'],['الاتصالات','telecom'],['الرعاية الصحية','health'],['خدمات الرعاية الصحية','healthservices'],['التعليم و التدريب','education'],['تقنية المعلومات','information-technology'],['المواد الاساسية','materials'],['التعدين والمعادن','mining'],['المراكز الرياضية','sports'],['موردي الادوية','pharma'],['الفنادق و السياحة','hotels-tourism'],['وسائل الاعلام','media'],['متعددة الأنشطة','multi'],['المرافق والطاقة','utilities'],['خدمات الاعمال','business-services'],['المنتجات الزجاجية','glass'],['أسواق الاوراق المالية','exchange'],['السلع الاستهلاكية','consumer']
];
const LABELS = { revenue:'الإيرادات',grossIncome:'إجمالي الدخل',operatingIncome:'دخل العمليات',netProfit:'صافي الربح',epsBeforeExceptional:'ربح السهم قبل الاستثنائية',eps:'ربح السهم',grossMargin:'هامش إجمالي الربح',operatingMargin:'هامش دخل العمليات',netMargin:'هامش صافي الربح',assets:'الموجودات',financing:'التمويل / صافي القروض',deposits:'ودائع العملاء',equity:'حقوق المساهمين',netFinancingIncome:'صافي دخل التمويل والاستثمار',loansToDeposits:'القروض إلى الودائع',returnOnEquity:'العائد على حقوق المساهمين',retailFinancingShare:'نسبة تمويل الأفراد',corporateFinancingShare:'نسبة تمويل الشركات',internationalFinancingShare:'نسبة التمويل الدولي',pe:'مكرر الأرباح التاريخي',dilutedEps:'ربح السهم المخفض',recurringEps:'ربحية السهم المتكررة',provisions:'المخصصات',averageShares:'متوسط عدد الأسهم',gwp:'إجمالي الأقساط المكتتبة (GWP)',insuranceRevenue:'إيرادات التأمين',rentalIncome:'إيرادات الإيجار',ffo:'الدخل من العمليات التشغيلية (FFO)',units:'عدد الوحدات',ffoPerUnit:'ربح الوحدة من العمليات التشغيلية',
 mktPe:'مكرر الأرباح',mktBook:'القيمة الدفترية',mktPb:'مكرر القيمة الدفترية',mktYield:'عائد التوزيع',mktCap:'القيمة السوقية'};
// أسماء بنود تختلف في قطاع بعينه عن الاسم العام
const SECTOR_LABELS = { reits:{ eps:'ربح الوحدة' }, finance:{ netFinancingIncome:'صافي دخل عمولات التمويل والاستثمار' } };
const GROUPS = [
 ['income','قائمة الدخل',['revenue','gwp','insuranceRevenue','rentalIncome','grossIncome','operatingIncome','ffo','netFinancingIncome','provisions','netProfit']],
 ['balance','المركز المالي',['assets','financing','deposits','equity']],
 ['share','السهم',['epsBeforeExceptional','eps','dilutedEps','recurringEps','ffoPerUnit','pe','averageShares','units']],
 ['ratio','الهوامش والنسب',['grossMargin','operatingMargin','netMargin','returnOnEquity','loansToDeposits','retailFinancingShare','corporateFinancingShare','internationalFinancingShare']],
 ['market','التقييم الحالي',MARKET_KEYS], // من الصفحة الرئيسية: قيمة حالية واحدة لكل شركة
];
// بنود لا يعني ارتفاعها «تحسنًا» بالضرورة: يظهر تغيرها بلون محايد
const NEUTRAL = new Set(['pe','mktPe','mktPb','mktBook','mktCap','provisions','loansToDeposits','averageShares','units','retailFinancingShare','corporateFinancingShare','internationalFinancingShare']);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = d => new Intl.NumberFormat('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const NF = [nf(0),nf(1),nf(2)];

// الفترات: السنة كاملة، أو ربع بعينه عبر السنوات، أو أرباع متتالية، أو تجميع 6 و9 أشهر من الأرباع المستقلة.
const PERIOD_OPTIONS = [['fy','سنوي'],['q','ربع محدد'],['seq','أرباع متتالية'],['h1','6 أشهر'],['m9','9 أشهر']];
const CUMULATIVE = { h1:{ count:2, short:'6M', name:'6 أشهر' }, m9:{ count:3, short:'9M', name:'9 أشهر' } };
const SEQ_DEFAULT = 8;

// state.years: معرّفات الأعمدة المختارة (نص): السنة «2025» في السنوي والربع المحدد و6 و9 أشهر، و«2026Q3» في الأرباع المتتالية.
// metrics: البنود المختارة بترتيب اختيارها؛ metric: البند الذي تُرسم له الدوال الآن (الأول، أو بند البطاقة عند «عدة بنود»)
const state = { sector:'agriculture', period:'fy', quarter:'4', metric:'netProfit', metrics:['netProfit'], multiPick:false, group:null, years:[], symbols:[], view:'bars', sort:{key:null,dir:-1}, query:'' };
// chosenPeriod: ما اختاره المستخدم، ويعود إليه عند الانتقال إلى قطاع له نتائج ربعية
let market = new Map(), marketAsOf = null;
let chosenPeriod = 'fy', annual = null, quarterly = null, companies = [], allYears = [], colLabels = new Map(), slots = new Map(), valueIndex = new Map();
const NOW = 'now'; // عمود بنود التقييم الحالي
const lab = id => id===NOW ? 'الحالي' : colLabels.get(id) ?? String(id);
const inLab = id => id===NOW ? 'حاليًا' : `في ${lab(id)}`; // «الأعلى في 2025» / «الأعلى حاليًا»
const isMkt = k => isMarketKey(k ?? state.metric);
// «اختيار عدة بنود» يفتح المواجهة بين شركتين ولو بقي بند واحد
const multi = () => state.multiPick;
// أعمدة البند الحالي: الفترات المختارة، أو عمود «الحالي» لبنود التقييم
const cols = () => isMkt() ? [NOW] : state.years;
// يرسم fn كأن البند k هو المختار (الدوال كلها تقرأ state.metric)
function using(k, fn){ const p = state.metric; state.metric = k; try{ return fn(); } finally{ state.metric = p; } }
const setMetrics = list => { state.metrics = list.length ? list : [state.metric]; state.metric = state.metrics[0]; };
const marketNote = () => marketAsOf ? `بتاريخ ${new Intl.DateTimeFormat('ar-u-nu-latn',{dateStyle:'long'}).format(new Date(marketAsOf+'T12:00:00'))}` : 'آخر لقطة';
const isSeq = () => state.period==='seq';
const hasData = v => !!v && Object.values(v).some(x => Number.isFinite(x));

const isPct = k => k.endsWith('Margin') || k.endsWith('Share') || k==='loansToDeposits' || k==='returnOnEquity' || k==='mktYield';
const unit = k => unitOf(k) ?? (isPct(k) ? '%' : ['eps','epsBeforeExceptional','dilutedEps','recurringEps'].includes(k) ? 'ريال' : k==='pe' ? 'مرة' : k==='averageShares' ? 'مليون سهم' : 'مليون ريال');
const unitOf = k => k==='ffoPerUnit' || k==='mktBook' ? 'ريال' : k==='units' ? 'مليون وحدة' : k==='mktPe' || k==='mktPb' ? 'مرة' : k==='mktCap' ? 'مليون ريال' : null;
const label = k => SECTOR_LABELS[state.sector]?.[k] || LABELS[k] || k;
const valueAt = (c,y) => { const v = isMkt() ? market.get(String(c.symbol))?.[state.metric] : valueIndex.get(c.symbol)?.get(y)?.[state.metric]; return Number.isFinite(v) ? v : null; };
const color = c => `var(--s${(slots.get(c.symbol) ?? 0) + 1})`;
// الأعمدة بلون موحّد (الذهبي، والسالب بالأحمر)؛ الشعار هو ما يميّز الشركة. الخطوط في «اتجاه» تبقى بألوان الشركات.
// «عدة بنود»: كل شركة بلونها في البطاقات
const uni = () => state.view==='bars' && !multi();
const tone = (c, v) => !uni() ? color(c) : v!=null && v<0 ? 'var(--cx-neg)' : 'var(--cx-gold)';
function fmt(v, signed=false){
  if(v==null) return '—';
  const x = isPct(state.metric) ? v*100 : v, a = Math.abs(x);
  const s = isPct(state.metric) ? NF[1].format(x)+'%' : (a>=1000?NF[0]:NF[2]).format(x);
  return (signed && x>0 ? '+' : '') + s;
}
const num = (v,signed) => `<span class="n">${fmt(v,signed)}</span>`;
// المختارة بترتيب القائمة (الأكبر قيمة سوقية أولًا)، لا بترتيب الاختيار
const chosen = () => companies.filter(c => state.symbols.includes(c.symbol));
/* ---------- شعارات الشركات ---------- */
// logos/<الرمز>.svg و manifest.json يذكر الرموز التي لها شعار؛ الشركة بلا شعار تأخذ أول حرف من اسمها
const logosPromise = fetch('logos/manifest.json?v=20261116').then(r => r.ok ? r.json() : {symbols:[]}).then(m => new Set((m.symbols||[]).map(String))).catch(() => new Set());
let logoSet = new Set();
const hasLogo = c => logoSet.has(String(c.symbol));
const initial = c => String(c.name||'').trim().charAt(0);
// شعار HTML (المفتاح والترتيب والتلميح والجدول)
const logoHtml = c => hasLogo(c)
  ? `<img class="cx-logo" src="logos/${esc(c.symbol)}.svg" alt="" width="18" height="18" loading="lazy" decoding="async">`
  : `<span class="cx-logo cx-logo-letter">${esc(initial(c))}</span>`;
// شعار SVG بقطر L وزاويته العليا اليسرى (x,y): مربع بزوايا ناعمة، بظل خفيف وحدّ رفيع.
// ring: لون الحدّ (في «اتجاه» لون خط الشركة)، وإلا حدّ محايد.
function logoSvg(c, x, y, L, cls='', attrs='', pre='', ring=''){
  const rx = L*0.26, box = `x="${x}" y="${y}" width="${L}" height="${L}" rx="${rx}"`;
  const inner = hasLogo(c)
    ? `<image href="logos/${esc(c.symbol)}.svg" x="${x}" y="${y}" width="${L}" height="${L}" clip-path="url(#cx-clip-tile)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect class="logo-bg" ${box}/><text class="logo-letter" x="${x+L/2}" y="${y+L/2+L*0.18}" font-size="${L*0.5}" text-anchor="middle">${esc(initial(c))}</text>`;
  return `<g class="logo mark ${cls}" data-s="${esc(c.symbol)}" ${attrs}>${pre}<rect class="logo-under" ${box} filter="url(#cx-logo-shadow)"/>${inner}<rect class="logo-edge${ring?' ringed':''}" ${box}${ring?` style="stroke:${ring}"`:''}/></g>`;
}

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
  if(PERIOD_OPTIONS.some(([id]) => id===p.get('p'))) state.period = p.get('p');
  if(/^[1-4]$/.test(p.get('q')||'')) state.quarter = p.get('q');
  return { vs:p.get('vs')==='1', m:(p.get('m')||'').split(',').filter(Boolean), y:(p.get('y')||'').split(',').filter(Boolean), c:(p.get('c')||'').split(',').filter(Boolean), v:p.get('v') };
}
function writeHash(){
  const p = new URLSearchParams({ s:state.sector, p:state.period, ...(state.period==='q' ? {q:state.quarter} : {}), m:state.metrics.join(','), ...(state.multiPick ? {vs:'1'} : {}), y:state.years.join(','), c:state.symbols.join(','), v:state.view });
  history.replaceState(null,'','#'+p.toString().replace(/%2C/g,','));
}

/* ---------- عناصر الاختيار ---------- */
function setSymbols(list){
  state.symbols = list.slice(0,maxCompanies());
  for(const s of [...slots.keys()]) if(!state.symbols.includes(s)) slots.delete(s);
  for(const s of state.symbols) if(!slots.has(s)){ const used = new Set(slots.values()); let i=0; while(used.has(i)) i++; slots.set(s,i); }
}
function availableMetrics(){
  const keys = new Set();
  for(const cols of valueIndex.values()) for(const v of cols.values()) for(const [k,x] of Object.entries(v)) if(Number.isFinite(x)) keys.add(k);
  // بنود التقييم الحالي: تظهر إن وُجدت قيمة لشركة واحدة على الأقل في القطاع
  for(const k of MARKET_KEYS) if(companies.some(c => Number.isFinite(market.get(String(c.symbol))?.[k]))) keys.add(k);
  return [...keys];
}
function metricGroups(){
  const keys = availableMetrics(), known = new Set(GROUPS.flatMap(g => g[2]));
  const groups = GROUPS.map(([id,name,list]) => [id,name,list.filter(k => keys.includes(k))]).filter(g => g[2].length);
  const rest = keys.filter(k => !known.has(k));
  if(rest.length) groups.push(['other','أخرى',rest]);
  return groups;
}
function renderMetrics(){
  const groups = metricGroups(), active = groups.find(g => g[0]===state.group) || groups.find(g => g[2].includes(state.metric)) || groups[0];
  state.group = active[0];
  const count = list => state.multiPick ? list.filter(k => state.metrics.includes(k)).length : 0;
  $('metric-groups').innerHTML = groups.map(([id,name,list]) => `<button type="button" data-group="${id}" aria-pressed="${id===active[0]}">${esc(name)}${count(list)?` <b class="cx-count">${count(list)}</b>`:''}</button>`).join('');
  $('metric-groups').hidden = groups.length<2;
  const full = state.multiPick && state.metrics.length>=MAX_METRICS;
  $('metric-chips').innerHTML = active[2].map(k => { const on = state.metrics.includes(k); return `<button type="button" class="cx-chip${state.multiPick?' cx-check':''}" data-metric="${esc(k)}" aria-pressed="${on}" ${!on&&full?'disabled':''}>${esc(label(k))}</button>`; }).join('');
  $('metric-multi').setAttribute('aria-pressed', String(state.multiPick));
  // البنود المختارة من كل المجموعات، ويُزال أي منها بالضغط عليه
  const picked = $('metric-picked');
  picked.hidden = !state.multiPick;
  picked.innerHTML = state.multiPick ? `<span class="cx-picked-label">المختارة <small class="n">${state.metrics.length}/${MAX_METRICS}</small></span>` + state.metrics.map(k => `<button type="button" class="cx-picked-chip" data-unpick="${esc(k)}" ${state.metrics.length<2?'disabled':''} aria-label="إزالة ${esc(label(k))}">${esc(label(k))}<span aria-hidden="true">×</span></button>`).join('') : '';
}
function renderYears(){
  // بنود التقييم الحالي وحدها لا تحتاج سنوات
  $('years-label').closest('.cx-row').hidden = state.metrics.every(k => isMkt(k));
  $('years-label').textContent = state.multiPick ? 'السنة' : isSeq() ? 'الأرباع' : 'السنوات';
  $('year-quick').hidden = state.multiPick; // المواجهة لسنة واحدة
  $('year-chips').innerHTML = allYears.map(y => `<button type="button" class="cx-chip" data-year="${esc(y)}" aria-pressed="${state.years.includes(y)}"><span class="n">${esc(lab(y))}</span></button>`).join('');
  const quick = isSeq() ? [['all','الكل'],['8','آخر 8 أرباع'],['4','آخر 4 أرباع'],['1','آخر ربع']] : [['all','الكل'],['3','آخر 3 سنوات'],['1','آخر سنة']];
  $('year-quick').innerHTML = quick.map(([n,t]) => `<button type="button" data-years="${n}">${t}</button>`).join('');
}
/* صف الفترة: يظهر لكل قطاع له ملف نتائج ربعية؛ البنود تأتي من ملفات القطاع نفسه */
function periodNote(list){
  const mk0 = state.metrics.some(k => isMkt(k)) ? ` بنود «التقييم الحالي» من الصفحة الرئيسية ${marketNote()}.` : '';
  if(!quarterly) return 'لا تتوفر نتائج ربعية لهذا القطاع؛ المقارنة سنوية فقط.' + mk0;
  const n = Number(state.quarter);
  const text = {
    fy: 'النتائج السنوية كاملة كما في ملف القطاع السنوي.',
    q: `الربع ${QUARTER_NAMES[n]} وحده (${monthRange(12,n)}) مقارنًا عبر السنوات.`,
    seq: 'كل ربع مستقل بترتيبه الزمني؛ التغير في الترتيب يقارن بالربع نفسه من السنة السابقة.',
    h1: 'مجموع الربعين الأول والثاني (يناير – يونيو) لكل سنة، من الأرباع المستقلة.',
    m9: 'مجموع الأرباع الثلاثة الأولى (يناير – سبتمبر) لكل سنة، من الأرباع المستقلة.'
  }[state.period];
  // المواجهة: فترة واحدة لسنة تختارها
  const vsText = { fy:'سنة مالية كاملة واحدة تختارها من صف السنة.', q:`الربع ${QUARTER_NAMES[n]} وحده (${monthRange(12,n)}) لسنة واحدة تختارها.`, h1:'الربعان الأول والثاني (يناير – يونيو) لسنة واحدة تختارها.', m9:'الأرباع الثلاثة الأولى (يناير – سبتمبر) لسنة واحدة تختارها.' };
  const offYear = state.period==='fy' ? [] : list.filter(c => !isCalendarYear(c.fiscalYearEnd));
  const mk = state.metrics.some(k => isMkt(k)) ? ` بنود «التقييم الحالي» قيمة واحدة من الصفحة الرئيسية ${marketNote()} (آخر سعر وآخر أربعة أرباع)، ولا تتغير بالفترة.` : '';
  return (state.multiPick ? vsText[state.period] || text : text) + mk + (offYear.length ? ' ' + offYear.map(c => `سنة ${c.name} المالية تنتهي في ${MONTH_NAMES[c.fiscalYearEnd]}`).join('، ') + '، وأرباعها مرقّمة حسب سنتها المالية كما في أرقام.' : '');
}
function renderPeriod(){
  // المواجهة لفترة واحدة: الأرباع المتتالية غير متاحة فيها
  const off = id => id!=='fy'&&!quarterly ? 'disabled title="لا تتوفر نتائج ربعية لهذا القطاع"' : id==='seq'&&state.multiPick ? 'disabled title="عند اختيار عدة بنود تكون المقارنة لفترة واحدة: سنة أو ربع محدد أو 6 أو 9 أشهر"' : '';
  $('period-seg').innerHTML = PERIOD_OPTIONS.map(([id,name]) => `<button type="button" data-period="${id}" aria-pressed="${id===state.period}" ${off(id)}>${name}</button>`).join('');
  $('quarter-seg').hidden = state.period!=='q';
  $('quarter-seg').innerHTML = [1,2,3,4].map(n => `<button type="button" data-quarter="${n}" aria-pressed="${String(n)===state.quarter}">الربع ${QUARTER_NAMES[n]}</button>`).join('');
  $('period-note').textContent = periodNote(chosen());
}
function periodName(){
  return state.period==='q' ? `الربع ${QUARTER_NAMES[Number(state.quarter)]}` : PERIOD_OPTIONS.find(([id]) => id===state.period)[1];
}
/* العمود الذي يُقارن به: الربع نفسه من السنة السابقة في الأرباع المتتالية، وإلا العمود السابق */
function prevOf(id){
  if(id===NOW || id==null) return null;
  if(isSeq()){ const k = `${Number(id.slice(0,4))-1}Q${id.slice(5)}`; return allYears.includes(k) ? k : null; }
  return allYears[allYears.indexOf(id)-1] ?? null;
}
function renderCompanies(){
  // في المواجهة لا تُعطَّل الشركات: اختيار ثالثة يستبدل الثانية
  const full = !state.multiPick && state.symbols.length>=MAX_COMPANIES, q = state.query.trim();
  $('company-search').closest('.cx-company-tools').querySelector('.cx-search').hidden = companies.length<=12;
  $('company-chips').innerHTML = companies.filter(c => !q || state.symbols.includes(c.symbol) || c.name.includes(q) || String(c.symbol).includes(q)).map(c => {
    const on = state.symbols.includes(c.symbol);
    return `<button type="button" class="cx-chip" data-symbol="${esc(c.symbol)}" aria-pressed="${on}" ${!on&&full?'disabled':''} style="--c:${on?color(c):'transparent'}"><i></i>${esc(c.name)} <bdi>${esc(c.symbol)}</bdi></button>`;
  }).join('');
  $('selection-count').textContent = state.multiPick ? `${state.symbols.length} من ${VS_COMPANIES} · مواجهة بين شركتين` : `${state.symbols.length} من ${companies.length}${full?' · الحد الأقصى':''}`;
  document.querySelectorAll('[data-pick="top5"],[data-pick="bottom5"]').forEach(b => b.hidden = state.multiPick);
}

/* ---------- أرقام سريعة ---------- */
// بيانات الأرقام السريعة (للصفحة ولصورة المقارنة)
function figureData(list){
  const y = cols().at(-1), first = cols()[0];
  const withV = list.map(c => ({c, v:valueAt(c,y)})).filter(r => r.v!=null).sort((a,b) => b.v-a.v);
  const out = [];
  if(withV.length){
    const top = withV[0], low = withV.at(-1), avg = withV.reduce((s,r) => s+r.v,0)/withV.length;
    out.push({ title:`الأعلى ${inLab(y)}`, v:top.v, c:top.c });
    out.push({ title:`الأدنى ${inLab(y)}`, v:low.v, c:low.c });
    out.push({ title:'متوسط الشركات المختارة', v:avg, note:`من ${withV.length} شركات · ${unit(state.metric)}` });
  }
  const base = cols().length>1 ? first : prevOf(y);
  if(base!=null){
    const moves = list.map(c => ({c, ch:change(valueAt(c,base),valueAt(c,y))})).filter(r => r.ch);
    const usePct = moves.length && moves.every(r => r.ch.pct!=null);
    moves.sort((a,b) => usePct ? b.ch.pct-a.ch.pct : b.ch.diff-a.ch.diff);
    if(moves.length) out.push({ title:`الأكثر ارتفاعًا ${lab(base)} ← ${lab(y)}`, ch:moves[0].ch, c:moves[0].c });
  }
  return out;
}
function renderFigures(list){
  const who = c => `<i style="--c:${color(c)}"></i>${esc(c.name)}`;
  $('cx-figures').innerHTML = figureData(list).map(f => `<div class="key-figure"><dt>${esc(f.title)}</dt><dd>${f.ch ? `<span class="n ${dirClass(f.ch.dir)}">${esc(f.ch.text)}</span>` : num(f.v)}</dd><small>${f.c ? who(f.c) : esc(f.note)}</small></div>`).join('');
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
const byValue = (list,y) => [...list].sort((a,b) => (valueAt(b,y) ?? -Infinity)-(valueAt(a,y) ?? -Infinity));
function renderChart(list){
  const box = $('chart'), W = Math.max(280, box.clientWidth-20), H = matchMedia('(max-width:760px)').matches ? 300 : 440;
  const yrs = cols(), n = list.length;
  const vals = list.flatMap(c => yrs.map(y => valueAt(c,y))).filter(v => v!=null);
  if(!vals.length){ box.innerHTML = `<div class="cx-empty" style="direction:rtl;border:0;margin:0">لا توجد قيم متاحة لهذا البند في السنوات المختارة.</div>`; return; }
  const bars = state.view==='bars';
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if(bars || (lo>=0 && lo<hi*0.5)) lo = Math.min(0,lo);
  if(bars) hi = Math.max(0,hi);
  if(lo===hi){ lo -= Math.abs(lo)*0.1||1; hi += Math.abs(hi)*0.1||1; }
  const ticks = niceTicks(lo,hi), step = ticks[1]-ticks[0]; lo = ticks[0]; hi = ticks.at(-1);
  const tickText = ticks.map(t => axisFmt(t,step));
  // تسميات المحور: سطر واحد إن اتسعت، وإلا سطران («Q3» فوق «2026»)، ويُحذف بعضها عند الازدحام
  const names = yrs.map(lab), wide = Math.max(...names.map(t => t.length))*6.6+8;
  const m0 = 14 + Math.max(...tickText.map(t => t.length))*6.2, gw0 = (W-m0-8)/yrs.length;
  const twoLine = gw0 < wide && names.some(t => t.includes(' '));
  const part = twoLine ? Math.max(...names.flatMap(t => t.split(' ')).map(t => t.length))*6.6+8 : wide;
  const every = Math.max(1, Math.ceil(part/gw0));
  // ---- مكان الشعارات (يتكيّف مع عدد الأعمدة) ----
  // واسع: مكان العمود ≥ 14 بكسل ← شعار فوق رأس كل عمود (وتحت رأس السالب) بقطر مكانه، حتى 24.
  // مزدحم: أضيق من ذلك ← صف شعارات واحد أعلى الرسم لمجموعة واحدة (آخر فترة، أو التي يمرّ عليها المؤشر)،
  //         ينفتح أعرض من المجموعة ويصل كل شعار بعموده بخط منقّط، فلا يتلاصق مهما زاد عدد الأعمدة ولا يأكل ارتفاع الرسم.
  // اتجاه: شعار عند نهاية كل خط، تُباعد الشعارات المتقاربة عموديًا.
  const neg = lo<0;
  let LG = null;
  if(bars){
    const gwB = (W-m0-8)/yrs.length, slot = gwB*0.8/n, bw = Math.max(3, Math.min(48, slot-2));
    const full = slot >= 14, L = full ? Math.min(24, slot-1) : (matchMedia('(max-width:760px)').matches ? 16 : 18);
    LG = { full, L, room: L+(full ? 6 : 12) };
  } else LG = { L: 20, room: 0 };
  const m = { l: m0, r: bars ? 8 : 8+LG.L+12, t: 20 + (bars ? LG.room : 4), b: (twoLine ? 42 : 30) + (bars && neg && LG.full ? LG.room : 0) };
  const pw = W-m.l-m.r, ph = H-m.t-m.b, gw = pw/yrs.length;
  const Y = v => m.t + (hi-v)/(hi-lo)*ph, cx = i => m.l + gw*(i+.5);
  let g = '';
  ticks.forEach((t,i) => { g += `<line class="${t===0?'zero':'grid'}" x1="${m.l}" x2="${W-m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l-8}" y="${Y(t)+3.5}" text-anchor="end">${tickText[i]}</text>`; });
  yrs.forEach((y,i) => {
    g += `<rect class="band" data-year="${esc(y)}" x="${m.l+gw*i}" y="${m.t-6}" width="${gw}" height="${ph+12}"/>`;
    if((yrs.length-1-i) % every) return; // يبقى آخر عمود ظاهرًا دائمًا
    const [a,b] = names[i].split(' ');
    g += twoLine && b ? `<text class="year" x="${cx(i)}" y="${H-22}" text-anchor="middle">${esc(a)}<tspan x="${cx(i)}" dy="14">${esc(b)}</tspan></text>` : `<text class="year" x="${cx(i)}" y="${H-8}" text-anchor="middle">${esc(names[i])}</text>`;
  });
  let logos = '';
  if(bars){
    const inner = gw*0.8, slot = inner/n, bw = Math.max(3, Math.min(48, slot-2)), showVal = slot>=42 && n*yrs.length<=18;
    // داخل كل فترة: الأعلى قيمة أولًا (يسار المجموعة) ثم الأقل، والشركة بلا قيمة في الآخر
    yrs.forEach((y,i) => byValue(list,y).forEach((c,j) => {
      const v = valueAt(c,y); if(v==null) return;
      const x = cx(i) - (n*slot)/2 + j*slot + (slot-bw)/2, y0 = Y(0), y1 = Y(v), h = Math.max(1.5, Math.abs(y1-y0)), r = Math.min(3, bw/2, h);
      const d = v>=0
        ? `M${x},${y0}V${y0-h+r}q0,${-r} ${r},${-r}H${x+bw-r}q${r},0 ${r},${r}V${y0}Z`
        : `M${x},${y0}V${y0+h-r}q0,${r} ${r},${r}H${x+bw-r}q${r},0 ${r},${-r}V${y0}Z`;
      // لون موحّد: عمود ذهبي (والسالب أحمر) بتدرّج يخفت نحو الصفر وخط مضيء على رأسه؛ آخر فترة أسطع
      const down = v<0, last = i===yrs.length-1, grad = `url(#cx-g-${down?'dn':'up'}${last?'-last':''})`, mid = x+bw/2, tipY = v>=0 ? y0-h : y0+h;
      g += `<path class="mark bar${last?' last':''}" data-s="${esc(c.symbol)}" d="${d}" fill="${grad}"/><rect class="mark cap${down?' dn':''}${last?' last':''}" data-s="${esc(c.symbol)}" x="${x+Math.min(2,bw/4)}" y="${v>=0 ? tipY : tipY-2.5}" width="${Math.max(1,bw-2*Math.min(2,bw/4))}" height="2.5" rx="1.25"/>`;
      const L = LG.L;
      if(LG.full){
        // فوق رأس العمود الموجب وتحت رأس السالب، والقيمة بعد الشعار
        logos += logoSvg(c, mid-L/2, v>=0 ? y0-h-4-L : y0+h+4, L);
        if(showVal) g += `<text class="val mark" data-s="${esc(c.symbol)}" x="${mid}" y="${v>=0 ? y0-h-L-9 : y0+h+L+17}" text-anchor="middle">${fmt(v)}</text>`;
      } else {
        // صف المجموعة أعلى الرسم بترتيب الأعمدة نفسه (فلا تتقاطع الخطوط)، متمركز على المجموعة ومحصور داخل الرسم
        const total = n*(L+3)-3, start = Math.max(m.l, Math.min(W-m.r-total, cx(i)-total/2));
        const lx = start + j*(L+3), ly = m.t-L-8, tip = v>=0 ? y0-h : y0;
        const lead = `<path class="leader" d="M${lx+L/2},${ly+L+1}L${mid},${tip-1}" stroke="${tone(c,v)}"/>`;
        logos += logoSvg(c, lx, ly, L, `pop${i===yrs.length-1?' show':''}`, `data-year="${esc(y)}"`, lead);
      }
    }));
  } else {
    list.forEach(c => {
      let d = '', pen = false, dots = '';
      yrs.forEach((y,i) => { const v = valueAt(c,y); if(v==null){ pen = false; return; } d += `${pen?'L':'M'}${cx(i)},${Y(v)}`; pen = true; dots += `<circle class="dot" cx="${cx(i)}" cy="${Y(v)}" r="4.5" fill="${color(c)}"/>`; });
      g += `<g class="mark" data-s="${esc(c.symbol)}"><path class="line" d="${d}" stroke="${color(c)}"/>${dots}</g>`;
    });
    // شعار عند آخر نقطة لكل خط، والمتقاربة تُباعد عموديًا داخل حدود الرسم
    const L = LG.L, gap = L+3;
    const ends = list.map(c => { const i = yrs.findLastIndex(y => valueAt(c,y)!=null); return i<0 ? null : { c, px: cx(i), py: Y(valueAt(c,yrs[i])) }; }).filter(Boolean).sort((a,b) => a.py-b.py);
    ends.forEach((e,k) => { e.ly = Math.max(e.py, k ? ends[k-1].ly+gap : m.t-L/2); });
    const over = ends.length ? ends.at(-1).ly - (m.t+ph-L/2) : 0;
    if(over>0) ends.forEach(e => e.ly -= over);
    const lx = W-m.r+8;
    ends.forEach(e => { logos += logoSvg(e.c, lx, e.ly-L/2, L, '', '', `<path class="leader" d="M${e.px+5},${e.py}L${lx-2},${e.ly}" stroke="${color(e.c)}"/>`, color(e.c)); });
  }
  const stop = (o, c, a) => `<stop offset="${o}" style="stop-color:var(${c});stop-opacity:${a}"/>`;
  const lg = (id, rev, c, a, b) => `<linearGradient id="${id}" x1="0" y1="${rev?1:0}" x2="0" y2="${rev?0:1}">${stop(0,c,a)}${stop(1,c,b)}</linearGradient>`;
  const defs = `<defs><clipPath id="cx-clip-tile" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".26" ry=".26"/></clipPath>`
    + `<filter id="cx-logo-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.8" flood-color="#000" flood-opacity=".45"/></filter>`
    + lg('cx-g-up',0,'--cx-gold',.78,.10) + lg('cx-g-up-last',0,'--cx-gold-hi',1,.22) + lg('cx-g-dn',1,'--cx-neg',.78,.10) + lg('cx-g-dn-last',1,'--cx-neg',1,.22) + `</defs>`;
  box.innerHTML = `<svg class="${bars && !LG.full ? 'dense' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label(state.metric))} حسب ${isSeq() ? 'الربع' : 'السنة'} · ${esc(periodName())}">${defs}${g}${logos}</svg>`;
}
function showTip(year, x, y){
  const tip = $('cx-tip'), list = chosen();
  const rows = list.map(c => ({c, v:valueAt(c,year)})).sort((a,b) => (b.v??-Infinity)-(a.v??-Infinity));
  tip.innerHTML = `<h4>${esc(label(state.metric))} · <span class="n">${esc(lab(year))}</span> · ${esc(unit(state.metric))}</h4>` + rows.map(r => `<div style="--c:${tone(r.c)}">${logoHtml(r.c)}<span>${esc(r.c.name)}</span><b>${num(r.v)}</b></div>`).join('');
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth-w-8, x+14 + (x+14+w>innerWidth-8 ? -w-28 : 0))) + 'px';
  tip.style.top = Math.max(8, Math.min(innerHeight-h-8, y-h/2)) + 'px';
}
function showLogos(year){ document.querySelectorAll('.cx-chart svg.dense .logo.pop').forEach(el => el.classList.toggle('show', el.dataset.year===(year ?? cols().at(-1)))); }
function hideTip(){ $('cx-tip').hidden = true; document.querySelectorAll('.cx-chart .band.on').forEach(b => b.classList.remove('on')); showLogos(null); }
function highlight(symbol){
  for(const el of [$('chart'), $('rank-list'), $('cx-multi')]) el.classList.toggle('dim', !!symbol);
  document.querySelectorAll('.cx-page [data-s]').forEach(el => el.classList.toggle('hl', el.dataset.s===symbol));
  document.querySelectorAll('#chart-legend button').forEach(b => b.classList.toggle('on', b.dataset.s===symbol));
}

/* ---------- الترتيب ---------- */
function rankData(list){
  const y = cols().at(-1), prev = prevOf(y);
  const rows = list.map(c => ({c, v:valueAt(c,y)})).sort((a,b) => (b.v??-Infinity)-(a.v??-Infinity))
    .map(r => ({ ...r, ch: prev!=null ? change(valueAt(r.c,prev), r.v) : null }));
  return { y, prev, rows };
}
function renderRank(list){
  const { y, prev, rows } = rankData(list);
  const vs = rows.map(r => r.v).filter(v => v!=null), lo = Math.min(0,...vs), hi = Math.max(0,...vs), span = hi-lo || 1;
  $('rank-title').textContent = `الترتيب ${inLab(y)}`;
  $('rank-sub').textContent = prev!=null ? `مع التغير عن ${lab(prev)}` : '';
  $('rank-list').innerHTML = rows.map((r,i) => {
    const ch = r.ch;
    const fill = r.v==null ? '' : `<span class="fill" style="left:${(Math.min(r.v,0)-lo)/span*100}%;width:${Math.abs(r.v)/span*100}%"></span>`;
    return `<li data-s="${esc(r.c.symbol)}" style="--c:${tone(r.c,r.v)}"><span class="pos">${r.v==null?'—':i+1}</span><span class="who">${logoHtml(r.c)}${esc(r.c.name)} <bdi>${esc(r.c.symbol)}</bdi></span><span class="fig">${num(r.v)}</span><span class="track">${fill}${lo<0?`<span class="axis0" style="left:${-lo/span*100}%"></span>`:''}</span>${ch?`<span class="delta"><span class="n ${dirClass(ch.dir)}">${arrow(ch.dir)} ${esc(ch.text)}</span> عن <span class="n">${esc(lab(prev))}</span></span>`:''}</li>`;
  }).join('');
}

/* ---------- عدة بنود: مواجهة بين شركتين ---------- */
// الفترة الواحدة بالكلام: «سنة 2025»، «الربع الثالث 2025»، «أول 6 أشهر 2025»
function vsPeriod(){
  if(state.metrics.every(k => isMkt(k))) return `التقييم الحالي · ${marketNote()}`;
  const y = state.years.at(-1) ?? '';
  return { fy:`سنة ${y}`, q:`الربع ${QUARTER_NAMES[Number(state.quarter)]} ${y}`, h1:`أول 6 أشهر ${y}`, m9:`أول 9 أشهر ${y}` }[state.period] || lab(y);
}
// لكل بند: قيمة الشركتين في الفترة المختارة (أو «الحالي» لبنود التقييم)، والتغير عن الفترة السابقة،
// ونصيب كل منهما من المجموع للشريط (الأرقام بلون واحد دون تمييز الأعلى)
function versusData(list){
  const [A,B] = list;
  return state.metrics.map(k => using(k, () => {
    const y = cols().at(-1), prev = prevOf(y);
    const side = c => { if(!c) return null; const v = valueAt(c,y), ch = prev!=null ? change(valueAt(c,prev), v) : null; return { v, text:fmt(v), ch, cls: ch ? dirClass(ch.dir) : '' }; };
    const a = side(A), b = side(B);
    const share = a?.v>0 && b?.v>0 ? a.v/(a.v+b.v) : null;
    return { k, label:label(k), unit:unit(k), now: y===NOW, prev: prev!=null ? lab(prev) : '', a, b, share };
  }));
}
function renderVersus(list){
  const [A,B] = list, rows = versusData(list);
  const co = (c,side) => c
    ? `<div class="cx-vs-co ${side}" data-s="${esc(c.symbol)}" style="--c:${color(c)}">${logoHtml(c)}<b>${esc(c.name)}</b><bdi>${esc(c.symbol)}</bdi></div>`
    : `<div class="cx-vs-co ${side} empty">اختر شركة ثانية</div>`;
  // النص منسّق مسبقًا ببنده (fmt تقرأ البند الحالي)
  const val = (r,s) => { const x = r[s]; if(!x) return `<span class="cx-vs-val ${s}"></span>`;
    return `<span class="cx-vs-val ${s}${x.v!=null&&x.v<0?' neg':''}"><span class="n">${esc(x.text)}</span>${x.ch?`<small class="n ${x.cls}">${arrow(x.ch.dir)} ${esc(x.ch.text)}</small>`:''}</span>`; };
  $('versus').style.cssText = `--ca:${A?color(A):'var(--s1)'};--cb:${B?color(B):'var(--s2)'}`;
  $('versus').innerHTML = `<header class="cx-vs-head">${co(A,'a')}<div class="cx-vs-mid"><span class="cx-vs-badge" dir="ltr">VS</span><span class="cx-vs-when">${esc(vsPeriod())}</span></div>${co(B,'b')}</header>
    <ol class="cx-vs-rows">${rows.map(r => `<li>${val(r,'a')}<span class="cx-vs-label"><b>${esc(r.label)}</b><small>${esc(r.unit)}${r.now && state.metrics.some(k => !isMkt(k)) ? ' · الحالي' : ''}${r.prev?` · التغير عن <span class="n">${esc(r.prev)}</span>`:''}</small>${r.share!=null?`<span class="cx-vs-bar" aria-hidden="true"><i style="width:${(r.share*100).toFixed(1)}%"></i><i></i></span>`:''}</span>${val(r,'b')}</li>`).join('')}</ol>`;
}

/* ---------- صورة المقارنة ---------- */
// كل ما تحتاجه الصورة كنصوص وأرقام جاهزة؛ الرسم نفسه في comparison-export.mjs
function exportData(){
  const list = chosen(), css = getComputedStyle(document.documentElement);
  const sectorName = SECTORS.find(([,s]) => s===state.sector)?.[0] || '';
  const dirOf = ch => { const k = dirClass(ch.dir); return k==='cx-up' ? 1 : k==='cx-down' ? -1 : 0; };
  const base = {
    theme: document.documentElement.dataset.theme==='light' ? 'light' : 'dark',
    site:'السوق السعودي', url:'portalnode.github.io/saudi-sectors',
    stamp:`صدرت في ${new Intl.DateTimeFormat('ar-u-nu-latn',{dateStyle:'long'}).format(new Date())}`,
  };
  const company = c => ({ symbol:String(c.symbol), name:c.name, initial:initial(c), logo: hasLogo(c) ? `logos/${c.symbol}.svg` : null,
    color: css.getPropertyValue(`--s${(slots.get(c.symbol) ?? 0)+1}`).trim() || '#3987e5' });
  if(multi()){
    // المواجهة: الشركة الأولى يمينًا والثانية يسارًا، والبنود في الوسط
    const side = x => x && { v:x.v, text:x.text, delta: x.ch ? `${arrow(x.ch.dir)} ${x.ch.text}` : '', dir: x.ch ? dirOf(x.ch) : 0 };
    const mixed = state.metrics.some(k => !isMkt(k));
    return { ...base, multi:true,
      title: list.length===2 ? `${list[0].name} مقابل ${list[1].name}` : list[0].name,
      sub: `مقارنة ${state.metrics.length} بنود · قطاع ${sectorName}`, span: vsPeriod(),
      companies: list.map(company),
      rows: versusData(list).map(r => ({ label:r.label, note:[r.unit, r.now && mixed ? 'الحالي' : '', r.prev ? `التغير عن ${r.prev}` : ''].filter(Boolean).join(' · '),
        share:r.share, a:side(r.a), b:side(r.b) })),
    };
  }
  const { prev, rows } = rankData(list);
  return {
    theme: document.documentElement.dataset.theme==='light' ? 'light' : 'dark',
    site:'السوق السعودي', url:'portalnode.github.io/saudi-sectors',
    stamp:`صدرت في ${new Intl.DateTimeFormat('ar-u-nu-latn',{dateStyle:'long'}).format(new Date())}`,
    title: label(state.metric), sub: `${isMkt() ? 'التقييم الحالي' : periodName()} · ${unit(state.metric)} · قطاع ${sectorName}`,
    span: isMkt() ? marketNote() : cols().length>1 ? `${lab(cols()[0])} – ${lab(cols().at(-1))}` : lab(cols()[0]),
    view: state.view, periods: cols().map(lab), fmt: v => fmt(v), axisFmt,
    companies: list.map(c => ({ symbol:String(c.symbol), name:c.name, initial:initial(c), logo: hasLogo(c) ? `logos/${c.symbol}.svg` : null,
      color: css.getPropertyValue(`--s${(slots.get(c.symbol) ?? 0)+1}`).trim() || '#3987e5', values: cols().map(y => valueAt(c,y)) })),
    figures: figureData(list).map(f => ({ title:f.title, text: f.ch ? f.ch.text : fmt(f.v), dir: f.ch ? dirOf(f.ch) : 0, neg: !f.ch && f.v<0, symbol: f.c ? String(f.c.symbol) : null, note: f.note })),
    rank: { title:`الترتيب ${inLab(cols().at(-1))}`, sub: prev!=null ? `مع التغير عن ${lab(prev)}` : '',
      rows: rows.map(r => ({ symbol:String(r.c.symbol), v:r.v, text:fmt(r.v), delta: r.ch ? `${arrow(r.ch.dir)} ${r.ch.text} عن ${lab(prev)}` : '', dir: r.ch ? dirOf(r.ch) : 0 })) },
  };
}

/* ---------- الجدول ---------- */
function spark(c){
  const pts = cols().map((y,i) => [i,valueAt(c,y)]).filter(p => p[1]!=null);
  if(pts.length<2) return '';
  const W=76,H=24,p=3, vs=pts.map(p=>p[1]), lo=Math.min(...vs), hi=Math.max(...vs), span=hi-lo||1, n=cols().length-1||1;
  const X = i => p+i/n*(W-2*p), Yv = v => H-p-(v-lo)/span*(H-2*p);
  const zero = lo<0 && hi>0 ? `<line x1="0" x2="${W}" y1="${Yv(0)}" y2="${Yv(0)}"/>` : '';
  const last = pts.at(-1);
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${zero}<path d="${pts.map((q,i)=>`${i?'L':'M'}${X(q[0])},${Yv(q[1])}`).join('')}"/><circle cx="${X(last[0])}" cy="${Yv(last[1])}" r="2.5"/></svg>`;
}
function renderTable(list){
  const yrs = cols(), many = yrs.length>1, a = yrs[0], b = yrs.at(-1);
  if(state.sort.key!=='chg' && state.sort.key!=='name' && !yrs.includes(state.sort.key)) state.sort = {key:b,dir:-1};
  if(state.sort.key==='chg' && !many) state.sort = {key:b,dir:-1};
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
  $('table-sub').textContent = `${label(state.metric)} · ${periodName()} · ${unit(state.metric)} · اضغط على عنوان العمود للترتيب`;
  $('cx-table').innerHTML = `<thead><tr>${head('name','الشركة')}${yrs.map(y => head(y,`<span class="n">${esc(lab(y))}</span>`)).join('')}${many?head('chg',`التغير <span class="n cx-th-range">${esc(lab(a))} ← ${esc(lab(b))}</span>`)+'<th>الاتجاه</th>':''}</tr></thead><tbody>${rows.map(c => {
    const ch = many ? change(valueAt(c,a),valueAt(c,b)) : null;
    return `<tr data-s="${esc(c.symbol)}" style="--c:${tone(c)}"><th scope="row"><span>${logoHtml(c)}${esc(c.name)} <bdi>${esc(c.symbol)}</bdi></span></th>${yrs.map(y => { const v = valueAt(c,y); return `<td class="${v==null?'miss':v<0?'neg':''}${v!=null&&v===best.get(y)&&list.length>1?' best':''}">${num(v)}</td>`; }).join('')}${many?`<td class="chg">${ch?`<span class="n ${dirClass(ch.dir)}">${esc(ch.text)}</span>`:'<span class="miss">—</span>'}</td><td>${spark(c)}</td>`:''}</tr>`;
  }).join('')}</tbody>`;
}

/* ---------- التجميع ---------- */
function render(){
  renderPeriod(); renderMetrics(); renderYears(); renderCompanies();
  $('chart-view').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view===state.view)));
  // قطاع بشركة واحدة (كالخدمات المالية) يُعرض لمقارنة فترات الشركة نفسها
  const list = chosen(), ok = list.length>=Math.min(2,companies.length) && list.length>0 && (state.years.length>=1 || state.metrics.every(k => isMkt(k)));
  $('cx-results').hidden = !ok; $('cx-empty').hidden = ok;
  const sectorName = SECTORS.find(([,s]) => s===state.sector)?.[0] || '';
  if(!ok){
    $('cx-empty').textContent = list.length<2 ? 'اختر شركتين على الأقل لعرض المقارنة.' : `اختر ${isSeq() ? 'ربعًا' : 'سنة'} واحدة على الأقل لعرض المقارنة.`;
    $('cx-summary').textContent = `قطاع ${sectorName}`;
    writeHash(); return;
  }
  // عدة بنود: بطاقات البنود وجدولها بدل الرسم والترتيب
  const many = multi();
  $('cx-multi').hidden = !many; $('cx-figures').hidden = many; document.querySelector('.cx-grid').hidden = many; document.querySelector('.cx-table-card').hidden = many;
  document.body.classList.toggle('cx-uni', uni());
  if(many){
    $('cx-summary').innerHTML = `<b>${list.length===2 ? `${esc(list[0].name)} مقابل ${esc(list[1].name)}` : esc(list[0].name)}</b> · ${state.metrics.length} بنود · ${esc(vsPeriod())} · قطاع ${esc(sectorName)}`;
    renderVersus(list);
    writeHash(); return;
  }
  const span = cols().length>1 ? `${lab(cols()[0])} – ${lab(cols().at(-1))}` : lab(cols()[0]);
  $('cx-summary').innerHTML = `<b>${esc(label(state.metric))}</b> · ${isMkt() ? esc(marketNote()) : esc(periodName())} · ${esc(unit(state.metric))} · ${list.length===1 ? 'شركة واحدة' : `${list.length} شركات`} من قطاع ${esc(sectorName)}${isMkt() ? '' : ` · <span class="n">${esc(span)}</span>`}`;
  $('chart-title').textContent = label(state.metric);
  $('chart-sub').textContent = isMkt() ? `${unit(state.metric)} · ${marketNote()} · من الصفحة الرئيسية` : `${periodName()} · ${unit(state.metric)} · مرّر على ${isSeq() ? 'الربع' : 'السنة'} لعرض القيم`;
  $('chart-legend').innerHTML = list.map(c => `<button type="button" data-s="${esc(c.symbol)}" style="--c:${color(c)}">${logoHtml(c)}${esc(c.name)}</button>`).join('');
  renderFigures(list); renderChart(list); renderRank(list); renderTable(list);
  writeHash();
}

/* ---------- البيانات ---------- */
const cache = new Map();
// data.json (ملف الصفحة الرئيسية): ترتيب الشركات من الأكبر قيمة سوقية، وبنود «التقييم الحالي».
// عند تعذره يبقى ترتيب الملف وتختفي بنود التقييم.
const pricesPromise = fetch('data.json').then(r => r.ok ? r.json() : null).catch(e => { console.warn('data.json unavailable:', e); return null; })
  .then(p => { market = marketIndex(p); marketAsOf = marketDate(p); return marketCapMap(p); });
let caps = new Map();
async function fetchSector(slug){
  if(!cache.has(slug)) cache.set(slug, (async () => {
    const get = async name => { const r = await fetch(`${DATA_BASE}${name}?v=${VERSION}`); if(!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); };
    // قطاع بلا ملف ربعي (كالصناديق العقارية حاليًا) يبقى سنويًا فقط
    const [a,q] = await Promise.all([get(`${slug}-financials.json`), get(`${slug}-quarterly-financials.json`).catch(() => null)]);
    return { annual:a, quarterly: Array.isArray(q?.companies) && q.companies.length ? q : null };
  })());
  try{ return await cache.get(slug); }catch(e){ cache.delete(slug); throw e; }
}
// الأعمدة والقيم للفترة المختارة، وهامش الربح يُحسب من المجاميع كما في صفحات القطاعات
function buildIndex(){
  const annualCompanies = sortByMarketCap(annual.companies || annual.banks || [], caps);
  colLabels = new Map();
  state.period = quarterly ? chosenPeriod : 'fy';
  if(state.period==='fy'){
    companies = annualCompanies;
    allYears = (annual.years || []).map(String);
    valueIndex = new Map(companies.map(c => [c.symbol, new Map((c.years||[]).map(r => [String(r.year), r.values||{}]))]));
    return;
  }
  const byName = new Map(annualCompanies.map(c => [c.symbol, c]));
  companies = sortByMarketCap(quarterly.companies, caps).map(c => ({ ...c, name: byName.get(c.symbol)?.name || c.name }));
  const keys = [...new Set(quarterly.companies.flatMap(c => Object.values(c.quarters||{}).flatMap(v => Object.keys(v||{}))))];
  const spec = { metrics: keys.map(key => ({ key })), ratios: DEFAULT_PERIOD_SPEC.ratios };
  const ids = new Set();
  valueIndex = new Map(companies.map(c => {
    const Q = c.quarters || {}, cols = new Map();
    const quarters = Object.keys(Q).filter(k => hasData(Q[k])).sort();
    if(isSeq()) for(const k of quarters) cols.set(k, withMargins(Q[k], spec));
    else for(const y of new Set(quarters.map(k => Number(k.slice(0,4))))){
      const v = state.period==='q' ? (hasData(Q[`${y}Q${state.quarter}`]) ? withMargins(Q[`${y}Q${state.quarter}`], spec) : null) : sumQuarters(c, y, CUMULATIVE[state.period].count, spec);
      if(hasData(v)) cols.set(String(y), v);
    }
    cols.forEach((_,k) => ids.add(k));
    return [c.symbol, cols];
  }));
  allYears = [...ids].sort();
  for(const id of allYears) colLabels.set(id, isSeq() ? quarterLabel(id) : state.period==='q' ? `Q${state.quarter} ${id}` : `${CUMULATIVE[state.period].short} ${id}`);
}
// يعيد بناء الأعمدة مع إبقاء ما يمكن إبقاؤه من البند والسنوات والشركات
function applyData(wanted={}){
  buildIndex();
  const keys = availableMetrics();
  // البنود المطلوبة (من الرابط) ثم المختارة سابقًا، وما لا يتوفر في القطاع أو الفترة يسقط
  const keep = list => (list || []).filter(k => keys.includes(k)).slice(0, MAX_METRICS);
  const next = keep(wanted.m).length ? keep(wanted.m) : keep(state.metrics).length ? keep(state.metrics) : [keys.includes('netProfit') ? 'netProfit' : keys[0]];
  setMetrics(next);
  if(next.length>1) state.multiPick = true;
  if(!state.multiPick) setMetrics(next.slice(0,1));
  const want = wanted.y ?? state.years, ys = want.filter(y => allYears.includes(y)).sort();
  state.years = ys.length ? ys : isSeq() ? allYears.slice(-SEQ_DEFAULT) : [...allYears];
  if(state.multiPick){
    // المواجهة لفترة واحدة: «أرباع متتالية» تصير «ربع محدد» بربع آخر عمود
    if(isSeq()){ const last = state.years.at(-1); chosenPeriod = 'q'; if(last) state.quarter = last.slice(5); return applyData({ ...wanted, y: last ? [last.slice(0,4)] : [] }); }
    state.years = state.years.slice(-1);
  }
  const wantC = (wanted.c ?? state.symbols).filter(s => companies.some(c => c.symbol===s));
  setSymbols(wantC.length>=2 ? wantC : wantC.length===1 ? [...wantC, ...companies.filter(c => c.symbol!==wantC[0]).slice(0,2).map(c => c.symbol)] : companies.slice(0,3).map(c => c.symbol));
  state.sort = {key:null,dir:-1};
}
async function loadSector(slug, wanted={}){
  state.sector = slug; $('sector-select').value = slug;
  [{ annual, quarterly }, caps, logoSet] = await Promise.all([fetchSector(slug), pricesPromise, logosPromise]);
  if(state.sector!==slug) return; // اختار المستخدم قطاعًا آخر أثناء التحميل
  slots = new Map(); state.query = ''; $('company-search').value = '';
  state.symbols = []; state.years = [];
  if(wanted.vs) state.multiPick = true;
  applyData({ m:wanted.m, y:wanted.y || [], c:wanted.c || [] });
  if(wanted.v==='lines' || wanted.v==='bars') state.view = wanted.v;
  render();
}

/* ---------- الأحداث ---------- */
$('sector-select').innerHTML = SECTORS.map(([name,slug]) => `<option value="${slug}">${esc(name)}</option>`).join('');
$('sector-select').addEventListener('change', e => loadSector(e.target.value).catch(fail));
// المجموعة تعرض بنودها فقط عند «عدة بنود»، وفي البند الواحد تختار أول بنودها كما كانت
$('metric-groups').addEventListener('click', e => { const b = e.target.closest('[data-group]'); if(!b) return; const g = metricGroups().find(g => g[0]===b.dataset.group); if(!g) return; state.group = g[0]; if(!state.multiPick && !g[2].includes(state.metric)) setMetrics([g[2][0]]); render(); });
$('metric-chips').addEventListener('click', e => {
  const b = e.target.closest('[data-metric]'); if(!b || b.disabled) return; const k = b.dataset.metric;
  if(!state.multiPick) setMetrics([k]);
  else if(state.metrics.includes(k)){ if(state.metrics.length>1) setMetrics(state.metrics.filter(x => x!==k)); }
  else if(state.metrics.length<MAX_METRICS) setMetrics([...state.metrics, k]);
  render();
});
$('metric-multi').addEventListener('click', () => {
  state.multiPick = !state.multiPick;
  if(!state.multiPick) setMetrics(state.metrics.slice(0,1));
  else { applyData({ m:state.metrics, y:state.years.slice(-1), c:state.symbols.slice(0,VS_COMPANIES) }); }
  render();
});
$('metric-picked').addEventListener('click', e => { const b = e.target.closest('[data-unpick]'); if(!b || state.metrics.length<2) return; setMetrics(state.metrics.filter(x => x!==b.dataset.unpick)); render(); });
$('period-seg').addEventListener('click', e => { const b = e.target.closest('[data-period]'); if(!b || b.disabled || b.dataset.period===state.period) return; chosenPeriod = b.dataset.period; applyData(); render(); });
$('quarter-seg').addEventListener('click', e => { const b = e.target.closest('[data-quarter]'); if(!b || b.dataset.quarter===state.quarter) return; state.quarter = b.dataset.quarter; applyData(); render(); });
$('year-chips').addEventListener('click', e => { const b = e.target.closest('[data-year]'); if(!b) return; const y = b.dataset.year; state.years = state.multiPick ? [y] : (state.years.includes(y) ? state.years.filter(v => v!==y) : [...state.years,y]).sort(); render(); });
$('year-quick').addEventListener('click', e => { const b = e.target.closest('[data-years]'); if(!b) return; state.years = b.dataset.years==='all' ? [...allYears] : allYears.slice(-Number(b.dataset.years)); render(); });
$('company-chips').addEventListener('click', e => { const b = e.target.closest('[data-symbol]'); if(!b) return; const s = b.dataset.symbol;
  // المواجهة: شركة ثالثة تحل محل آخر شركة اختيرت
  setSymbols(state.symbols.includes(s) ? state.symbols.filter(v => v!==s) : state.multiPick && state.symbols.length>=VS_COMPANIES ? [state.symbols[0], s] : [...state.symbols,s]); render(); });
$('company-search').addEventListener('input', e => { state.query = e.target.value; renderCompanies(); });
document.querySelector('[data-pick]').parentElement.addEventListener('click', e => {
  const b = e.target.closest('[data-pick]'); if(!b) return;
  if(b.dataset.pick==='reset') setSymbols(companies.slice(0,3).map(c => c.symbol));
  else { const y = cols().at(-1) ?? allYears.at(-1), sign = b.dataset.pick==='top5' ? -1 : 1;
    setSymbols(companies.map(c => ({c, v:valueAt(c,y)})).filter(r => r.v!=null).sort((p,q) => sign*(p.v-q.v)).slice(0,5).map(r => r.c.symbol)); }
  render();
});
$('chart-view').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if(b){ state.view = b.dataset.view; render(); } });
$('cx-table').addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if(!b) return; const k = b.dataset.sort; state.sort = { key:k, dir: state.sort.key===k ? -state.sort.dir : -1 }; renderTable(chosen()); });
$('chart').addEventListener('pointermove', e => { const band = e.target.closest?.('.band') || document.elementsFromPoint(e.clientX,e.clientY).find(el => el.classList?.contains('band')); if(!band){ hideTip(); return; } document.querySelectorAll('.cx-chart .band.on').forEach(b => b!==band && b.classList.remove('on')); band.classList.add('on'); showLogos(band.dataset.year); showTip(band.dataset.year, e.clientX, e.clientY); });
$('chart').addEventListener('pointerleave', hideTip);
addEventListener('scroll', hideTip, {passive:true});
for(const id of ['chart-legend','rank-list','cx-table','versus']){
  $(id).addEventListener('pointerover', e => { const el = e.target.closest('[data-s]'); if(el) highlight(el.dataset.s); });
  $(id).addEventListener('pointerleave', () => highlight(null));
}
$('cx-save-img').addEventListener('click', () => { if(!$('cx-results').hidden) openExportDialog(exportData); });
$('cx-share').addEventListener('click', async e => { const b = e.currentTarget, t = b.textContent; try{ await navigator.clipboard.writeText(location.href); b.textContent = 'تم نسخ الرابط ✓'; }catch{ b.textContent = 'انسخ الرابط من شريط العنوان'; } setTimeout(() => b.textContent = t, 1800); });
let lastW = 0;
new ResizeObserver(() => { const w = $('chart').clientWidth; if(w && w!==lastW && !$('cx-results').hidden && !multi()){ lastW = w; renderChart(chosen()); } }).observe($('chart'));
const fail = e => { $('cx-results').hidden = true; $('cx-empty').hidden = false; $('cx-empty').textContent = 'تعذر تحميل بيانات القطاع.'; console.error(e); };
const wanted = readHash();
chosenPeriod = state.period;
loadSector(state.sector, wanted).catch(fail);
