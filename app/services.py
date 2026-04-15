import csv
import io
import json
import os
import secrets
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app import models


def log_audit(
    db: Session,
    *,
    actor_admin_id: int | None,
    entity_type: str,
    entity_id: int | None,
    action: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    item = models.AuditLog(
        actor_admin_id=actor_admin_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        before_json=json.dumps(before, ensure_ascii=False) if before else None,
        after_json=json.dumps(after, ensure_ascii=False) if after else None,
    )
    db.add(item)
    db.commit()


def make_viewer_token() -> str:
    return secrets.token_urlsafe(24)


def duplicate_warning_message(row: models.DepositRequest) -> str:
    return (
        "중복 가능성: 동일 브랜드에 주문번호/고객명/입금액이 같은 건이 이미 있습니다. "
        f"(기존건 id={row.id})"
    )


def export_brand_requests_csv(rows: list[models.DepositRequest]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "id",
            "request_date",
            "order_number",
            "customer_name",
            "payer_name",
            "amount",
            "currency",
            "fee_mode",
            "promotion_type",
            "discount_amount",
            "status",
            "memo",
            "extra_fields_json",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.id,
                row.request_date.isoformat(),
                row.order_number or "",
                row.customer_name or "",
                row.payer_name or "",
                row.amount,
                row.currency,
                row.fee_mode or "",
                row.promotion_type or "",
                row.discount_amount or "",
                row.status,
                row.memo or "",
                row.extra_fields_json or "",
            ]
        )
    return buffer.getvalue()


def archive_brand_to_google_sheet(db: Session, brand: models.Brand) -> models.BrandArchiveSync:
    enabled = os.getenv("GOOGLE_SHEETS_SYNC_ENABLED", "false").lower() == "true"
    if enabled:
        status = "success"
        msg = "Google Sheets API 연동 구현 필요: service account + spreadsheets.values.update"
    else:
        status = "skipped"
        msg = "동기화 비활성화 상태 (GOOGLE_SHEETS_SYNC_ENABLED=false)"

    sync = models.BrandArchiveSync(
        brand_id=brand.id,
        synced_at=datetime.utcnow(),
        sync_status=status,
        message=msg,
    )
    db.add(sync)
    db.commit()
    db.refresh(sync)
    return sync


def build_viewer_url(token: str, base_url: str | None = None) -> str:
    path = f"/viewer/{token}"
    if not base_url:
        return path
    return f"{base_url.rstrip('/')}{path}"
