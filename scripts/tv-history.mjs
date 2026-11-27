// A stock's full daily history from TradingView's chart feed (the same data the TradingView chart
// draws, read without an account): two series per stock in one session —
//   splits:    closes adjusted for capital actions only (bonus shares, splits, rights issues)
//   dividends: the same closes also back-adjusted for cash dividends (TradingView's "ADJ")
// Both are on the basis of the latest bar: only ratios between dates mean anything.
const URL_WS = 'wss://data.tradingview.com/socket.io/websocket?type=chart';
const frame = (m, p) => { const s = JSON.stringify({ m, p }); return `~m~${s.length}~m~${s}`; };
const iso = seconds => new Date((seconds + 3 * 3600) * 1000).toISOString().slice(0, 10); // Riyadh

/** { splits: [{d, o, c}], dividends: [{d, o, c}] } for `TADAWUL:<symbol>`; rejects on error or timeout. */
export function tvDailyHistory(symbol, { bars = 20000, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_WS, { headers: { Origin: 'https://www.tradingview.com' } });
    const series = { splits: null, dividends: null }, got = { s1: [], s2: [] };
    const done = (error, value) => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => done(new Error('TradingView timeout')), timeoutMs);
    ws.onerror = () => done(new Error('TradingView connection failed'));
    ws.onmessage = event => {
      for (const part of String(event.data).split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith('~h~')) { ws.send(`~m~${part.length}~m~${part}`); continue; } // heartbeat
        let msg; try { msg = JSON.parse(part); } catch { continue; }
        if (msg.session_id) {
          ws.send(frame('set_auth_token', ['unauthorized_user_token']));
          ws.send(frame('chart_create_session', ['cs_1', '']));
          ws.send(frame('resolve_symbol', ['cs_1', 'y1', '=' + JSON.stringify({ symbol: `TADAWUL:${symbol}`, adjustment: 'splits', session: 'regular' })]));
          ws.send(frame('create_series', ['cs_1', 's1', 's1', 'y1', '1D', bars, '']));
          continue;
        }
        if (msg.m === 'symbol_error' || msg.m === 'series_error' || msg.m === 'critical_error' || msg.m === 'protocol_error') return done(new Error(`TradingView ${msg.m}: ${JSON.stringify(msg.p?.slice?.(1) ?? msg.p)}`));
        if (msg.m === 'timescale_update') for (const id of ['s1', 's2']) if (msg.p?.[1]?.[id]?.s) got[id] = msg.p[1][id].s.map(x => x.v);
        if (msg.m === 'series_completed') {
          const id = msg.p?.[1];
          if (id === 's1' && !series.splits) {
            series.splits = got.s1;
            // One series per chart session: the dividend-adjusted one gets a second session.
            ws.send(frame('chart_create_session', ['cs_2', '']));
            ws.send(frame('resolve_symbol', ['cs_2', 'y2', '=' + JSON.stringify({ symbol: `TADAWUL:${symbol}`, adjustment: 'dividends', session: 'regular' })]));
            ws.send(frame('create_series', ['cs_2', 's2', 's2', 'y2', '1D', bars, '']));
          } else if (id === 's2') {
            series.dividends = got.s2;
            const toBars = rows => rows.filter(v => Number.isFinite(v?.[4]) && v[4] > 0).map(v => ({ d: iso(v[0]), o: v[1], c: v[4] }));
            done(null, { splits: toBars(series.splits), dividends: toBars(series.dividends) });
          }
        }
      }
    };
  });
}
