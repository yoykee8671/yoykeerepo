#!/usr/bin/env python3
"""Parse an uploaded xlsx to JSON for Node. Emits {"sheets": {name: [rowObjs]}}.

Used for the bank transaction file (은행 거래내역). By default reads the
'통합 라벨링 내역' sheet if present, otherwise the first sheet. Pass --sheet to
override, or --all to dump every sheet. The first non-empty row is the header.
"""

import argparse
import json
import os
import sys
from datetime import date, datetime

from openpyxl import load_workbook

# 파일 읽기(구형 .xls 변환 · CSV 인코딩)는 판매내역 파서와 함께 쓴다.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sheet_io import read_csv_rows, workbook_path  # noqa: E402


def cell(v):
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def sheet_rows(ws):
    # 거래처 파일은 <dimension> 이 틀리게 적혀 오는 경우가 흔하다. read_only
    # 모드는 그 값을 그대로 믿어서 195행짜리 시트가 1행으로 읽힌다.
    try:
        ws.reset_dimensions()
    except AttributeError:
        pass
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    header = [str(h).strip() if h is not None else f"col{i}" for i, h in enumerate(rows[0])]
    out = []
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        obj = {}
        for i, h in enumerate(header):
            obj[h] = cell(r[i]) if i < len(r) else ""
        out.append(obj)
    return out


def rows_to_objs(rows):
    """(머리글, 행...) 튜플 목록을 {열이름: 값} 목록으로."""
    if not rows:
        return []
    header = [str(h).strip() if h not in (None, "") else f"col{i}"
              for i, h in enumerate(rows[0])]
    out = []
    for r in rows[1:]:
        if r is None or all(x in (None, "") for x in r):
            continue
        out.append({h: (cell(r[i]) if i < len(r) else "") for i, h in enumerate(header)})
    return out


def _header_width(ws):
    """1행에 이름이 붙은 열 수. 자료 시트를 고르는 기준으로 쓴다."""
    try:
        first = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    except StopIteration:
        return 0
    return sum(1 for v in (first or ()) if v not in (None, ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--sheet", default="")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    # CSV 로 올라오는 자료도 있다 (재고 내보내기 등). 머리글 + 행 모양은 같다.
    if os.path.splitext(args.input)[1].lower() in (".csv", ".txt"):
        rows = read_csv_rows(args.input)
        json.dump({"sheets": {"csv": rows_to_objs(rows)}}, sys.stdout, ensure_ascii=False)
        return

    # 구형 .xls 는 변환해서 읽는다 — 택배사 관리자가 아직 이 형식으로 준다.
    wb = load_workbook(workbook_path(args.input), data_only=True, read_only=True)
    result = {}
    if args.all:
        for ws in wb.worksheets:
            result[ws.title] = sheet_rows(ws)
    else:
        target = None
        if args.sheet and args.sheet in wb.sheetnames:
            target = wb[args.sheet]
        elif "통합 라벨링 내역" in wb.sheetnames:
            target = wb["통합 라벨링 내역"]
        else:
            # 사람이 집계 시트를 덧붙여 보내는 경우가 있어(합포기준 등) 첫
            # 시트가 자료 시트라는 보장이 없다. 머리글이 가장 많은 표를 고른다.
            target = max(wb.worksheets, key=lambda ws: _header_width(ws))
        result[target.title] = sheet_rows(target)

    json.dump({"sheets": result}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
