"""
البنود الموحدة لكل نوع قطاع، وأنماط البحث عنها في بنود XBRL.
- from: الأنماط بالترتيب (نص مطابق تمامًا، أو re: لتعبير نمطي)؛ يؤخذ أول بند له قيمة في الفترة.
- mode "sum": مجموع كل البنود المطابقة المختلفة (all=True) أو أول بند لكل نمط.
- sign "out": مبلغ خارج من النقد، يُعرض بالسالب دائمًا.
- calc: بند محسوب من بنود أخرى (needs).
"""


def _sum(*xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) if xs else None


def _sub(a, b):
    return None if a is None or b is None else a - b


def _ratio(a, b):
    return None if a is None or not b else a / b


def _positive_ratio(a, b):
    """نسبة لا معنى لها بمقام سالب أو صفر (حقوق ملكية سالبة، مطلوبات متداولة صفر)."""
    return None if a is None or b is None or b <= 0 else a / b


def _total_debt(short, long, equity):
    # بلا أي بند قروض في مركز مالي تفصيلي موجود من ملف الشركة (حقوق الملكية منه علامة على وجوده) = شركة بلا قروض
    if short is None and long is None:
        return 0.0 if equity is not None else None
    return _sum(short, long)


# بنود القروض بأسمائها المختلفة في ملفات الشركات (الإيجارات لا تُحسب دَينًا)
SHORT_DEBT = [r"re:^قروض قصيرة الأجل|^قروض (بنكية )?قصيرة|^مرابحات، متداولة|^قروض - متداولة|^القروض والسلف, المتداولة|^قروض بنكية متداولة",
              r"re:^قسط متداول من قروض طويلة الأجل|^الجزء المتداول من (ال)?قروض"]
LONG_DEBT = ["سندات دين وقروض لأجل وقروض وصكوك مصدرة",
             r"re:^سندات دين وقرو?ض|^قروض طويلة الأجل|^قروض - غير متداولة|^القروض والسلف, غير المتداولة|^مرابحات، غير متداولة|^قروض مرابحة طويلة|^قروض بنكية غير( ال)?متداولة|^قروض لأجل$|^قرض صندوق التنمية|^تسهيلات قروض|^مرابحات$"]


def leverage_items(debt_key):
    """مؤشرات السيولة والمديونية للشركات غير البنوك."""
    return [
        {"key": "currentRatio", "label": "نسبة التداول", "group": "مؤشرات محسوبة", "unit": "times", "needs": ["currentAssets", "currentLiabilities"], "calc": _positive_ratio},
        {"key": "cashToCurrentLiabilities", "label": "النقد إلى الالتزامات المتداولة", "group": "مؤشرات محسوبة", "unit": "times", "needs": ["cash", "currentLiabilities"], "calc": _positive_ratio},
        {"key": "debtToEquity", "label": "الديون إلى حقوق الملكية", "group": "مؤشرات محسوبة", "unit": "ratio", "needs": [debt_key, "totalEquity"], "calc": _positive_ratio},
        {"key": "debtToAssets", "label": "الديون إلى إجمالي الأصول", "group": "مؤشرات محسوبة", "unit": "ratio", "needs": [debt_key, "totalAssets"], "calc": _positive_ratio},
    ]


CFO = r"re:^صافي التدفقات النقدية من \(المستخدمة في\) النشاطات التشغيلية"
CFI = r"re:^صافي التدفقات النقدية من \(المستخدمة في\) النشاطات الاستثمارية"
CFF = r"re:^صافي التدفقات النقدية من \(المستخدمة في\) النشاطات التمويلية"
NET_CHANGE = r"re:^صافي الزيادة \(النقص\) في النقدية وشبه النقدية"
CASH_END = r"re:^النقدية وشبه النقدية في نهاية الفترة"
PBT = ["ربح (خسارة) الفترة قبل الزكاة وضريبة الدخل", "الربح (الخسارة) قبل الزكاة وضريبة الدخل",
       r"re:^الربح \(الخسارة\) قبل الزكاة وضريبة الدخل", r"re:^ربح \(خسارة\) الفترة قبل الزكاة",
       r"re:^الربح \(الخسارة\) من العمليات المستمرة قبل الزكاة"]
