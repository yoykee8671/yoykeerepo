#!/usr/bin/env python3
"""Extract the 회생채권 변제계획표 (Google Sheet export, tab 'final') into JSON.

    python3 scripts/v2_extract_rehab.py --input plan.xlsx > rehab.json

Output: {"creditors": [{cat, creditor, biz, total, convertRate, cash, prepaid, prepaidPaid,
          remaining2026, years: {"2026": n, ...}}], "totals": {...}}
Rows starting with 'ㄴ' (원금/개시전이자 breakdown) and '...의 합'/'총 합계' rows are skipped;
the plan's own total row is returned separately for checking.
"""
import argparse
import json
import sys

import openpyxl


def key(v):
    return "".join(str(v).split()) if v is not None else ""


def num(v):
    return round(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.input, data_only=True)
    ws = wb["final"]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    hi = next(i for i, r in enumerate(rows) if any(key(v) == "채권자" for v in r))
    hdr = [key(v) for v in rows[hi]]
    ci = {h: i for i, h in enumerate(hdr) if h}
    years = [h for h in hdr if "차(" in h and h.endswith(")") and "잔액" not in h]
    g = lambda r, name: r[ci[name]] if name in ci and ci[name] < len(r) else None
    out, totals, cat = [], None, ""
    for r in rows[hi + 1:]:
        c, who = g(r, "구분"), g(r, "채권자")
        if isinstance(c, str) and c.strip() == "총 합계":
            totals = {"total": num(g(r, "채권총액(개시전이자)")), "prepaid": num(g(r, "준비연도(2025)")),
                      "prepaidPaid": num(g(r, "<-현가변제할인율4.4%적용(조세채권제외)")),
                      "remaining2026": num(g(r, "1차(2026)변제실잔액")),
                      "years": {h[h.index("(") + 1:-1]: num(g(r, h)) for h in years}}
            continue
        if isinstance(c, str) and c.strip():
            cat = c.strip()
        if not isinstance(who, str) or not who.strip() or who.strip().startswith("ㄴ") or "합" in (c or "") or who.strip().endswith("의 합"):
            continue
        out.append({
            "cat": cat, "creditor": who.strip(), "biz": (g(r, "개인회사(사업자상호)") or "") if isinstance(g(r, "개인회사(사업자상호)"), str) else "",
            "total": num(g(r, "채권총액(개시전이자)")), "convertRate": g(r, "출자전환비율") if isinstance(g(r, "출자전환비율"), (int, float)) else None,
            "cash": num(g(r, "현금변제할채권액의합")), "prepaid": num(g(r, "준비연도(2025)")),
            "prepaidPaid": num(g(r, "<-현가변제할인율4.4%적용(조세채권제외)")), "remaining2026": num(g(r, "1차(2026)변제실잔액")),
            "years": {h[h.index("(") + 1:-1]: num(g(r, h)) for h in years},
        })
    json.dump({"creditors": out, "totals": totals}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
