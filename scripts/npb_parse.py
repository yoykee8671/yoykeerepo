#!/usr/bin/env python3
"""Parse a monthly per-channel DOTEON sales xlsx into normalized product lines.

Invoked from Node via execFile, mirroring the xlsx_to_json.py pattern:

    python3 npb_parse.py --input <file.xlsx> [--channel <code>]

Emits JSON to stdout:

    {
      "channel": "gongu",
      "sourceFile": "DB_cafe24_영이공구_202605_doteon.xlsx",
      "lines": [
        { "productKey": "spray", "label": "도톤 아웃도어 스프레이 2개세트",
          "qtyEa": 20, "qtyOrders": 10, "eaPerUnit": 2,
          "tier": "2개세트", "raw": { "discountRate": 0.32 } }
      ],
      "warnings": [],
      "meta": {}
    }

Channel is auto-detected from the filename keyword when --channel is omitted.
Unrecognized products are reported in `warnings` (never silently dropped to 0).
Missing/renamed columns degrade to warnings rather than crashes.
"""

import argparse
import json
import os
import re
import sys
import unicodedata

from openpyxl import load_workbook


# --- product identity -------------------------------------------------------

PRODUCT_LABELS = {
    "foot": "도톤 풋클리너",
    "spray": "도톤 아웃도어 스프레이",
}

FOOT_KEYWORDS = ("풋클리너", "발세정", "도톤 풋", "foot")
SPRAY_KEYWORDS = ("아웃도어", "outdoor", "스프레이", "해충방지")

FOOT_BARCODE = "8809879544118"
SPRAY_BARCODE = "8809879544101"

FOOT_CODE_PREFIX = "BT25DTFC"
SPRAY_CODE_PREFIX = "BT25OS"


def norm(v):
    if v is None:
        return ""
    return str(v).strip()


def identify_product(name=None, barcode=None, code=None):
    """Return 'foot' | 'spray' | None from any of name/barcode/상품코드."""
    bc = norm(barcode)
    if bc:
        # barcodes can arrive as int -> str with trailing .0
        bc = bc.split(".")[0]
        if bc == FOOT_BARCODE:
            return "foot"
        if bc == SPRAY_BARCODE:
            return "spray"
    cd = norm(code).upper()
    if cd:
        if cd.startswith(FOOT_CODE_PREFIX):
            return "foot"
        if cd.startswith(SPRAY_CODE_PREFIX):
            return "spray"
    nm = norm(name).lower()
    if nm:
        if any(k.lower() in nm for k in FOOT_KEYWORDS):
            return "foot"
        if any(k.lower() in nm for k in SPRAY_KEYWORDS):
            return "spray"
    return None


# --- channel detection ------------------------------------------------------

# Order matters: 영이공구 must be checked before cafe24 (longer, more specific).
CHANNEL_KEYWORDS = [
    ("영이공구", "gongu"),
    ("cafe24", "cafe24"),
    ("b2b", "b2b"),
    ("대리점", "tailit"),
    ("몽슈슈", "mongshu"),
    ("스마트스토어", "smartstore"),
    ("컬리", "kurly"),
    ("쿠팡", "coupang"),
    ("emart", "molly"),
    ("행사", "terrymarket"),
    ("태리마켓", "terrymarket"),
    ("파마스퀘어", "pharmasquare"),
]


def detect_channel(filename):
    # macOS stores filenames as NFD (decomposed Hangul); normalize to NFC so
    # Korean keyword literals in this file match reliably.
    base = unicodedata.normalize("NFC", os.path.basename(filename))
    for keyword, code in CHANNEL_KEYWORDS:
        if keyword in base:
            return code
    return None


# --- helpers ----------------------------------------------------------------

def to_int(v):
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).replace(",", "").strip()
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def header_index(header_row):
    """Map stripped header name -> column index."""
    idx = {}
    for i, h in enumerate(header_row):
        key = norm(h)
        if key and key not in idx:
            idx[key] = i
    return idx


def resolve_cols(idx, names, warnings, channel):
    """Return list of resolved indices; append a warning for any missing name."""
    out = []
    for n in names:
        if n in idx:
            out.append(idx[n])
        else:
            out.append(None)
            warnings.append(
                "[%s] expected column '%s' not found in header" % (channel, n)
            )
    return out


