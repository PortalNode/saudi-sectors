const columns = [
  ['symbol','رمز السهم','symbol'],['name','اسم الشركة','name'],['price','سعر السهم','price'],
  ['eps','ربحية السهم · آخر 4 أرباع','eps'],['pe','مكرر الأرباح','pe'],['bookValue','القيمة الدفترية','bv'],
  ['pb','مكرر القيمة الدفترية','pb'],['day','تغير اليوم','day'],['month3','تغير 3 أشهر','3m'],
  ['month6','تغير 6 أشهر','6m'],['year1','تغير سنة','1y']
];
const numberFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const epsFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});
let data, financialMap, activeSector = null, query = '', sortBySector = new Map(), epsMode = 'recurring', refreshRunning = false;
const financials = new Map();
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized = value => String(value ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().trim();
const numeric = (n, digits=2) => n == null ? '<span class="missing">—</span>' : `<span class="num">${digits===3?epsFormat.format(n):numberFormat.format(n)}</span>`;
const percent = n => n == null ? '<span class="missing">—</span>' : `<span class="num ${n>0?'up':n<0?'down':'flat'}">${n>0?'+':''}${numberFormat.format(n)}%</span>`;
const pe = stock => stock.pe != null ? numeric(stock.pe) : stock.eps != null && stock.eps < 0 ? '<span class="loss">خاسرة</span>' : '<span class="missing">—</span>';
const allStocks = () => data.sectors.flatMap(s => s.stocks);
const safeNumber = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function periodValid(period){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(period || ''))return false;
  const day=new Date(`${period}T12:00:00`);
  return !Number.isNaN(day.getTime()) && day <= new Date() && day >= new Date('2020-01-01T00:00:00');
}
function applyFinancials(){
  for(const stock of allStocks()){
    const fallback=stock._fallback || (stock._fallback={eps:stock.eps,pe:stock.pe,bookValue:stock.bookValue,pb:stock.pb});
    const record=financials.get(stock.symbol);
    const preferred=record && safeNumber(record[epsMode]);
    const reportedFallback=record && epsMode==='recurring' ? safeNumber(record.reported) : null;
    const chosen=preferred ?? reportedFallback;
    const epsKind=preferred != null ? (epsMode==='recurring'?'متكررة':'معلنة') : reportedFallback != null ? 'معلنة' : null;
    stock.eps=chosen ?? fallback.eps;
    stock.pe=chosen == null ? fallback.pe : chosen > 0 && stock.price != null ? stock.price/chosen : null;
    stock.bookValue=record?.book == null ? fallback.bookValue : safeNumber(record.book);
    stock.pb=record?.book == null ? fallback.pb : stock.bookValue > 0 && stock.price != null ? stock.price/stock.bookValue : null;
    stock._epsSource=chosen == null ? 'تداول السعودية · حتى الربع الثاني 2026' : `أرقام · ربحية ${epsKind} · آخر تحديث للقطاع ${record.period}`;
    stock._bookSource=record?.book == null ? 'تداول السعودية · حتى الربع الثاني 2026' : `أرقام · آخر تحديث للقطاع ${record.period}`;
    stock._hasCurrentEps=chosen != null;
    stock._epsPeriod=chosen == null ? null : record.period;
    stock._epsKind=epsKind;
  }
  stats();render();
}
function stats(){
  const stocks=allStocks();
  const updated=stocks.filter(s=>s._hasCurrentEps).length;
  const values=[['القطاعات',data.sectors.length],['الشركات',stocks.length],['ربحية من أرقام',updated],['تاريخ السعر','02.11.2026']];
  $('stats').innerHTML=values.map(([label,value])=>`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`).join('');
}
function nav(){
  $('sector-nav').innerHTML=`<button class="sector-button ${activeSector===null?'active':''}" data-sector="all" type="button" aria-pressed="${activeSector===null}"><span>جميع القطاعات</span><span class="count">${data.sectors.length}</span></button>`+
    data.sectors.map((sector,i)=>`<button class="sector-button ${activeSector===i?'active':''}" data-sector="${i}" type="button" aria-pressed="${activeSector===i}"><span>${escapeHtml(sector.name)}</span><span class="count">${sector.stocks.length}</span></button>`).join('');
}
function row(stock){
  const source=stock._hasCurrentEps?`أرقام · ${stock._epsKind} · قطاع ${stock._epsPeriod.slice(0,7)}`:'تداول · بيانات أقدم';
  const sourceClass=stock._hasCurrentEps?'fresh':'stale';
  return `<tr><td class="sticky-1"><span class="symbol-badge">${escapeHtml(stock.symbol)}</span></td><td class="sticky-2 company-name">${escapeHtml(stock.name)}</td><td>${stock.price==null?'<span class="missing">—</span>':`<span class="num price">${numberFormat.format(stock.price)}</span>`}</td><td title="${escapeHtml(stock._epsSource)}">${numeric(stock.eps,3)}<span class="source-tag ${sourceClass}">${source}</span></td><td>${pe(stock)}</td><td title="${escapeHtml(stock._bookSource)}">${numeric(stock.bookValue)}</td><td>${numeric(stock.pb)}</td><td>${percent(stock.day)}</td><td>${percent(stock.month3)}</td><td>${percent(stock.month6)}</td><td>${percent(stock.year1)}</td></tr>`;
}
function render(){
  nav();
  columns[3][1]='ربحية السهم · آخر 4 أرباع';
  const selected=activeSector===null?data.sectors.map((sector,index)=>({sector,index})):[{sector:data.sectors[activeSector],index:activeSector}];
  const filtered=selected.map(({sector,index})=>({sector,index,stocks:sector.stocks.filter(s=>normalized(s.name).includes(query)||s.symbol.includes(query))})).filter(s=>s.stocks.length);
  const count=filtered.reduce((n,s)=>n+s.stocks.length,0);
  $('view-title').textContent=activeSector===null?'جميع القطاعات':data.sectors[activeSector].name;
  $('result-count').textContent=`${count} شركة في ${filtered.length} قطاع`;
  $('clear').hidden=!query;
  $('empty').hidden=filtered.length!==0;
  $('sectors').innerHTML=filtered.map(({sector,index,stocks})=>{
    const sort=sortBySector.get(index);
    if(sort){stocks=[...stocks].sort((a,b)=>{
      const av=a[sort.key],bv=b[sort.key];
      if(av==null) return 1;if(bv==null)return -1;
      return (typeof av==='string'?av.localeCompare(bv,'ar'):av-bv)*sort.dir;
    });}
    return `<section class="sector-section" id="sector-${index}" aria-labelledby="heading-${index}"><div class="sector-heading"><div class="sector-title-wrap"><span class="sector-index">${String(index+1).padStart(2,'0')}</span><h3 id="heading-${index}">${escapeHtml(sector.name)}</h3></div><span class="sector-pill">${stocks.length} ${stocks.length===1?'شركة':'شركات'}</span></div><div class="table-wrap" tabindex="0" aria-label="جدول ${escapeHtml(sector.name)}؛ مرر أفقيًا لرؤية كل الأعمدة"><table><colgroup>${columns.map(c=>`<col class="col-${c[2]}">`).join('')}</colgroup><thead><tr>${columns.map(([key,label],ci)=>`<th class="${ci===0?'sticky-1':ci===1?'sticky-2':''}" scope="col"><button type="button" data-sort="${key}" data-index="${index}" class="${sort?.key===key?'sorted':''}" aria-label="ترتيب حسب ${label}">${label}<span class="sort-glyph">${sort?.key===key?(sort.dir===1?'↑':'↓'):'↕'}</span></button></th>`).join('')}</tr></thead><tbody>${stocks.map(row).join('')}</tbody></table></div></section>`;
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
  updateStatus(`ربحية ${updated} سهمًا من أرقام؛ ${allStocks().length-updated} سهمًا تعرض قيمة تداول الأقدم. نوع الربحية وتاريخ القطاع ظاهران أسفل القيمة.`);
}
function readSector(html,sectorId){
  const documentHtml=new DOMParser().parseFromString(html,'text/html');
  const rawDate=documentHtml.querySelector('.update-info span')?.textContent.trim() || '';
  const m=rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)return {reason:'missing-date'};
  const period=`${m[3]}-${m[2]}-${m[1]}`;
  if(!periodValid(period))return {reason:'invalid-date'};
  const records=[];
  for(const cell of documentHtml.querySelectorAll('td[compid]')){
    const symbol=financialMap.companyIds[cell.getAttribute('compid')];
    if(!symbol)continue;
    const row=cell.closest('tr');
    const field=key=>safeNumber(row.querySelector(`td[field-column="${key}"]`)?.getAttribute('data-order'));
    const recurring=field('EPSBeforeXOItems'),reported=field('EarningsPerShare'),book=field('BookValue');
    if(recurring == null && reported == null && book == null)continue;
    records.push({symbol,sector:sectorId,period,recurring,reported,book});
  }
  return {records};
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
  if(refreshRunning)return;
  refreshRunning=true;
  updateStatus('جار فحص الأرباح المعلنة لدى أرقام…');
  const ids=[...financialMap.sectorIds];
  const results=[];
  async function worker(){while(ids.length){const id=ids.shift();try{results.push(await getSector(id));}catch(error){results.push({reason:error.name==='AbortError'?'timeout':'network'});}}}
  await Promise.all(Array.from({length:Math.min(4,ids.length)},worker));
  let changed=0,invalid=0,failed=0;
  for(const result of results){
    if(result.reason){if(result.reason==='invalid-date')invalid++;else failed++;continue;}
    for(const record of result.records){
      const previous=financials.get(record.symbol);
      if(!previous || record.period>=previous.period){financials.set(record.symbol,record);changed++;}
    }
  }
  applyFinancials();
  const updated=allStocks().filter(s=>s._hasCurrentEps).length;
  let message=`ربحية ${updated} سهمًا من أرقام؛ ${allStocks().length-updated} سهمًا تعرض قيمة تداول الأقدم. آخر فحص ${new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date())}.`;
  if(invalid)message+=` استُبعدت ${invalid} قطاعات بسبب تاريخ غير صالح.`;
  if(failed)message+=` تعذر فحص ${failed} قطاعات؛ ستُعاد المحاولة تلقائيًا.`;
  updateStatus(message);
  refreshRunning=false;
}

document.addEventListener('click',event=>{
  const sectorButton=event.target.closest('[data-sector]');
  if(sectorButton){activeSector=sectorButton.dataset.sector==='all'?null:Number(sectorButton.dataset.sector);render();$('main-content').scrollIntoView({behavior:'smooth',block:'start'});return;}
  const sortButton=event.target.closest('[data-sort]');
  if(sortButton){const index=Number(sortButton.dataset.index),key=sortButton.dataset.sort,current=sortBySector.get(index);sortBySector.set(index,{key,dir:current?.key===key?-current.dir:1});const section=document.getElementById(`sector-${index}`);const scroll=section.querySelector('.table-wrap').scrollLeft;render();document.getElementById(`sector-${index}`).querySelector('.table-wrap').scrollLeft=scroll;}
});
$('search').addEventListener('input',event=>{query=normalized(event.target.value);render();});
$('clear').addEventListener('click',()=>{$('search').value='';query='';render();$('search').focus();});
$('recurring-mode').addEventListener('click',()=>updateMode('recurring'));
$('reported-mode').addEventListener('click',()=>updateMode('reported'));
Promise.all([fetch('data.json').then(r=>{if(!r.ok)throw Error('data unavailable');return r.json()}),fetch('financial-map.json').then(r=>{if(!r.ok)throw Error('map unavailable');return r.json()})])
  .then(([result,map])=>{
    data=result;financialMap=map;
    for(const [symbol,record] of Object.entries(map.snapshot))if(periodValid(record.period))financials.set(symbol,record);
    applyFinancials();
    refreshFinancials();
    setInterval(refreshFinancials,60*60*1000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshFinancials();});
  })
  .catch(()=>{$('result-count').textContent='تعذر تحميل البيانات';$('empty').hidden=false;$('empty').querySelector('h3').textContent='تعذر تحميل البيانات';updateStatus('تعذر تحميل بيانات الأرباح.');});
