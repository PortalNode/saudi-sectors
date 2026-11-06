const columns = [
  ['symbol','رمز السهم','symbol'],['name','اسم الشركة','name'],['price','سعر السهم','price'],
  ['eps','ربحية السهم','eps'],['pe','مكرر الأرباح','pe'],['bookValue','القيمة الدفترية','bv'],
  ['pb','مكرر القيمة الدفترية','pb'],['dividendYield','عائد التوزيع','yield'],['week52Position','آخر 52 أسبوع','week52'],['marketCap','القيمة السوقية','mcap'],['day','تغير اليوم','day'],['ytd','الأداء منذ بداية السنة','ytd'],['month3','تغير 3 أشهر','3m'],
  ['month6','تغير 6 أشهر','6m'],['year1','تغير سنة','1y']
];
const numberFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const integerFormat = new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const epsFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const timeFormat = new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'});
let data, financialMap, activeSector = null, query = '', sortBySector = new Map([['all',{key:'marketCap',dir:-1}]]), epsMode = 'recurring', refreshRunning = false, pricesRefreshRunning = false, priceRefreshError = '';
const financials = new Map();
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized = value => String(value ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().trim();
const numeric = (n, digits=2) => n == null ? '<span class="missing">—</span>' : `<span class="num">${digits===3?epsFormat.format(n):numberFormat.format(n)}</span>`;
const percent = (n, signed=true) => n == null ? '<span class="missing">—</span>' : `<span class="num ${signed?(n>0?'up':n<0?'down':'flat'):'dividend-yield'}">${signed&&n>0?'+':''}${numberFormat.format(n)}%</span>`;
const pe = stock => stock.pe != null ? numeric(stock.pe) : stock.eps != null && stock.eps < 0 ? '<span class="loss">خاسرة</span>' : '<span class="missing">—</span>';
const allStocks = () => data.sectors.flatMap(s => s.stocks);
const safeNumber = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

// The range is displayed high on the left and low on the right, as in the
// reference. Sorting uses the current price's position from low to high.
function range52Position(stock){
  const low=safeNumber(stock.week52Low),high=safeNumber(stock.week52High),price=safeNumber(stock.price);
  if(low==null||high==null||price==null||low<=0||high<low||price<=0)return null;
  if(high===low)return price===low?0.5:price>high?1:0;
  return Math.max(0,Math.min(1,(price-low)/(high-low)));
}
function range52(stock){
  const low=safeNumber(stock.week52Low),high=safeNumber(stock.week52High);
  if(low==null||high==null||low<=0||high<low)return '<span class="missing" title="نطاق آخر 52 أسبوعًا غير متاح">—</span>';
  const price=safeNumber(stock.price),position=range52Position(stock);
  const checked=stock.week52CheckedAt?new Date(stock.week52CheckedAt):null;
  const checkedLabel=checked&&!Number.isNaN(checked.getTime())?new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(checked):null;
  const title=`أعلى سعر: ${numberFormat.format(high)}، أدنى سعر: ${numberFormat.format(low)}${position==null?'؛ السعر الحالي غير متاح':`، السعر الحالي: ${numberFormat.format(price)}`}${stock.week52Source?`؛ المصدر: ${stock.week52Source}`:''}${checkedLabel?`؛ آخر فحص: ${checkedLabel}`:''}`;
  const marker=position==null?'':`<span class="range52-marker" style="left:${((1-position)*100).toFixed(2)}%"></span>`;
  return `<div class="range52" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><div class="range52-track">${marker}</div><div class="range52-labels" aria-hidden="true"><span>${numberFormat.format(high)}</span><span>${numberFormat.format(low)}</span></div></div>`;
}

function periodValid(period){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(period || ''))return false;
  const day=new Date(`${period}T12:00:00`);
  return !Number.isNaN(day.getTime()) && day <= new Date() && day >= new Date('2020-01-01T00:00:00');
}
function today(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
const sourceDate = record=>{
  return record.dateKind==='checked' ? `فُحصت بيانات الشركة في ${record.period}؛ تاريخ تحديث القطاع لدى أرقام غير صالح` : `آخر تحديث للقطاع ${record.period}`;
}
const displayDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') ? value.split('-').reverse().join('.') : /^\d{2}\.\d{2}\.\d{4}$/.test(value||'') ? value : null;
const providerLabel = value => value==='Saudi Exchange'?'تداول السعودية':value==='TradingView'?'تريدينغ فيو':value||'مصدر غير محدد';
const snapshotLabel = () => displayDate(data.priceSource?.mode==='close' ? data.priceSource.officialDate || data.priceDate : data.priceSource?.observedDate || data.priceDate) || '—';
const timestamp = value => value ? new Date(value).getTime() : NaN;
const updateTime = value => {if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:timeFormat.format(date)};
const checkedLabel = value => {const date=new Date(value);return !value||Number.isNaN(date.getTime())?null:`${new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)} ${timeFormat.format(date)} بتوقيت الرياض`};
// Usual Saudi cash-equity hours, including the closing auction / trade-at-last.
// This is a freshness warning, not a claim that a session is currently open.
function isMarketHours(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part=type=>parts.find(p=>p.type===type)?.value;
  const minutes=Number(part('hour'))*60+Number(part('minute'));
  return !['Fri','Sat'].includes(part('weekday')) && minutes>=10*60 && minutes<15*60+20;
}
function paintPriceStatus(){
  const source=data?.priceSource||{},messages=[];
  if(source.warning)messages.push(source.warning);
  if(source.unavailableSymbols>0)messages.push(`السعر غير متاح لـ ${source.unavailableSymbols} سهمًا.`);
  const checked=checkedLabel(source.checkedAt);
  messages.push(checked?`آخر فحص لنسخة الأسعار: ${checked}.`:'وقت آخر فحص لنسخة الأسعار غير متاح.');
  if(isMarketHours() && Number.isFinite(timestamp(source.checkedAt)) && Date.now()-timestamp(source.checkedAt)>35*60*1000)messages.push('نسخة الأسعار قديمة: مضى أكثر من 35 دقيقة على آخر فحص خلال ساعات التداول المعتادة.');
  if(priceRefreshError)messages.push(priceRefreshError);
  const node=$('price-status');if(node)node.textContent=messages.join(' ');
}
function paintSnapshot(){
  const date=snapshotLabel();
  for(const id of ['price-date','price-date-note','price-date-footer']){
    const node=$(id);
    if(node) node.textContent=date;
  }
  const mode=$('price-mode');
  const official=data.priceSource?.mode==='close';
  const delay=safeNumber(data.priceSource?.delayMinutes);
  if(mode)mode.textContent=official?(date==='—'?'إغلاق رسمي · آخر إغلاق متاح':'إغلاق رسمي'):`أسعار متأخرة · غير مؤكدة رسميًا${delay!=null&&delay>0?` · تأخير المصدر ${delay} دقيقة`:''}`;
  const source=$('price-source');
  if(source)source.textContent=providerLabel(data.priceSource?.provider);
  paintPriceStatus();
}
function stockPriceLabel(stock){
  const date=displayDate(stock.priceDate);
  const status=stock.priceStatus==='official_close'?'إغلاق رسمي':stock.priceStatus==='unavailable'||stock.price==null?'السعر غير متاح':'سعر متأخر · غير مؤكد رسميًا';
  return `${status} · ${date||'تاريخ السعر غير متاح'} · المصدر: ${providerLabel(stock.priceSource || data.priceSource?.provider)}`;
}
function applyFinancials(){
  for(const stock of allStocks()){
    const fallback=stock._fallback || (stock._fallback={eps:safeNumber(stock.eps),bookValue:safeNumber(stock.bookValue),dividendYield:safeNumber(stock.dividendYield)});
    const record=financials.get(stock.symbol);
    const preferred=record && safeNumber(record[epsMode]);
    const reportedFallback=record && epsMode==='recurring' ? safeNumber(record.reported) : null;
    const chosen=preferred ?? reportedFallback;
    const epsKind=preferred != null ? (epsMode==='recurring'?'متكررة':'معلنة') : reportedFallback != null ? 'معلنة' : null;
    stock.eps=chosen ?? fallback.eps;
    const price=safeNumber(stock.price);
    stock.pe=stock.eps > 0 && price != null && price > 0 ? price/stock.eps : null;
    stock.bookValue=record?.book == null ? fallback.bookValue : safeNumber(record.book);
    stock.pb=stock.bookValue > 0 && price != null && price > 0 ? price/stock.bookValue : null;
    // data.json's last-year yield has a different definition from sector ratios.
    // Never replace it with the quarterly sector endpoint's DividendYield field.
    stock.dividendYield=fallback.dividendYield;
    const fallbackSource=`تداول السعودية${data.financialPeriod?` · ${data.financialPeriod}`:''}`;
    stock._epsSource=chosen == null ? fallbackSource : `أرقام · ربحية ${epsKind} · ${sourceDate(record)}`;
    stock._bookSource=record?.book == null ? fallbackSource : `أرقام · ${sourceDate(record)}`;
    stock._hasCurrentEps=chosen != null;
    stock._epsPeriod=chosen == null ? null : record.period;
    stock._epsDateKind=chosen == null ? null : record.dateKind;
    stock._epsKind=epsKind;
  }
  stats();render();
}
function stats(){
  const stocks=allStocks();
  const updated=stocks.filter(s=>s._hasCurrentEps).length;
  const values=[['القطاعات',data.sectors.length],['الشركات',stocks.length],['ربحية من أرقام',updated],['تاريخ السعر',snapshotLabel()]];
  const statsNode=$('stats');if(statsNode)statsNode.innerHTML=values.map(([label,value])=>`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`).join('');
}
function marketDailyChange(summary){
  const day=safeNumber(summary.day),points=safeNumber(summary.pointChange);
  if(day==null)return '—';
  const direction=day>0?'ارتفاع':day<0?'انخفاض':'دون تغيير';
  const arrow=day>0?'▲':day<0?'▼':'';
  const amount=points==null?'—':numberFormat.format(Math.abs(points));
  const rate=numberFormat.format(Math.abs(day));
  const label=`${direction}؛ ${points==null?'التغيير بالنقاط غير متاح':`${amount} نقطة`}؛ ${rate} بالمئة`;
  return `<span class="market-daily-change" role="img" aria-label="${escapeHtml(label)}"><span class="market-direction" aria-hidden="true">${arrow}</span><bdi class="market-points" aria-hidden="true">${amount}</bdi><span class="market-percent" aria-hidden="true"><bdi>${rate}</bdi> %</span></span>`;
}
function paintMarketSummary(){
  const m=data.marketSummary||{};
  const breadth=allStocks().reduce((counts,stock)=>{const change=safeNumber(stock.day);if(change>0)counts.up++;else if(change<0)counts.down++;else if(change===0)counts.flat++;return counts;},{up:0,down:0,flat:0});
  const mode=m.mode || (m.isIntraday?'delayed':null);
  const source=providerLabel(!m.mode&&m.quoteSource?m.quoteSource:m.source);
  const date=displayDate(m.date);
  const daily=marketDailyChange(m);
  const items=[
    {label:'قيمة المؤشر',value:m.value==null?'—':numberFormat.format(m.value)},
    {label:'التغيير اليومي',value:daily,trend:m.day},
    {label:'الشركات المرتفعة',value:integerFormat.format(breadth.up),trend:1},
    {label:'الشركات المنخفضة',value:integerFormat.format(breadth.down),trend:-1},
    {label:'دون تغيير',value:integerFormat.format(breadth.flat),trend:0},
    {label:'القيمة المتداولة',value:m.turnover==null?'—':integerFormat.format(m.turnover),source:m.turnoverSource},
    {label:'أداء المؤشر منذ بداية السنة',value:m.ytd,percent:true},
    {label:'3 أشهر',value:m.month3,percent:true},
    {label:'6 أشهر',value:m.month6,percent:true},
    {label:'سنة',value:m.year1,percent:true}
  ];
  $('market-stats').innerHTML=items.map(item=>{
    const trend=item.trend ?? (item.percent?item.value:null);
    const display=item.percent?(item.value==null?'—':`${item.value>0?'+':''}${numberFormat.format(item.value)}%`):item.value;
    const cls=typeof trend==='number'?(trend>0?'up':trend<0?'down':'flat'):'';
    const itemSource=item.percent?providerLabel(m.performanceSource):item.source?providerLabel(item.source):source;
    const title=item.label.startsWith('الشركات')||item.label==='دون تغيير'?`محسوب من بيانات أسهم الجدول · ${providerLabel(data.priceSource?.provider)} · ${snapshotLabel()}`:`المصدر: ${itemSource} · ${item.percent?'تاريخ بيانات الأداء':'تاريخ المؤشر'}: ${item.percent?m.performanceDate||'غير متاح':date||'غير متاح'}`;
    return `<div class="market-card" title="${escapeHtml(title)}"><span>${item.label}</span><strong class="${cls}">${display}</strong></div>`;
  }).join('');
  const checked=checkedLabel(m.updatedAt);
  const label=mode==='close'?'إغلاق رسمي':mode==='delayed'?'بيانات متأخرة · غير مؤكدة رسميًا':'بيانات المؤشر';
  $('market-date').textContent=m.date||m.value!=null?`${label} · ${date||(mode==='close'?'آخر إغلاق متاح':'تاريخ غير متاح')} · ${source}${checked?` · آخر فحص ${checked}`:''}`:'بانتظار تحديث المؤشر';
}
function sectorChange(stocks){
  let weighted=0,total=0;
  for(const stock of stocks){const change=safeNumber(stock.day),cap=safeNumber(stock.marketCap);if(change==null||cap==null||cap<=0)continue;weighted+=change*cap;total+=cap;}
  return total?weighted/total:null;
}
function nav(){
  $('sector-nav').innerHTML=`<button class="sector-button ${activeSector===null?'active':''}" data-sector="all" type="button" aria-pressed="${activeSector===null}" title="جميع القطاعات · ${allStocks().length} شركة"><span>جميع القطاعات</span><span class="count">${data.sectors.length}</span></button>`+
    data.sectors.map((sector,i)=>`<button class="sector-button ${activeSector===i?'active':''}" data-sector="${i}" type="button" aria-pressed="${activeSector===i}" title="${escapeHtml(sector.name)} · ${sector.stocks.length} شركة"><span>${escapeHtml(sector.name)}</span><span class="count">${sector.stocks.length}</span></button>`).join('');
}
function row(stock){
  const dividendTitle=stock.dividendYield==null?'عائد التوزيع (آخر سنة) غير متاح في ملف البيانات':stock.dividendYieldSource==='Argaam Dividend Yield (%) (Last Year)'?'أرقام: عائد التوزيع (%) (آخر سنة)':`عائد التوزيع · المصدر: ${stock.dividendYieldSource||'ملف البيانات؛ المصدر غير محدد'}`;
  const priceTitle=stockPriceLabel(stock);
  const performanceTitle=`تاريخ بيانات الأداء: ${stock.performanceDate||'غير متاح'}`;
  const isBank=data?.sectors.some(sector=>sector.name==='البنوك'&&sector.stocks.some(bank=>bank.symbol===stock.symbol));
  const isMining=data?.sectors.some(sector=>sector.name==='التعدين والمعادن'&&sector.stocks.some(company=>company.symbol===stock.symbol));
  const isTelecom=data?.sectors.some(sector=>sector.name==='الاتصالات'&&sector.stocks.some(company=>company.symbol===stock.symbol));
  const isUtilities=data?.sectors.some(sector=>sector.name==='المرافق والطاقة'&&sector.stocks.some(company=>company.symbol===stock.symbol));
  const isHealth=data?.sectors.some(sector=>sector.name==='الرعاية الصحية'&&sector.stocks.some(company=>company.symbol===stock.symbol));
  const isGlass=data?.sectors.some(sector=>sector.name==='المنتجات الزجاجية'&&sector.stocks.some(company=>company.symbol===stock.symbol));
  const companyLabel=isBank?`<a class="company-results-link" href="banks.html?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية 2021–2025 لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:isMining?`<a class="company-results-link" href="mining.html?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية 2020–2025 لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:isTelecom?`<a class="company-results-link" href="telecom.html?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية 2021–2025 لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:isUtilities?`<a class="company-results-link" href="utilities.html?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية 2021–2025 لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:isHealth?`<a class="company-results-link" href="health.html?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية 2021–2025 لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:isGlass?`<a class="company-results-link" href="glass.html?symbol=${encodeURIComponent(stock.symbol)}" title="النتائج السنوية 2021–2025 لـ ${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</a>`:escapeHtml(stock.name);
  return `<tr><td class="sticky-1"><span class="symbol-badge">${escapeHtml(stock.symbol)}</span></td><td class="sticky-2 company-name">${companyLabel}</td><td title="${escapeHtml(priceTitle)}">${stock.price==null?'<span class="missing">—</span>':`<span class="num price">${numberFormat.format(stock.price)}</span>`}</td><td title="${escapeHtml(stock._epsSource)}">${numeric(stock.eps,2)}</td><td>${pe(stock)}</td><td title="${escapeHtml(stock._bookSource)}">${numeric(stock.bookValue)}</td><td>${numeric(stock.pb)}</td><td title="${escapeHtml(dividendTitle)}">${percent(stock.dividendYield,false)}</td><td>${range52(stock)}</td><td title="${escapeHtml(`القيمة السوقية · ${priceTitle}`)}">${numeric(stock.marketCap)}</td><td>${percent(stock.day)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.ytd)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.month3)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.month6)}</td><td title="${escapeHtml(performanceTitle)}">${percent(stock.year1)}</td></tr>`;
}
function render(){
  nav();
  const selected=activeSector===null
    ? [{index:'all',name:'جميع الشركات',stocks:allStocks()}]
    : [{index:activeSector,name:data.sectors[activeSector].name,stocks:data.sectors[activeSector].stocks}];
  const filtered=selected.map(group=>({...group,stocks:group.stocks.filter(s=>normalized(s.name).includes(query)||s.symbol.includes(query))})).filter(group=>group.stocks.length);
  const count=filtered.reduce((n,group)=>n+group.stocks.length,0);
  $('view-title').textContent=activeSector===null?'جميع القطاعات':data.sectors[activeSector].name;
  const allSort=sortBySector.get('all');
  $('result-count').textContent=activeSector===null?`${count} شركة في جدول واحد${allSort?.key==='marketCap'&&allSort.dir===-1?' · الأكبر قيمة سوقية أولًا':''}`:`${count} شركة في قطاع ${data.sectors[activeSector].name}`;
  $('clear').hidden=!query;
  $('empty').hidden=filtered.length!==0;
  $('sectors').innerHTML=filtered.map(({name,index,stocks})=>{
    const sort=sortBySector.get(index);
    if(sort){stocks=[...stocks].sort((a,b)=>{
      const av=sort.key==='week52Position'?range52Position(a):a[sort.key],bv=sort.key==='week52Position'?range52Position(b):b[sort.key];
      if(av==null) return 1;if(bv==null)return -1;
      return (typeof av==='string'?av.localeCompare(bv,'ar'):av-bv)*sort.dir || a.symbol.localeCompare(b.symbol,'en');
    });}
    const change=sectorChange(index==='all'?allStocks():data.sectors[index].stocks),changeClass=change==null?'':change>0?'up':change<0?'down':'flat',changeText=change==null?'—':`${change>0?'+':''}${numberFormat.format(change)}%`;
    const annualResultsLink=name==='البنوك'?'<a class="bank-results-link" href="banks.html">النتائج السنوية 2021–2025</a>':name==='التعدين والمعادن'?'<a class="bank-results-link" href="mining.html">النتائج السنوية 2020–2025</a>':name==='الاتصالات'?'<a class="bank-results-link" href="telecom.html">النتائج السنوية 2021–2025</a>':name==='المرافق والطاقة'?'<a class="bank-results-link" href="utilities.html">النتائج السنوية 2021–2025</a>':name==='الرعاية الصحية'?'<a class="bank-results-link" href="health.html">النتائج السنوية 2021–2025</a>':name==='المنتجات الزجاجية'?'<a class="bank-results-link" href="glass.html">النتائج السنوية 2021–2025</a>':'';
    return `<section class="sector-section" id="sector-${index}" aria-labelledby="heading-${index}"><div class="sector-heading"><div class="sector-title-wrap">${index==='all'?'':`<span class="sector-index">${String(index+1).padStart(2,'0')}</span>`}<h3 id="heading-${index}">${escapeHtml(name)}</h3></div><div class="sector-meta">${annualResultsLink}<span class="sector-pill">${stocks.length} ${index==='all'||stocks.length===1?'شركة':'شركات'}</span>${index==='all'?'':`<span class="sector-performance ${changeClass}" title="تغير محسوب مرجح بالقيمة السوقية لجميع شركات القطاع؛ ليس مؤشر قطاع رسميًا">تغير مرجح محسوب <strong>${changeText}</strong></span>`}</div></div><div class="table-wrap" tabindex="0" aria-label="جدول ${escapeHtml(name)}؛ مرر أفقيًا لرؤية كل الأعمدة"><table><colgroup>${columns.map(c=>`<col class="col-${c[2]}">`).join('')}</colgroup><thead><tr>${columns.map(([key,label],ci)=>`<th class="${ci===0?'sticky-1':ci===1?'sticky-2':''}" scope="col"><button type="button" data-sort="${key}" data-index="${index}" class="${sort?.key===key?'sorted':''}" aria-label="ترتيب حسب ${label}">${label}<span class="sort-glyph">${sort?.key===key?(sort.dir===1?'↑':'↓'):'↕'}</span></button></th>`).join('')}</tr></thead><tbody>${stocks.map(row).join('')}</tbody></table></div></section>`;
  }).join('');
}
function updateStatus(message){$('financial-status').textContent=message;}
function updateMode(mode){
  epsMode=mode;
  $('recurring-mode').classList.toggle('selected',mode==='recurring');
  $('reported-mode').classList.toggle('selected',mode==='reported');
  $('recurring-mode').setAttribute('aria-pressed',String(mode==='recurring'));
  $('reported-mode').setAttribute('aria-pressed',String(mode==='reported'));
  applyFinancials();
  const updated=allStocks().filter(s=>s._hasCurrentEps).length;
  updateStatus(`ربحية ${updated} سهمًا من أرقام؛ ${allStocks().length-updated} سهمًا تعرض بيانات أقدم. عائد التوزيع محفوظ من ملف الأسعار وفق مصدره، وليس من نسب القطاع الفصلية.`);
}
function readSector(html,sectorId){
  const documentHtml=new DOMParser().parseFromString(html,'text/html');
  const rawDate=documentHtml.querySelector('.update-info span')?.textContent.trim() || '';
  const m=rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)return {reason:'missing-date'};
  const period=`${m[3]}-${m[2]}-${m[1]}`;
  const futureSectorDate=new Date(`${period}T12:00:00`) > new Date();
  if(!periodValid(period) && !futureSectorDate)return {reason:'invalid-date'};
  const recordPeriod=futureSectorDate?today():period;
  const dateKind=futureSectorDate?'checked':'sector';
  const records=[];
  for(const cell of documentHtml.querySelectorAll('td[compid]')){
    const symbol=financialMap.companyIds[cell.getAttribute('compid')];
    if(!symbol)continue;
    const row=cell.closest('tr');
    const field=key=>safeNumber(row.querySelector(`td[field-column="${key}"]`)?.getAttribute('data-order'));
    const recurring=field('EPSBeforeXOItems'),reported=field('EarningsPerShare'),book=field('BookValue'),dividendYield=field('DividendYield');
    if(recurring == null && reported == null && book == null && dividendYield == null)continue;
    records.push({symbol,sector:sectorId,period:recordPeriod,dateKind,recurring,reported,book,dividendYield});
  }
  return {records,futureSectorDate};
}
async function getSector(sectorId){
  const url=`https://www.argaam.com/en/financialratios-sector/${sectorId}/quarter/per-share-data/${sectorId}`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{mode:'cors',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    return readSector(await response.text(),sectorId);
  }finally{clearTimeout(timer);}
}
async function refreshFinancials(){
  if(refreshRunning||!data||!financialMap)return;
  refreshRunning=true;
  updateStatus('جار فحص الأرباح المعلنة لدى أرقام…');
  const ids=[...financialMap.sectorIds];
  const results=[];
  async function worker(){while(ids.length){const id=ids.shift();try{results.push(await getSector(id));}catch(error){results.push({reason:error.name==='AbortError'?'timeout':'network'});}}}
  await Promise.all(Array.from({length:Math.min(4,ids.length)},worker));
  let changed=0,invalid=0,failed=0,futureHeaders=0;
  for(const result of results){
    if(result.reason){if(result.reason==='invalid-date')invalid++;else failed++;continue;}
    if(result.futureSectorDate)futureHeaders++;
    for(const record of result.records){
      const previous=financials.get(record.symbol);
      if(!previous || record.period>=previous.period){financials.set(record.symbol,record);changed++;}
    }
  }
  applyFinancials();
  const updated=allStocks().filter(s=>s._hasCurrentEps).length;
  let message=`ربحية ${updated} سهمًا من أرقام؛ ${allStocks().length-updated} سهمًا تعرض بيانات أقدم. آخر فحص ${new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date())}.`;
  if(invalid)message+=` استُبعدت ${invalid} قطاعات بسبب تاريخ غير صالح.`;
  if(futureHeaders)message+=` تاريخ تحديث ${futureHeaders} قطاع لدى أرقام يقع في المستقبل؛ استُخدمت قيم الشركات مع إظهار تاريخ الفحص بدلًا منه.`;
  if(failed)message+=` تعذر فحص ${failed} قطاعات؛ ستُعاد المحاولة تلقائيًا.`;
  updateStatus(message);
  refreshRunning=false;
}