# «مدفوعة (عدا لحقوق الملكية غير مسيطرة)» هي توزيعات المساهمين؛ «مدفوعة لحقوق ملكية غير مسيطرة» ليست منها
DIVIDENDS = [r"re:^توزيعات [أا]رباح مدفوعة(?! ?(ل|إلى |الى )(حقوق|ال?حصص))", r"re:^(ال)?مسدد من دائن[وي] توزيعات"]
# شركات بلا حصص غير مسيطرة تضع توزيعات مساهميها أحيانًا تحت بند «لحقوق ملكية غير مسيطرة»
DIVIDENDS_NO_NCI = [r"re:^توزيعات [أا]رباح مدفوعة"]
CAPEX = ["شراء ممتلكات وآلات ومعدات", r"re:^شراء ممتلكات و(آلات و)?معدات", r"re:^(إضافات|اضافات) (إلى|الى|على) (ال)?ممتلكات"]

TOTAL_ASSETS = {"key": "totalAssets", "label": "إجمالي الموجودات", "from": ["إجمالي الموجودات"], "total": True}
TOTAL_LIAB = {"key": "totalLiabilities", "label": "إجمالي المطلوبات", "from": ["إجمالي المطلوبات"], "total": True}
CAPITAL = {"key": "capital", "label": "رأس المال", "from": ["رأس المال", r"re:^رأس المال$|^رأس مال"]}
RETAINED = {"key": "retained", "label": "أرباح مبقاة (خسائر متراكمة)", "from": ["أرباح مبقاة (خسائر متراكمة)", r"re:^(ال)?أرباح (ال)?مبقاة|^(ال)?خسائر (ال)?متراكمة"]}
TOTAL_EQUITY = {"key": "totalEquity", "label": "إجمالي حقوق الملكية", "from": ["إجمالي حقوق الملكية"], "total": True}

CF_TAIL = [
    {"key": "netChange", "label": "صافي التغير في النقد", "from": [NET_CHANGE], "group": "النقد"},
    {"key": "cashEnd", "label": "النقد آخر الفترة", "from": [CASH_END], "balance": True, "group": "النقد", "total": True},
]

