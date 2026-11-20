// تنظيم فحوى إعلان تداول: يحوّل النص الخام (سطور «البند: القيمة» وجداول الأرقام والقوائم والفقرات)
// إلى بنية يعرضها company-announcements.js، ويستخرج «أبرز النقاط» من الحقول المعروفة.
// دوال صرفة بلا DOM حتى تُختبر في Node (tests/announcement-format.test.mjs).

const NUM = /^(?:-|[-+]?\d[\d,]*(?:\.\d+)?)$/;
const BULLET = /^(?:[•●▪◦·]|[-–]\s|\d{1,2}[.)])\s*/;
const KEY_VALUE = /^([^:]{2,260}?)\s*:\s*(.*)$/;
const DATE_PAIR = /^(\d{4}-\d{2}-\d{2})\s*الموافق\s*(\d{4}-\d{2}-\d{2})$/;
const LEAD_KEYS = new Set(['مقدمة', 'تفاصيل الإعلان']);
const SKIP_LINES = new Set(['الملفات الملحقة']);
const LONG_FIELD = 150;

const endsSentence = text => /[.؟!۔]$/.test(text);

// يضم أسطرًا مقطّعة إلى فقرات: سطر لا ينتهي بنقطة يُكمَل بما بعده
function paragraphs(lines) {
  const out = [];
  for (const line of lines) {
    if (out.length && !endsSentence(out[out.length - 1])) out[out.length - 1] += ` ${line}`;
    else out.push(line);
  }
  return out;
}

export function parseBody(text) {
  const lead = [], fields = [], tables = [];
  let last = null, group = null;

  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || SKIP_LINES.has(line)) continue;

    // صف أرقام: «البند: الحالي: المماثل: التغير ...»
    const parts = line.split(/\s*:\s*/);
    if (parts.length >= 3 && parts.length <= 7 && parts[0].length > 1 && !/وقت|الساعة|موعد/.test(parts[0]) && parts.slice(1).every(p => NUM.test(p))) {
      const values = parts.slice(1);
      if (!group || group.cols !== values.length) { group = { cols: values.length, rows: [] }; tables.push(group); }
      group.rows.push({ label: parts[0], values });
      last = null;
      continue;
    }
    group = null;

    const bullet = line.match(BULLET);
    if (bullet && last) { (last.items ||= []).push(line.slice(bullet[0].length)); continue; }

    const kv = line.match(KEY_VALUE);
    if (kv && kv[1].split(' ').length <= 40 && !/^(https?|ftp)$/i.test(kv[1]) && !kv[2].startsWith('//')) {
      last = { key: kv[1].trim(), lines: kv[2].trim() ? [kv[2].trim()] : [] };
      fields.push(last);
      continue;
    }
    if (last) last.lines.push(line); else lead.push(line);
  }

  const out = { lead: [], tables: [], fields: [], notes: [], rawTables: tables };
  out.lead = paragraphs(lead);
  for (const field of fields) {
    const paras = paragraphs(field.lines);
    if (LEAD_KEYS.has(field.key)) { out.lead.push(...paras); continue; }
    const value = paras.join('\n');
    const date = value.match(DATE_PAIR);
    const item = { key: field.key, paras, items: field.items || [], value };
    if (date) item.date = { hijri: date[1], greg: date[2] };
    if (/^مرفق$/.test(value)) item.attached = true;
    // الحقل الطويل يُعرض فقرة تحت عنوانه بدل خانة في الشبكة
    (value.length > LONG_FIELD || paras.length > 1 || item.items.length ? out.notes : out.fields).push(item);
  }
  out.tables = tables.map((table, index) => ({
    kind: table.cols >= 4 ? 'quarter' : 'period',
    title: table.cols >= 4 ? 'الربع' : (tables[index - 1]?.cols >= 4 ? 'الفترة التراكمية' : 'الفترة المالية'),
    heads: table.cols >= 5 ? ['الربع الحالي', 'الربع المماثل من العام السابق', 'التغير %', 'الربع السابق', 'التغير %']
      : table.cols === 4 ? ['الحالي', 'المماثل', 'التغير %', 'السابق']
      : table.cols === 3 ? ['الفترة الحالية', 'الفترة المماثلة', 'التغير %'] : ['الحالي', 'المماثل'],
    rows: table.rows
  }));
  delete out.rawTables;
  return out;
}

