import json
import os

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import and_, text
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import AdminUser, Brand, BrandViewerToken, DepositRequest
from app.schemas import (
    AdminCreate,
    BrandCreate,
    DepositRequestCreate,
    DepositRequestRead,
    DepositRequestUpdate,
)
from app.services import (
    archive_brand_to_google_sheet,
    duplicate_warning_message,
    export_brand_requests_csv,
    log_audit,
    make_viewer_token,
    build_viewer_url,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="입금 요청 관리 웹앱")
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


VALID_ROLES = {"super", "general"}
VALID_SYNC_MODES = {"immediate", "manual"}


def ensure_super_admin(db: Session, actor_admin_id: int | None) -> None:
    # 첫 super admin 초기 셋업은 예외 허용
    existing_admin = db.query(AdminUser).count()
    if existing_admin == 0:
        return
    if actor_admin_id is None:
        raise HTTPException(status_code=400, detail="super 관리자 actor_admin_id 필요")
    actor = db.query(AdminUser).filter(AdminUser.id == actor_admin_id, AdminUser.is_active.is_(True)).first()
    if not actor or actor.role != "super":
        raise HTTPException(status_code=403, detail="super 관리자만 수행 가능")


@app.get("/", response_class=HTMLResponse)
def home(request: Request, db: Session = Depends(get_db)):
    admins = db.query(AdminUser).order_by(AdminUser.id.desc()).all()
    brands = db.query(Brand).order_by(Brand.id.desc()).all()
    requests = db.query(DepositRequest).order_by(DepositRequest.id.desc()).limit(50).all()
    audits = db.execute(
        text("SELECT id, entity_type, action, created_at FROM audit_logs ORDER BY id DESC LIMIT 20")
    ).fetchall()
    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "admins": admins,
            "brands": brands,
            "deposit_requests": requests,
            "audits": audits,
        },
    )


@app.get("/audits")
def list_audits(db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            "SELECT id, actor_admin_id, entity_type, entity_id, action, before_json, after_json, created_at "
            "FROM audit_logs ORDER BY id DESC LIMIT 500"
        )
    ).fetchall()
    return [dict(row._mapping) for row in rows]


@app.post("/admins")
def create_admin(payload: AdminCreate, db: Session = Depends(get_db)):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role은 super/general 중 하나여야 함")
    ensure_super_admin(db, payload.actor_admin_id)
    if db.query(AdminUser).filter(AdminUser.email == payload.email).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 이메일")
    item = AdminUser(name=payload.name, email=payload.email, role=payload.role)
    db.add(item)
    db.commit()
    db.refresh(item)
    log_audit(
        db,
        actor_admin_id=payload.actor_admin_id or item.id,
        entity_type="admin_user",
        entity_id=item.id,
        action="create",
        after={"name": item.name, "email": item.email, "role": item.role},
    )
    return {"id": item.id, "name": item.name, "email": item.email, "role": item.role}


@app.patch("/admins/{admin_id}")
def update_admin(admin_id: int, payload: AdminCreate, db: Session = Depends(get_db)):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role은 super/general 중 하나여야 함")
    ensure_super_admin(db, payload.actor_admin_id)
    item = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="관리자를 찾을 수 없음")
    before = {"name": item.name, "email": item.email, "role": item.role}
    item.name = payload.name
    item.email = payload.email
    item.role = payload.role
    db.commit()
    db.refresh(item)
    log_audit(
        db,
        actor_admin_id=payload.actor_admin_id,
        entity_type="admin_user",
        entity_id=admin_id,
        action="update",
        before=before,
        after={"name": item.name, "email": item.email, "role": item.role},
    )
    return {"id": item.id, "name": item.name, "email": item.email, "role": item.role}


@app.delete("/admins/{admin_id}")
def delete_admin(admin_id: int, actor_admin_id: int, db: Session = Depends(get_db)):
    ensure_super_admin(db, actor_admin_id)
    item = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="관리자를 찾을 수 없음")
    before = {"name": item.name, "email": item.email, "role": item.role}
    db.delete(item)
    db.commit()
    log_audit(
        db,
        actor_admin_id=actor_admin_id,
        entity_type="admin_user",
        entity_id=admin_id,
        action="delete",
        before=before,
    )
    return {"ok": True}