NORMAL = {
    "bs": [
        {"key": "cash", "label": "النقد وما في حكمه", "group": "الموجودات",
         "from": ["النقد وما في حكمه", "النقدية وشبه النقدية", "أرصدة لدى البنوك ونقد في الصندوق", r"re:^(ال)?نقد(ية)? و(ما (في|يماثله|يعادله)|معادلات|شبه)|^(ال)?نقدية وشبه|^نقد وأرصدة لدى البنوك|^(ال)?نقد لدى البنوك"]},
        {"key": "receivables", "label": "مدينون تجاريون", "group": "الموجودات",
         "from": ["مدينون تجاريون", r"re:^مدينون تجاريون|^ذمم مدينة تجارية"]},
        {"key": "inventory", "label": "المخزون", "group": "الموجودات", "from": ["المخزون", r"re:^المخزون|^مخزون"]},
        {"key": "currentAssets", "label": "إجمالي الموجودات المتداولة", "group": "الموجودات", "from": ["إجمالي الموجودات المتداولة"], "total": True},
        {"key": "ppe", "label": "ممتلكات وآلات ومعدات", "group": "الموجودات",
         "from": ["ممتلكات وآلات ومعدات", r"re:^ممتلكات و(آلات و)?معدات"]},
        {**TOTAL_ASSETS, "group": "الموجودات"},
        {"key": "shortDebt", "label": "قروض قصيرة الأجل والجزء المتداول", "group": "المطلوبات", "mode": "sum", "from": SHORT_DEBT},
        {"key": "payables", "label": "دائنون تجاريون", "group": "المطلوبات", "from": ["دائنون تجاريون", r"re:^دائنون تجاريون|^ذمم دائنة تجارية"]},
        {"key": "currentLiabilities", "label": "إجمالي المطلوبات المتداولة", "group": "المطلوبات", "from": ["إجمالي المطلوبات المتداولة"], "total": True},
        {"key": "longDebt", "label": "قروض طويلة الأجل وصكوك", "group": "المطلوبات", "from": LONG_DEBT},
        {**TOTAL_LIAB, "group": "المطلوبات"},
        {**CAPITAL, "group": "حقوق الملكية"},
        {**RETAINED, "group": "حقوق الملكية"},
        {"key": "parentEquity", "label": "حقوق ملاك الشركة الأم", "group": "حقوق الملكية",
         "from": ["حقوق الملكية المتعلقة بملاك الشركة الأم", r"re:^(إجمالي )?حقوق الملكية المتعلقة بملاك الشركة الأم|^(إجمالي )?حقوق الملكية (العائدة|المتعلقة) (ل|ب)مساهمي", "إجمالي حقوق الملكية"]},
        {**TOTAL_EQUITY, "group": "حقوق الملكية"},
        {"key": "totalDebt", "label": "إجمالي الديون", "group": "مؤشرات محسوبة", "needs": ["shortDebt", "longDebt", "totalEquity"], "calc": _total_debt},
        {"key": "netDebt", "label": "صافي الدين (السالب = فائض نقدي)", "group": "مؤشرات محسوبة", "needs": ["totalDebt", "cash"], "calc": _sub},
        {"key": "workingCapital", "label": "رأس المال العامل", "group": "مؤشرات محسوبة", "needs": ["currentAssets", "currentLiabilities"], "calc": _sub},
        *leverage_items("totalDebt"),
    ],
    "cf": [
        {"key": "pbt", "label": "الربح قبل الزكاة والضريبة", "group": "الأنشطة التشغيلية", "from": PBT},
        {"key": "da", "label": "الاستهلاك والإطفاء", "group": "الأنشطة التشغيلية", "mode": "sum", "all": True,
         "from": [r"re:^التعديلات على (ال)?استهلاك|^التعديلات على (ال)?إطفاء|^تعديلات على (ال)?استهلاك|^تعديلات على (ال)?إطفاء"]},
        {"key": "workingCapitalChange", "label": "التغير في رأس المال العامل", "group": "الأنشطة التشغيلية",
         "from": ["صافي الزيادة (النقص) بسبب التغيرات في رأس المال العامل", r"re:^(صافي|إجمالي) .*التغيرات في رأس المال العامل"]},
        {"key": "cfo", "label": "صافي النقد من الأنشطة التشغيلية", "group": "الأنشطة التشغيلية", "from": [CFO], "total": True},
        {"key": "capex", "label": "الإنفاق الرأسمالي", "group": "الأنشطة الاستثمارية", "from": CAPEX, "sign": "out"},
        {"key": "cfi", "label": "صافي النقد من الأنشطة الاستثمارية", "group": "الأنشطة الاستثمارية", "from": [CFI], "total": True},
        {"key": "dividends", "label": "توزيعات أرباح مدفوعة", "group": "الأنشطة التمويلية", "from": DIVIDENDS, "fallbackNoNci": DIVIDENDS_NO_NCI, "sign": "out"},
        {"key": "cff", "label": "صافي النقد من الأنشطة التمويلية", "group": "الأنشطة التمويلية", "from": [CFF], "total": True},
        *CF_TAIL,
        {"key": "fcf", "label": "التدفق النقدي الحر", "group": "مؤشرات محسوبة", "needs": ["cfo", "capex"],
         "calc": lambda a, b: None if a is None or b is None else a + b},
    ],
}