const field = (parsed, pattern) => [...parsed.fields, ...parsed.notes].find(f => pattern.test(f.key));
const dateText = f => f?.date ? { value: f.date.greg, date: f.date } : f ? { value: f.value } : null;

function findRow(parsed, patterns) {
  for (const pattern of patterns) {
    for (const table of parsed.tables) {
      const rows = table.rows.filter(row => pattern.test(row.label) && NUM.test(row.values[0]) && row.values[0] !== '-');
      const row = rows.find(r => /مساهمي/.test(r.label)) || rows[0];
      if (row) return { row, table };
    }
  }
  return null;
}

function resultTile(parsed, label, patterns) {
  const hit = findRow(parsed, patterns);
  if (!hit) return null;
  const change = hit.row.values.length >= 3 && hit.row.values[2] !== '-' ? Number(hit.row.values[2].replace(/,/g, '')) : null;
  return {
    label, value: hit.row.values[0], rowLabel: hit.row.label,
    change: Number.isFinite(change) ? change : null,
    versus: hit.table.kind === 'quarter' ? 'الربع المماثل' : 'الفترة المماثلة'
  };
}

// أبرز النقاط: حتى أربع خانات من الحقول المعروفة، وإلا أول حقول التواريخ والمبالغ والنسب
export function keyPoints(parsed, title = '') {
  const tiles = [];
  const add = (label, f, extra = {}) => { const v = dateText(f); if (v && v.value && !f.attached) tiles.push({ label, ...v, src: f.key, ...extra }); };

  if (parsed.tables.length) {
    for (const tile of [
      resultTile(parsed, 'صافي الربح', [/^صافي (الربح|الدخل)/]),
      resultTile(parsed, 'الإيرادات', [/^(المبيعات|الايرادات|الإيرادات)/, /^إجمالي (الإيرادات|الايرادات|دخل العمليات|ربح \(خسارة\) العمليات)/, /^إجمالي دخل العمولات/]),
      resultTile(parsed, 'ربحية السهم', [/ربحية/])
    ]) if (tile) tiles.push(tile);
    return tiles;
  }

  if (/توزيع/.test(title)) {
    add('حصة السهم', field(parsed, /حصة السهم/));
    add('إجمالي التوزيع', field(parsed, /(اجمالي|إجمالي) المبلغ/));
    add('تاريخ الأحقية', field(parsed, /تاريخ الأحقية/));
    add('تاريخ التوزيع', field(parsed, /تاريخ التوزيع/));
  } else if (/الجمعية العامة|جمعية عمومية/.test(title)) {
    add('تاريخ الاجتماع', field(parsed, /^تاريخ (انعقاد|الاجتماع)/));
    add('نسبة الحضور', field(parsed, /نسبة الحضور/));
  } else if (/استقالة|تعيين|تكليف/.test(title)) {
    add('المستقيل', field(parsed, /اسم الشخص المستقيل/));
    add('المعيَّن', field(parsed, /اسم الشخص المعي/));
    add('تاريخ المباشرة', field(parsed, /تاريخ مباشرة/));
  }

  if (!tiles.length && /توقيع|اتفاقية|عقد|ترسية|بيع|استحواذ|تمويل|تسهيلات|زيادة رأس المال/.test(title)) {
    const text = [...parsed.lead, ...parsed.notes.flatMap(n => n.paras)].join(' ');
    const money = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(مليون|مليار|ألف)?\s*(ريال|دولار)/);
    if (money) tiles.push({ label: 'مبلغ ورد في الإعلان', value: money[0].replace(/\s+/g, ' ') });
  }

  if (tiles.length < 2) {
    const picked = new Set(tiles.map(t => t.label));
    for (const f of parsed.fields) {
      if (tiles.length >= 4) break;
      if (!/^(تاريخ|قيمة|مبلغ|نسبة|حصة|عدد|مدة|إجمالي|اجمالي)/.test(f.key) || /السابق|رابط|التكاليف/.test(f.key) || f.attached) continue;
      if (picked.has(f.key)) continue;
      const v = dateText(f);
      if (v?.value) { tiles.push({ label: f.key, ...v, src: f.key }); picked.add(f.key); }
    }
  }
  return tiles.slice(0, 4);
}
