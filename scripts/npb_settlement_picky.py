#!/usr/bin/env python3
"""픽키도기클럽 계열 월별 세부판매내역(정산서) xlsx 생성.

`종합_(픽키파크)우프_YYYY-MM월_필바이츠 세부판매내역.xlsx` 양식을 셀 단위로
따른다 (기준: 26년 8월 파일). 도톤 정산서와 표가 달라 생성기를 나눴다.

시트 셋:
  1. 정산서                 — 판매내역 종합, 매출계산서 발행 주체별 정산, 메모
  2. 채널별 정산 합계        — 채널 한 블록씩 + 하단 총계/요약
  3. 채널별 판매데이터 정리   — 채널별 상품 단위 내역
  4. DB)*                   — 올린 채널 원본

세 장은 수식으로 묶는다. 합계 시트는 판매데이터 시트의 합계 줄을, 정산서는
합계 시트의 요약 줄을 가리킨다 -- 한 장만 고쳐도 나머지가 따라오고, 받는
쪽이 숫자의 출처를 셀에서 바로 짚을 수 있다.

CLI: python3 npb_settlement_picky.py --input <spec.json> --output <out.xlsx>
"""

import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

# 양식은 맑은 고딕을 쓴다. 리눅스에는 그 글꼴이 없어 fontconfig 가 나눔으로
# 바꿔 주는데, 받는 쪽(엑셀)에서는 원래 글꼴로 열린다.
FACE = "맑은 고딕"

THIN = Side(style="thin", color="A6A6A6")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="FFD9D9D9")
SUB_FILL = PatternFill("solid", fgColor="FFF2F2F2")
TOTAL_FILL = PatternFill("solid", fgColor="FFE2EFDA")
BLUE_FILL = PatternFill("solid", fgColor="FFCAEDFB")   # 소비자정가계·매출계
GREEN_FILL = PatternFill("solid", fgColor="FFDAF2D0")  # 수수료·정산합계
# 우프 정산 줄. 양식은 테마색(accent2)의 80% 밝은 값을 쓴다 -- 테마 참조 대신
# 같은 색을 직접 적는다. 파일을 여는 쪽 테마가 달라도 색이 흔들리지 않는다.
PARTY_FILL = PatternFill("solid", fgColor="FFFBE3D6")

MONEY = "#,##0"
PCT = "0.0%"
# 하단 총계 줄만 회계 서식이다 (양식 그대로).
ACCT = r'_(* #,##0_);_(* \(#,##0\);_(* "-"_);_(@_)'

F9 = Font(name=FACE, size=9)
F10 = Font(name=FACE, size=10)
F10B = Font(name=FACE, size=10, bold=True)
F11 = Font(name=FACE, size=11)
F11B = Font(name=FACE, size=11, bold=True)

# 채널 블록의 열 구성.
CHANNEL_HEADERS = [
    "항목", "정가합계", "배송비합계", "할인합계", "최종결제합계",
    "공제(%)", "공제(원)", "정산합계", "정산형태", "비고",
]
DETAIL_HEADERS = [
    "순번", "제품", "판매수량", "정가합계", "배송비", "할인(원)",
    "최종결제합계", "수수료(%)", "수수료(원)", "정산합계",
]

TOTALS_SHEET = "'채널별 정산 합계'"
DETAIL_SHEET = "'채널별 판매데이터 정리'"


def _num(v):
    """숫자로 못 읽는 값(빈칸·'품목별상이' 같은 글자)은 0 으로 본다."""
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def put(ws, row, col, value, *, font=F11, fill=None, fmt=None, align=None, border=True):
    cell = ws.cell(row=row, column=col, value=value)
    cell.font = font
    if fill:
        cell.fill = fill
    if fmt:
        cell.number_format = fmt
    if align:
        cell.alignment = Alignment(horizontal=align, vertical="center",
                                   wrap_text=(align == "left"))
    if border:
        cell.border = BOX
    return cell