BANK = {
    "bs": [
        {"key": "cashCentralBank", "label": "نقد وأرصدة لدى البنك المركزي", "group": "الموجودات",
         "from": ["نقد وأرصدة لدى مؤسسة النقد العربي السعودي", r"re:^نقد(ية)? وأرصدة لدى (مؤسسة النقد|البنك المركزي|ساما)"]},
        {"key": "dueFromBanks", "label": "أرصدة لدى البنوك", "group": "الموجودات", "from": [r"re:^أرصدة مستحقة من (ال)?بنوك"]},
        {"key": "investments", "label": "الاستثمارات", "group": "الموجودات", "from": ["استثمارات، صافي", r"re:^استثمارات، صافي|^الاستثمارات، صافي|^استثمارات$"]},
        {"key": "loans", "label": "القروض والتمويل (صافي)", "group": "الموجودات", "from": ["قروض وتمويل وسلف، صافي", r"re:^قروض وتمويل|^تمويل وسلف|^قروض وسلف"]},
        {**TOTAL_ASSETS, "group": "الموجودات"},
        {"key": "dueToBanks", "label": "أرصدة للبنوك والمؤسسات المالية", "group": "المطلوبات",
         "from": [r"re:^أرصدة مستحقة (إلى|الى) (ال)?بنوك|^أرصدة للبنوك"]},
        {"key": "deposits", "label": "ودائع العملاء", "group": "المطلوبات", "from": ["ودائع العملاء", r"re:^ودائع (ال)?عملاء"]},
        {"key": "debtIssued", "label": "سندات وصكوك مصدرة", "group": "المطلوبات", "mode": "sum",
         "from": [r"re:^سندات دين وقرو?ض لأجل", r"re:^ديون ثانوية|^صكوك ثانوية"]},
        {**TOTAL_LIAB, "group": "المطلوبات"},
        {**CAPITAL, "group": "حقوق الملكية"},
        {**RETAINED, "group": "حقوق الملكية"},
        {"key": "tier1", "label": "صكوك الشريحة الأولى", "group": "حقوق الملكية", "from": [r"re:^صكوك الشريحة الأولى|^صكوك (رأس المال )?من الشريحة الأولى", "بنود أخرى لحقوق الملكية"]},
        {"key": "parentEquity", "label": "حقوق مساهمي البنك", "group": "حقوق الملكية",
         "from": [r"re:^إجمالي حقوق الملكية المتع?لقة بمساهمي البنك|^حقوق الملكية المتعلقة بمساهمي"]},
        {**TOTAL_EQUITY, "group": "حقوق الملكية"},
        {"key": "loansToDeposits", "label": "نسبة القروض إلى الودائع", "group": "مؤشرات محسوبة", "unit": "ratio", "needs": ["loans", "deposits"], "calc": _ratio},
    ],
    "cf": [
        {"key": "pbt", "label": "الربح قبل الزكاة والضريبة", "group": "الأنشطة التشغيلية", "from": PBT},
        {"key": "cfo", "label": "صافي النقد من الأنشطة التشغيلية", "group": "الأنشطة التشغيلية", "from": [CFO], "total": True},
        {"key": "capex", "label": "شراء ممتلكات ومعدات", "group": "الأنشطة الاستثمارية", "from": CAPEX, "sign": "out"},
        {"key": "cfi", "label": "صافي النقد من الأنشطة الاستثمارية", "group": "الأنشطة الاستثمارية", "from": [CFI], "total": True},
        {"key": "dividends", "label": "توزيعات أرباح مدفوعة", "group": "الأنشطة التمويلية", "from": DIVIDENDS, "fallbackNoNci": DIVIDENDS_NO_NCI, "sign": "out"},
        {"key": "cff", "label": "صافي النقد من الأنشطة التمويلية", "group": "الأنشطة التمويلية", "from": [CFF], "total": True},
        *CF_TAIL,
    ],
}

