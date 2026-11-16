#!/usr/bin/env python3
"""Extract production-partner ledgers from the 생산비 Google Sheet export (xlsx).

    python3 scripts/v2_extract_production.py --input cost.xlsx > production.json

Output: {"partners": [{name, bills, payments, sheetBilled, sheetPaid, sheetBalance, notes}],
         "rates": [{partner, item, option, unitPrice, from}]}
Amounts are VAT-included won unless noted (rates are VAT-excluded, as in the sheet).
"""
import argparse
import datetime as dt
import json
import re
import sys

import openpyxl


def day(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, (int, float)) and 19000101 <= v <= 21001231:
        s = str(int(v))
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    if isinstance(v, str):
        m = re.search(r"(20\d\d)[.\-/ ]\s*(\d{1,2})[.\-/ ]\s*(\d{1,2})", v)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def won(v):
    if isinstance(v, (int, float)):
        return int(round(v))
    if isinstance(v, str):
        s = re.sub(r"[^\d.\-]", "", v)
        try:
            return int(round(float(s))) if s else 0
        except ValueError:
            return 0
    return 0


def text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else ""


def rows(ws):
    return [list(r) + [None] * 40 for r in ws.iter_rows(values_only=True)]


def find_header(rs, col, label):
    for i, r in enumerate(rs):
        if text(r[col]) == label:
            return i
    raise ValueError(f"header {label} not found")


def seorim(ws):
    """세림통상: B 청구일자, C 청구금액, D 상환금액, E 품목, F 상환일자 (independent columns)."""
    rs = rows(ws)
    start = find_header(rs, 1, "청구일자") + 1
    bills, payments, billed_total, paid_total, balance = [], [], 0, 0, 0
    for r in rs[start:]:
        b, c, d, e, f = r[1], r[2], r[3], r[4], r[5]
        if text(b) == "남은 잔금":
            balance = won(d) or won(c)
            continue
        if b is None and (won(c) or won(d)) and not e and not f:
            billed_total, paid_total = won(c), won(d)  # 합계 줄
            continue
        if day(b) and won(c):
            bills.append({"date": day(b), "amount": won(c), "memo": text(e)})
        if won(d):
            payments.append({"date": day(f) or day(b), "amount": won(d), "memo": "" if day(f) else "상환일 없음(청구일로 기록)"})
    return {"bills": bills, "payments": payments, "sheetBilled": billed_total, "sheetPaid": paid_total, "sheetBalance": balance,
            "notes": ["시트 합계는 2023-01-03(229행)부터, 상환은 351행까지만 더한다(이후 상환은 합계에 빠짐)."]}


def seorim_detail(ws):
    """세림상세내역YYYY: B 날짜(묶음 첫 줄만), C 품목, E 수량, F 단가, G 공급가합, H 부가세포함가, I 묶음 합계."""
    rs = rows(ws)
    start = find_header(rs, 1, "날짜") + 1
    groups, cur = [], None
    for r in rs[start:]:
        if day(r[1]):
            cur = {"date": day(r[1]), "lines": [], "total": 0}
            groups.append(cur)
        if cur is None:
            continue
        if text(r[2]) and (won(r[6]) or won(r[7])):
            cur["lines"].append({"item": text(r[2]), "qty": float(r[4] or 0), "unitPrice": won(r[5]),
                                 "supply": won(r[6]), "gross": won(r[7])})
        elif won(r[8]) and not text(r[2]):
            cur["total"] = won(r[8])
    return [g for g in groups if g["lines"]]


def seorim_rates(ws):
    """세림상세내역 오른쪽 공임표: M 품목(첫 줄만), N 옵션, O 단가(VAT별도), P 새 단가, Q (yy/mm/dd)."""
    rs = rows(ws)
    out, item = [], ""
    for r in rs[2:60]:
        m, n, o, p, q = r[12], r[13], r[14], r[15], r[16]
        if text(m) == "품목별 세림 공임":
            continue
        if text(m) and not text(m).startswith("("):
            item = text(m)  # '(재단/원단/…)' 같은 괄호 줄은 윗 품목의 설명이다
        if not item or not (won(o) or won(p)):
            continue
        if won(o):
            out.append({"partner": "세림통상", "item": item, "option": text(n), "unitPrice": won(o), "from": ""})
        if won(p):
            mm = re.search(r"(\d\d)/(\d\d)/(\d\d)", text(q))
            frm = f"20{mm.group(1)}-{mm.group(2)}-{mm.group(3)}" if mm else ""
            # '(06/04/28)'처럼 연도가 이상하면 날짜를 비우고 표시만 남긴다(확인 필요).
            out.append({"partner": "세림통상", "item": item, "option": text(n), "unitPrice": won(p),
                        "from": frm if frm >= "2018" else "", "fromText": text(q)})
    return out