def widths(ws, spec):
    for letter, width in spec.items():
        ws.column_dimensions[letter].width = width


def heights(ws, rows, value):
    for row in rows:
        ws.row_dimensions[row].height = value


def fee_cell(ws, row, col, value, *, font=F11):
    """공제(%) 칸. 요율이 품목마다 다른 채널은 숫자 대신 그 사실을 적는다."""
    if isinstance(value, (int, float)):
        return put(ws, row, col, value, font=font, fmt=PCT, align="center")
    return put(ws, row, col, value or "", font=font, align="center")


# ------------------------------------------------- 채널별 판매데이터 정리
def build_channel_detail(ws, spec):
    """상품 단위 내역. 다른 두 장이 이 장의 합계 줄을 가리킨다."""
    widths(ws, {"A": 2, "B": 17, "C": 75.5, "D": 11, "E": 13, "F": 11,
                "G": 12, "H": 14, "I": 11, "J": 13, "K": 14})
    put(ws, 2, 2, f"정산기간 {spec.get('periodRange') or ''}", font=F11B, border=False)

    anchors = {}
    row = 4
    for channel in spec.get("channels") or []:
        head_row = row
        put(ws, row, 2, channel.get("name") or "", font=F11B, fill=SUB_FILL)
        basis = channel.get("dateBasis") or ""
        put(ws, row, 3, f"{basis} 기준" if basis else "", align="left")
        row += 1
        for i, label in enumerate(DETAIL_HEADERS):
            put(ws, row, 2 + i, label, font=F11B, fill=HEAD_FILL, align="center")
        row += 1

        first = row
        for n, item in enumerate(channel.get("rows") or [], start=1):
            put(ws, row, 2, n, align="center")
            put(ws, row, 3, item.get("label") or "", align="left")
            put(ws, row, 4, item.get("qty", 0), fmt=MONEY)
            put(ws, row, 5, item.get("listTotal", 0), fmt=MONEY)
            put(ws, row, 6, item.get("shipping", 0), fmt=MONEY)
            put(ws, row, 7, item.get("discount", 0), fmt=MONEY)
            # 최종결제 = 정가 + 배송비 - 할인. 할인을 고치면 여기가 따라온다.
            put(ws, row, 8, f"=E{row}+F{row}-G{row}", fmt=MONEY)
            rate = item.get("feeRate")
            fee_cell(ws, row, 9, rate)
            if isinstance(rate, (int, float)) and rate:
                put(ws, row, 10, f"=H{row}*I{row}", fmt=MONEY)
            else:
                put(ws, row, 10, item.get("feeTotal", 0), fmt=MONEY)
            put(ws, row, 11, f"=H{row}-J{row}", fmt=MONEY)
            row += 1
        last = row - 1

        total_row = row
        put(ws, row, 2, "", fill=TOTAL_FILL)
        put(ws, row, 3, "합계", font=F11B, fill=TOTAL_FILL)
        for col in (4, 5, 6, 7, 8, 10, 11):
            letter = chr(ord("A") + col - 1)
            formula = f"=SUM({letter}{first}:{letter}{last})" if last >= first else 0
            put(ws, row, col, formula, fmt=MONEY, fill=TOTAL_FILL)
        put(ws, row, 9, "", fill=TOTAL_FILL)
        heights(ws, [total_row], 18)

        anchors[channel.get("code") or channel.get("name")] = {
            "row": total_row,
            "has": last >= first,
            # 매출이 없는 채널은 제목만 남기고 접는다 (양식과 같은 방식).
            "fold": (head_row + 1, total_row),
        }
        row += 2

    # 맨 아래 총합계. 채널 합계 줄만 더한다.
    rows = [a["row"] for a in anchors.values()]
    if rows:
        row += 1
        put(ws, row, 3, "총합계", font=F11, fill=TOTAL_FILL)
        for col in (5, 6, 7, 8, 10, 11):
            letter = chr(ord("A") + col - 1)
            cells = ",".join(f"{letter}{r}" for r in rows)
            put(ws, row, col, f"=SUM({cells})", fmt=MONEY, fill=TOTAL_FILL)

    return anchors