INSURANCE = {
    "bs": [
        {"key": "cash", "label": "النقد وما في حكمه", "group": "الموجودات", "mode": "sum", "all": True,
         "from": [r"re:^(ال)?نقدية وشبه (ال)?نقدية|^نقدية وشبه نقدية|^النقد وما في حكمه"]},
        {"key": "deposits", "label": "ودائع مرابحة لأجل", "group": "الموجودات", "mode": "sum", "all": True, "from": [r"re:^ودائع \(مرابحة\) لأجل|^ودائع لأجل|^ودائع مرابحة"]},
        {"key": "investments", "label": "الاستثمارات", "group": "الموجودات", "mode": "sum", "all": True,
         "from": [r"re:^استثمارات (متاحة للبيع|مقتناة|مدرجة|بالقيمة|بالتكلفة|محتفظ)|^استثمارات، صافي|^الاستثمارات$"]},
        {"key": "premiumsReceivable", "label": "أقساط مدينة", "group": "الموجودات", "from": [r"re:^أقساط / تأمين مدينة|^أقساط (تأمين )?مدينة|^أقساط واشتراكات"]},
        {"key": "reinsuranceShare", "label": "حصة معيدي التأمين من المطالبات", "group": "الموجودات",
         "from": [r"re:^حصة معيدي تأمين / إعادة تكافل من مطالبات|^حصة معيدي التأمين من المطالبات|^موجودات عقود إعادة التأمين"]},
        {**TOTAL_ASSETS, "group": "الموجودات"},
        {"key": "claims", "label": "المطالبات تحت التسوية", "group": "المطلوبات",
         "from": [r"re:^إجمالي المطالبات / المزايا المستحقة|^مطالبات تحت التسوية|^مطلوبات عقود التأمين"]},
        {"key": "totalLiabilities", "label": "إجمالي المطلوبات", "group": "المطلوبات", "total": True,
         "from": ["إجمالي المطلوبات"]},
        {**CAPITAL, "group": "حقوق الملكية"},
        {**RETAINED, "group": "حقوق الملكية"},
        {"key": "parentEquity", "label": "إجمالي حقوق المساهمين", "group": "حقوق الملكية", "total": True,
         "from": ["إجمالي حقوق الملكية المتعلقة بمساهمي الشركة", r"re:^إجمالي حقوق الملكية المتعلقة بمساهمي|^إجمالي حقوق المساهمين|^إجمالي حقوق الملكية$"]},
    ],
    "cf": [
        {"key": "cfo", "label": "صافي النقد من الأنشطة التشغيلية", "group": "الأنشطة", "mode": "sum", "all": True, "from": [CFO], "total": True},
        {"key": "cfi", "label": "صافي النقد من الأنشطة الاستثمارية", "group": "الأنشطة", "mode": "sum", "all": True, "from": [CFI], "total": True},
        {"key": "cff", "label": "صافي النقد من الأنشطة التمويلية", "group": "الأنشطة", "mode": "sum", "all": True, "from": [CFF], "total": True},
        *CF_TAIL,
    ],
}

FINANCE = {
    "bs": [
        {"key": "cash", "label": "النقد وما في حكمه", "group": "الموجودات",
         "from": ["أرصدة لدى البنوك ونقد في الصندوق", "النقد وما في حكمه", "النقدية وشبه النقدية", r"re:^نقد وأرصدة لدى"]},
        # موجودات مالية متداولة + غير متداولة (ذمم التمويل)؛ وإلا بنود ذمم التمويل والإيجار (بلا تكرار بنود الشركة الإضافية)
        {"key": "financing", "label": "ذمم التمويل (صافي)", "group": "الموجودات", "mode": "sum",
         "from": [r"re:^موجودات مالية، متداولة$", r"re:^موجودات مالية، غير متداولة$", r"re:^موجودات مالية$"],
         "fallback": {"mode": "sum", "from": [r"re:^قروض وتمويل وسلف", r"re:^مدين[وو]? عقود إيجار|^مديون عقود إيجار", r"re:^ذمم (مدينة )?(ال)?تمويل|^مدينو التمويل|^صافي (ال)?استثمار في (عقود )?(ال)?تمويل"]}},
        {"key": "currentAssets", "label": "إجمالي الموجودات المتداولة", "group": "الموجودات", "from": ["إجمالي الموجودات المتداولة"], "total": True},
        {**TOTAL_ASSETS, "group": "الموجودات"},
        {"key": "totalDebt", "label": "إجمالي الديون (قروض وصكوك)", "group": "المطلوبات", "mode": "sum",
         "from": ["سندات دين وقروض لأجل وقروض وصكوك مصدرة", r"re:^أرصدة مستحقة (إلى|الى) (ال)?بنوك", *SHORT_DEBT]},
        {"key": "currentLiabilities", "label": "إجمالي المطلوبات المتداولة", "group": "المطلوبات", "from": ["إجمالي المطلوبات المتداولة"], "total": True},
        {**TOTAL_LIAB, "group": "المطلوبات"},
        {**CAPITAL, "group": "حقوق الملكية"},
        {**RETAINED, "group": "حقوق الملكية"},
        {**TOTAL_EQUITY, "group": "حقوق الملكية"},
        {"key": "parentEquity", "label": "حقوق ملاك الشركة الأم", "group": "حقوق الملكية",
         "from": ["حقوق الملكية المتعلقة بملاك الشركة الأم", r"re:^(إجمالي )?حقوق الملكية المتع?لقة ب(ملاك|مساهمي)"]},
        {"key": "netDebt", "label": "صافي الدين (السالب = فائض نقدي)", "group": "مؤشرات محسوبة", "needs": ["totalDebt", "cash"], "calc": _sub},
        {"key": "workingCapital", "label": "رأس المال العامل", "group": "مؤشرات محسوبة", "needs": ["currentAssets", "currentLiabilities"], "calc": _sub},
        *leverage_items("totalDebt"),
    ],
    "cf": [
        {"key": "pbt", "label": "الربح قبل الزكاة والضريبة", "group": "الأنشطة التشغيلية", "from": PBT},
        {"key": "cfo", "label": "صافي النقد من الأنشطة التشغيلية", "group": "الأنشطة التشغيلية", "from": [CFO], "total": True},
        {"key": "capex", "label": "الإنفاق الرأسمالي", "group": "الأنشطة الاستثمارية", "from": CAPEX, "sign": "out"},
        {"key": "cfi", "label": "صافي النقد من الأنشطة الاستثمارية", "group": "الأنشطة الاستثمارية", "from": [CFI], "total": True},
        {"key": "dividends", "label": "توزيعات أرباح مدفوعة", "group": "الأنشطة التمويلية", "from": DIVIDENDS, "fallbackNoNci": DIVIDENDS_NO_NCI, "sign": "out"},
        {"key": "cff", "label": "صافي النقد من الأنشطة التمويلية", "group": "الأنشطة التمويلية", "from": [CFF], "total": True},
        *CF_TAIL,
    ],
}

