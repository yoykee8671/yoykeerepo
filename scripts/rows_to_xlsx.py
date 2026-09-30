#!/usr/bin/env python3
"""Write a plain data table (header row + rows) to xlsx. Shared by every
"이 목록을 엑셀로 다운로드/일괄 업로드" screen (거래처/원부자재/납품지 등) --
one generic writer instead of a bespoke script per table.

Spec JSON:
{
  "sheetName": "거래처",
  "headers": ["ID", "거래처명", ...],
  "rows": [["partner_abc123", "동광섬유", ...], ...]
}

The ID column (always first) is how a re-uploaded row is matched back to
an existing record on import -- see xlsx_to_json.py for the reverse
direction and server.js for the create/update logic.
"""

import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEADER_FILL = PatternFill("solid", fgColor="E8E8E8")
HEADER_FONT = Font(bold=True)


def build(ws, spec):
    ws.title = spec.get("sheetName", "Sheet1")[:31]
    headers = spec.get("headers", [])
    rows = spec.get("rows", [])

    for ci, htext in enumerate(headers, start=1):
        c = ws.cell(row=1, column=ci, value=htext)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center")

    for ri, row in enumerate(rows, start=2):
        for ci, value in enumerate(row, start=1):
            ws.cell(row=ri, column=ci, value=value)

    for ci, htext in enumerate(headers, start=1):
        max_len = len(str(htext))
        for row in rows:
            if ci - 1 < len(row) and row[ci - 1] is not None:
                max_len = max(max_len, len(str(row[ci - 1])))
        ws.column_dimensions[get_column_letter(ci)].width = min(max(max_len + 2, 8), 40)

    ws.freeze_panes = "A2"
    # ID column exists only to round-trip an upload back to the right
    # record -- narrow it out of the way rather than delete it, since a
    # script column is easy to re-widen by hand if someone needs to read it.
    if headers and headers[0].upper() == "ID":
        ws.column_dimensions["A"].width = 4
        ws.column_dimensions["A"].hidden = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        spec = json.load(f)

    wb = Workbook()
    ws = wb.active
    build(ws, spec)
    wb.save(args.output)
    print(json.dumps({"ok": True, "rowCount": len(spec.get("rows", []))}))


if __name__ == "__main__":
    main()
