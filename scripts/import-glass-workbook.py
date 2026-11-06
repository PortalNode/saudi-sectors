#!/usr/bin/env python3
"""Import annual FY 2021–2025 glass products results from the supplied workbook."""
import argparse, hashlib, json, math
from datetime import datetime, timezone
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "dist" / "glass-financials.json"
SITE_DATA = ROOT / "dist" / "data.json"
YEARS = [2021, 2022, 2023, 2024, 2025]
METRIC_KEYS = {
    "الإيرادات": "revenue", "إجمالي الدخل": "grossIncome", "دخل العمليات": "operatingIncome",
    "صافي الدخل": "netProfit", "ربح السهم قبل البنود الاستثنائية": "epsBeforeExceptional", "ربح السهم": "eps",
}
class ImportValidationError(ValueError): pass
def norm(v): return " ".join(str(v).split()) if v is not None else ""
def finite(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
def symbol_map(site_data):
    data=json.loads(Path(site_data).read_text(encoding='utf-8'))
    sectors=[s for s in data['sectors'] if norm(s['name'])=='المنتجات الزجاجية']
    if len(sectors)!=1: raise ImportValidationError('يجب وجود قطاع منتجات زجاجية واحد')
    return {str(s['symbol']):s['name'] for s in sectors[0]['stocks']}
def import_workbook(input_path, site_data=SITE_DATA):
    input_path=Path(input_path); before=hashlib.sha256(input_path.read_bytes()).hexdigest(); names=symbol_map(site_data)
    wb=openpyxl.load_workbook(input_path,data_only=True,read_only=False); companies=[]
    try:
        for ws in wb.worksheets:
            title=norm(ws.cell(1,1).value); symbol=next((s for s,n in names.items() if norm(n)==norm(ws.title)),None)
            if not symbol: raise ImportValidationError(f'اسم الورقة غير مطابق لقائمة الموقع: {ws.title}')
            years=[int(ws.cell(2,c).value) for c in range(2,ws.max_column+1,2) if finite(ws.cell(2,c).value)]
            records=[]
            for col,year in zip(range(2,ws.max_column+1,2),years):
                if year not in YEARS: continue
                values={}
                for row in range(3,ws.max_row+1):
                    label=norm(ws.cell(row,1).value)
                    if label in METRIC_KEYS:
                        value=ws.cell(row,col).value
                        if not finite(value): raise ImportValidationError(f'قيمة مفقودة أو غير رقمية: {ws.title} {year} {label}')
                        values[METRIC_KEYS[label]]=float(value)
                if set(values)!=set(METRIC_KEYS.values()): raise ImportValidationError(f'بنود ناقصة في ورقة {ws.title} لعام {year}')
                values['grossMargin']=values['grossIncome']/values['revenue'] if values['revenue'] else None
                values['operatingMargin']=values['operatingIncome']/values['revenue'] if values['revenue'] else None
                values['netMargin']=values['netProfit']/values['revenue'] if values['revenue'] else None
                records.append({'year':year,'period':'FY','values':values})
            if not records: raise ImportValidationError(f'لا توجد سنوات صالحة في {ws.title}')
            records.sort(key=lambda r:r['year'])
            companies.append({'symbol':symbol,'name':names[symbol],'fullName':title.split('  —')[0],'sourceSheet':ws.title,'years':records})
    finally: wb.close()
    if hashlib.sha256(input_path.read_bytes()).hexdigest()!=before: raise ImportValidationError('تغير ملف المصدر أثناء القراءة')
    if {c['symbol'] for c in companies}!=set(names) or len(companies)!=len(names): raise ImportValidationError('عدد أو رموز شركات المنتجات الزجاجية غير مطابقة للموقع')
    order={s:i for i,s in enumerate(names)}; companies.sort(key=lambda c:order[c['symbol']])
    return {'schemaVersion':1,'sector':'المنتجات الزجاجية','years':YEARS,'source':{'name':input_path.name,'provider':'أرقام','importedAt':datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z'),'note':'النتائج المالية السنوية فقط؛ السنوات غير المتاحة لبعض الشركات تظهر بعلامة —.'},'companies':companies}
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('input',type=Path); ap.add_argument('--output',type=Path,default=DEFAULT_OUTPUT); args=ap.parse_args()
    payload=import_workbook(args.input); args.output.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); print(f"Imported {len(payload['companies'])} companies to {args.output}")
if __name__=='__main__': main()