async function refreshPrices(){
  if(pricesRefreshRunning)return false;
  pricesRefreshRunning=true;
  try{
    const response=await fetch(`data.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const result=await response.json();
    if(!result||!Array.isArray(result.sectors)||result.sectors.some(sector=>!Array.isArray(sector.stocks)))throw Error('invalid price data');
    const current=timestamp(data?.priceSource?.checkedAt),incoming=timestamp(result.priceSource?.checkedAt);
    if(data && Number.isFinite(current) && (!Number.isFinite(incoming)||incoming<current)){
      priceRefreshError='رُفضت نسخة أسعار أقدم أو بلا وقت فحص صالح؛ احتُفظ بالقيم المعروضة.';
      paintPriceStatus();
      return false;
    }
    const initial=!data;
    data=result;
    priceRefreshError='';
    if(initial)$('empty').querySelector('h3').textContent='لا توجد نتائج مطابقة';
    paintSnapshot();paintMarketSummary();applyFinancials();
    if(initial&&financialMap)refreshFinancials();
    return true;
  }catch(error){
    priceRefreshError=data?'تعذر تحديث الأسعار؛ احتُفظ بالقيم المعروضة وستُعاد المحاولة تلقائيًا.':'تعذر تحميل الأسعار؛ ستُعاد المحاولة تلقائيًا.';
    paintPriceStatus();
    if(!data){$('result-count').textContent='تعذر تحميل البيانات';$('empty').hidden=false;$('empty').querySelector('h3').textContent='تعذر تحميل البيانات';}
    return false;
  }finally{pricesRefreshRunning=false;}
}
async function loadFinancialMap(){
  try{
    const response=await fetch('financial-map.json?v=live-20261104',{cache:'no-store'});
    if(!response.ok)throw Error('map unavailable');
    const map=await response.json();
    if(!map||!Array.isArray(map.sectorIds))throw Error('invalid map');
    financialMap=map;
    for(const [symbol,record] of Object.entries(map.snapshot||{}))if(periodValid(record.period))financials.set(symbol,record);
    if(data){applyFinancials();refreshFinancials();}
  }catch(error){updateStatus('تعذر تحميل بيانات الأرباح المحدثة؛ تُعرض القيم المتاحة في ملف الأسعار.');}
}

document.addEventListener('click',event=>{
  const sectorButton=event.target.closest('[data-sector]');
  if(sectorButton){activeSector=sectorButton.dataset.sector==='all'?null:Number(sectorButton.dataset.sector);if(activeSector===null)sortBySector.set('all',{key:'marketCap',dir:-1});render();$('main-content').scrollIntoView({behavior:'smooth',block:'start'});return;}
  const sortButton=event.target.closest('[data-sort]');
  if(sortButton){const index=sortButton.dataset.index==='all'?'all':Number(sortButton.dataset.index),key=sortButton.dataset.sort,current=sortBySector.get(index);sortBySector.set(index,{key,dir:current?.key===key?-current.dir:1});const section=document.getElementById(`sector-${index}`);const scroll=section.querySelector('.table-wrap').scrollLeft;render();document.getElementById(`sector-${index}`).querySelector('.table-wrap').scrollLeft=scroll;}
});
$('search').addEventListener('input',event=>{query=normalized(event.target.value);render();});
$('clear').addEventListener('click',()=>{$('search').value='';query='';render();$('search').focus();});
$('recurring-mode').addEventListener('click',()=>updateMode('recurring'));
$('reported-mode').addEventListener('click',()=>updateMode('reported'));
refreshPrices();
loadFinancialMap();
setInterval(refreshPrices,60*1000);
setInterval(refreshFinancials,60*60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshPrices();refreshFinancials();}});
