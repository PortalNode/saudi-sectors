// A provider's reported 52-week extremes are used as-is, never inferred from
// a percentage, a close, or an incomplete history. Low === high is legitimate
// for a newly listed or very thinly traded security.
const positiveFinite = value => Number.isFinite(value) && value > 0;

function validPair(low, high) {
  return positiveFinite(low) && positiveFinite(high) && low <= high;
}

function contains(low, high, price) {
  return positiveFinite(price) && low <= price && price <= high;
}

/**
 * Apply the first usable provider pair. Each candidate must contain both its
 * own provider's last price and the site's displayed price. No tolerance or
 * artificial expansion is applied to accommodate disagreement between feeds.
 * Retain a valid old pair on transient failures if still compatible with the
 * displayed price; otherwise leave both fields null rather than mislead.
 */
export function applyWeek52Range(stock, candidates = []) {
  for (const { low, high, referencePrice, source, checkedAt } of candidates) {
    if (validPair(low, high) && contains(low, high, referencePrice) && contains(low, high, stock.price)) {
      stock.week52Low = low;
      stock.week52High = high;
      if (source) stock.week52Source = source; else delete stock.week52Source;
      if (checkedAt) stock.week52CheckedAt = checkedAt; else delete stock.week52CheckedAt;
      return 'updated';
    }
  }

  const oldPairValid = validPair(stock.week52Low, stock.week52High);
  if (oldPairValid && contains(stock.week52Low, stock.week52High, stock.price)) return 'retained';

  stock.week52Low = null;
  stock.week52High = null;
  delete stock.week52Source;
  delete stock.week52CheckedAt;
  return oldPairValid ? 'incompatible' : 'unavailable';
}
