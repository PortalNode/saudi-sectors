// Pure indicator maths for the scanner and its backtests. No DOM, no I/O, no globals: the same file
// runs in the browser and in Node. Every function takes plain arrays and returns an array of the
// same length, with null until enough data exists (so index i only ever depends on values 0..i).
// SMA, EMA, RSI and MACD follow the definitions in dist/company-chart.js (TradingView's); a test
// pins them to that file so the scanner and the chart can never disagree.

export function sma(values, n) {
  const out = []; let sum = 0, run = 0;
  values.forEach((v, i) => {
    if (v == null) { sum = 0; run = 0; out.push(null); return; }
    sum += v; run += 1;
    if (run > n) { sum -= values[i - n]; run = n; }
    out.push(run === n ? sum / n : null);
  });
  return out;
}

export function ema(values, n) {
  const k = 2 / (n + 1), out = []; let prev = null, run = [];
  for (const v of values) {
    if (v == null) { out.push(null); run = []; continue; }
    if (prev == null) { run.push(v); if (run.length === n) prev = run.reduce((a, b) => a + b, 0) / n; out.push(prev); continue; }
    prev = v * k + prev * (1 - k); out.push(prev);
  }
  return out;
}

// Wilder smoothing as in TradingView.
export function rsi(values, n = 14) {
  const out = [null]; let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)); } else out.push(null); }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)); }
  }
  return out;
}

export function macd(values, fastLen = 12, slowLen = 26, signalLen = 9) {
  const fast = ema(values, fastLen), slow = ema(values, slowLen);
  const line = values.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null);
  const signal = ema(line, signalLen);
  return line.map((m, i) => m == null ? null : { macd: m, signal: signal[i], hist: signal[i] == null ? null : m - signal[i] });
}

// Rate of change over n bars, in percent.
export function roc(values, n) {
  return values.map((v, i) => i >= n && v != null && values[i - n] ? (v / values[i - n] - 1) * 100 : null);
}

// True range needs the previous close, so the first bar uses high - low.
export function trueRange(high, low, close) {
  return high.map((h, i) => i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1])));
}

// Wilder's ATR: the first value is the plain average of the first n true ranges.
export function atr(high, low, close, n = 14) {
  const tr = trueRange(high, low, close), out = new Array(tr.length).fill(null);
  if (tr.length < n) return out;
  let prev = 0; for (let i = 0; i < n; i++) prev += tr[i]; prev /= n; out[n - 1] = prev;
  for (let i = n; i < tr.length; i++) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
  return out;
}

// Wilder's ADX with the +DI and -DI lines. Needs 2n bars before the first ADX value.
export function adx(high, low, close, n = 14) {
  const len = high.length, nul = () => new Array(len).fill(null);
  const out = { adx: nul(), plusDI: nul(), minusDI: nul() };
  if (len <= n) return out;
  const tr = trueRange(high, low, close), pdm = [0], mdm = [0];
  for (let i = 1; i < len; i++) {
    const up = high[i] - high[i - 1], down = low[i - 1] - low[i];
    pdm.push(up > down && up > 0 ? up : 0); mdm.push(down > up && down > 0 ? down : 0);
  }
  let sTr = 0, sP = 0, sM = 0;
  for (let i = 1; i <= n; i++) { sTr += tr[i]; sP += pdm[i]; sM += mdm[i]; }
  const dx = [];
  const push = i => {
    const p = sTr ? 100 * sP / sTr : 0, m = sTr ? 100 * sM / sTr : 0;
    out.plusDI[i] = p; out.minusDI[i] = m; dx.push(p + m ? 100 * Math.abs(p - m) / (p + m) : 0);
  };
  push(n);
  for (let i = n + 1; i < len; i++) { sTr = sTr - sTr / n + tr[i]; sP = sP - sP / n + pdm[i]; sM = sM - sM / n + mdm[i]; push(i); }
  // dx[k] belongs to bar n + k; ADX is the Wilder average of n dx values.
  if (dx.length >= n) {
    let a = 0; for (let k = 0; k < n; k++) a += dx[k]; a /= n; out.adx[2 * n - 1] = a;
    for (let k = n; k < dx.length; k++) { a = (a * (n - 1) + dx[k]) / n; out.adx[n + k] = a; }
  }
  return out;
}

export function bollinger(values, n = 20, mult = 2) {
  const mid = sma(values, n);
  return values.map((_, i) => {
    if (mid[i] == null) return null;
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    return { mid: mid[i], up: mid[i] + mult * sd, low: mid[i] - mult * sd, width: mid[i] ? 2 * mult * sd / mid[i] : null };
  });
}

// Highest / lowest of the n bars BEFORE bar i (bar i itself excluded), which is what a breakout is
// measured against: a close above the highest close of the previous n sessions.
export function priorHighest(values, n) {
  return values.map((_, i) => { if (i < n) return null; let m = -Infinity; for (let j = i - n; j < i; j++) { if (values[j] == null) return null; if (values[j] > m) m = values[j]; } return m; });
}
export function priorLowest(values, n) {
  return values.map((_, i) => { if (i < n) return null; let m = Infinity; for (let j = i - n; j < i; j++) { if (values[j] == null) return null; if (values[j] < m) m = values[j]; } return m; });
}

// Share of the previous n values (excluding bar i) that are below bar i's value, 0..100.
export function percentRank(values, n) {
  return values.map((v, i) => {
    if (i < n || v == null) return null;
    let below = 0; for (let j = i - n; j < i; j++) { if (values[j] == null) return null; if (values[j] < v) below += 1; }
    return 100 * below / n;
  });
}

// Simple slope: change over `n` bars as a fraction of the older value.
export function slope(values, n) {
  return values.map((v, i) => i >= n && v != null && values[i - n] ? v / values[i - n] - 1 : null);
}
