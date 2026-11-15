#!/usr/bin/env python3
"""Extract the 2026 현금흐름표 (Google Drive xlsx) into JSON.

    python3 scripts/v2_extract_cashflow.py --input cashflow.xlsx > cashflow.json

Layout of the sheet (tab '2026'):
  - left block (cols A..I): fixed-cost master list — No. 월 유형 분류 항목 금액 결제방식 일정 결제여부
  - calendar block: row 2 has month labels ('1월'..), row 3 day numbers, row 4 weekdays;
    column J/K holds row labels. '현금IN' section then '현금OUT' section, each ending with '합계'.
Output: {"year": 2026, "rows": [{side, label, order}], "cells": [{date, side, label, amount}],
         "fixed": [{no, kind, category, item, amount, variable, method, schedule, paid}]}
"""
import argparse
import json
import re
import sys

import openpyxl


def text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--year", type=int, default=2026)
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.input, data_only=True)
    ws = wb[str(args.year)] if str(args.year) in wb.sheetnames else wb.worksheets[0]
    rows = [list(r) + [None] * 420 for r in ws.iter_rows(values_only=True)]

    months = {}
    for j, v in enumerate(rows[1]):
        m = re.fullmatch(r"(\d{1,2})월", text(v))
        if m and j > 9:
            months[int(m.group(1))] = j
    first_cal = min(months.values()) if months else 11
    label_cols = range(9, first_cal)

    out_rows, cells, side, order = [], [], "", 0
    seen = set()
    for i in range(2, len(rows)):
        r = rows[i]
        labels = [text(r[j]) for j in label_cols if text(r[j])]
        lab = labels[0] if labels else ""
        if lab.startswith("현금IN"):
            side = "in"; continue
        if lab.startswith("현금OUT"):
            side = "out"; continue
        if not side or lab in ("목", "월", "화", "수", "금", "토", "일"):
            continue
        if lab.startswith("합계"):
            if side == "out":
                side = ""
            continue
        has_val = any(isinstance(r[c], (int, float)) and r[c] for c in range(first_cal, len(r)))
        if not lab and not has_val:
            continue
        name = lab or ("기타 입금" if side == "in" else "기타 출금")
        key = (side, name)
        if key not in seen:
            seen.add(key)
            order += 1
            out_rows.append({"side": side, "label": name, "order": order})
        for mon, c in months.items():
            for d in range(1, 32):
                col = c + d - 1
                day_hdr = text(rows[2][col])
                if day_hdr != str(d):
                    continue
                v = r[col]
                if isinstance(v, (int, float)) and not isinstance(v, bool) and v:
                    cells.append({"date": f"{args.year}-{mon:02d}-{d:02d}", "side": side, "label": name, "amount": round(v)})

    fixed = []
    for i in range(4, len(rows)):
        r = rows[i]
        item, cat = text(r[4]), text(r[3])
        if not item and not cat:
            if i > 40:
                break
            continue
        amt = r[5]
        fixed.append({"no": text(r[0]).replace(".0", ""), "kind": text(r[2]), "category": cat, "item": item,
                      "amount": round(amt) if isinstance(amt, (int, float)) else 0,
                      "variable": not isinstance(amt, (int, float)) or text(r[2]) == "변동",
                      "method": text(r[6]), "schedule": text(r[7]), "paid": text(r[8])})
    json.dump({"year": args.year, "rows": out_rows, "cells": cells, "fixed": fixed}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
