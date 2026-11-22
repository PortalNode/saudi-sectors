// «موعد النتائج القادمة» في صفحة الشركة: الموعد المتوقع لإعلان النتائج ونطاقه، وسجل مواعيد
// الإعلان السابقة، وربط كل إعلان بصافي الربح وحركة السهم. تقرأ الرمز من شارة .symbol-badge
// وتضع البطاقة فوق جدول النتائج مباشرة. البيانات من earnings-calendar/<الرمز>.json
// (scripts/build-earnings-calendar.py، تُحدَّث تلقائيًا مع إعلانات تداول).
(() => {
  const WD = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const QN = ['','الربع الأول','الربع الثاني','الربع الثالث','الربع الرابع'];
  const SRC = { tadawul: 'تداول', verified: 'مباشر', history: 'سجل تاريخي' };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const D = s => new Date(s + 'T00:00:00Z');
  const days = (a, b) => Math.round((D(b) - D(a)) / 864e5);
  const addDays = (s, n) => new Date(D(s).getTime() + n * 864e5).toISOString().slice(0, 10);
  const dmy = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const dm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const wd = s => WD[D(s).getUTCDay()];
  const n = v => `<span class="ced-num">${esc(v)}</span>`;
  const pct = (v, dp = 1) => v == null ? '<span class="ced-muted">—</span>' : `<span class="ced-num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v.toFixed(dp)}%</span>`;
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
  const period = (r, c) => r.q === 4 && c.fye === 12 ? `السنوية ${r.fy}` : `${QN[r.q]} ${r.fy}`;
  const confCls = c => c === 'عالية' ? 'c3' : c === 'متوسطة' ? 'c2' : '';
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // توقيت الرياض

  const cache = new Map();
  const load = symbol => {
    if (!cache.has(symbol)) cache.set(symbol, fetch(`earnings-calendar/${encodeURIComponent(symbol)}.json`, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).catch(() => null));
    return cache.get(symbol);
  };

  function html(c) {
    const T = today(), x = c.next, rs = c.recs, last = rs.at(-1);
    // الموعد المتوقع مضى ولم يصل إعلان بعد
    const toGo = days(T, x.d);
    const moves = rs.filter(r => r.rx != null);
    const avgMove = moves.length ? moves.reduce((a, r) => a + Math.abs(r.rx), 0) / moves.length : null;
    const mins = rs.slice(-8).map(r => r.tm).filter(Boolean).map(t => +t.slice(0, 2) * 60 + +t.slice(3));
    const tm = mins.length >= 3 ? median(mins) : null;
    const span = Math.max(14, days(x.lo, x.hi) + 10), start = addDays(x.lo, -5), pos = d => days(start, d) / span * 100;
    const years = [...new Set(rs.map(r => r.fy).concat(x.fy))].sort().slice(-5);
    const speed = c.rel <= -3 ? `أبكر من السوق بـ ${n(Math.round(-c.rel))} أيام` : c.rel >= 3 ? `بعد السوق بـ ${n(Math.round(c.rel))} أيام` : 'في توقيت السوق';
    const hasProfit = rs.some(r => r.np != null);
    return `
      <div class="cp-head"><h3 id="ced-title">موعد النتائج القادمة</h3><div class="cp-tags"><span class="cp-tag market">تقدير من سجل الشركة</span><span class="cp-tag">المصادر: إعلانات تداول + سجل الإعلانات منذ ${n(rs[0].fy)}</span></div></div>
      <div class="ced-body">
        <div class="ced-col">
          <div class="ced-lbl">الموعد المتوقع لإعلان نتائج ${esc(period(x, c))} · الفترة المنتهية ${n(dmy(x.pe))}</div>
          <div class="ced-big">${wd(x.d)} ${n(dmy(x.d))} ${toGo > 0 ? `<span class="ced-cd">بعد ${n(toGo)} يومًا</span>` : toGo === 0 ? '<span class="ced-cd">اليوم</span>' : `<span class="ced-cd late">تأخر ${n(-toGo)} يومًا عن الموعد المتوقع</span>`}</div>
          <div class="ced-lbl"><span class="ced-conf ${confCls(x.conf)}"></span>ثقة ${esc(x.conf)} · ${x.m === 'company' ? `مبني على آخر ${n(x.n)} ${x.n === 1 ? 'إعلان' : 'إعلانات'} للفترة نفسها` : 'تقدير من وسيط القطاع لقلة سجل الشركة'}</div>
          <div class="ced-range" aria-hidden="true"><div class="ced-win" style="right:${pos(x.lo)}%;width:${Math.max(1, days(x.lo, x.hi)) / span * 100}%"></div><div class="ced-pt" style="right:${pos(x.d)}%"></div></div>
          <div class="ced-rl"><span>أبكر موعد ${n(dmy(x.lo))}</span><span>أبعد موعد ${n(dmy(x.hi))}</span></div>
        </div>
        <div class="ced-col">
          <ul class="ced-facts">
            <li>آخر إعلان<b>${esc(period(last, c))} · ${n(dmy(last.d))}</b></li>
            <li>أُعلن بعد نهاية الفترة بـ<b>${n(last.lag)} يومًا</b></li>
            <li>توقيت إعلاناتها عادة<b>${speed}</b></li>
            ${c.peers > 1 ? `<li>ترتيبها في سرعة الإعلان بالقطاع<b>${n(c.rank)} من ${n(c.peers)}</b></li>` : ''}
            ${tm != null ? `<li>وقت النشر المعتاد<b>${n(String(Math.floor(tm / 60)).padStart(2, '0') + ':' + String(Math.round(tm % 60)).padStart(2, '0'))}</b></li>` : ''}
            ${avgMove != null ? `<li>متوسط حركة السهم بعد الإعلان<b>${n('±' + avgMove.toFixed(2) + '%')}</b></li>` : ''}
            ${c.bt.n ? `<li>دقة هذا التوقع على سجلها السابق<b>${n(c.bt.w7 + '%')} ضمن ±7 أيام</b></li>` : ''}
          </ul>
        </div>
        <div class="ced-col">
          <div class="ced-lbl" style="margin-bottom:7px">تواريخ الإعلان السابقة</div>
          <div class="ced-grid"><div></div>${['ر1', 'ر2', 'ر3', c.fye === 12 ? 'السنوي' : 'ر4'].map(h => `<div class="h">${h}</div>`).join('')}
            ${years.map(y => `<div class="y">${n(y)}</div>` + [1, 2, 3, 4].map(q => {
              const r = rs.find(r => r.fy === y && r.q === q);
              if (r) return `<div class="ced-cell ${r.sp}" title="${esc(period(r, c))}: ${dmy(r.d)} — بعد ${r.lag} يومًا من نهاية الفترة"><b class="ced-num">${dm(r.d)}</b><small>${n(r.lag)} يوم</small></div>`;
              if (y === x.fy && q === x.q) return `<div class="ced-cell next" title="متوقع"><b class="ced-num">${dm(x.d)}</b><small>متوقع</small></div>`;
              return '<div class="ced-cell none">—</div>';
            }).join('')).join('')}
          </div>
          <div class="ced-legend"><span><i class="fast"></i>أبكر من السوق بأسبوع+</span><span><i class="slow"></i>أبطأ من السوق بأسبوع+</span><span><i class="next"></i>متوقع</span></div>
        </div>
      </div>
      <details class="ced-more"><summary>الإعلانات السابقة${hasProfit ? ' مع النتيجة' : ''} وحركة السهم (${n(rs.length)})</summary>
        <div class="ced-tw" tabindex="0"><table class="ced-table"><thead><tr><th>الفترة</th><th>تاريخ الإعلان</th><th>الوقت</th><th>أيام بعد نهاية الفترة</th>${hasProfit ? '<th>صافي الربح (مليون ريال)</th><th>التغير السنوي</th>' : ''}<th>حركة السهم أول جلسة</th><th>المصدر</th></tr></thead><tbody>
        ${rs.slice(-12).reverse().map(r => `<tr><td>${esc(period(r, c))}</td><td>${wd(r.d)} ${n(dmy(r.d))}</td><td>${n(r.tm || '—')}</td><td>${n(r.lag)}</td>
          ${hasProfit ? `<td>${r.np == null ? '<span class="ced-muted">—</span>' : n(r.np.toLocaleString('en-US', { maximumFractionDigits: 1 }))}</td><td>${pct(r.yoy)}</td>` : ''}<td>${pct(r.rx, 2)}</td>
          <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${SRC[r.src]}</a>` : SRC[r.src]}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="ced-note">الموعد المتوقع = نهاية الفترة + وسيط أيام الإعلان في آخر ثلاث سنوات للفترة نفسها، ويُنقل من الجمعة والسبت إلى أقرب يوم تداول. حركة السهم متاحة منذ 2025.</p></details>`;
  }

  // ترتيب ما بين بطاقات الشركة وجدول النتائج: إعلانات الشركة ← موعد النتائج القادمة ←
  // آخر النتائج المالية (layout.js) ← شريط الفترة. لا يُنقل عنصر إلا إذا خرج عن مكانه،
  // ولا تتحرك البطاقات الأخرى (كل منها يلتصق بما قبله فقط)، فلا تتعارض المراقبات.
  function order(panel, card = document.getElementById('company-earnings')) {
    const anchor = ['company-announcements', 'company-quote', 'company-profile'].map(id => document.getElementById(id)).find(el => el?.parentElement === panel)
      || panel.querySelector(':scope > .bank-heading');
    if (!anchor) return;
    let prev = anchor;
    for (const el of [card, panel.querySelector(':scope > .key-figures-title'), panel.querySelector(':scope > .key-figures'), panel.querySelector(':scope > .period-bar')]) {
      if (!el || (el.parentElement !== panel && el !== card)) continue;
      if (prev.nextElementSibling !== el) prev.after(el);
      prev = el;
    }
  }

  let shown = null;
  async function paint() {
    const panel = document.querySelector('.bank-panel');
    const symbol = panel?.querySelector('.bank-heading .symbol-badge')?.textContent.trim();
    const table = panel?.querySelector(':scope > .table-wrap');
    let box = document.getElementById('company-earnings');
    if (!symbol || !table) return;
    order(panel);
    if (box && shown === symbol) return;
    shown = symbol;
    const c = await load(symbol);
    if (shown !== symbol) return;
    box = document.getElementById('company-earnings');
    if (!c?.recs?.length) { box?.remove(); order(panel); return; }
    if (!box) { box = document.createElement('section'); box.id = 'company-earnings'; box.className = 'company-profile company-earnings'; box.setAttribute('aria-labelledby', 'ced-title'); }
    box.innerHTML = html(c);
    order(panel, box);
  }

  function start() {
    paint();
    new MutationObserver(() => paint()).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
