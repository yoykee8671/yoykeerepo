#!/usr/bin/env python3
"""업로드 파일 읽기. 판매처·택배사가 주는 파일의 형식이 제각각이라 여기서 다
흡수한다. 파싱하는 스크립트(npb_parse.py / xlsx_to_json.py)가 함께 쓴다.

흡수하는 것:
  - 구형 .xls  — 택배사·물류사 관리자에서 아직 이 형식으로 내려 준다.
                 이미지에 들어 있는 LibreOffice 로 변환해 읽는다.
  - CSV 인코딩 — 네이버·카페24는 UTF-8, 재고관리·택배사는 CP949 로 준다.
"""

import csv
import os
import shutil
import subprocess
import tempfile

# 틀린 인코딩으로 열면 UnicodeDecodeError 가 나면서 파일을 통째로 못 읽는다.
CSV_ENCODINGS = ("utf-8-sig", "cp949", "euc-kr", "utf-16")


def read_csv_rows(path):
    last = None
    for encoding in CSV_ENCODINGS:
        try:
            with open(path, newline="", encoding=encoding) as fh:
                return [tuple(row) for row in csv.reader(fh)]
        except UnicodeDecodeError as exc:
            last = exc
    raise ValueError(
        "CSV 인코딩을 알 수 없습니다 (%s 를 모두 시도): %s"
        % (", ".join(CSV_ENCODINGS), last)
    )


def xls_to_xlsx(path):
    """구형 .xls 를 .xlsx 로 바꿔 그 경로를 돌려준다.

    서버 이미지에 LibreOffice 가 이미 있다(정산서 PDF 변환용). 파이썬 쪽에
    xlrd 를 더 얹는 대신 그걸 쓴다.
    """
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise ValueError(
            "구형 .xls 형식은 이 서버에서 변환할 수 없습니다. "
            ".xlsx 또는 .csv로 저장 후 올려주세요."
        )
    outdir = tempfile.mkdtemp(prefix="sheet-xls-")
    try:
        subprocess.run(
            [soffice, "--headless", "--norestore", "--nolockcheck",
             "-env:UserInstallation=file://" + os.path.join(outdir, "profile"),
             "--convert-to", "xlsx", "--outdir", outdir, path],
            check=True, capture_output=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("구형 .xls 변환이 시간을 넘겼습니다. .xlsx 로 저장해 올려주세요.")
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", "replace").strip().split("\n")[-1]
        raise ValueError("구형 .xls 를 변환하지 못했습니다: %s" % (detail or "변환 실패"))
    converted = os.path.join(
        outdir, os.path.splitext(os.path.basename(path))[0] + ".xlsx"
    )
    if not os.path.exists(converted):
        raise ValueError("구형 .xls 변환 결과를 찾을 수 없습니다.")
    return converted


def workbook_path(path):
    """openpyxl 로 열 수 있는 경로. .xls 면 변환본 경로를 돌려준다."""
    if os.path.splitext(path)[1].lower() == ".xls":
        return xls_to_xlsx(path)
    return path