def dongkwang(ws):
    """동광섬유: B 청구일(묶음 첫 줄), D 품목, E 단가, F 수량, H 줄 청구금액(VAT포함),
    I 묶음 합계, J 지급액, L '날짜 입금완'·'1차/2차' 또는 내용.
    날짜 없는 줄: 음수 H = 상계, 양수 H + 입금 = 나눠 낸 돈.
    시트는 2021-01-05(60행)부터만 합산한다 → 그 전 청구는 정산 끝난 것으로 본다(assumed)."""
    rs = rows(ws)
    start = find_header(rs, 1, "청구(발주일)") + 1
    settled_before = "2021-01-05"
    groups, cur = [], None
    for r in rs[start:]:
        if text(r[1]) in ("총 잔금액", "총 청구액") or text(r[1]) == "발주일":
            continue
        if day(r[1]):
            cur = {"head": r, "rows": []}
            groups.append(cur)
        elif cur is not None:
            cur["rows"].append(r)
    bills, payments = [], []
    for g in groups:
        head = g["head"]
        body = [head] + g["rows"]
        lines = [{"item": text(r[3]), "unitPrice": won(r[4]), "qty": float(r[5] or 0), "gross": won(r[7])}
                 for r in body if text(r[3]) and won(r[7])]
        amount = won(head[8]) or sum(l["gross"] for l in lines) or won(head[7])
        if not amount:
            continue
        note = text(head[11])
        bill = {"date": day(head[1]), "amount": amount, "memo": ""}
        if lines:
            bill["lines"] = lines
        bills.append(bill)
        bidx = len(bills) - 1
        n_before = len(payments)
        extra = []
        for r in g["rows"]:
            if text(r[3]):
                continue
            n = text(r[11])
            if won(r[7]) < 0:
                extra.append({"date": bill["date"], "amount": -won(r[7]), "memo": n or "상계"})
            elif won(r[7]) > 0 and re.search(r"입금|결제", n):
                extra.append({"date": day(n) or bill["date"], "amount": won(r[7]), "memo": n})
            elif re.search(r"\d차", n) and day(n):
                extra.append({"date": day(n), "amount": 0, "memo": n})
        paid = re.search(r"입금|결제|\d차", note)
        if extra:
            known = sum(x["amount"] for x in extra if x["amount"])
            for x in extra:
                if not x["amount"]:
                    x["amount"] = 0
            if paid and not won(head[9]):
                # 머리줄 메모가 '1차'이고 다음 줄이 '2차'인 분할 지급: 금액을 반씩 나눈다(합계는 청구액).
                parts = [{"date": day(note) or bill["date"], "amount": 0, "memo": note}] + [x for x in extra if not x["amount"]]
                rest = amount - known
                if parts and rest > 0:
                    each = rest // len(parts)
                    for i, x in enumerate(parts):
                        x["amount"] = each if i < len(parts) - 1 else rest - each * (len(parts) - 1)
                payments += [x for x in parts if x["amount"]]
            payments += [x for x in extra if x["amount"] and x not in payments]
        elif paid:
            payments.append({"date": day(note) or bill["date"], "amount": won(head[9]) or amount, "memo": note})
        elif bill["date"] < settled_before:
            bill["memo"] = note
            payments.append({"date": bill["date"], "amount": amount, "memo": "시트 합산 범위 이전 — 정산 끝난 것으로 봄", "assumed": True})
        else:
            bill["memo"] = note
        for x in payments[n_before:]:
            x["billIdx"] = bidx
    return {"bills": bills, "payments": payments}


