"""하나은행 다계좌이체(이체등록) 엑셀을 만든다.

usage: hana_transfer_xlsx.py --input rows.json --output out.xlsx

rows.json: [{"bank", "account", "amount", "withdrawMemo", "depositMemo"}]

은행이 내려준 양식(templates/hnb_multitrns.xlsx)을 그대로 쓴다. 칸은 모두 텍스트
서식(@)이고 값도 문자열로 넣는다 — 계좌번호가 0 으로 시작하거나 길어서 숫자로
넣으면 앞자리가 사라지거나 지수 표기로 바뀐다. 금액도 쉼표 없는 숫자 문자열이다.
CMS코드는 비운다.
"""
import argparse
import copy
import json
import os
import re

from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "templates", "hnb_multitrns.xlsx")
COLUMNS = 6


def digits(value):
    return re.sub(r"\D", "", str(value or ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as fh:
        rows = json.load(fh)

    wb = load_workbook(TEMPLATE)
    ws = wb.active
    # 2행의 서식(테두리·텍스트 서식)을 데이터 줄에 그대로 쓴다.
    styles = [copy.copy(ws.cell(row=2, column=c)._style) for c in range(1, COLUMNS + 1)]
    # 양식에 들어 있는 예시 줄을 지운다.
    if ws.max_row > 1:
        ws.delete_rows(2, ws.max_row - 1)

    for i, row in enumerate(rows, start=2):
        values = [
            str(row.get("bank") or "").strip(),
            digits(row.get("account")),
            digits(row.get("amount")),
            str(row.get("withdrawMemo") or "").strip(),
            str(row.get("depositMemo") or "").strip(),
            "",
        ]
        for c, value in enumerate(values, start=1):
            cell = ws.cell(row=i, column=c)
            cell._style = copy.copy(styles[c - 1])
            cell.number_format = "@"
            # 빈 칸은 값 없이 둔다(CMS코드, 비운 입금통장표시).
            cell.value = value if value != "" else None
            if value != "":
                cell.data_type = "s"
    wb.save(args.output)


if __name__ == "__main__":
    main()