REIT = {
    "bs": [
        {"key": "cash", "label": "النقد وما في حكمه", "group": "الموجودات",
         "from": ["النقد وما في حكمه", "النقدية وشبه النقدية", "أرصدة لدى البنوك ونقد في الصندوق", r"re:^(ال)?نقد(ية)? وما في حكمه|^(ال)?نقدية وشبه"]},
        {"key": "realEstate", "label": "الاستثمارات العقارية", "group": "الموجودات", "mode": "sum", "all": True,
         "from": [r"re:^(ال)?استثمارات (ال)?عقارية|^عقارات استثمارية"]},
        {**TOTAL_ASSETS, "group": "الموجودات"},
        {"key": "debt", "label": "التمويل", "group": "المطلوبات", "mode": "sum", "all": True,
         "from": [r"re:^سندات دين وقرو?ض|^قروض|^تمويل(ات)? (إسلامي|طويل|قصير|مرابحة)|^تسهيلات"]},
        {**TOTAL_LIAB, "group": "المطلوبات"},
        {"key": "netAssets", "label": "صافي الموجودات لمالكي الوحدات", "group": "صافي الموجودات", "total": True,
         "from": [r"re:^صافي (ال)?موجودات (ال)?عائدة|^صافي قيمة (ال)?موجودات|^صافي الموجودات", "إجمالي حقوق الملكية"]},
        {"key": "debtToAssets", "label": "التمويل إلى إجمالي الموجودات", "group": "مؤشرات محسوبة", "unit": "ratio", "needs": ["debt", "totalAssets"], "calc": _ratio},
    ],
    "cf": [
        {"key": "cfo", "label": "صافي النقد من الأنشطة التشغيلية", "group": "الأنشطة", "from": [CFO], "total": True},
        {"key": "cfi", "label": "صافي النقد من الأنشطة الاستثمارية", "group": "الأنشطة", "from": [CFI], "total": True},
        {"key": "dividends", "label": "توزيعات مدفوعة لمالكي الوحدات", "group": "الأنشطة", "from": DIVIDENDS + [r"re:^توزيعات (مدفوعة|نقدية)"], "sign": "out"},
        {"key": "cff", "label": "صافي النقد من الأنشطة التمويلية", "group": "الأنشطة", "from": [CFF], "total": True},
        *CF_TAIL,
    ],
}

ITEMS = {"normal": NORMAL, "bank": BANK, "insurance": INSURANCE, "finance": FINANCE, "reit": REIT}


def sector_type(slug):
    return {"banks": "bank", "insurance": "insurance", "finance": "finance", "reits": "reit"}.get(slug, "normal")
