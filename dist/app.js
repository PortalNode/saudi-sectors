const columns = [
  ['symbol','رمز السهم','symbol'],['name','اسم الشركة','name'],['price','سعر السهم','price'],
  ['eps','ربحية السهم · آخر 4 أرباع','eps'],['pe','مكرر الأرباح','pe'],['bookValue','القيمة الدفترية','bv'],
  ['pb','مكرر القيمة الدفترية','pb'],['day','تغير اليوم','day'],['month3','تغير 3 أشهر','3m'],
  ['month6','تغير 6 أشهر','6m'],['year1','تغير سنة','1y']
];
const numberFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const epsFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});
let data, activeSector = null, query = '', sortBySector = new Map();
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized = value => String(value ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().trim();
const numeric = (n, digits=2) => n == null ? '<span class="missing">—</span>' : `<span class="num">${digits===3?epsFormat.format(n):numberFormat.format(n)}</span>`;
const percent = n => n == null ? '<span class="missing">—</span>' : `<span class="num ${n>0?'up':n<0?'down':'flat'}">${n>0?'+':''}${numberFormat.format(n)}%</span>`;
const pe = stock => stock.pe != null ? numeric(stock.pe) : stock.eps != null && stock.eps < 0 ? '<span class="loss">خاسرة</span>' : '<span class="missing">—</span>';

function stats(){
  const stocks=data.sectors.flatMap(s=>s.stocks);
  const complete=stocks.filter(s=>s.eps!=null && s.bookValue!=null).length;
  const values=[['القطاعات',data.sectors.length],['الشركات',stocks.length],['متاحة لها بيانات مالية',complete],['تاريخ اللقطة','02.11.2026']];
  $('stats').innerHTML=values.map(([label,value])=>`<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`).join('');
}
function nav(){
  $('sector-nav').innerHTML=`<button class="sector-button ${activeSector===null?'active':''}" data-sector="all" type="button" aria-pressed="${activeSector===null}"><span>جميع القطاعات</span><span class="count">${data.sectors.length}</span></button>`+
    data.sectors.map((sector,i)=>`<button class="sector-button ${activeSector===i?'active':''}" data-sector="${i}" type="button" aria-pressed="${activeSector===i}"><span>${escapeHtml(sector.name)}</span><span class="count">${sector.stocks.length}</span></button>`).join('');
}
function row(stock){
  return `<tr><td class="sticky-1"><span class="symbol-badge">${escapeHtml(stock.symbol)}</span></td><td class="sticky-2 company-name">${escapeHtml(stock.name)}</td><td>${stock.price==null?'<span class="missing">—</span>':`<span class="num price">${numberFormat.format(stock.price)}</span>`}</td><td>${numeric(stock.eps,3)}</td><td>${pe(stock)}</td><td>${numeric(stock.bookValue)}</td><td>${numeric(stock.pb)}</td><td>${percent(stock.day)}</td><td>${percent(stock.month3)}</td><td>${percent(stock.month6)}</td><td>${percent(stock.year1)}</td></tr>`;
}
function render(){
  nav();
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
document.addEventListener('click',event=>{
  const sectorButton=event.target.closest('[data-sector]');
  if(sectorButton){activeSector=sectorButton.dataset.sector==='all'?null:Number(sectorButton.dataset.sector);render();$('main-content').scrollIntoView({behavior:'smooth',block:'start'});return;}
  const sortButton=event.target.closest('[data-sort]');
  if(sortButton){const index=Number(sortButton.dataset.index),key=sortButton.dataset.sort,current=sortBySector.get(index);sortBySector.set(index,{key,dir:current?.key===key?-current.dir:1});const section=document.getElementById(`sector-${index}`);const scroll=section.querySelector('.table-wrap').scrollLeft;render();document.getElementById(`sector-${index}`).querySelector('.table-wrap').scrollLeft=scroll;}
});
$('search').addEventListener('input',event=>{query=normalized(event.target.value);render();});
$('clear').addEventListener('click',()=>{$('search').value='';query='';render();$('search').focus();});
fetch('data.json').then(r=>{if(!r.ok)throw Error('data unavailable');return r.json()}).then(result=>{data=result;stats();render()}).catch(()=>{$('result-count').textContent='تعذر تحميل البيانات';$('empty').hidden=false;$('empty').querySelector('h3').textContent='تعذر تحميل البيانات';});
