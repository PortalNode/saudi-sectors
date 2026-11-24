// مؤشرات التقييم الحالية في صفحة المقارنة: من data.json نفسه الذي تعرضه الصفحة الرئيسية.
// قيمة واحدة لكل شركة (آخر سعر وآخر أربعة أرباع)، فلا تتغير بالفترة المختارة.
export const MARKET_KEYS = ['mktPe', 'mktBook', 'mktPb', 'mktYield', 'mktCap'];
export const isMarketKey = k => MARKET_KEYS.includes(k);

const num = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** خريطة الرمز ← { mktPe, mktBook, mktPb, mktYield, mktCap }؛ العائد كنسبة (0.035) مثل الهوامش. */
export function marketIndex(prices) {
  const out = new Map();
  for (const sector of prices?.sectors ?? []) {
    for (const s of sector?.stocks ?? []) {
      if (!s?.symbol) continue;
      const price = num(s.price), eps = num(s.eps), book = num(s.bookValue);
      // المكرر كما في الصفحة الرئيسية: السعر ÷ الربحية، ولا مكرر للشركة الخاسرة
      const pe = num(s.pe) ?? (eps > 0 && price > 0 ? price / eps : null);
      const pb = num(s.pb) ?? (book > 0 && price > 0 ? price / book : null);
      const yieldPct = num(s.dividendYield), cap = num(s.marketCap);
      const v = {
        mktPe: pe != null && pe > 0 && !(eps != null && eps < 0) ? pe : null,
        mktBook: book,
        mktPb: pb != null && pb > 0 ? pb : null,
        mktYield: yieldPct == null ? null : yieldPct / 100,
        mktCap: cap != null && cap > 0 ? cap : null,
      };
      if (Object.values(v).some(x => x != null)) out.set(String(s.symbol), v);
    }
  }
  return out;
}

/** تاريخ اللقطة (YYYY-MM-DD) كما في data.json. */
export const marketDate = prices => String(prices?.asOf || '').slice(0, 10) || null;
