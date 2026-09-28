#!/usr/bin/env python3
"""Generate a production purchase order (발주서) xlsx from a JSON spec.

Spec JSON:
{
  "docNo": "PO-20260928-001",
  "orderDate": "2026-09-28",
  "issuer": {"businessName","businessNumber","representativeName","address","bankInfo"},
  "partner": {"name","businessName","businessNumber","representativeName","address",
              "contactName","contactEmail"},
  "lineItems": [{"itemName","spec","quantity","unit","unitPrice","totalPrice"}, ...],
  "deliveryPlace": "...",
  "subtotal": 0, "vat": 0, "total": 0,
  "note": "..."
}
"""

import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

_THIN = Side(style="thin", color="808080")
BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
HEAD_FILL = PatternFill("solid", fgColor="D9D9D9")
BOLD = Font(bold=True)
TITLE = Font(size=20, bold=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
WON = "#,##0"


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_purchase_order(ws, spec):
    ws.title = "발주서"
    ws["A1"] = "발  주  서"
    ws["A1"].font = TITLE
    ws.merge_cells("A1:E1")
    ws["A1"].alignment = CENTER

    ws["F2"] = "문서번호"
    ws["G2"] = spec.get("docNo", "")
    ws["F3"] = "발주일"
    ws["G3"] = spec.get("orderDate", "")

    issuer = spec.get("issuer", {})
    partner = spec.get("partner", {})

    ws["A3"] = "발행"
    ws["A3"].font = BOLD
    ws["B3"] = issuer.get("businessName", "")
    ws["A4"] = "사업자번호"
    ws["B4"] = issuer.get("businessNumber", "")
    ws["A5"] = "대표자"
    ws["B5"] = issuer.get("representativeName", "")
    ws["A6"] = "주소"
    ws["B6"] = issuer.get("address", "")
    ws["A7"] = "계좌"
    ws["B7"] = issuer.get("bankInfo", "")

    ws["D3"] = "수신"
    ws["D3"].font = BOLD
    ws["E3"] = partner.get("businessName") or partner.get("name", "")
    ws["D4"] = "사업자번호"
    ws["E4"] = partner.get("businessNumber", "")
    ws["D5"] = "대표자"
    ws["E5"] = partner.get("representativeName", "")
    ws["D6"] = "담당자"
    ws["E6"] = f"{partner.get('contactName', '')} {partner.get('contactEmail', '')}".strip()
    ws["D7"] = "주소"
    ws["E7"] = partner.get("address", "")

    headers = ["순번", "품목명", "규격", "수량", "단위", "단가", "합계"]
    header_row = 9
    for ci, htext in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=ci, value=htext)
        c.font = BOLD
        c.fill = HEAD_FILL
        c.alignment = CENTER
        c.border = BORDER

    r = header_row + 1
    for i, item in enumerate(spec.get("lineItems", []), start=1):
        vals = [i, item.get("itemName", ""), item.get("spec", ""), _num(item.get("quantity")),
                item.get("unit", ""), _num(item.get("unitPrice")), _num(item.get("totalPrice"))]
        for ci, v in enumerate(vals, start=1):
            c = ws.cell(row=r, column=ci, value=v)
            c.border = BORDER
            if ci in (6, 7):
                c.number_format = WON
        r += 1

    sr = r + 1
    ws.cell(row=sr, column=6, value="소계").font = BOLD
    ws.cell(row=sr, column=7, value=_num(spec.get("subtotal"))).number_format = WON
    ws.cell(row=sr + 1, column=6, value="부가세").font = BOLD
    ws.cell(row=sr + 1, column=7, value=_num(spec.get("vat"))).number_format = WON
    ws.cell(row=sr + 2, column=6, value="합계").font = BOLD
    ws.cell(row=sr + 2, column=7, value=_num(spec.get("total"))).number_format = WON

    ws.cell(row=sr, column=1, value="납품장소")
    ws.cell(row=sr, column=2, value=spec.get("deliveryPlace", ""))
    ws.cell(row=sr + 1, column=1, value="비고")
    ws.cell(row=sr + 1, column=2, value=spec.get("note", ""))

    widths = [6, 26, 16, 8, 8, 12, 14]
    for ci, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=header_row, column=ci).column_letter].width = w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        spec = json.load(f)

    wb = Workbook()
    ws = wb.active
    build_purchase_order(ws, spec)
    wb.save(args.output)
    print(json.dumps({"ok": True, "lineCount": len(spec.get("lineItems", []))}))


if __name__ == "__main__":
    main()