# --------------------------------------------------------- 채널별 정산 합계
def build_channel_totals(ws, spec, detail):
    widths(ws, {"A": 2, "B": 20, "C": 32.2, "D": 14, "E": 13, "F": 15,
                "G": 12, "H": 19, "I": 14, "J": 11, "K": 65.2})
    put(ws, 2, 2, f"정산기간 {spec.get('periodRange') or ''}", font=F11B, border=False)

    row = 4
    rows_by_channel = []
    for channel in spec.get("channels") or []:
        put(ws, row, 2, channel.get("name") or "", font=F11B, fill=SUB_FILL)
        basis = channel.get("dateBasis") or ""
        put(ws, row, 3, f"집계기준: {basis}" if basis else "", align="left")
        row += 1
        for i, label in enumerate(CHANNEL_HEADERS):
            put(ws, row, 2 + i, label, font=F11B, fill=HEAD_FILL, align="center")
        row += 1

        totals = channel.get("totals") or {}
        src = detail.get(channel.get("code") or channel.get("name")) or {}
        # 판매데이터 시트의 합계 줄을 가리킨다. 값으로 박으면 두 장의 숫자가
        # 어긋났을 때 어느 쪽이 맞는지 알 수 없다 (실제로 그렇게 틀어졌다).
        def from_detail(letter, fallback):
            if src.get("has"):
                return f"={DETAIL_SHEET}!{letter}{src['row']}"
            return fallback

        put(ws, row, 2, "합계", font=F11B)
        put(ws, row, 3, from_detail("E", totals.get("list", 0)), fmt=MONEY)
        # 채널이 배송을 맡으면 금액 대신 그 사실을 적는다 (쿠팡배송/자체배송 등).
        ship_note = channel.get("shippingNote")
        if ship_note:
            put(ws, row, 4, ship_note, align="center")
        else:
            put(ws, row, 4, from_detail("F", totals.get("shipping", 0)), fmt=MONEY)
        put(ws, row, 5, from_detail("G", totals.get("discount", 0)), fmt=MONEY)
        # 최종결제 = 정가 - 할인 (+ 배송비 결제분).
        sale_f = f"=C{row}-E{row}" if ship_note else f"=C{row}-E{row}+D{row}"
        put(ws, row, 6, sale_f, fmt=MONEY)
        fee_cell(ws, row, 7, channel.get("feeLabel"))
        # 공제율이 숫자인 채널만 수식으로 묶는다. '품목별상이'·'네이버기준'처럼
        # 글자가 오는 채널은 품목별 합을 그대로 받는다.
        rate = channel.get("feeRate")
        if isinstance(rate, (int, float)) and rate:
            put(ws, row, 8, f"=F{row}*G{row}", fmt=MONEY)
        else:
            put(ws, row, 8, from_detail("J", totals.get("fee", 0)), fmt=MONEY)
        put(ws, row, 9, f"=F{row}-H{row}", fmt=MONEY)
        put(ws, row, 10, channel.get("settleBy") or "", align="center")
        put(ws, row, 11, channel.get("note") or "", align="left")
        heights(ws, [row - 2, row], 18)
        rows_by_channel.append({
            "row": row,
            "settleBy": channel.get("settleBy") or "",
            # 매출이 없는 채널은 숨긴다. 지우지 않는 이유는 다음 달에 되살릴 때
            # 채널 목록이 그대로 있어야 하기 때문이다.
            "empty": not any(_num(totals.get(k)) for k in ("list", "sale", "fee", "settle")),
            "first": row - 2,
        })
        row += 2

    # 채널 합계를 한 줄로 모은다. 아래 요약과 정산서가 이 줄을 가리키므로,
    # 어느 한쪽만 따로 계산되어 숫자가 어긋나는 일이 없다.
    total_row = row - 1
    if rows_by_channel:
        top = rows_by_channel[0]["first"] + 1
        for col in (3, 5, 6, 8, 9):
            letter = chr(ord("A") + col - 1)
            put(ws, total_row, col, f"=SUM({letter}{top}:{letter}{total_row - 1})",
                font=F11B, fmt=ACCT, border=False)

    put(ws, total_row + 1, 11, "VAT 포함", font=F9, align="right", border=False)

    row = total_row + 2
    summary = [
        ("list", "소비자정가합계", f"=C{total_row}", "소비자 정상가 기준 판매 합계"),
        ("discount", "할인합계", f"=E{total_row}", "프로모션할인 / 대량구매할인 / 사업자할인 등"),
        ("sale", "최종결제액 합계", f"=F{total_row}", "소비자정가합계 - 할인합계 + 배송비 결제분"),
        ("fee", "공제합계", f"=H{total_row}", "거래수수료 / 카드사 등 결제 PG 수수료"),
        ("settle", "정산합계", f"=I{total_row}", "최종결제액 합계 - 공제합계 = 정산합계"),
    ]
    anchors = {}
    for key, label, formula, note in summary:
        bold = key in ("sale", "settle")
        put(ws, row, 8, label, font=F11B, fill=SUB_FILL)
        put(ws, row, 9, formula, font=F11B if bold else F11, fmt=MONEY)
        put(ws, row, 11, note, align="left", border=False)
        heights(ws, [row], 18)
        anchors[key] = f"I{row}"
        row += 1

    # 정산 주체별 합계. 어떤 채널은 우프가 계산서를 발행하고, 어떤 채널은
    # 업체가 픽키파크로 직접 발행한다 -- 그 둘을 갈라 적어야 한다.
    by_party = {}
    for r in rows_by_channel:
        by_party.setdefault(r["settleBy"] or "우프", []).append(r["row"])
    for party in sorted(by_party, key=lambda x: 0 if x == "우프" else 1):
        put(ws, row, 8, f"정산합계({party})", font=F11B, fill=TOTAL_FILL)
        put(ws, row, 9, "=" + "+".join(f"I{r}" for r in by_party[party]),
            fmt=MONEY, fill=TOTAL_FILL)
        row += 1
    # 정산서가 주체별 A매출·B공제·C정산을 적으려면 칸 주소가 필요하다.
    anchors["parties"] = {
        party: {
            "sale": "+".join(f"F{r}" for r in rows),
            "fee": "+".join(f"H{r}" for r in rows),
            "settle": "+".join(f"I{r}" for r in rows),
        }
        for party, rows in by_party.items()
    }

    # 그 달에 매출이 없던 채널은 블록째 숨긴다. 블록 사이 빈 줄까지 접어야
    # 빈 채널 자리가 공백으로 남지 않는다 -- 다만 마지막 채널 뒤의 한 줄은
    # 총계 줄이라 건드리지 않는다.
    for i, r in enumerate(rows_by_channel):
        if not r["empty"]:
            continue
        last = r["row"] + (1 if i < len(rows_by_channel) - 1 else 0)
        for rr in range(r["first"], last + 1):
            ws.row_dimensions[rr].hidden = True

    spec["_pickyAnchors"] = anchors


