from __future__ import annotations

import json
import secrets
import shutil
from copy import deepcopy
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "db.json"


DELETE_BRANDS = {
    "지노네이처 (포엣미)",
    "쿠루름",
    "프롬한라(벨아벨팜)",
    "리카리카",
}


CUTOFF_UNSPECIFIED = {
    "니드포펫",
    "카네브",
    "퍼펫",
    "레인보우스토리",
    "안스펫",
    "클러스터라운드",
    "아인솝",
    "트러스티푸드(림피드)",
    "브릿지독",
    "이비야야(도기파크)",
    "위러브코코",
    "복슬강아지",
    "룰루키친",
    "테일하이",
    "꼬뜨cote",
    "닥터웰릿(곰곰연구소)",
}


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def make_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def shipping_threshold(amount: int, fee: int, rule: str) -> dict:
    return {
        "shippingPolicyType": "threshold",
        "shippingThresholdAmount": amount,
        "shippingThresholdFee": fee,
        "shippingFlatFee": 0,
        "shippingRule": rule,
    }


def shipping_free(rule: str = "무료배송") -> dict:
    return {
        "shippingPolicyType": "free",
        "shippingThresholdAmount": 0,
        "shippingThresholdFee": 0,
        "shippingFlatFee": 0,
        "shippingRule": rule,
    }


def shipping_flat(fee: int, rule: str) -> dict:
    return {
        "shippingPolicyType": "flat",
        "shippingThresholdAmount": 0,
        "shippingThresholdFee": 0,
        "shippingFlatFee": fee,
        "shippingRule": rule,
    }


OVERRIDES = {
    "펫페이스": {
        "settlementType": "prepay_fee",
        "commissionRate": 65,
        "requiredMemo": "실판매가 기준 65% 수수료 적용. 필요시 원판매가/할인가/현재 판매가를 함께 관리",
        **shipping_threshold(100000, 3000, "공급가 10만원 미만 배송비 3,000원"),
    },
    "아카바코퍼레이션 (패디펫)": {
        "settlementType": "prepay_supply",
        "commissionRate": 0,
        "requiredMemo": "품목별 공급가 리스트 기준으로 입력",
    },
    "뮤니쿤트": {
        "commissionRate": 40,
    },
    "리케이(아이그룸)": {
        "settlementType": "prepay_supply",
        "commissionRate": 0,
        "requiredMemo": "품목별 공급가 리스트 기준으로 입력",
        **shipping_flat(3500, "주문건당 1회 3,500원 부과"),
    },
    "온힐": {
        "settlementType": "prepay_supply",
        "commissionRate": 0,
        "requiredMemo": "품목별 공급가 리스트 기준으로 입력",
    },
    "아롬나옴": {
        "settlementType": "prepay_supply",
        "commissionRate": 0,
        "requiredMemo": "품목별 공급가 리스트 기준으로 입력",
    },
    "리꼬르소": {
        "commissionRate": 25,
    },
    "포사이어티 (시카로 / 논스톱)": {
        "commissionRate": 25,
        **shipping_threshold(50000, 3000, "5만원 미만 3,000원"),
    },
    "브릿지독": {
        "commissionRate": 25,
        **shipping_threshold(50000, 3000, "5만원 이상 무료배송 / 미만 3,000원"),
    },
    "포포네": {
        "commissionRate": 25,
        **shipping_threshold(100000, 5000, "10만원 이상 무료배송 / 미만 5,000원"),
    },
    "꼬뜨cote": {
        "settlementType": "consignment",
        "commissionRate": 25,
        **shipping_free("무료배송"),
    },
    "이비야야(도기파크)": {
        "commissionRate": 25,
        **shipping_threshold(30000, 3000, "3만원 이상 무료배송 / 미만 3,000원"),
    },
    "복슬강아지": {
        "commissionRate": 20,
    },
    "닥터웰릿(곰곰연구소)": {
        "commissionRate": 25,
    },
    "베럴즈": {
        "settlementType": "consignment",
        "commissionRate": 0,
        "cutoffType": "consignment",
        "cutoffNote": "위탁입금",
        "cutoffHour": "",
    },
    "헤이마": {
        "settlementType": "prepay_fee",
        "commissionRate": 35,
        "hasReceivable": False,
        "cutoffType": "after_shipment",
        "cutoffNote": "출고완료 확인 후 입금",
        "cutoffHour": "",
    },
    "퍼펫": {
        "settlementType": "prepay_fee",
        "commissionRate": 38,
        "hasReceivable": False,
        "cutoffType": "after_shipment",
        "cutoffNote": "출고완료 확인 후 입금",
        "cutoffHour": "",
    },
    "릴리스키친": {
        "settlementType": "prepay_fee",
        "commissionRate": 20,
        "hasReceivable": False,
        "cutoffType": "after_shipment",
        "cutoffNote": "출고완료 확인 후 입금",
        "cutoffHour": "",
    },
    "안스펫": {
        "settlementType": "prepay_fee",
        "commissionRate": 25,
        "hasReceivable": False,
        "cutoffType": "after_shipment",
        "cutoffNote": "출고완료 확인 후 입금",
        "cutoffHour": "",
    },
    "카네브": {
        "settlementType": "prepay_fee",
        "commissionRate": 25,
        "hasReceivable": False,
        "cutoffType": "after_shipment",
        "cutoffNote": "출고완료 확인 후 입금",
        "cutoffHour": "",
    },
    "위러브코코": {
        "settlementType": "consignment",
        "commissionRate": 25,
        "hasReceivable": False,
        "cutoffType": "consignment",
        "cutoffNote": "위탁입금",
        "cutoffHour": "",
        **shipping_free("무료배송"),
    },
    "페슬러": {
        "settlementType": "prepay_fee",
        "commissionRate": 35,
        "hasReceivable": False,
        **shipping_threshold(50000, 3000, "5만원 미만 3,000원"),
    },
}


