from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class AdminCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: str = Field(default="general")
    actor_admin_id: int | None = None


class BrandCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    contact_name: str | None = None
    contact_email: EmailStr | None = None
    google_sheet_url: str | None = None
    sync_mode: str = "manual"
    template_columns: list[str] = []
    actor_admin_id: int | None = None


class DepositRequestCreate(BaseModel):
    brand_id: int
    order_number: str | None = None
    customer_name: str | None = None
    payer_name: str | None = None
    name_source: str = "customer"
    account_holder: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    amount: float = 0
    currency: str = "KRW"
    fee_mode: str | None = None
    promotion_type: str | None = None
    discount_amount: float | None = None
    extra_fields: dict[str, str | float | int | None] = {}
    memo: str | None = None
    status: str = "requested"
    created_by_admin_id: int | None = None


class DepositRequestUpdate(BaseModel):
    order_number: str | None = None
    customer_name: str | None = None
    payer_name: str | None = None
    name_source: str | None = None
    amount: float | None = None
    status: str | None = None
    memo: str | None = None
    updated_by_admin_id: int | None = None


class DepositRequestRead(BaseModel):
    id: int
    brand_id: int
    order_number: str | None
    customer_name: str | None
    payer_name: str | None
    amount: float
    currency: str
    status: str
    request_date: datetime

    class Config:
        from_attributes = True