# ------------------------------------------------------------------ 정산서
# 양식과 셀 단위로 같게 그린다. 실비는 이 장에 숫자로 올리지 않는다 -- 정산에서
# 공제하지 않는 값을 표에 함께 세우면 공제한 것처럼 읽힌다. 별도 청구 사실은
# 메모 한 줄로만 알린다.
def build_summary(ws, spec):
    widths(ws, {"A": 3.7, "B": 31.3, "C": 23.8, "D": 34.7, "E": 17.3, "F": 17.5,
                "G": 11.2, "H": 8.8, "L": 13.3, "M": 44.5, "N": 8.7, "O": 8.5,
                "P": 8.8})
    for row, height in [(2, 24), (3, 13), (4, 16), (6, 23), (10, 28), (11, 40),
                        (12, 71), (15, 10), (16, 15.8), (17, 38)]:
        ws.row_dimensions[row].height = height

    put(ws, 2, 2, spec.get("title") or "월별 세부 판매 현황", font=F10B, border=False)

    put(ws, 4, 2, "[판매내역 종합]", font=F10B, align="left", border=False)
    put(ws, 4, 7, "vat포함", font=F10, align="right", border=False)

    for i, (label, font, fill) in enumerate([
        ("계산서 발행 (신고)기준", F10, None),
        ("집계 기준 (채널별 상이)", F10B, None),
        ("소비자정가계", F10B, BLUE_FILL),
        ("매출계", F10B, BLUE_FILL),
        ("수수료 (공제계)", F10B, GREEN_FILL),
        ("정산합계", F10B, GREEN_FILL),
    ]):
        put(ws, 5, 2 + i, label, font=font, fill=fill, align="center")

    rollup = spec.get("rollup") or {}
    # 채널 합계 시트의 요약 칸을 가리킨다.
    anchors = spec.get("_pickyAnchors") or {}
    ref = lambda key, fb: (f"={TOTALS_SHEET}!{anchors[key]}" if anchors.get(key)
                           else rollup.get(fb, 0))
    put(ws, 6, 2, spec.get("issueBasisDate") or "", font=F10B, align="center")
    put(ws, 6, 3, spec.get("periodRange") or "", font=F10B, align="center")
    for i, (akey, fb) in enumerate([("list", "listTotal"), ("sale", "realSaleTotal"),
                                    ("fee", "feeTotal"), ("settle", "settleTotal")]):
        put(ws, 6, 4 + i, ref(akey, fb), font=F10B, fmt=MONEY, align="center")

    put(ws, 8, 2, "매출계산서발행", font=F10B, align="left", border=False)
    ws.merge_cells("B8:C8")
    put(ws, 8, 10, "vat포함", font=F10, align="right", border=False)

    for i, label in enumerate(["항목", "A 매출", "B 공제계", "C 정산계", "비고"]):
        put(ws, 9, 2 + i, label, font=F10, fill=SUB_FILL, align="center")
    ws.merge_cells("F9:J9")
    for col in range(6, 11):
        ws.cell(row=9, column=col).fill = SUB_FILL
        ws.cell(row=9, column=col).border = BOX

    row = 10
    put(ws, row, 2, "정산합계", font=F10, align="center")
    # 위 [판매내역 종합] 줄을 그대로 가리킨다.
    put(ws, row, 3, "=E6", font=F10B, fmt=MONEY, align="center")
    put(ws, row, 4, "=F6", font=F10, fmt=MONEY, align="center")
    put(ws, row, 5, "=G6", font=F10B, fmt=MONEY, align="center")
    put(ws, row, 6, "", border=True)
    ws.merge_cells("F10:J10")
    for col in range(6, 11):
        ws.cell(row=row, column=col).border = BOX
    row += 1

    notes = {
        "픽키파크": "직접 픽키파크로 업체가 발행 후, 해당 업체에서 픽키파크 계좌로 직접 대금 지급되는 건입니다.",
        "우프": "우프에서 B (공제계) 만큼 수수료 세금계산서를 발행 하고, C 정산계 만큼 대금을 입금해요.  \n"
                "픽키파크에서 A 매출을 기타매출로 신고 하시면 됩니다.",
    }
    # 픽키파크 → 우프 순으로 적는다 (양식과 같은 순서). 주체는 채널 시트에서
    # 그대로 끌어온다 -- spec 에 따로 담아 두면 채널 표와 어긋날 수 있다.
    party_cells = (anchors.get("parties") or {})
    for name in sorted(party_cells, key=lambda x: 0 if x == "픽키파크" else 1):
        cells = party_cells[name]
        fill = PARTY_FILL if name == "우프" else None
        put(ws, row, 2, f"{name} 정산", font=F10, fill=fill, align="center")
        for i, key in enumerate(["sale", "fee", "settle"]):
            formula = "=" + "+".join(
                f"{TOTALS_SHEET}!{c}" for c in cells[key].split("+"))
            put(ws, row, 3 + i, formula,
                font=F10 if key == "fee" else F10B,
                fill=fill, fmt=MONEY, align="center")
        cell = put(ws, row, 6, notes.get(name, ""), font=F10)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.merge_cells(start_row=row, start_column=6, end_row=row, end_column=10)
        for col in range(6, 11):
            ws.cell(row=row, column=col).border = BOX
        row += 1

    row = 16
    put(ws, row, 2, "[메모/특이사항]", font=F10B, align="left", border=False)
    ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=3)
    row += 1
    for line in spec.get("memo") or []:
        put(ws, row, 2, line, font=F10, align="left", border=False)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=4)
        row += 1