@app.post("/admins/form")
def create_admin_form(
    name: str = Form(...),
    email: str = Form(...),
    role: str = Form("general"),
    actor_admin_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    return create_admin(AdminCreate(name=name, email=email, role=role, actor_admin_id=actor_admin_id), db)


@app.post("/brands")
def create_brand(payload: BrandCreate, request: Request, db: Session = Depends(get_db)):
    if payload.sync_mode not in VALID_SYNC_MODES:
        raise HTTPException(status_code=400, detail="sync_mode는 immediate/manual 중 하나여야 함")
    if db.query(Brand).filter(Brand.name == payload.name).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 브랜드")
    brand = Brand(
        name=payload.name,
        contact_name=payload.contact_name,
        contact_email=payload.contact_email,
        google_sheet_url=payload.google_sheet_url,
        sync_mode=payload.sync_mode,
        template_columns_json=json.dumps(payload.template_columns, ensure_ascii=False),
    )
    db.add(brand)
    db.commit()
    db.refresh(brand)

    # 브랜드별 읽기 전용 공유 링크 생성
    token = BrandViewerToken(brand_id=brand.id, token=make_viewer_token())
    db.add(token)
    db.commit()

    log_audit(
        db,
        actor_admin_id=payload.actor_admin_id,
        entity_type="brand",
        entity_id=brand.id,
        action="create",
        after={"name": brand.name, "google_sheet_url": brand.google_sheet_url, "sync_mode": brand.sync_mode},
    )
    base_url = os.getenv("APP_BASE_URL") or str(request.base_url).rstrip("/")
    return {
        "id": brand.id,
        "name": brand.name,
        "viewer_path": f"/viewer/{token.token}",
        "viewer_url": build_viewer_url(token.token, base_url),
    }


@app.post("/brands/form")
def create_brand_form(
    request: Request,
    name: str = Form(...),
    contact_name: str = Form(""),
    contact_email: str = Form(""),
    google_sheet_url: str = Form(""),
    sync_mode: str = Form("manual"),
    template_columns: str = Form(""),
    actor_admin_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    columns = [c.strip() for c in template_columns.split(",") if c.strip()]
    payload = BrandCreate(
        name=name,
        contact_name=contact_name or None,
        contact_email=contact_email or None,
        google_sheet_url=google_sheet_url or None,
        sync_mode=sync_mode,
        template_columns=columns,
        actor_admin_id=actor_admin_id,
    )
    return create_brand(payload, request, db)


@app.post("/deposit-requests", response_model=DepositRequestRead)
def create_deposit_request(payload: DepositRequestCreate, db: Session = Depends(get_db)):
    brand = db.query(Brand).filter(Brand.id == payload.brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="브랜드를 찾을 수 없음")

    duplicate = None
    if payload.order_number and payload.customer_name:
        duplicate = (
            db.query(DepositRequest)
            .filter(
                and_(
                    DepositRequest.brand_id == payload.brand_id,
                    DepositRequest.order_number == payload.order_number,
                    DepositRequest.customer_name == payload.customer_name,
                    DepositRequest.amount == payload.amount,
                )
            )
            .first()
        )

    row = DepositRequest(
        brand_id=payload.brand_id,
        order_number=payload.order_number,
        customer_name=payload.customer_name,
        payer_name=payload.payer_name,
        name_source=payload.name_source,
        account_holder=payload.account_holder,
        bank_name=payload.bank_name,
        account_number=payload.account_number,
        amount=payload.amount,
        currency=payload.currency,
        fee_mode=payload.fee_mode,
        promotion_type=payload.promotion_type,
        discount_amount=payload.discount_amount,
        extra_fields_json=json.dumps(payload.extra_fields, ensure_ascii=False),
        memo=payload.memo,
        status=payload.status,
        created_by_admin_id=payload.created_by_admin_id,
        updated_by_admin_id=payload.created_by_admin_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    log_audit(
        db,
        actor_admin_id=payload.created_by_admin_id,
        entity_type="deposit_request",
        entity_id=row.id,
        action="create",
        after={
            "brand_id": row.brand_id,
            "order_number": row.order_number,
            "customer_name": row.customer_name,
            "amount": row.amount,
            "status": row.status,
            "duplicate_warning": bool(duplicate),
        },
    )

    if brand.sync_mode == "immediate":
        archive_brand_to_google_sheet(db, brand)

    if duplicate:
        # 요청은 저장하되 경고 메시지 제공
        setattr(row, "duplicate_warning", duplicate_warning_message(duplicate))
    return row


@app.patch("/deposit-requests/{request_id}")
def update_deposit_request(request_id: int, payload: DepositRequestUpdate, db: Session = Depends(get_db)):
    row = db.query(DepositRequest).filter(DepositRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="입금요청을 찾을 수 없음")
    before = {
        "order_number": row.order_number,
        "customer_name": row.customer_name,
        "payer_name": row.payer_name,
        "amount": row.amount,
        "status": row.status,
        "memo": row.memo,
    }
    if payload.order_number is not None:
        row.order_number = payload.order_number
    if payload.customer_name is not None:
        row.customer_name = payload.customer_name
    if payload.payer_name is not None:
        row.payer_name = payload.payer_name
    if payload.name_source is not None:
        row.name_source = payload.name_source
    if payload.amount is not None:
        row.amount = payload.amount
    if payload.status is not None:
        row.status = payload.status
    if payload.memo is not None:
        row.memo = payload.memo
    row.updated_by_admin_id = payload.updated_by_admin_id

    db.commit()
    db.refresh(row)

    log_audit(
        db,
        actor_admin_id=payload.updated_by_admin_id,
        entity_type="deposit_request",
        entity_id=row.id,
        action="update",
        before=before,
        after={
            "order_number": row.order_number,
            "customer_name": row.customer_name,
            "payer_name": row.payer_name,
            "amount": row.amount,
            "status": row.status,
            "memo": row.memo,
        },
    )
    return {"ok": True, "id": row.id}


@app.delete("/deposit-requests/{request_id}")
def delete_deposit_request(request_id: int, actor_admin_id: int, db: Session = Depends(get_db)):
    row = db.query(DepositRequest).filter(DepositRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="입금요청을 찾을 수 없음")
    before = {
        "order_number": row.order_number,
        "customer_name": row.customer_name,
        "payer_name": row.payer_name,
        "amount": row.amount,
        "status": row.status,
    }
    db.delete(row)
    db.commit()
    log_audit(
        db,
        actor_admin_id=actor_admin_id,
        entity_type="deposit_request",
        entity_id=request_id,
        action="delete",
        before=before,
    )
    return {"ok": True}


@app.post("/deposit-requests/form")
def create_deposit_request_form(
    brand_id: int = Form(...),
    order_number: str = Form(""),
    customer_name: str = Form(""),
    payer_name: str = Form(""),
    name_source: str = Form("customer"),
    account_holder: str = Form(""),
    bank_name: str = Form(""),
    account_number: str = Form(""),
    amount: float = Form(0),
    currency: str = Form("KRW"),
    fee_mode: str = Form(""),
    promotion_type: str = Form(""),
    discount_amount: float | None = Form(None),
    extra_fields: str = Form(""),
    memo: str = Form(""),
    status: str = Form("requested"),
    created_by_admin_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    try:
        extra_map = json.loads(extra_fields) if extra_fields.strip() else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"extra_fields JSON 형식 오류: {exc}") from exc

    payload = DepositRequestCreate(
        brand_id=brand_id,
        order_number=order_number or None,
        customer_name=customer_name or None,
        payer_name=payer_name or None,
        name_source=name_source,
        account_holder=account_holder or None,
        bank_name=bank_name or None,
        account_number=account_number or None,
        amount=amount,
        currency=currency,
        fee_mode=fee_mode or None,
        promotion_type=promotion_type or None,
        discount_amount=discount_amount,
        extra_fields=extra_map,
        memo=memo or None,
        status=status,
        created_by_admin_id=created_by_admin_id,
    )
    row = create_deposit_request(payload, db)
    return {
        "id": row.id,
        "duplicate_warning": getattr(row, "duplicate_warning", None),
    }


@app.get("/brands/{brand_id}/export.csv")
def export_brand_csv(brand_id: int, db: Session = Depends(get_db)):
    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="브랜드를 찾을 수 없음")
    rows = db.query(DepositRequest).filter(DepositRequest.brand_id == brand_id).order_by(DepositRequest.id.desc()).all()
    csv_text = export_brand_requests_csv(rows)
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="brand_{brand_id}_requests.csv"'},
    )


@app.post("/brands/{brand_id}/archive")
def archive_brand(brand_id: int, actor_admin_id: int | None = None, db: Session = Depends(get_db)):
    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="브랜드를 찾을 수 없음")
    sync = archive_brand_to_google_sheet(db, brand)
    log_audit(
        db,
        actor_admin_id=actor_admin_id,
        entity_type="brand_archive",
        entity_id=brand_id,
        action="sync",
        after={"status": sync.sync_status, "message": sync.message},
    )
    return {"brand_id": brand_id, "status": sync.sync_status, "message": sync.message}


@app.get("/viewer/{token}", response_class=HTMLResponse)
def brand_viewer(token: str, request: Request, db: Session = Depends(get_db)):
    viewer = db.query(BrandViewerToken).filter(BrandViewerToken.token == token).first()
    if not viewer:
        raise HTTPException(status_code=404, detail="공유 링크를 찾을 수 없음")
    brand = db.query(Brand).filter(Brand.id == viewer.brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="브랜드를 찾을 수 없음")
    rows = db.query(DepositRequest).filter(DepositRequest.brand_id == brand.id).order_by(DepositRequest.id.desc()).all()
    return templates.TemplateResponse(
        "viewer.html",
        {
            "request": request,
            "brand": brand,
            "rows": rows,
        },
    )
