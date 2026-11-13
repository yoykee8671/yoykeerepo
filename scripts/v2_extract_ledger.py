"""Extract order rows from every brand tab of '2026_선매입 브랜드 관리대장' (v2 migration).

usage: v2_extract_ledger.py ledger.xlsx out.json
Download: https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx
Output: { tabName: { cols: [...], rows: [{orderNo, customer, month, goods, ship, paid, margin, date, ret, b2b}] } }
Then POST {tabs, creditors} to /api/setup/migration/run (owner).
"""
import json, re, sys, datetime
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
COLS = {
  'month': ['정산월'], 'customer': ['주문자명'], 'orderNo': ['주문번호'], 'qty': ['수량'],
  'goods': ['상품주문총계', '상품주문 총계'], 'ship': ['배송비'], 'paid': ['업체실입금액', '업체 실 입금액'],
  'margin': ['공급마진', '우프마진', '마진'], 'date': ['입금(예정)일자', '입금예정일자', '입금일자'],
  'ret': ['반품/교환', '반품'], 'b2b': ['B2B 주문건', 'B2B'], 'supply': ['공급가액']
}
def norm(s): return re.sub(r'\s+', '', str(s or ''))
def num(v):
    if v in (None, ''): return 0
    if isinstance(v, (int, float)): return float(v)
    s = re.sub(r'[^\d.\-]', '', str(v)); 
    try: return float(s) if s not in ('', '-', '.') else 0
    except: return 0
def day(v):
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    m = re.match(r'(\d{4})\D+(\d{1,2})\D+(\d{1,2})', str(v or '').strip())
    return f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}' if m else ''
out = {}
skip = re.compile(r'단가표|양식|템플릿|입금요청시트|기타|행사공급가|주미스25')
for ws in wb.worksheets:
    if skip.search(ws.title): continue
    header = None; cols = {}; rows = []
    for r in ws.iter_rows(values_only=True):
        if header is None:
            cells = [norm(c) for c in r]
            if '주문번호' in cells:
                header = cells
                for key, names in COLS.items():
                    for i, c in enumerate(cells):
                        if any(c.startswith(norm(n)) for n in names) and key not in cols:
                            cols[key] = i
            continue
        g = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else None
        on = str(g('orderNo') or '').strip()
        if not re.match(r'^\d{8}-\d{7}', on): continue
        rows.append({'orderNo': on[:16], 'customer': str(g('customer') or '').strip(), 'month': str(g('month') or '').split('.')[0],
                     'goods': num(g('goods')), 'ship': num(g('ship')), 'paid': num(g('paid')), 'margin': num(g('margin')),
                     'date': day(g('date')), 'ret': str(g('ret') or '').strip(), 'b2b': str(g('b2b') or '').strip()})
    out[ws.title] = {'cols': sorted(cols), 'rows': rows}
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False)
print(len(out), 'tabs,', sum(len(v['rows']) for v in out.values()), 'order rows')
print('tabs without margin col:', [k for k, v in out.items() if 'margin' not in v['cols'] and v['rows']][:30])