class Aggregator:
    """Groups rows into output lines keyed by (productKey, tier)."""

    def __init__(self):
        self._lines = {}

    def add(self, product, orders, ea, ea_per_unit=1, tier=None, raw=None):
        # 미식별 라인은 원본 이름별로 모은다 — 서버가 나중에 매칭한다.
        if product is None:
            tier = (raw or {}).get("sourceName") or tier
        key = (product, tier)
        line = self._lines.get(key)
        if line is None:
            line = {
                "productKey": product,
                "label": PRODUCT_LABELS.get(product, product)
                if product else ((raw or {}).get("sourceName") or "(미식별)"),
                "qtyEa": 0,
                "qtyOrders": 0,
                "eaPerUnit": ea_per_unit,
                "tier": tier,
                "raw": dict(raw or {}),
            }
            if tier and product:
                line["label"] = PRODUCT_LABELS.get(product, product) + " " + tier
            self._lines[key] = line
        line["qtyEa"] += ea
        line["qtyOrders"] += orders
        if raw:
            line["raw"].update(raw)

    def lines(self):
        out = []
        for line in self._lines.values():
            item = {
                "productKey": line["productKey"],
                "label": line["label"],
                "qtyEa": line["qtyEa"],
                "qtyOrders": line["qtyOrders"],
                "eaPerUnit": line["eaPerUnit"],
                "raw": line["raw"],
            }
            if line["tier"]:
                item["tier"] = line["tier"]
            out.append(item)
        # stable ordering: product then tier
        out.sort(key=lambda x: (x["productKey"] or "~", x.get("tier") or ""))
        return out


def data_rows(ws):
    rows = list(ws.iter_rows(values_only=True))
    return rows


def load_rows(path):
    """Read the first sheet as a list of row tuples. Supports .xlsx/.xlsm via
    openpyxl and .csv via the csv module (many channel exports are CSV). Raises
    on unreadable input so main() can turn it into a visible warning."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".csv", ".txt"):
        import csv
        with open(path, newline="", encoding="utf-8-sig") as fh:
            return [tuple(row) for row in csv.reader(fh)]
    if ext == ".xls":
        raise ValueError(
            "구형 .xls 형식은 지원하지 않습니다. .xlsx 또는 .csv로 저장 후 올려주세요."
        )
    wb = load_workbook(path, data_only=True, read_only=True)
    return list(wb.worksheets[0].iter_rows(values_only=True))


# --- per-channel parsers ----------------------------------------------------

def parse_cafe24(rows, channel, warnings, is_gongu=False):
    """cafe24 family (cafe24, gongu, b2b, tailit): J=상품명, K=옵션, L=수량."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_name, ci_opt, ci_qty, ci_refund = resolve_cols(
        idx,
        ["주문상품명(기본)", "상품옵션(기본)", "수량", "환불완료일"],
        warnings,
        channel,
    )
    if ci_name is None or ci_qty is None:
        return agg.lines()
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        # skip refunded rows
        if ci_refund is not None and ci_refund < len(r) and norm(r[ci_refund]):
            continue
        name = r[ci_name] if ci_name < len(r) else None
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        product = identify_product(name=name)
        if product is None:
            warnings.append(
                "[%s] unrecognized product (qty=%d): %r" % (channel, qty, norm(name))
            )
            continue
        if is_gongu:
            opt = norm(r[ci_opt]) if (ci_opt is not None and ci_opt < len(r)) else ""
            m_ea = re.search(r"(\d+)\s*개", opt)
            m_disc = re.search(r"\((\d+)%할인\)", opt)
            ea_per_unit = int(m_ea.group(1)) if m_ea else 1
            disc = int(m_disc.group(1)) / 100.0 if m_disc else None
            if ea_per_unit == 1:
                tier = "1개"
            else:
                tier = "%d개세트" % ea_per_unit
            if not m_ea:
                warnings.append(
                    "[%s] could not parse 공구 tier from option: %r" % (channel, opt)
                )
            agg.add(
                product,
                orders=qty,  # 수량 is always 1 per 공구 row
                ea=qty * ea_per_unit,
                ea_per_unit=ea_per_unit,
                tier=tier,
                raw={"discountRate": disc, "option": opt},
            )
        else:
            agg.add(product, orders=1, ea=qty, ea_per_unit=1)
    return agg.lines()


