// خادم وسيط لصفحة «المحلل الذكي» على Cloudflare Workers.
// - يحفظ مفتاح OpenRouter سرًّا (لا يصل للمتصفح أبدًا).
// - يأخذ ملف الشركة المختصر من الموقع نفسه، فلا يستطيع أحد إرسال نصوص ضخمة على حسابك.
// - يحدد عدد الأسئلة لكل زائر في اليوم وسقفًا يوميًا للموقع كله، ويحصر النماذج في المجانية.

// احتياطي فقط: الدور الكامل يأتي من الملف نفسه (pack.system).
const SYSTEM = 'أنت محلل مالي للسوق السعودي. أجب بالعربية باختصار ووضوح بعناوين قصيرة ونقاط. اعتمد فقط على بيانات الشركة المرفقة واذكر الأرقام وتواريخها. لا تقدم توصية شراء أو بيع مباشرة. إذا لم تكفِ البيانات للإجابة فقل ذلك صراحة.';
// نماذج مجانية فقط (:free)، فلا يُخصم أي مبلغ من الرصيد.
const DEFAULT_MODELS = 'nvidia/nemotron-3-ultra-550b-a55b:free,baidu/ernie-5.5-flash-preview:free,dots-studio/dots-3-note-preview:free,inclusionai/ling-3.2-flash:free,nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free';

const json = (body, status, cors, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });

function corsFor(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || 'https://portalnode.github.io').split(',').map(s => s.trim());
  const origin = request.headers.get('Origin') || '';
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-Remaining',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// عدّاد يومي في KV (اختياري؛ بدون KV لا يوجد حد). العد تقريبي وهذا كافٍ هنا.
async function takeQuota(env, ip) {
  if (!env.RATE) return { ok: true, remaining: null };
  const day = new Date().toISOString().slice(0, 10);
  const perIp = Number(env.DAILY_LIMIT || 20), global = Number(env.GLOBAL_DAILY_LIMIT || 1000);
  const ipKey = `ip:${day}:${ip}`, allKey = `all:${day}`;
  const [usedIp, usedAll] = await Promise.all([env.RATE.get(ipKey), env.RATE.get(allKey)]).then(v => v.map(x => Number(x || 0)));
  if (usedAll >= global) return { ok: false, reason: 'تم بلوغ الحد اليومي للموقع. جرّب غدًا.' };
  if (usedIp >= perIp) return { ok: false, reason: `استخدمت أسئلتك اليومية (${perIp}). جرّب غدًا.` };
  await Promise.all([
    env.RATE.put(ipKey, String(usedIp + 1), { expirationTtl: 172800 }),
    env.RATE.put(allKey, String(usedAll + 1), { expirationTtl: 172800 }),
  ]);
  return { ok: true, remaining: perIp - usedIp - 1 };
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsFor(request, env);
    if (!cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!env.OPENROUTER_API_KEY) return json({ error: 'الخدمة غير مهيأة.' }, 503, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'طلب غير صالح.' }, 400, cors); }
    // النطاق: السوق كامل، أو قطاع (slug)، أو شركة (رمز من 4 أرقام). body.symbol للتوافق مع النسخة الأولى.
    const scope = ['market', 'sector', 'company'].includes(body.scope) ? body.scope : 'company';
    const id = String(body.id ?? body.symbol ?? '');
    const question = String(body.question || '').trim();
    if (scope === 'company' && !/^\d{4}$/.test(id)) return json({ error: 'رمز الشركة غير صالح.' }, 400, cors);
    if (scope === 'sector' && !/^[a-z-]{2,40}$/.test(id)) return json({ error: 'القطاع غير صالح.' }, 400, cors);
    const extra = (Array.isArray(body.extra) ? body.extra : []).map(String).filter(x => /^\d{4}$/.test(x) && x !== id).slice(0, 3);
    // المرحلة الثانية لأسئلة الترشيح: ملفات المرشحين الكاملة (حتى 8) بدل جدول السوق أو القطاع.
    const deep = scope === 'company' ? [] : [...new Set((Array.isArray(body.deep) ? body.deep : []).map(String).filter(x => /^\d{4}$/.test(x)))].slice(0, 8);
    if (!question || question.length > 500) return json({ error: 'السؤال فارغ أو أطول من 500 حرف.' }, 400, cors);
    const models = (env.MODELS || DEFAULT_MODELS).split(',').map(s => s.trim());
    const model = models.includes(body.model) ? body.model : models[0];
    // آخر 3 أسئلة وأجوبتها فقط، وبطول محدود.
    const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
      .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2500) }));

    const site = (env.SITE_URL || 'https://portalnode.github.io/saudi-sectors/').replace(/\/?$/, '/');
    const load = async name => { const r = await fetch(`${site}ai/${name}.json`, { cf: { cacheTtl: 600, cacheEverything: true } }); return r.ok ? r.json() : null; };
    const pack = await load(scope === 'market' ? 'market' : scope === 'sector' ? `sector-${id}` : id);
    if (!pack) return json({ error: 'لا توجد بيانات لهذا الاختيار.' }, 404, cors);
    const LABEL = { market: 'جدول السوق كاملًا', sector: 'جدول القطاع', company: 'ملف الشركة' };
    let system = pack.system || SYSTEM, data;
    if (deep.length) {
      const picks = (await Promise.all(deep.map(load))).filter(Boolean);
      if (!picks.length) return json({ error: 'لا توجد بيانات للشركات المرشحة.' }, 404, cors);
      system += `\n\n${pack.deep || ''}`;
      data = `(ملخص ${LABEL[scope]} وملفات المرشحين الكاملة)\n${pack.digest || ''}${picks.map(p => `\n\n--- ملف شركة مرشحة: ${p.name} (${p.symbol}) | القطاع: ${p.sector} ---\n${p.text}`).join('')}`;
    } else {
      const extras = (await Promise.all(extra.map(load))).filter(Boolean);
      if (scope !== 'company' && pack.pick) system += `\n\n${pack.pick}`;
      data = `(${LABEL[scope]})\n${pack.text}${extras.map(p => `\n\n--- ملف شركة ذكرها السائل: ${p.name} (${p.symbol}) ---\n${p.text}`).join('')}`;
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const quota = await takeQuota(env, ip);
    if (!quota.ok) return json({ error: quota.reason }, 429, cors);

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': site,
        'X-Title': 'Saudi Sectors',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: `${system}\n\nالبيانات المرفقة:\n${data}` }, ...history, { role: 'user', content: question }],
        max_tokens: Number(env.MAX_TOKENS || 16000),
        reasoning: { effort: 'medium' },
        temperature: 0.3,
        stream: true,
        usage: { include: true },
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text()).slice(0, 300);
      console.error('OpenRouter error', upstream.status, detail);
      return json({ error: 'تعذّر الوصول إلى نموذج الذكاء الاصطناعي الآن.' }, 502, cors);
    }
    const headers = { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Model': model };
    if (quota.remaining != null) headers['X-Remaining'] = String(quota.remaining);
    return new Response(upstream.body, { status: 200, headers });
  },
};
