// Reading and writing a stock's candles as two files (see splitFile in ohlc-merge.mjs):
// <dir>/<symbol>.json (recent sessions) and <dir>/history/<symbol>.json (everything earlier).
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { splitFile, joinFiles } from './ohlc-merge.mjs';

const readJson = async url => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; } };
const recentUrl = (dir, symbol) => new URL(`${symbol}.json`, dir);
const historyUrl = (dir, symbol) => new URL(`history/${symbol}.json`, dir);

/** The stored full candle file for `symbol`, or null. */
export async function readCandles(dir, symbol) {
  const recent = await readJson(recentUrl(dir, symbol));
  if (!recent) return null;
  return recent.historyThrough ? joinFiles(recent, await readJson(historyUrl(dir, symbol))) : recent;
}

/** Store a full candle file as its two parts; a part is written only when it changed. Returns files written. */
export async function writeCandles(dir, file) {
  const { recent, history } = splitFile(file);
  let written = 0;
  const put = async (url, value) => {
    const text = JSON.stringify(value) + '\n';
    let before = null; try { before = await readFile(url, 'utf8'); } catch { /* new */ }
    if (before !== text) { await writeFile(url, text); written += 1; }
  };
  if (history) { await mkdir(new URL('history/', dir), { recursive: true }); await put(historyUrl(dir, file.symbol), history); }
  else await rm(historyUrl(dir, file.symbol), { force: true });
  await put(recentUrl(dir, file.symbol), recent);
  return written;
}