def parse_mongshu(rows, channel, warnings):
    """몽슈슈 재고표: product col B, code col C, qty from 판매 col H."""
    agg = Aggregator()
    B, C, H = 1, 2, 7  # 제품, 상품코드, 판매
    for r in rows:
        if r is None or len(r) <= H:
            continue
        seq = r[0] if len(r) > 0 else None
        # data rows carry a numeric 순번 in col A
        if not isinstance(seq, (int, float)):
            continue
        name = r[B]
        code = r[C]
        qty = to_int(r[H])
        product = identify_product(name=name, code=code)
        if product is None:
            warnings.append(
                "[%s] non-doteon / unrecognized product (판매=%d): %r / %r"
                % (channel, qty, norm(name), norm(code))
            )
            continue
        agg.add(product, orders=1, ea=qty, ea_per_unit=1)
    return agg.lines()


def parse_smartstore(rows, channel, warnings):
    """Naver smartstore: 상품명 col O, 수량 col R, 판매채널 col D."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_name, ci_qty = resolve_cols(idx, ["상품명", "수량"], warnings, channel)
    if ci_name is None or ci_qty is None:
        return agg.lines()
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        name = r[ci_name] if ci_name < len(r) else None
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        product = identify_product(name=name)
        if product is None:
            warnings.append(
                "[%s] unrecognized product (qty=%d): %r" % (channel, qty, norm(name))
            )
            continue
        agg.add(product, orders=1, ea=qty, ea_per_unit=1)
    return agg.lines()


def parse_kurly(rows, channel, warnings):
    """컬리: 상품명 col F / 옵션명 col G, 수량 col M."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_name, ci_opt, ci_qty = resolve_cols(
        idx, ["상품명", "옵션명", "수량"], warnings, channel
    )
    if ci_name is None or ci_qty is None:
        return agg.lines()
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        name = r[ci_name] if ci_name < len(r) else None
        opt = r[ci_opt] if (ci_opt is not None and ci_opt < len(r)) else None
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        product = identify_product(name=name) or identify_product(name=opt)
        if product is None:
            warnings.append(
                "[%s] unrecognized product (qty=%d): %r" % (channel, qty, norm(name))
            )
            continue
        agg.add(product, orders=1, ea=qty, ea_per_unit=1)
    return agg.lines()


def parse_coupang(rows, channel, warnings):
    """쿠팡: SKU명 col D, 수량 col H, rows where 구분='발주'. Bundle-aware."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_gubun, ci_sku, ci_qty = resolve_cols(
        idx, ["구분", "SKU명", "수량"], warnings, channel
    )
    if ci_sku is None or ci_qty is None:
        return agg.lines()
    distinct_skus = []
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        if ci_gubun is not None and ci_gubun < len(r):
            if norm(r[ci_gubun]) != "발주":
                continue
        sku = norm(r[ci_sku]) if ci_sku < len(r) else ""
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        product = identify_product(name=sku)
        if product is None:
            warnings.append(
                "[%s] unrecognized SKU (수량=%d): %r" % (channel, qty, sku)
            )
            continue
        if sku not in distinct_skus:
            distinct_skus.append(sku)
        # bundle size from SKU name (e.g. '2개', '3개세트'); default 1
        m_ea = re.search(r"(\d+)\s*개", sku)
        ea_per_unit = int(m_ea.group(1)) if m_ea else 1
        tier = None if ea_per_unit == 1 else "%d개" % ea_per_unit
        agg.add(
            product,
            orders=qty,
            ea=qty * ea_per_unit,
            ea_per_unit=ea_per_unit,
            tier=tier,
            raw={"sku": sku},
        )
    if distinct_skus:
        warnings.append(
            "[%s] distinct SKU names (verify bundle composition): %s"
            % (channel, "; ".join(distinct_skus))
        )
    return agg.lines()


def parse_emart(rows, channel, warnings, meta):
    """emart(몰리스): 상품코드(barcode) col G / 상품명 col H, 납품량 col N. VAT별도."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_code, ci_name, ci_qty, ci_amt = resolve_cols(
        idx, ["상품코드", "상품명", "납품량", "납품금액"], warnings, channel
    )
    if ci_qty is None or (ci_code is None and ci_name is None):
        return agg.lines()
    meta["vatIncluded"] = False
    meta["basis"] = "납품금액"
    warnings.append("[%s] VAT 별도 (unit price excludes VAT)" % channel)
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        barcode = r[ci_code] if (ci_code is not None and ci_code < len(r)) else None
        name = r[ci_name] if (ci_name is not None and ci_name < len(r)) else None
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        amt = to_int(r[ci_amt]) if (ci_amt is not None and ci_amt < len(r)) else 0
        product = identify_product(name=name, barcode=barcode)
        if product is None:
            warnings.append(
                "[%s] unrecognized product (납품량=%d): %r" % (channel, qty, norm(name))
            )
            continue
        unit = round(amt / qty) if qty else None
        agg.add(
            product,
            orders=1,
            ea=qty,
            ea_per_unit=1,
            raw={"vatIncluded": False, "basis": "납품금액", "unitPrice": unit},
        )
    return agg.lines()


