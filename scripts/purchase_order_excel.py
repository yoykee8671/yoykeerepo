#!/usr/bin/env python3
"""Generate a production purchase order (발주서) xlsx from a JSON spec.

Spec JSON, exactly as built by the `GET /api/purchase-orders/:id/excel`
route in server.js:
{
  "docNo": "PO-20260928-001",
  "orderDate": "2026-09-28",
  "issuer": {"businessName","businessNumber","representativeName","address","invoiceEmail","bankInfo"},
  "partner": {"name","businessName","businessNumber","representativeName","address",
              "contactName","contactEmail","invoiceEmail"},  # {} if the partner record
                                                              # was deleted
  "lineItems": [{"itemName","spec","quantity","unit","unitPrice","totalPrice"}, ...],
  "deliveryPlace": {"name","address","contactName","contactPhone","note"},  # all optional
  "subtotal": 0, "vat": 0, "total": 0,   # not used for display -- trade_doc_common
                                          # recomputes these as live Excel formulas from
                                          # lineItems, which is always equal to these
                                          # server-computed values (same formula) but
                                          # verifiable/editable in the workbook itself
  "note": "..."
}
"""

import argparse
import json

from openpyxl import Workbook

from trade_doc_common import render


def _delivery_place_line(delivery):
    """Join the delivery-place snapshot into one readable line. Accepts the
    current object shape; a plain string passes through as-is for backward
    compatibility with purchase orders saved before this field became
    structured."""
    if isinstance(delivery, str):
        return delivery
    if not isinstance(delivery, dict):
        return ""
    parts = []
    if delivery.get("name"):
        parts.append(delivery["name"])
    if delivery.get("address"):
        parts.append(delivery["address"])
    contact = " ".join(x for x in [delivery.get("contactName"), delivery.get("contactPhone")] if x)
    if contact:
        parts.append(f"담당: {contact}")
    if delivery.get("note"):
        parts.append(f"메모: {delivery['note']}")
    return " / ".join(parts)


def _prepare_spec(spec):
    """Derive the flat fields trade_doc_common.DOC_CONFIGS references
    (dotted paths only reach real dict keys, never computed values) from
    the richer objects server.js actually sends."""
    partner = spec.setdefault("partner", {})
    # 거래처의 공식 상호가 없으면(등록 시 생략 가능) 화면에서 쓰던 내부
    # 표시명(name)으로 대체한다 -- 발주서에 수신처가 빈칸으로 나가면 안 된다.
    partner["displayName"] = partner.get("businessName") or partner.get("name") or ""
    partner["contactLine"] = " ".join(
        x for x in [partner.get("contactName"), partner.get("contactEmail")] if x
    )
    spec["deliveryPlaceLine"] = _delivery_place_line(spec.get("deliveryPlace"))
    return spec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        spec = json.load(f)
    _prepare_spec(spec)

    wb = Workbook()
    ws = wb.active
    ws.title = "발주서"
    render(ws, "purchase_order", spec)
    wb.save(args.output)
    print(json.dumps({"ok": True, "lineCount": len(spec.get("lineItems", []))}))


if __name__ == "__main__":
    main()
