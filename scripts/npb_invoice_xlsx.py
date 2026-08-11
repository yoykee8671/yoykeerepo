#!/usr/bin/env python3
"""실비 청구서 xlsx 생성.

26년 6월분부터 운임/광고 실비는 판매정산서에 합치지 않고 따로 발행한다.
공헌이익을 볼 때 계정별로 갈라 보기 위해서다. 그래서 정산서와 같은 파일에
붙이지 않고 청구서 한 장으로 독립시킨다.

    python3 npb_invoice_xlsx.py --input <invoice.json> --output <out.xlsx>
"""

import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

THIN = Side(style="thin", color="D0D0D0")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="F2F2F2")
TOTAL_FILL = PatternFill("solid", fgColor="FFF6E5")
MONEY = "#,##0"

COLUMNS = [
    ("항목", 34),
    ("건수", 10),
    ("단가", 12),
    ("금액", 14),
    ("비고", 40),
]


def money(cell, value):
    cell.value = value
    cell.number_format = MONEY
    cell.alignment = Alignment(horizontal="right")


def build(invoice, path):
    wb = Workbook()
    ws = wb.active
    ws.title = "청구서"

    for i, (_, width) in enumerate(COLUMNS, start=2):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.column_dimensions["A"].width = 2

    title = ws.cell(row=2, column=2, value=invoice.get("title") or "실비 청구서")
    title.font = Font(size=15, bold=True)

    supplier = invoice.get("businessName") or invoice.get("brandName") or ""
    meta = [
        ("공급받는 자", supplier),
        ("집계 기간", invoice.get("periodMonth") or ""),
        ("계정 분류", invoice.get("account") or ""),
        ("발행일", str(invoice.get("issuedAt") or "")[:10]),
        ("입금 기한", invoice.get("dueDate") or ""),
    ]
    row = 4
    for label, value in meta:
        key = ws.cell(row=row, column=2, value=label)
        key.font = Font(bold=True)
        key.fill = HEAD_FILL
        key.border = BOX
        cell = ws.cell(row=row, column=3, value=value)
        cell.border = BOX
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=6)
        for col in range(3, 7):
            ws.cell(row=row, column=col).border = BOX
        row += 1

    row += 1
    header_row = row
    for i, (label, _) in enumerate(COLUMNS, start=2):
        cell = ws.cell(row=header_row, column=i, value=label)
        cell.font = Font(bold=True)
        cell.fill = HEAD_FILL
        cell.border = BOX
        cell.alignment = Alignment(horizontal="center")
    row += 1

    for item in invoice.get("items") or []:
        ws.cell(row=row, column=2, value=item.get("label") or "").border = BOX
        count = item.get("count") or 0
        cell = ws.cell(row=row, column=3)
        cell.value = count if count else ""
        cell.number_format = MONEY
        cell.alignment = Alignment(horizontal="right")
        cell.border = BOX
        unit = item.get("unit") or 0
        cell = ws.cell(row=row, column=4)
        cell.value = unit if unit else ""
        cell.number_format = MONEY
        cell.alignment = Alignment(horizontal="right")
        cell.border = BOX
        cell = ws.cell(row=row, column=5)
        money(cell, item.get("amount") or 0)
        cell.border = BOX
        note = ws.cell(row=row, column=6, value=item.get("note") or "")
        note.border = BOX
        note.alignment = Alignment(wrap_text=True, vertical="center")
        row += 1

    total_cell = ws.cell(row=row, column=2, value="합계")
    total_cell.font = Font(bold=True)
    total_cell.fill = TOTAL_FILL
    total_cell.border = BOX
    for col in (3, 4, 6):
        cell = ws.cell(row=row, column=col)
        cell.fill = TOTAL_FILL
        cell.border = BOX
    cell = ws.cell(row=row, column=5)
    money(cell, invoice.get("total") or 0)
    cell.font = Font(bold=True)
    cell.fill = TOTAL_FILL
    cell.border = BOX
    row += 2

    ws.cell(row=row, column=2, value="[안내]").font = Font(bold=True)
    row += 1
    notes = [
        "본 청구서는 판매정산서와 별도로 발행되는 실비 청구분입니다.",
        "정산서에는 포함·공제되지 않으며, 계정별 분류를 위해 분리 발행합니다.",
        "금액은 VAT 포함 기준입니다.",
    ]
    if invoice.get("note"):
        notes.append(str(invoice["note"]))
    for text in notes:
        ws.cell(row=row, column=2, value=text)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=6)
        row += 1

    wb.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    with open(args.input, encoding="utf-8") as fh:
        invoice = json.load(fh)
    build(invoice, args.output)


if __name__ == "__main__":
    main()
