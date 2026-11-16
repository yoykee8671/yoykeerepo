"""Extract creditors from the 회생 변제율 계산표 'final' sheet (v2 migration).

usage: v2_extract_claims.py claims.xlsx out.json
Output: { hdr, rows: [{cat, creditor, biz, total, convert, cash}] } — use rows whose cat starts with '상거래'.
"""
from openpyxl import load_workbook
import sys, json
wb=load_workbook(sys.argv[1], read_only=True, data_only=True)
ws=wb['final']; out=[]; hdr=None
for r in ws.iter_rows(values_only=True):
    c=list(r)
    if hdr is None and c and any(str(x or '').startswith('채권자') for x in c[:3]): hdr=[str(x or '').replace('\n','') for x in c]; continue
    if hdr and len(c)>13 and c[2] and isinstance(c[4],(int,float)):
        out.append({'cat':c[1],'creditor':c[2],'biz':c[3],'total':c[4],'convert':c[6],'cash':c[12]})
json.dump({'hdr':hdr,'rows':out},open(sys.argv[2],'w'),ensure_ascii=False,default=str)
print(hdr[:14]); print(len(out)); [print(o) for o in out if str(o['cat'] or '').startswith('상거래')][:3]
print([o for o in out if '고공' in str(o['biz'])+str(o['creditor']) or '김지연' in str(o['creditor'])][:3])
