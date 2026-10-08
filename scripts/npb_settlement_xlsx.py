#!/usr/bin/env python3
"""Generate the NPB (운영대행) 월별 판매정산서 xlsx, reproducing the
`(도톤)우프_YYYY-M월 판매정산서.xlsx` answer-key layout.

Three sheets:
  1. 종합정산            — rollup row, 재고현황, 정산 방식, 이익분배, 실비 산정표,
                          3PL 단가표, 메모.
  2. 채널별 판매데이터 정리 — one block per channel + grand totals (J78:L82).
  3. DB)입출고목록       — summary rows + the uploaded 입출고 원장 ledger.

CLI: python3 npb_settlement_xlsx.py --input <spec.json> --output <out.xlsx>

Invoked from Node via execFile, mirroring scripts/settlement_excel.py.
See scripts/settlement_excel.py for the shared openpyxl style vocabulary
(Alignment/Border/Font/PatternFill/Side, insert_logo, 맑은 고딕).
"""

import argparse
import calendar
import json
import os
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

try:
    from openpyxl.drawing.image import Image as XLImage
except Exception:  # pragma: no cover
    XLImage = None

LOGO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wooof_logo.png")

# ---------------------------------------------------------------- style vocab
WOOOF_GREEN = "1FA84C"
GREY_FILL = PatternFill("solid", fgColor="D9D9D9")
LIGHT_FILL = PatternFill("solid", fgColor="F2F2F2")
GREEN_FILL = PatternFill("solid", fgColor="E2EFDA")
BLUE_FILL = PatternFill("solid", fgColor="DDEBF7")

_THIN = Side(style="thin", color="808080")
_MED = Side(style="medium", color="404040")
BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
BORDER_MED = Border(left=_MED, right=_MED, top=_MED, bottom=_MED)

FONT = Font(name="맑은 고딕", size=10)
FONT9 = Font(name="맑은 고딕", size=9)
FONT9B = Font(name="맑은 고딕", size=9, bold=True)
FONT11 = Font(name="맑은 고딕", size=11)
BOLD = Font(name="맑은 고딕", size=10, bold=True)
BOLD11 = Font(name="맑은 고딕", size=11, bold=True)
BOLD12 = Font(name="맑은 고딕", size=12, bold=True)
LOGO_FONT = Font(name="Arial Black", size=20, bold=True, color=WOOOF_GREEN)

CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
CENTER_NW = Alignment(horizontal="center", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")
LEFT = Alignment(horizontal="left", vertical="center")

WON = "#,##0"
PCT = "0%"
DATE_YM = 'yyyy"년"\\ m"월";@'


def insert_logo(ws, cell="A1"):
    """Place the WOOOF logo image; fall back to green text (see settlement_excel.py)."""
    if XLImage and os.path.exists(LOGO_PATH):
        try:
            img = XLImage(LOGO_PATH)
            img.width, img.height = 150, 27
            img.anchor = cell
            ws.add_image(img)
            return
        except Exception:
            pass
    ws[cell] = "WOOOF"
    ws[cell].font = LOGO_FONT
    ws[cell].alignment = LEFT


def box(ws, cell_range, border=BORDER):
    for row in ws[cell_range]:
        for c in row:
            c.border = border


def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _fmt_for(v):
    """Infer a display number-format from a value (rates < 1 -> %, big ints -> 천단위)."""
    if isinstance(v, bool):
        return None
    if isinstance(v, float) and not v.is_integer() and 0 < v <= 1:
        return PCT
    if isinstance(v, int) and abs(v) >= 1000:
        return WON
    if isinstance(v, float) and v.is_integer() and abs(v) >= 1000:
        return WON
    return None


# --------------------------------------------------------------- sheet 1
def build_summary(ws, spec):
    ws.sheet_view.showGridLines = False
    period = spec.get("period", {})
    roll = spec.get("rollup", {})

    insert_logo(ws, "A1")

    # --- [판매내역 종합] rollup table (B2:J4) ---
    ws["B2"] = "[판매내역 종합]"
    ws["B2"].font = BOLD
    ws["J2"] = "vat포함"
    ws["J2"].font = FONT11
    ws["J2"].alignment = RIGHT

    heads = ["정산 월", "실판매수량", "판매정가계", "할인계", "실판매계",
             "공제 수수료 \n(공급마진)", "매출계", "실비", "이익"]
    for i, h in enumerate(heads):
        c = ws.cell(row=3, column=2 + i, value=h)
        c.font = BOLD
        c.fill = GREY_FILL
        c.alignment = CENTER
    y = int(period.get("year", 2026))
    m = int(period.get("month", 1))
    dcell = ws.cell(row=4, column=2, value=datetime(y, m, 1))
    dcell.number_format = DATE_YM
    dcell.alignment = CENTER_NW
    dcell.font = FONT
    # 채널 시트의 집계 칸을 가리킨다. 값으로 박으면 채널 표를 고쳤을 때
    # 종합정산이 따라오지 않아 두 장의 숫자가 어긋난다 -- 손으로 고쳐 보내야
    # 했던 원인이 이것이다.
    g = spec.get("_grandCells") or {}
    ref = lambda key: "='채널별 판매데이터 정리'!{}".format(g[key]) if g.get(key) else None
    data = [
        (ref("qty"), roll.get("qtyTotal")),            # C 실판매수량
        (ref("list"), roll.get("listTotal")),          # D 판매정가계
        ("=D4-F4", roll.get("discountTotal")),         # E 할인계 = 정가계 - 실판매계
        (ref("sales"), roll.get("realSaleTotal")),     # F 실판매계
        (ref("fee"), roll.get("feeTotal")),            # G 공제 수수료
        ("=F4-G4", roll.get("revenueTotal")),          # H 매출계
        ("=F26", roll.get("logisticsCost")),           # I 실비 (아래 물류 합계)
        ("=H4-I4", roll.get("profit")),                # J 이익
    ]
    for i, (formula, fallback) in enumerate(data):
        c = ws.cell(row=4, column=3 + i, value=formula if formula else fallback)
        c.number_format = WON
        c.alignment = CENTER_NW
        c.font = BOLD11
    box(ws, "B3:J4")

    # --- [재고현황] block (L5:Y12) ---
    ws["L5"] = "[재고현황]"
    ws["L5"].font = BOLD11
    ws["M5"] = "자사물류센터 입출고 기준"
    ws["M5"].font = FONT
    for rng, txt in (("N6:P6", period.get("monthStart", "")),
                     ("Q6:V6", period.get("range", "")),
                     ("W6:Y6", period.get("monthEnd", ""))):
        ws.merge_cells(rng)
        top = rng.split(":")[0]
        ws[top] = txt
        ws[top].font = BOLD11
        ws[top].fill = GREY_FILL
        ws[top].alignment = CENTER_NW
    for rng, txt in (("N7:P7", "기초재고"), ("Q7:S7", "입고"),
                     ("T7:V7", "출고"), ("W7:Y7", "기말재고")):
        ws.merge_cells(rng)
        top = rng.split(":")[0]
        ws[top] = txt
        ws[top].font = BOLD11
        ws[top].fill = LIGHT_FILL
        ws[top].alignment = CENTER_NW
    subheads = ["품목관리코드", "품목명", "전체", "정상", "불용", "전체", "입고",
                "반품", "전체", "판매", "비매출", "전체", "정상", "불용"]
    for i, h in enumerate(subheads):
        c = ws.cell(row=8, column=12 + i, value=h)  # L=12
        c.font = FONT9B
        c.fill = LIGHT_FILL
        c.alignment = CENTER
    inv = spec.get("inventory", [])
    # N~Y. '전체' 칸은 옆 칸의 합이고 기말은 기초+입고-출고라, 값으로 박지 않고
    # 수식으로 둔다 -- 실사로 한 칸을 고치면 나머지가 따라와야 한다.
    # 열: N전체 O정상 P불용 | Q전체 R입고 S반품 | T전체 U판매 V비매출 | W전체 X정상 Y불용
    inv_inputs = {"O": "openOk", "P": "openDead", "R": "inIn", "S": "inReturn",
                  "U": "outSold", "V": "outNonsale", "Y": "closeDead"}
    inv_formulas = {"N": "=O{r}+P{r}", "Q": "=R{r}+S{r}", "T": "=U{r}+V{r}",
                    "W": "=N{r}+Q{r}-T{r}", "X": "=W{r}-Y{r}"}
    first = 9
    r = first
    for item in inv:
        ws.cell(row=r, column=12, value=item.get("code")).alignment = CENTER_NW
        ws.cell(row=r, column=13, value=item.get("name")).font = FONT
        for letter, key in inv_inputs.items():
            c = ws.cell(row=r, column=_col_idx(letter), value=_num(item.get(key)))
            c.alignment = CENTER_NW
            c.font = FONT
        for letter, tpl in inv_formulas.items():
            c = ws.cell(row=r, column=_col_idx(letter), value=tpl.format(r=r))
            c.alignment = CENTER_NW
            c.font = FONT
        r += 1
    last = r - 1
    # 품목이 둘뿐이어도 합계는 12행에 둔다(기존 양식과 같은 자리).
    inv_sum_row = max(12, r)
    ws.cell(row=inv_sum_row, column=13, value="합계").font = BOLD
    for letter in list(inv_inputs) + list(inv_formulas):
        c = ws.cell(row=inv_sum_row, column=_col_idx(letter))
        c.value = "=SUM({l}{a}:{l}{b})".format(l=letter, a=first, b=last) if inv else 0
        c.alignment = CENTER_NW
        c.font = BOLD
    box(ws, "L8:Y{}".format(inv_sum_row))

    # --- [정산 방식/ VAT포함] block (B6:J11) ---
    ws["B6"] = "[정산 방식/ VAT포함]"
    ws["B6"].font = BOLD
    ws["B6"].alignment = LEFT
    method_rows = [
        ("항목", "비고"),
        ("A 수수료 (공급마진)", "각 유통 채널별 공급마진 (위탁은 수수료/ 매입은 공급할인액) 기준"),
        ("B 매출계 (월별 최종 판매 금액)",
         "월별 제품 최종판매금액\n(정가 - 프로모션 등 할인이 반영된 최종 결제 금액)"),
        ("C 실비", "운송료 실비, PG결제 수수료 등"),
        ("D 이익",
         "판매 매출 발생 시, “월별 제품 최종 판매 금액”을 기준으로, 인플루언서 공구 "
         "수수료를 포함한 각각의 입점 채널별 공급 수수료, 운송료 실비, PG사 결제 수수료를 제외한 금액"),
    ]
    for i, (label, note) in enumerate(method_rows):
        rr = 7 + i
        ws.merge_cells("B{0}:E{0}".format(rr))
        ws.merge_cells("F{0}:J{0}".format(rr))
        lc = ws["B{}".format(rr)]
        lc.value = label
        lc.font = FONT9B if i == 0 else FONT9
        lc.alignment = CENTER_NW if i == 0 else LEFT
        if i == 1:
            lc.fill = GREEN_FILL
        nc = ws["F{}".format(rr)]
        nc.value = note
        nc.font = FONT9B if i == 0 else FONT9
        nc.alignment = CENTER_NW if i == 0 else LEFT
    box(ws, "B7:J11")

    # --- 이익분배 block (B14:F19) ---
    ws["B14"] = "매출계산서발행"
    ws["B14"].font = BOLD11
    ws["F14"] = "vat포함"
    ws["F14"].font = FONT
    for i, h in enumerate(["항목", "구분", "비율", "금액", "비고"]):
        c = ws.cell(row=15, column=2 + i, value=h)
        c.font = FONT11
        c.fill = LIGHT_FILL
        c.alignment = CENTER_NW
    parties = spec.get("profitSplit", [])
    n = len(parties)
    if n:
        ws.merge_cells("B16:B{}".format(15 + n))
    ws["B16"] = "이익분배"
    ws["B16"].font = FONT11
    ws["B16"].alignment = CENTER
    r = 16
    for p in parties:
        ws.cell(row=r, column=3, value=p.get("partyName")).font = FONT11
        rc = ws.cell(row=r, column=4, value=p.get("ratio"))
        rc.number_format = PCT
        rc.alignment = CENTER_NW
        rc.font = FONT11
        # 금액은 이익(J4)에 비율을 곱한 수식으로 둔다. 값으로 박으면 위에서
        # 이익이 바뀌었을 때 분배액이 따라오지 않는다.
        ac = ws.cell(row=r, column=5, value="=$J$4*D{}".format(r))
        ac.number_format = WON
        ac.alignment = CENTER_NW
        ac.font = FONT11
        note = p.get("note") or ("제외" if p.get("excluded") else "")
        ws.cell(row=r, column=6, value=note).font = FONT11
        r += 1
    sum_row = 16 + n
    ws.merge_cells("B{0}:C{0}".format(sum_row))
    ws["B{}".format(sum_row)] = "합계"
    ws["B{}".format(sum_row)].font = FONT11
    ws["B{}".format(sum_row)].alignment = CENTER_NW
    rc = ws.cell(row=sum_row, column=4,
                 value="=SUM(D16:D{})".format(15 + n) if n else 1)
    rc.number_format = PCT
    rc.alignment = CENTER_NW
    ac = ws.cell(row=sum_row, column=5,
                 value="=SUM(E16:E{})".format(15 + n) if n
                 else roll.get("profit"))
    ac.number_format = WON
    ac.alignment = CENTER_NW
    box(ws, "B15:F{}".format(sum_row))

    # --- 실비 산정표 (B21:F28) ---
    ws["B21"] = "[실비 : 운임/물류]"
    ws["B21"].font = BOLD
    ws["F21"] = "vat포함"
    ws["F21"].font = FONT
    log = spec.get("logistics", {})
    ws.merge_cells("B22:B23")
    ws["B22"] = "{}년 {}월".format(y, m)
    ws["B22"].font = BOLD
    ws["B22"].alignment = CENTER
    ws.merge_cells("C22:F22")
    ws["C22"] = "물류 실비 산정"
    ws["C22"].font = BOLD
    ws["C22"].alignment = CENTER
    for i, h in enumerate(["수량(출고건수)", "택배", "피킹/패킹/부자재", "총계"]):
        c = ws.cell(row=23, column=3 + i, value=h)
        c.font = BOLD
        c.fill = LIGHT_FILL
        c.alignment = CENTER
    # 실비 행은 출고 유형 수만큼 그린다. 브랜드마다 유형이 다르다 — 도톤은
    # 소형/대형, 픽키는 3PL/본사/용달. 유형이 둘이면 예전과 같은 자리에 찍힌다.
    breakdown = log.get("breakdown") or [
        {"label": "택배(소형)", "count": log.get("smallCount", 0),
         "freight": log.get("smallShip"), "handling": log.get("pickPack"),
         "amount": log.get("smallTotal")},
        {"label": "택배(중대형)", "count": log.get("largeCount", 0),
         "freight": log.get("largeShip"), "handling": log.get("pickPack"),
         "amount": log.get("largeTotal", 0)},
    ]
    # 3PL 단가표에서 건당 단가를 끌어온다 -- spec 이 단가를 안 주면 실비가
    # 0 으로 나가고, 종합정산의 이익까지 그만큼 부풀려진다.
    table = spec.get("threePLTable") or []

    def unit_price(*keywords):
        for row in table:
            text = "{} {}".format(row.get("item", ""), row.get("note", ""))
            if all(k in text for k in keywords):
                return _num(row.get("unitPrice"))
        return None

    handling_default = unit_price("물류비")
    freight_defaults = {0: unit_price("택배운임비", "소형"),
                        1: unit_price("택배운임비", "중대형")}

    money_cells = []
    row_i = 24
    first_row = row_i
    for n, b in enumerate(breakdown):
        ws.cell(row=row_i, column=2, value=b.get("label")).alignment = CENTER_NW
        ws.cell(row=row_i, column=3, value=b.get("count") or None)
        # 용달·퀵은 건당 단가가 없고 실비만 있다.
        freight = b.get("freight")
        if freight is None:
            freight = freight_defaults.get(n)
        handling = b.get("handling")
        if handling is None and freight is not None:
            handling = handling_default
        ws.cell(row=row_i, column=4, value=freight or None)
        ws.cell(row=row_i, column=5, value=handling or None)
        # 건수 x (택배 + 피킹) 를 수식으로 둔다. 건수를 고치면 실비와 이익이
        # 따라 움직여야 한다.
        if b.get("amount") is not None and freight is None:
            ws.cell(row=row_i, column=6, value=b.get("amount"))
        else:
            ws.cell(row=row_i, column=6,
                    value="=C{r}*(D{r}+E{r})".format(r=row_i))
        money_cells += [("C", row_i, True), ("D", row_i, False),
                        ("E", row_i, False), ("F", row_i, True)]
        row_i += 1
    last_row = row_i - 1
    sum_r = row_i
    ws.cell(row=sum_r, column=2, value="합계").alignment = CENTER_NW
    ws.cell(row=sum_r, column=2).font = BOLD
    ws.cell(row=sum_r, column=3,
            value="=SUM(C{}:C{})".format(first_row, last_row))
    ws.cell(row=sum_r, column=6,
            value="=SUM(F{}:F{})".format(first_row, last_row))
    money_cells += [("C", sum_r, True), ("F", sum_r, True)]
    for col, rr, bold in money_cells:
        cell = ws["{}{}".format(col, rr)]
        cell.number_format = WON
        cell.alignment = CENTER_NW
        if bold:
            cell.font = BOLD11
    box(ws, "B22:F{}".format(sum_r))
    # 유형이 둘일 때와 같은 자리에 오도록 아래 내용을 밀어낸다.
    shift = sum_r - 26
    note_r = 27 + shift
    ws.cell(row=note_r, column=2,
            value=("*입고비용 및 보관비용은 한시적 청구제외 하였으며, 운송실비(당사가 3PL 지불하는 "
                   "택배운임비 +물류비) 청구기준만 기재되었습니다.")).font = FONT9
    ws.cell(row=note_r + 1, column=2,
            value="*퀵/용달 등 별도 운송비 발생시에는 개별기재합니다.").font = FONT9

    # --- 3PL 단가표 (B30:F35) ---
    vat_r = 29 + shift
    ws.cell(row=vat_r, column=6, value="vat별도").font = FONT
    ws.cell(row=vat_r, column=6).alignment = RIGHT
    for i, h in enumerate(["항목", "항목", "견적(원)", "단위", "비고"]):
        c = ws.cell(row=30 + shift, column=2 + i, value=h)
        c.font = FONT11
        c.fill = BLUE_FILL
        c.alignment = CENTER_NW
    tpl = spec.get("threePLTable") or spec.get("threePlTable") or [
        {"item": "보관료", "unitPrice": None, "unit": "월/평당 ", "note": "청구제외"},
        {"item": "입고비용", "unitPrice": 0, "unit": "건", "note": "청구제외"},
        {"item": "택배운임비", "unitPrice": 2500, "unit": "건", "note": "로젠택배(소형)"},
        {"item": "택배운임비", "unitPrice": 4000, "unit": "건", "note": "로젠택배(중대형)"},
        {"item": "물류비", "unitPrice": 1300, "unit": "건", "note": "부자재 /피킹/패킹"},
    ]
    tpl_top = 31 + shift
    tpl_bottom = tpl_top + max(len(tpl), 1) - 1
    ws.merge_cells("B{}:B{}".format(tpl_top, tpl_bottom))
    ws.cell(row=tpl_top, column=2, value="3PL \n단가표").font = FONT11
    ws.cell(row=tpl_top, column=2).alignment = CENTER
    for i, row in enumerate(tpl):
        rr = tpl_top + i
        ws.cell(row=rr, column=3, value=row.get("item")).font = FONT11
        pc = ws.cell(row=rr, column=4, value=row.get("unitPrice"))
        pc.number_format = WON
        pc.alignment = CENTER_NW
        ws.cell(row=rr, column=5, value=row.get("unit")).alignment = CENTER_NW
        ws.cell(row=rr, column=6, value=row.get("note")).font = FONT11
    box(ws, "B{}:F{}".format(30 + shift, tpl_bottom))

    # --- 메모 (B38:B43) ---
    memo_top = tpl_bottom + 3
    ws.cell(row=memo_top, column=2, value="[메모/특이사항]").font = BOLD
    memo = spec.get("memo") or [
        "재고이동(오프라인 위탁진열/ 판매시 정산)",
        "비매출: 협찬, 진열품, 샘플 등의 무상사용",
        "세금계산서는 정산 월 기준 익익월 10일에 발행 예정입니다. ",
        "정산금액은 정산 월 기준 익월 15일에 입금 예정이며 정산금액 활용안 협의에 따라 변경될 수 있습니다. ",
        "불용이슈: 패키지 손상/파손",
    ]
    for i, line in enumerate(memo):
        c = ws.cell(row=memo_top + 1 + i, column=2, value=line)
        c.font = FONT9

    # widths
    for col, w in (("A", 5.2), ("B", 11.3), ("C", 16.7), ("D", 13.3), ("E", 16.3),
                   ("F", 12.0), ("G", 12.3), ("I", 10.5), ("J", 12.3), ("K", 6.8),
                   ("L", 16.2), ("M", 38.3), ("N", 9.5)):
        ws.column_dimensions[col].width = w


# --------------------------------------------------------------- sheet 2
# 채널 표는 거래 형태에 따라 칸이 다르다. 위탁은 공급가와 기본수수료를,
# 직매출은 프로모션가와 할인율을, 대리점 매입은 대리점가를 보여 줘야 받는 쪽이
# 자기 계약 조건을 확인할 수 있다. 열 문자는 B 부터 시작한다(A 는 여백).
#
# inputs   : 서버가 보낸 줄 값에서 그 열에 그대로 적을 것
# formulas : 그 열에 적을 수식 ({r} 은 행 번호)
# totals   : 아래 집계 블록이 모아 쓸 열
# pct      : 백분율 서식을 쓸 열
LAYOUTS = {
    "consignment": {
        "label": "위탁재고",
        "headers": ["순번", "제품", "정가", "공급가", "기본수수료", "판매수량",
                    "프로모션차감", "매출합계", "수수료합계", "정산합계", "정가합계"],
        "inputs": {"D": "listPrice", "E": "supplyPrice", "F": "feeRate",
                   "G": "qty", "H": "promoDiscount"},
        "formulas": {"I": "=D{r}*G{r}-H{r}", "J": "=I{r}*F{r}",
                     "K": "=I{r}-J{r}", "L": "=D{r}*G{r}"},
        "totals": {"qty": "G", "discount": "H", "sales": "I", "fee": "J",
                   "settle": "K", "list": "L"},
        "pct": ["F"],
    },
    "direct": {
        "label": "직매출",
        "headers": ["순번", "품목 구성", "정가", "프로모션가", "할인율", "판매수량",
                    "매출합계", "수수료", "수수료합계", "정산합계", "정가합계"],
        "inputs": {"D": "listPrice", "F": "discountRate", "G": "qty", "I": "feeRate"},
        "formulas": {"E": "=D{r}-(D{r}*F{r})", "H": "=E{r}*G{r}",
                     "J": "=H{r}*I{r}", "K": "=H{r}-J{r}", "L": "=D{r}*G{r}"},
        "totals": {"qty": "G", "sales": "H", "fee": "J", "settle": "K", "list": "L"},
        "pct": ["F", "I"],
    },
    "wholesale": {
        "label": "매입(판매)",
        "headers": ["순번", "품목 구성", "정가", "대리점가", "기본수수료", "판매수량",
                    "프로모션차감", "매출합계", "수수료합계", "정산합계", "정가합계"],
        "inputs": {"D": "listPrice", "E": "supplyPrice", "F": "feeRate",
                   "G": "qty", "H": "promoDiscount"},
        "formulas": {"I": "=D{r}*G{r}-H{r}", "J": "=I{r}*F{r}",
                     "K": "=I{r}-J{r}", "L": "=D{r}*G{r}"},
        "totals": {"qty": "G", "discount": "H", "sales": "I", "fee": "J",
                   "settle": "K", "list": "L"},
        "pct": ["F"],
    },
    "vendor_ship": {
        "label": "판매자위탁배송",
        "headers": ["순번", "품목 구성", "정가", "프로모션가", "공급가", "수수료율",
                    "판매수량", "매출합계", "수수료합계", "정산합계", "정가합계"],
        "inputs": {"D": "listPrice", "E": "salePrice", "G": "feeRate", "H": "qty"},
        "formulas": {"F": "=E{r}-E{r}*G{r}", "I": "=E{r}*H{r}",
                     "J": "=E{r}*G{r}*H{r}", "K": "=I{r}-J{r}", "L": "=H{r}*D{r}"},
        "totals": {"qty": "H", "sales": "I", "fee": "J", "settle": "K", "list": "L"},
        "pct": ["G"],
    },
}

DEFAULT_LAYOUT = "direct"


def _col_idx(letter):
    return ord(letter) - ord("A") + 1


def _write_channel_block(ws, ch, r):
    """채널 한 블록을 그리고 (다음 시작행, 합계행 참조) 를 돌려준다."""
    layout = LAYOUTS.get(ch.get("layout")) or LAYOUTS[DEFAULT_LAYOUT]

    ws.cell(row=r, column=2, value=ch.get("name")).font = BOLD11
    if ch.get("desc"):
        ws.cell(row=r, column=4, value=ch["desc"]).font = FONT
    tag = ch.get("tag") or layout["label"]
    tc = ws.cell(row=r, column=11, value=tag)
    tc.font = FONT
    tc.alignment = CENTER_NW

    hr = r + 1
    for i, h in enumerate(layout["headers"]):
        c = ws.cell(row=hr, column=2 + i, value=h)
        c.font = BOLD
        c.fill = LIGHT_FILL
        c.alignment = CENTER

    rows = ch.get("rows", [])
    first = hr + 1
    for n, data in enumerate(rows):
        rr = first + n
        seq = ws.cell(row=rr, column=2, value=n + 1)
        seq.font = FONT
        seq.alignment = CENTER_NW
        name = ws.cell(row=rr, column=3, value=data.get("label", ""))
        name.font = FONT
        name.alignment = CENTER_NW
        for letter, key in layout["inputs"].items():
            c = ws.cell(row=rr, column=_col_idx(letter), value=_num(data.get(key)))
            c.font = FONT
            c.alignment = CENTER_NW
            c.number_format = PCT if letter in layout["pct"] else WON
        for letter, tpl in layout["formulas"].items():
            c = ws.cell(row=rr, column=_col_idx(letter), value=tpl.format(r=rr))
            c.font = FONT
            c.alignment = CENTER_NW
            c.number_format = WON
    last = first + len(rows) - 1

    # 합계 줄 — 값이 아니라 SUM 이라야 위 칸을 고쳤을 때 따라 움직인다.
    sr = last + 1 if rows else first
    sc = ws.cell(row=sr, column=3, value="합계")
    sc.font = BOLD
    sc.alignment = CENTER_NW
    refs = {}
    for key, letter in layout["totals"].items():
        c = ws.cell(row=sr, column=_col_idx(letter))
        c.value = "=SUM({l}{a}:{l}{b})".format(l=letter, a=first, b=last) if rows else 0
        c.font = BOLD
        c.alignment = CENTER_NW
        c.number_format = WON
        refs[key] = "{}{}".format(letter, sr)
    box(ws, "B{}:L{}".format(hr, sr))
    return sr + 2, refs


def build_channels(ws, spec):
    ws.sheet_view.showGridLines = False
    period = spec.get("period", {})
    # "판매기간 2026 8/1 - 8/31". start/end 가 비면 월에서 만들어 쓴다 --
    # 머리글에 기간이 빠진 정산서가 나가면 어느 달 것인지 알 수 없다.
    start = period.get("start") or ""
    end = period.get("end") or ""
    if not start or not end:
        y, m = int(period.get("year") or 0), int(period.get("month") or 0)
        if y and m:
            last = calendar.monthrange(y, m)[1]
            start, end = "{}/1".format(m), "{}/{}".format(m, last)
    ws["B1"] = "판매기간 {} {} - {}".format(period.get("year", ""), start, end)
    ws["B1"].font = BOLD11

    r = 4
    channel_refs = []
    for ch in spec.get("channels", []):
        r, refs = _write_channel_block(ws, ch, r)
        channel_refs.append(refs)

    # 채널 합계를 모으는 블록. 종합정산이 이 칸들을 가리키므로, 두 장의 숫자가
    # 따로 계산되어 어긋나는 일이 없다.
    def total_of(key):
        cells = [refs[key] for refs in channel_refs if refs.get(key)]
        return "=" + "+".join(cells) if cells else 0

    grand = [
        ("총 판매수량", total_of("qty"), "실 수량(1EA단위)"),
        ("정가합계", total_of("list"), "정가 기준"),
        ("매출합계", total_of("sales"), "할인/프로모션 반영 판매계"),
        ("공제합계", total_of("fee"), "공제 수수료 계"),
        ("정산합계", total_of("settle"), "실 정산합계"),
    ]
    base = r + 1
    for i, (label, val, note) in enumerate(grand):
        rr = base + i
        lc = ws.cell(row=rr, column=10, value=label)  # J
        lc.font = BOLD
        lc.fill = LIGHT_FILL
        lc.alignment = CENTER_NW
        vc = ws.cell(row=rr, column=11, value=val)  # K
        vc.number_format = WON
        vc.font = BOLD11
        vc.alignment = CENTER_NW
        nc = ws.cell(row=rr, column=12, value=note)  # L
        nc.font = FONT9
    box(ws, "J{}:L{}".format(base, base + len(grand) - 1))
    # 종합정산이 참조할 수 있도록 어디에 찍혔는지 돌려준다.
    spec["_grandCells"] = {
        "qty": "K{}".format(base), "list": "K{}".format(base + 1),
        "sales": "K{}".format(base + 2), "fee": "K{}".format(base + 3),
        "settle": "K{}".format(base + 4),
    }

    for col, w in (("B", 6), ("C", 30), ("D", 12), ("E", 12), ("F", 11),
                   ("G", 11), ("H", 12), ("I", 13), ("J", 13), ("K", 13), ("L", 20)):
        ws.column_dimensions[col].width = w


# --------------------------------------------------------------- sheet 3
def build_ledger(ws, spec):
    led = spec.get("ledger", {})
    summary = led.get("summary", {})
    # summary rows (C1:I4)
    ws["C1"] = "출고건수 \n(송장기준/건)"
    ws["C1"].font = FONT9B
    ws["C1"].alignment = CENTER
    ws["F1"] = "품목"
    ws["F1"].font = BOLD
    ws["H1"] = "입고합"
    ws["H1"].font = BOLD
    ws["I1"] = "출고합"
    ws["I1"].font = BOLD
    ws["C2"] = summary.get("outCount")
    ws["C2"].font = BOLD11
    ws["C2"].alignment = CENTER_NW
    items = summary.get("items", [])
    r = 2
    for it in items:
        ws.cell(row=r, column=6, value=it.get("name")).font = FONT
        ws.cell(row=r, column=8, value=it.get("inSum")).alignment = CENTER_NW
        ws.cell(row=r, column=9, value=it.get("outSum")).alignment = CENTER_NW
        r += 1
    tr = 2 + len(items)
    ws.cell(row=tr, column=8, value=summary.get("totalIn")).font = BOLD
    ws.cell(row=tr, column=9, value=summary.get("totalOut")).font = BOLD

    # header row A7:T7
    headers = led.get("headers") or [
        "출고카운트", "입출고일자", "입력일자", "공급처명", "바코드번호", "상품명",
        "옵션내용", "원가", "입고수량", "입고금액", "출고수량", "출고금액",
        "재고작업구분", "판매처명", "판매단가", "판매금액", "판매구분", "내용",
        "판매처 주문번호", "판매상세 (판매 수수료율)",
    ]
    for i, h in enumerate(headers):
        c = ws.cell(row=7, column=1 + i, value=h)
        c.font = BOLD
        c.fill = GREY_FILL
        c.alignment = CENTER

    # ledger rows from row 8
    rr = 8
    for row_vals in led.get("rows", []):
        for i, v in enumerate(row_vals):
            if v is None:
                continue
            c = ws.cell(row=rr, column=1 + i, value=v)
            c.font = FONT
            fmt = _fmt_for(v) if not isinstance(v, str) else None
            if fmt:
                c.number_format = fmt
        rr += 1

    widths = [10, 12, 20, 8, 15, 34, 12, 8, 9, 10, 9, 10, 13, 18, 10, 11, 11, 22, 20, 22]
    for i, w in enumerate(widths):
        ws.column_dimensions[ws.cell(row=7, column=1 + i).column_letter].width = w


def build_channel_db(ws, sheet):
    """채널 원본 한 장. 업로드한 표를 그대로 싣는다 -- 채널 표의 숫자가 어디서
    왔는지 받는 쪽이 따라갈 수 있어야 한다."""
    ws.sheet_view.showGridLines = False
    rows = sheet.get("rows") or []
    if not rows:
        return
    headers = [k for k in (rows[0] or {}).keys()] if isinstance(rows[0], dict) else []
    if headers:
        body = [[r.get(h) for h in headers] for r in rows]
    else:
        headers = sheet.get("headers") or []
        body = rows
    for i, h in enumerate(headers):
        c = ws.cell(row=1, column=1 + i, value=h)
        c.font = BOLD
        c.fill = GREY_FILL
        c.alignment = CENTER
    for n, vals in enumerate(body):
        for i, v in enumerate(vals):
            if v is None:
                continue
            c = ws.cell(row=2 + n, column=1 + i, value=v)
            c.font = FONT
            fmt = _fmt_for(v) if not isinstance(v, str) else None
            if fmt:
                c.number_format = fmt
    ws.freeze_panes = "A2"
    for i in range(len(headers)):
        ws.column_dimensions[ws.cell(row=1, column=1 + i).column_letter].width = 16


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        spec = json.load(f)

    wb = Workbook()
    ws1 = wb.active
    ws1.title = "종합정산"
    # 채널 시트를 먼저 그린다 -- 종합정산이 그 집계 칸을 수식으로 가리키므로,
    # 어느 행에 찍혔는지 알아야 참조를 쓸 수 있다.
    build_channels(wb.create_sheet("채널별 판매데이터 정리"), spec)
    build_summary(ws1, spec)
    build_ledger(wb.create_sheet("DB)입출고목록"), spec)
    db_sheets = spec.get("channelDbSheets") or []
    used = set(wb.sheetnames)
    for sheet in db_sheets:
        title = sheet.get("name") or "DB)원본"
        # 같은 이름이 둘이면 openpyxl 이 조용히 바꿔 버린다 -- 직접 번호를 붙인다.
        if title in used:
            n = 2
            while "{}{}".format(title[:28], n) in used:
                n += 1
            title = "{}{}".format(title[:28], n)
        used.add(title)
        build_channel_db(wb.create_sheet(title), sheet)

    wb.save(args.output)
    print(json.dumps({"ok": True,
                      "channels": len(spec.get("channels", [])),
                      "dbSheets": len(db_sheets),
                      "inventoryRows": len(spec.get("inventory", [])),
                      "ledgerRows": len(spec.get("ledger", {}).get("rows", []))}))


if __name__ == "__main__":
    main()
