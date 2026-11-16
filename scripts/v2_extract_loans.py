#!/usr/bin/env python3
"""Extract the 대출금 관리대장 Google Sheet export (xlsx) into JSON.

    python3 scripts/v2_extract_loans.py --input loan.xlsx > loans.json

Each tab ('베럴즈', '우프') has a header row starting with '구분' and one loan per row.
Output: {"loans": [...], "asOf": {company: date}}
"""
import argparse
import datetime as dt
import json
import re
import sys

import openpyxl

COMPANY = {"베럴즈": "betters", "우프": "wooof"}


def day(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return ""


def won(v):
    if isinstance(v, (int, float)):
        return int(round(v))
    if isinstance(v, str):
        s = re.sub(r"[^\d]", "", v)
        return int(s) if s else 0
    return 0


def text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.input, data_only=True)
    loans, as_of = [], {}
    for ws in wb.worksheets:
        company = next((v for k, v in COMPANY.items() if k in ws.title), None)
        if not company:
            continue
        rows = [list(r) + [None] * 30 for r in ws.iter_rows(values_only=True)]
        hdr_i, cols = None, {}
        for i, r in enumerate(rows):
            if "구분" in [text(v) for v in r] and "대출명" in [text(v) for v in r]:
                hdr_i = i
                cols = {text(v): j for j, v in enumerate(r) if text(v)}
                break
        if hdr_i is None:
            continue
        # 표 위쪽에 날짜 하나만 있으면 그 표의 기준일로 본다(우프 탭 2026-07-24).
        for r in rows[:hdr_i]:
            ds = [day(v) for v in r if day(v)]
            if ds:
                as_of[company] = ds[0]

        def g(r, name):
            j = cols.get(name)
            return r[j] if j is not None else None

        for n, r in enumerate(rows[hdr_i + 1:]):
            name = text(g(r, "대출명"))
            if not name:
                continue
            remaining_raw = g(r, "잔여 대출금")
            loans.append({
                # 이름은 해마다 바뀌기도 해('일반자금대출' → '일반자금대출 (기보)') 계좌·실행일로 묶는다.
                "sheetKey": f"{company}:{re.sub(r'[^0-9]', '', text(g(r, '출금계좌번호')))[:14]}:{day(g(r, '대출실행일자')) or n}",
                "company": company,
                "category": text(g(r, "구분")),
                "name": name,
                "startDate": day(g(r, "대출실행일자")),
                "principal": won(g(r, "원금")),
                "rate": round(float(g(r, "이율") or 0) * 100, 3) if isinstance(g(r, "이율"), (int, float)) else 0,
                "bank": text(g(r, "거래은행")),
                "account": text(g(r, "출금계좌번호")),
                "principalPayment": won(g(r, "거래원금 원금상환")),
                "monthlyPayment": won(g(r, "원리금")),
                "interestNote": text(g(r, "약정이자")),
                "payDay": text(g(r, "상환일자(매월)")),
                "repayStart": day(g(r, "원리금 상환 시작일")),
                "term": text(g(r, "거치기간/상환기간")),
                "maturity": day(g(r, "만기년월일")),
                "balance": won(remaining_raw),
                "balanceBlank": text(remaining_raw) in ("", "-"),
                "memo": " ".join(t for t in (text(g(r, "비고")), text(g(r, "담당자"))) if t),
            })
    json.dump({"loans": loans, "asOf": as_of}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