def build_source_sheet(ws, source):
    """올린 채널 파일을 그대로 적는다. 파서는 행을 {열이름: 값} 으로 준다."""
    rows = source.get("rows") or []
    if not rows:
        return
    header, seen = [], set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                header.append(key)
    for c, key in enumerate(header, start=1):
        cell = ws.cell(row=1, column=c, value=key)
        cell.font = F11B
        cell.fill = SUB_FILL
    for r, row in enumerate(rows, start=2):
        for c, key in enumerate(header, start=1):
            cell = ws.cell(row=r, column=c, value=row.get(key))
            cell.font = F11


def build(spec, path):
    wb = Workbook()
    wb.active.title = "정산서"
    # 뒷장부터 그린다 -- 앞장이 뒷장의 칸을 수식으로 가리키므로 어느 행에
    # 찍혔는지 먼저 알아야 참조를 쓸 수 있다.
    detail = build_channel_detail(wb.create_sheet("채널별 판매데이터 정리"), spec)
    build_channel_totals(wb.create_sheet("채널별 정산 합계"), spec, detail)
    build_summary(wb["정산서"], spec)
    # 양식의 시트 순서: 정산서 → 합계 → 판매데이터 → DB)
    wb.move_sheet("채널별 정산 합계", offset=-1)

    # 매출이 없던 채널은 판매데이터 시트에서도 제목만 남기고 접는다.
    ws = wb["채널별 판매데이터 정리"]
    for channel in spec.get("channels") or []:
        src = detail.get(channel.get("code") or channel.get("name")) or {}
        totals = channel.get("totals") or {}
        if any(_num(totals.get(k)) for k in ("list", "sale", "fee", "settle")):
            continue
        start, end = src.get("fold", (0, -1))
        for rr in range(start, end + 1):
            ws.row_dimensions[rr].hidden = True

    # 올린 채널 파일을 DB) 시트로 뒤에 붙인다. 시트 이름에 못 쓰는 글자는 뺀다.
    used = set(wb.sheetnames)
    for source in spec.get("sources") or []:
        base = f"DB){source.get('label') or source.get('channel') or ''}"
        title = "".join(ch for ch in base if ch not in "\\/*?:[]")[:31] or "DB)"
        name, n = title, 2
        while name in used:
            name = f"{title[:28]}({n})"
            n += 1
        used.add(name)
        build_source_sheet(wb.create_sheet(name), source)
    wb.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    with open(args.input, encoding="utf-8") as fh:
        spec = json.load(fh)
    build(spec, args.output)


if __name__ == "__main__":
    main()