def ensure_brand(db: dict, name: str, *, base_name: str | None = None, raw_sheet_name: str | None = None) -> dict:
    existing = next((brand for brand in db["brands"] if brand.get("name") == name), None)
    if existing:
        return existing

    base = next((brand for brand in db["brands"] if brand.get("name") == base_name), None)
    if base:
        brand = deepcopy(base)
        brand["id"] = make_id("brand")
        brand["shareToken"] = secrets.token_hex(12)
        brand["createdAt"] = now()
    else:
        brand = {
            "id": make_id("brand"),
            "sheetId": "",
            "name": name,
            "rawSheetName": raw_sheet_name or name,
            "type": "brand",
            "settlementType": "prepay_fee",
            "commissionRate": 0,
            "hasReceivable": False,
            "receivableTotal": 0,
            "consignmentDueDay": "",
            "shippingPolicyType": "free",
            "shippingFlatFee": 0,
            "shippingThresholdAmount": 0,
            "shippingThresholdFee": 0,
            "shippingRule": "무료배송",
            "promotionSummary": "",
            "isActive": True,
            "starred": False,
            "businessName": "",
            "businessNumber": "",
            "representativeName": "",
            "bankName": "",
            "bankAccount": "",
            "accountHolder": "",
            "depositorName": "",
            "cutoffNote": "",
            "cutoffType": "time",
            "cutoffHour": "",
            "requiredMemo": "",
            "googleSheetUrl": "",
            "shareToken": secrets.token_hex(12),
            "createdAt": now(),
            "updatedAt": now(),
        }
    brand["name"] = name
    brand["rawSheetName"] = raw_sheet_name or brand.get("rawSheetName") or name
    brand["updatedAt"] = now()
    db["brands"].append(brand)
    return brand


def split_trusty_food(db: dict):
    original = next((brand for brand in db["brands"] if brand.get("name") == "트러스티푸드(림피드)"), None)
    if not original:
        return

    original["name"] = "트러스티푸드 (온라인)"
    original["updatedAt"] = now()
    original["commissionRate"] = 25
    original["requiredMemo"] = ""

    b2b = ensure_brand(db, "트러스티푸드 (B2B)", base_name="트러스티푸드 (온라인)", raw_sheet_name=original.get("rawSheetName"))
    b2b["commissionRate"] = 20
    b2b["requiredMemo"] = "b2b"
    b2b["updatedAt"] = now()

    for row in db["requests"]:
        if row.get("brandId") != original["id"]:
            continue
        memo = str(row.get("requiredMemo") or "").lower()
        if "b2b" in memo:
            row["brandId"] = b2b["id"]
            row["brandName"] = b2b["name"]
        else:
            row["brandName"] = original["name"]
        row["updatedAt"] = now()


def ensure_missing_brands(db: dict):
    lifepet = ensure_brand(db, "라이펫")
    lifepet.update({
        "settlementType": "consignment",
        "commissionRate": 27,
        "hasReceivable": False,
        "consignmentDueDay": "익월말",
        "cutoffType": "consignment",
        "cutoffNote": "위탁입금",
        "cutoffHour": "",
        "updatedAt": now(),
        **shipping_free("무료배송"),
    })


def main():
    with DB_PATH.open("r", encoding="utf-8") as fh:
        db = json.load(fh)

    backup_path = DATA_DIR / f"db.backup.{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    shutil.copy2(DB_PATH, backup_path)

    deleted_ids = {brand["id"] for brand in db["brands"] if brand.get("name") in DELETE_BRANDS}
    db["brands"] = [brand for brand in db["brands"] if brand.get("name") not in DELETE_BRANDS]
    db["requests"] = [row for row in db["requests"] if row.get("brandId") not in deleted_ids and row.get("brandName") not in DELETE_BRANDS]
    db["promotionRules"] = [row for row in db["promotionRules"] if row.get("brandId") not in deleted_ids]
    db["priceEntries"] = [row for row in db["priceEntries"] if row.get("brandId") not in deleted_ids]
    valid_price_ids = {row["id"] for row in db["priceEntries"]}
    db["priceAliases"] = [
        row for row in db["priceAliases"]
        if row.get("brandId") not in deleted_ids and (not row.get("priceEntryId") or row.get("priceEntryId") in valid_price_ids)
    ]

    for brand in db["brands"]:
        name = brand.get("name")
        if name in CUTOFF_UNSPECIFIED:
            brand["cutoffType"] = "time"
            brand["cutoffHour"] = ""
            brand["cutoffNote"] = "출고마감시간 미지정"
            brand["updatedAt"] = now()

        override = OVERRIDES.get(name)
        if not override:
            continue
        for key, value in override.items():
            brand[key] = value
        brand["updatedAt"] = now()

    split_trusty_food(db)
    ensure_missing_brands(db)

    with DB_PATH.open("w", encoding="utf-8") as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)

    print(f"Backup: {backup_path.name}")
    print("Deleted:", ", ".join(sorted(DELETE_BRANDS)))
    print("Updated:", ", ".join(sorted(OVERRIDES)))


if __name__ == "__main__":
    main()