def bestever(ws):
    """베스트에버: B 청구일자, C 청구금액, D 내용('결제완료' 등). 분할 회차 줄(B='n회차', E='o' 납부)."""
    rs = rows(ws)
    start = find_header(rs, 1, "청구일자") + 1
    bills, payments, notes, cur = [], [], [], None
    for r in rs[start:]:
        b = text(r[1])
        if day(r[1]) and won(r[2]):
            memo = text(r[3])
            cur = {"date": day(r[1]), "amount": won(r[2]), "memo": "" if re.search(r"결제", memo) else memo, "_inst": []}
            bills.append(cur)
            if re.search(r"결제", memo):
                payments.append({"date": day(memo) or cur["date"], "amount": cur["amount"], "memo": memo, "billIdx": len(bills) - 1})
                cur["_paid"] = True
        elif re.match(r"\d+회차", b) and cur is not None:
            cur["_inst"].append({"amount": won(r[2]), "due": text(r[3]), "done": text(r[4]).lower() == "o"})
        elif b and not day(r[1]) and not re.match(r"총 ", b):
            notes.append(b)
    settled_before = "2024-04-22"  # 시트 총 청구액은 60행(2024-04-22)부터만 더한다
    for bidx, bill in enumerate(bills):
        inst = bill.pop("_inst")
        if bill.pop("_paid", False):
            continue
        if not inst and bill["date"] < settled_before:
            payments.append({"date": bill["date"], "amount": bill["amount"], "memo": "시트 합산 범위 이전 — 정산 끝난 것으로 봄", "assumed": True, "billIdx": bidx})
            continue
        if inst:
            bill["installments"] = inst
            done = sum(i["amount"] for i in inst if i["done"])
            if all(i["done"] for i in inst):
                payments.append({"date": bill["date"], "amount": bill["amount"], "memo": f"분할 {len(inst)}회 납부 완료", "billIdx": bidx})
            elif done:
                payments.append({"date": bill["date"], "amount": done, "memo": "분할 일부 납부", "billIdx": bidx})
    return {"bills": bills, "payments": payments, "notes": notes}


def woil(ws):
    """우일자수: A 작업일(빈 칸이면 윗줄 날짜), B 품명, C 단가, D 수량, E 금액, F 입금완료."""
    rs = rows(ws)
    start = find_header(rs, 0, "작업일") + 1
    bills, payments, notes, last = [], [], [], ""
    for r in rs[start:]:
        if text(r[1]).startswith("총 미수"):
            break
        if day(r[0]):
            last = day(r[0])
        if not won(r[4]) or not text(r[1]):
            continue
        bills.append({"date": last, "amount": won(r[4]), "memo": text(r[1]),
                      "lines": [{"item": text(r[1]), "unitPrice": won(r[2]), "qty": float(r[3] or 0), "gross": won(r[4])}]})
        if text(r[5]):
            payments.append({"date": day(r[5]) or last, "amount": won(r[4]), "memo": f"입금완료 {text(r[5])}", "billIdx": len(bills) - 1})
    for r in rs[start:]:
        t = " ".join(text(v) for v in r[:3] if text(v))
        if t and ("국민은행" in t or "수량" in t or "업체에서" in t):
            notes.append(t)
    return {"bills": bills, "payments": payments, "notes": notes}


def seojin(ws):
    rs = rows(ws)
    start = find_header(rs, 1, "발행일자") + 1
    head = rs[start - 1]
    bills = [{"date": day(r[1]), "amount": won(r[2]), "memo": ""} for r in rs[start:] if day(r[1]) and won(r[2])]
    return {"bills": bills, "payments": [], "notes": [text(v) for v in head[2:6] if text(v) and text(v) != "총 합계금액"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.input, data_only=True)
    partners = []

    s = seorim(wb["세림통상"])
    details = []
    for name in wb.sheetnames:
        if name.startswith("세림상세내역"):
            details += seorim_detail(wb[name])
    s["details"] = sorted(details, key=lambda g: g["date"])
    partners.append({"name": "세림통상", **s})
    partners.append({"name": "동광섬유", **dongkwang(wb["동광섬유"]), "sheetBalance": 2172500})
    partners.append({"name": "베스트에버", **bestever(wb["베스트에버"]), "sheetBalance": 6602200,
                     "company": "betters_personal"})
    partners.append({"name": "우일자수", **woil(wb["우일자수"]), "sheetBalance": 10202200})
    partners.append({"name": "서진프린트", **seojin(wb["서진프린트"])})

    rates = []
    tabs = sorted([n for n in wb.sheetnames if n.startswith("세림상세내역")])
    if tabs:
        rates = seorim_rates(wb[tabs[-1]])
    json.dump({"partners": partners, "rates": rates}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
