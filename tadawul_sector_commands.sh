#!/usr/bin/env bash
# شغّل هذه الأوامر من مجلد المشروع الذي يحتوي dist/data.json
# التثبيت مرة واحدة:
python3 -m pip install openpyxl curl-cffi

# اختبار أسماء القطاعات:
python3 tadawul_announcements_excel.py --list-sectors

# الأوامر — كل أمر ينشئ ملف Excel مستقلاً للقطاع:
python3 tadawul_announcements_excel.py --sector 'المنتجات الزجاجية'
python3 tadawul_announcements_excel.py --sector 'الخدمات المالية'
python3 tadawul_announcements_excel.py --sector 'الاتصالات'
python3 tadawul_announcements_excel.py --sector 'السلع الاستهلاكية'
python3 tadawul_announcements_excel.py --sector 'التمويل'
python3 tadawul_announcements_excel.py --sector 'أسواق الاوراق المالية'
python3 tadawul_announcements_excel.py --sector 'خدمات الرعاية الصحية'
python3 tadawul_announcements_excel.py --sector 'المواد الاساسية'
python3 tadawul_announcements_excel.py --sector 'البنوك'
python3 tadawul_announcements_excel.py --sector 'البتروكيماويات'
python3 tadawul_announcements_excel.py --sector 'النفط و الغاز'
python3 tadawul_announcements_excel.py --sector 'الاسمنت'
python3 tadawul_announcements_excel.py --sector 'تجارة و تجزئة'
python3 tadawul_announcements_excel.py --sector 'موردي الادوية'
python3 tadawul_announcements_excel.py --sector 'المراكز الرياضية'
python3 tadawul_announcements_excel.py --sector 'الرعاية الصحية'
python3 tadawul_announcements_excel.py --sector 'التعليم و التدريب'
python3 tadawul_announcements_excel.py --sector 'الأغذية والمشروبات'
python3 tadawul_announcements_excel.py --sector 'الزراعة'
python3 tadawul_announcements_excel.py --sector 'متعددة الأنشطة'
python3 tadawul_announcements_excel.py --sector 'المرافق والطاقة'
python3 tadawul_announcements_excel.py --sector 'التأمين'
python3 tadawul_announcements_excel.py --sector 'الصناعات التحويلية'
python3 tadawul_announcements_excel.py --sector 'التعدين والمعادن'
python3 tadawul_announcements_excel.py --sector 'الصناديق العقارية المتداولة'
python3 tadawul_announcements_excel.py --sector 'العقارات'
python3 tadawul_announcements_excel.py --sector 'النقل'
python3 tadawul_announcements_excel.py --sector 'وسائل الاعلام'
python3 tadawul_announcements_excel.py --sector 'الفنادق و السياحة'
python3 tadawul_announcements_excel.py --sector 'تقنية المعلومات'
python3 tadawul_announcements_excel.py --sector 'خدمات الاعمال'

# لتشغيل جميع القطاعات بالتتابع (أبطأ وأكثر عرضة للحظر):
# python3 tadawul_announcements_excel.py --all
