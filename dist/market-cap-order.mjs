// ترتيب الشركات من الأكبر قيمة سوقية إلى الأصغر في صفحات النتائج والمقارنة.
// القيمة السوقية من آخر لقطة في data.json، وتُستخدم للترتيب فقط ولا تُعرض.

/** خريطة الرمز ← القيمة السوقية من لقطة الأسعار (data.json). */
export function marketCapMap(prices) {
  const caps = new Map();
  for (const sector of prices?.sectors ?? []) {
    for (const stock of sector?.stocks ?? []) {
      const cap = Number(stock?.marketCap);
      if (stock?.symbol && Number.isFinite(cap) && cap > 0) caps.set(String(stock.symbol), cap);
    }
  }
  return caps;
}

/** نسخة مرتبة من الأكبر قيمة سوقية؛ من لا قيمة له يأتي في الآخر بترتيبه الأصلي. */
export function sortByMarketCap(list, caps) {
  if (!caps?.size) return [...list];
  return list
    .map((item, index) => ({ item, index, cap: caps.get(String(item.symbol)) ?? null }))
    .sort((a, b) => (a.cap === null) - (b.cap === null) || (b.cap ?? 0) - (a.cap ?? 0) || a.index - b.index)
    .map(entry => entry.item);
}

/** يقرأ data.json ويعيد خريطة القيم السوقية؛ عند الفشل خريطة فارغة فيبقى ترتيب الملف. */
export async function loadMarketCaps(fetchImpl = fetch) {
  try {
    const response = await fetchImpl('data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return marketCapMap(await response.json());
  } catch (error) {
    console.warn('Market caps unavailable; keeping file order:', error);
    return new Map();
  }
}