def parse_pharmasquare(rows, channel, warnings):
    """파마스퀘어(대리점형 45%): 바코드 col C, 판매수량 col E."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_code, ci_name, ci_qty = resolve_cols(
        idx, ["바코드", "상품", "판매수량"], warnings, channel
    )
    if ci_qty is None or ci_code is None:
        return agg.lines()
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        barcode = r[ci_code] if ci_code < len(r) else None
        # subtotal rows have no barcode -> skip
        if not norm(barcode):
            continue
        name = r[ci_name] if (ci_name is not None and ci_name < len(r)) else None
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        product = identify_product(barcode=barcode, name=name)
        if product is None:
            warnings.append(
                "[%s] unrecognized product (판매수량=%d): %r" % (channel, qty, norm(name))
            )
            continue
        agg.add(
            product, orders=1, ea=qty, ea_per_unit=1, raw={"feeRate": 0.45}
        )
    return agg.lines()


def parse_terrymarket(rows, channel, warnings):
    """태리마켓/행사: 품목 col A, 판매수량 col B, 마켓 할인가 col C, 행사명 col H."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()
    idx = header_index(rows[0])
    ci_item, ci_qty, ci_price, ci_event = resolve_cols(
        idx, ["품목", "판매수량", "마켓 할인가", "행사명"], warnings, channel
    )
    if ci_item is None or ci_qty is None:
        return agg.lines()
    for r in rows[1:]:
        if r is None or all(x is None for x in r):
            continue
        item = norm(r[ci_item]) if ci_item < len(r) else ""
        if not item or "합계" in item:
            continue
        qty = to_int(r[ci_qty]) if ci_qty < len(r) else 0
        price = (
            to_int(r[ci_price]) if (ci_price is not None and ci_price < len(r)) else None
        )
        event = (
            norm(r[ci_event]) if (ci_event is not None and ci_event < len(r)) else ""
        )
        product = identify_product(name=item)
        if product is None:
            warnings.append(
                "[%s] unrecognized 품목 (판매수량=%d): %r" % (channel, qty, item)
            )
            continue
        agg.add(
            product,
            orders=1,
            ea=qty,
            ea_per_unit=1,
            raw={"marketPrice": price, "eventName": event},
        )
    return agg.lines()


# --- dispatch ---------------------------------------------------------------

# --- generic fallback -------------------------------------------------------
#
# 전용 레시피가 없는 채널을 위한 범용 파서.
#
# 채널마다 엑셀 양식이 다르지만 정산에 필요한 것은 "무슨 상품이 몇 개 팔렸나"
# 둘뿐이다. 컬럼을 이름 후보로 찾아내면 대부분의 채널이 코드 수정 없이 읽힌다.
# 양식이 특이한 채널만 전용 레시피를 추가하면 된다 — 채널을 하나 늘릴 때마다
# 파이썬을 고쳐야 하는 구조가 병목이었다.

GENERIC_QTY_COLS = ("주문수량", "판매수량", "결제수량", "구매수량", "출고수량", "수량")
GENERIC_NAME_COLS = ("상품명", "옵션명", "품목명", "제품명", "상품이름", "품목", "상품")
GENERIC_BARCODE_COLS = ("바코드", "barcode")
GENERIC_CODE_COLS = ("상품코드", "품목코드", "자체상품코드", "sku")


def pick_col(idx, candidates):
    """이름이 정확히 맞는 컬럼을 우선하고, 없으면 부분 일치로 찾는다."""
    for c in candidates:
        if c in idx:
            return idx[c], c
    for key, i in idx.items():
        low = key.lower()
        for c in candidates:
            if c.lower() in low:
                return i, key
    return None, None


