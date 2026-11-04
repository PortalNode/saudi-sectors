#!/usr/bin/env node
/** A finite unauthenticated source-access test. Never uses cookies or subscription bypasses. */
import { writeFile } from 'node:fs/promises';

const url = 'https://www.argaam.com/ar/financial-reports/company-report/43/2024/1';
const strip = text => text.replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const result = { url, checkedAt: new Date().toISOString(), authenticated: false, success: false };
console.log('Testing one public annual-report URL without cookies.');
try {
  const response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': 'saudi-sectors-bank-data-test/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  result.httpStatus = response.status;
  const html = await response.text();
  result.title = strip(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const text = strip(html);
  const protectedContent = /يمكنكم الاطلاع على كامل التقرير من خلال الاشتراك|To Access this Content, Please Login or Subscribe/i.test(text);
  if (!response.ok) result.reason = `HTTP ${response.status}`;
  else if (protectedContent) result.reason = 'subscription-required';
  else if (/verify you are human|captcha|access denied/i.test(result.title)) result.reason = 'access-restricted';
  else {
    const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0]);
    const table = tables.find(table => strip(table).includes('دخل العمليات') && strip(table).includes('المخصصات'));
    if (!table) result.reason = 'annual-summary-table-not-returned';
    else {
      result.rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match =>
        [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => strip(cell[1]))
      ).filter(cells => cells.length);
      result.success = result.rows.length >= 8;
      if (!result.success) result.reason = 'incomplete-table';
    }
  }
} catch (error) {
  result.reason = `${error.name}: ${error.message}`;
}
await writeFile('bank-report-access-test.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log(result.success ? 'Public source test succeeded; automatic parser can be evaluated next.' : 'Source test blocked; no production data modified.');
