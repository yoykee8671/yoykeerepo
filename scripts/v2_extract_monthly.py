#!/usr/bin/env python3
"""Extract the 입점사 월정산 Google Sheet export (xlsx) into JSON.

    python3 scripts/v2_extract_monthly.py --input monthly.xlsx > monthly.json

Tabs are named like '2610월정산' (2026-10) or '25012월정산' (2025-12). Row 1 is the header.
Output: {"months": {"2026-10": [{brand, kind, checked, memo, fixRequest, sales, shipping,
          baseRate, rate, diff, recovered, margin, supplyByItem, sent, note}]}}
"""
import argparse
import json
import re
import sys

import openpyxl

COLS = {"업체명": "brand", "구분": "kind", "확인완료/발행요청": "checked", "메모": "memo", "수정요청": "fixRequest",
        "매출액": "sales", "배송비": "shipping", "원수수료율": "baseRate", "현수수료율(조정)": "rate",
        "입금차액": "diff", "회수누적": "recovered", "마진": "margin", "상품별공급가": "supplyByItem", "정산서 발송완료": "sent"}
NUM = {"sales", "shipping", "diff", "recovered", "margin", "supplyByItem"}


def month_of(title):
    m = re.match(r"(\d{2})(\d{1,3})월정산", title.replace(" ", ""))
    if not m:
        return ""
    yy, mm = m.group(1), m.group(2)
    mm = mm[1:] if len(mm) == 3 else mm  # '012' → '12'
    return f"20{yy}-{int(mm):02d}"


def num(v):
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    if isinstance(v, str):
        s = re.sub(r"[^\d.\-]", "", v)
        try:
            return round(float(s), 2) if s and s not in ("-", ".") else 0
        except ValueError:
            return 0
    return 0


def rate(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return round(float(v) * 100, 2) if v <= 1 else round(float(v), 2)
    return str(v).strip() if v not in (None, "") else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.input, data_only=True)
    out = {}
    for ws in wb.worksheets:
        month = month_of(ws.title)
        if not month:
            continue
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header = [str(v).strip() if v is not None else "" for v in rows[0]]
        idx = {COLS[h]: i for i, h in enumerate(header) if h in COLS}
        extra = len(header)  # 헤더 오른쪽 칸(비고)
        items = []
        for r in rows[1:]:
            r = list(r) + [None] * 40
            brand = str(r[idx["brand"]] or "").strip() if "brand" in idx else ""
            if not brand:
                continue
            rec = {"brand": brand}
            for key, i in idx.items():
                v = r[i]
                if key == "brand":
                    continue
                if key in NUM:
                    rec[key] = num(v)
                elif key in ("baseRate", "rate"):
                    rec[key] = rate(v)
                elif key in ("checked", "sent"):
                    rec[key] = bool(v) if isinstance(v, bool) else str(v or "").strip().upper() == "TRUE"
                else:
                    rec[key] = str(v or "").strip()
            note = " ".join(str(v).strip() for v in r[extra:extra + 4] if v not in (None, ""))
            if note:
                rec["note"] = note
            items.append(rec)
        out[month] = items
    json.dump({"months": out}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