def parse_generic(rows, channel, warnings):
    """상품명·수량 컬럼을 이름으로 찾아 집계한다."""
    agg = Aggregator()
    if not rows:
        warnings.append("[%s] empty sheet" % channel)
        return agg.lines()

    # 헤더가 첫 행이 아닐 수 있다 — 수량 컬럼이 잡히는 첫 행을 헤더로 본다.
    header_row = 0
    idx = header_index(rows[0])
    ci_qty, qty_name = pick_col(idx, GENERIC_QTY_COLS)
    if ci_qty is None:
        for r in range(1, min(len(rows), 10)):
            probe = header_index(rows[r])
            ci_qty, qty_name = pick_col(probe, GENERIC_QTY_COLS)
            if ci_qty is not None:
                header_row, idx = r, probe
                break
    if ci_qty is None:
        warnings.append(
            "[%s] 수량 컬럼을 찾지 못했습니다. 헤더에서 읽은 이름: %s"
            % (channel, ", ".join(list(idx.keys())[:12]) or "(없음)")
        )
        return agg.lines()

    ci_name, name_col = pick_col(idx, GENERIC_NAME_COLS)
    ci_barcode, _ = pick_col(idx, GENERIC_BARCODE_COLS)
    ci_code, _ = pick_col(idx, GENERIC_CODE_COLS)
    if ci_name is None and ci_barcode is None and ci_code is None:
        warnings.append(
            "[%s] 상품을 식별할 컬럼(상품명/바코드/상품코드)을 찾지 못했습니다" % channel
        )
        return agg.lines()

    warnings.append(
        "[%s] 범용 파서로 읽었습니다 (상품='%s', 수량='%s'). 금액이 맞는지 확인하세요."
        % (channel, name_col or "(바코드/코드)", qty_name)
    )

    def cell(row, i):
        return row[i] if (i is not None and i < len(row)) else None

    for r in rows[header_row + 1:]:
        if r is None or all(x is None for x in r):
            continue
        qty = to_int(cell(r, ci_qty))
        if qty <= 0:
            continue
        product = identify_product(
            name=cell(r, ci_name), barcode=cell(r, ci_barcode), code=cell(r, ci_code)
        )
        if product is None:
            # 이름을 못 알아봐도 버리지 않는다. 원본 이름을 그대로 넘기면
            # 서버가 상품표·별칭으로 다시 맞춰보고, 그래도 모르면 사람이
            # 한 번 지정해 다음부터 자동으로 인식되게 한다.
            unresolved_key = norm(cell(r, ci_name)) or "(이름 없음)"
            agg.add(None, orders=1, ea=qty, ea_per_unit=1, raw={"sourceName": unresolved_key})
            continue
        agg.add(product, orders=1, ea=qty, ea_per_unit=1)
    return agg.lines()


def parse(channel, rows, warnings, meta):
    if channel == "gongu":
        return parse_cafe24(rows, channel, warnings, is_gongu=True)
    if channel in ("cafe24", "b2b", "tailit"):
        return parse_cafe24(rows, channel, warnings, is_gongu=False)
    if channel == "mongshu":
        return parse_mongshu(rows, channel, warnings)
    if channel == "smartstore":
        return parse_smartstore(rows, channel, warnings)
    if channel == "kurly":
        return parse_kurly(rows, channel, warnings)
    if channel == "coupang":
        return parse_coupang(rows, channel, warnings)
    if channel == "molly":
        return parse_emart(rows, channel, warnings, meta)
    if channel == "pharmasquare":
        return parse_pharmasquare(rows, channel, warnings)
    if channel == "terrymarket":
        return parse_terrymarket(rows, channel, warnings)
    # 전용 레시피가 없으면 범용 파서로 넘긴다. 화면에서 채널을 추가하고 바로
    # 파일을 올릴 수 있어야 한다.
    return parse_generic(rows, channel, warnings)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--channel", default="")
    args = ap.parse_args()

    warnings = []
    meta = {}
    channel = args.channel or detect_channel(args.input)
    if not channel:
        warnings.append(
            "could not detect channel from filename: %s" % os.path.basename(args.input)
        )
        result = {
            "channel": None,
            "sourceFile": os.path.basename(args.input),
            "lines": [],
            "warnings": warnings,
            "meta": meta,
        }
        json.dump(result, sys.stdout, ensure_ascii=False)
        return

    try:
        rows = load_rows(args.input)
    except Exception as exc:  # unreadable file -> visible warning, not a crash
        warnings.append(
            "파일을 읽을 수 없습니다 (%s): %s"
            % (os.path.basename(args.input), exc)
        )
        rows = None

    lines = parse(channel, rows, warnings, meta) if rows else []

    result = {
        "channel": channel,
        "sourceFile": os.path.basename(args.input),
        "lines": lines,
        "warnings": warnings,
        "meta": meta,
    }
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
