# خادم «المحلل الذكي»

صفحة `dist/ai-analyst.html` لا تحتوي على أي مفتاح. ترسل السؤال ورمز الشركة إلى هذا الخادم الوسيط على Cloudflare Workers، وهو يضيف مفتاح OpenRouter وملف الشركة المختصر (`ai/<الرمز>.json`) ثم يمرر الإجابة للصفحة.

## التشغيل لأول مرة (حوالي 10 دقائق، مجاني)

1. أنشئ حسابًا مجانيًا في Cloudflare، ثم من مجلد المشروع:

   ```bash
   cd worker
   ```

   ```bash
   npx wrangler login
   ```

2. أنشئ عدّاد الحدود اليومية، وانسخ الـ `id` الناتج إلى `wrangler.toml` في قسم `[[kv_namespaces]]` (أزل علامات `#`):

   ```bash
   npx wrangler kv namespace create RATE
   ```

3. أضف مفتاح OpenRouter سرًّا (يُطلب منك لصقه، ولا يُحفظ في أي ملف):

   ```bash
   npx wrangler secret put OPENROUTER_API_KEY
   ```

4. انشر الخادم:

   ```bash
   npx wrangler deploy
   ```

   سيظهر رابط مثل `https://saudi-sectors-ai.<اسمك>.workers.dev`.

5. ضع الرابط في `dist/ai-config.js`:

   ```js
   window.AI_ENDPOINT = 'https://saudi-sectors-ai.<اسمك>.workers.dev';
   ```

   ثم ارفع التعديل إلى main.

## الحماية من حرق الرصيد

- **في OpenRouter:** ضع حدًّا للإنفاق على المفتاح نفسه (Settings → Keys → Credit limit)، مثلًا 5 دولارات. هذا أهم إجراء.
- **في الخادم** (`wrangler.toml`):
  - `DAILY_LIMIT`: عدد أسئلة كل زائر في اليوم، والافتراضي 20.
  - `GLOBAL_DAILY_LIMIT`: سقف الموقع كله في اليوم، والافتراضي 1000.
  - `MAX_TOKENS`: أقصى طول للإجابة.
  - `MODELS`: النماذج المسموحة، وأولها هو الافتراضي.
- الخادم يقبل الطلبات فقط من المواقع المذكورة في `ALLOWED_ORIGINS`، ويرفض أي سؤال أطول من 500 حرف، ويأخذ بيانات الشركة من الموقع بنفسه ولا يقبلها من الزائر.

## التكلفة التقريبية

السؤال الواحد حوالي 2,300 توكن دخل (البيانات المالية والفنية ودور المحلل) وحتى 1,500 توكن خرج. مع `deepseek/deepseek-v4.1-flash` تكون التكلفة حوالي 0.0025 دولار، أي قرابة 400 سؤال بدولار واحد.
