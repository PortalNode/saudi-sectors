// تعديل الأسعار للتوزيعات النقدية بنفس صيغة الشارت (ADJ كما في TradingView، dist/company-chart.js → adjustDividends):
// كل سعر قبل تاريخ الاستحقاق يُضرب في (1 − التوزيع ÷ إغلاق الجلسة السابقة له). الحجم لا يتغير.
// الماسح يحسب كل مفاتيحه ومناطق الدعم والمقاومة على هذه السلسلة المعدّلة حتى تطابق ما يراه المستخدم في الشارت (ADJ مفعّل افتراضياً)؛
// وإلا ظهر قاع حقيقي مرتين: مرة في الأسعار الاسمية ومرة في المعدّلة، وانزاحت المنطقة عن الشموع المعروضة.
// دالة نقية: تأخذ إغلاقات خام وتواريخ وتوزيعات [[تاريخ، مبلغ]] وتعيد معاملاً لكل شمعة (1 بلا تعديل).
export function dividendFactors(dates, close, dividends = []) {
  const factor = new Array(dates.length).fill(1);
  for (const [date, amount] of dividends) {
    const i = dates.findIndex(d => d >= date);
    if (i <= 0 || !(amount > 0) || !(close[i - 1] > amount)) continue;
    const f = 1 - amount / close[i - 1];
    for (let j = 0; j < i; j++) factor[j] *= f;
  }
  return factor;
}

// يعيد { o, h, l, c } معدّلة (والتواريخ والحجم كما هي)
export function adjustCandles({ d, o, h, l, c }, dividends = []) {
  const f = dividendFactors(d, c, dividends), mul = a => a.map((x, i) => f[i] === 1 ? x : x * f[i]);
  return { o: mul(o), h: mul(h), l: mul(l), c: mul(c), factor: f };
}
