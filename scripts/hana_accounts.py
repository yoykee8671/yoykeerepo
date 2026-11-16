"""하나은행 '자주쓰는입금계좌관리' 내려받기 파일을 읽어 JSON 으로 낸다.

usage: hana_accounts.py --input accounts.xlsx

출력: {"accounts": [{"bankName", "accountNumber", "alias", "holder", "registeredAt"}]}

은행이 주는 xlsx 는 openpyxl 이 스타일 정의에서 멈춘다(CellStyle styleId). 칸 값만
필요하므로 표준 라이브러리로 압축을 풀어 시트 XML 을 직접 읽는다. 계좌번호는
문자열 그대로 둔다 — 0 으로 시작하는 번호가 있다.
.xls 등 다른 형식은 기존 변환기(sheet_io)로 xlsx 로 바꾼 뒤 같은 방법으로 읽는다.
"""
import argparse
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
HEADERS = {
    "bankName": ["입금은행", "은행"],
    "accountNumber": ["입금계좌번호", "계좌번호"],
    "alias": ["입금계좌별칭", "별칭"],
    "holder": ["예금주"],
    "registeredAt": ["등록일자", "등록일"],
}


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_rows(path):
    with zipfile.ZipFile(path) as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        sheets = sorted(n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        if not sheets:
            return []
        root = ET.fromstring(zf.read(sheets[0]))
        rows = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            values = {}
            for c in row.findall("m:c", NS):
                kind = c.get("t")
                v = c.find("m:v", NS)
                if kind == "s" and v is not None:
                    text = shared[int(v.text)]
                elif kind == "inlineStr":
                    text = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                else:
                    text = v.text if v is not None else ""
                values[col_index(c.get("r"))] = (text or "").strip()
            if values:
                width = max(values) + 1
                rows.append([values.get(i, "") for i in range(width)])
        return rows


def to_xlsx(path):
    if zipfile.is_zipfile(path):
        return path
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sheet_io import workbook_path  # noqa: E402
    return workbook_path(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    rows = read_rows(to_xlsx(args.input))

    header_at = None
    cols = {}
    for i, row in enumerate(rows):
        flat = [re.sub(r"\s+", "", c) for c in row]
        found = {}
        for key, names in HEADERS.items():
            for j, cell in enumerate(flat):
                if cell in names:
                    found[key] = j
                    break
        if "bankName" in found and "accountNumber" in found:
            header_at, cols = i, found
            break
    if header_at is None:
        print(json.dumps({"error": "입금은행·입금계좌번호 머리글을 찾지 못했습니다."}, ensure_ascii=False))
        return

    accounts = []
    for row in rows[header_at + 1:]:
        get = lambda key: row[cols[key]].strip() if key in cols and cols[key] < len(row) else ""  # noqa: E731
        number = re.sub(r"\D", "", get("accountNumber"))
        if not number:
            continue
        accounts.append({
            "bankName": get("bankName"),
            "accountNumber": number,
            "alias": get("alias"),
            "holder": get("holder"),
            "registeredAt": get("registeredAt"),
        })
    print(json.dumps({"accounts": accounts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
