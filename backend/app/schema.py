from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool

MODEL_VERSION = "0.9"

Money = Optional[float]
MONEY_MAX = 1e9  # no single server is worth a billion dollars; keeps sums finite


class AssetInputs(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    asset_profile: Optional[Literal["a100_8x", "h100_8x"]] = None
    gpus: Optional[int] = Field(None, ge=1, le=16)
    server_kw: Optional[float] = Field(None, ge=0.5, le=15)
    health_pass: Optional[StrictBool] = None
    ownership: Optional[Literal["owned", "client_approved", "consigned"]] = None
    repairable: Optional[StrictBool] = None

    offer_today: Money = Field(None, ge=0, le=MONEY_MAX)
    market_price: Money = Field(None, ge=0, le=MONEY_MAX)
    sell_fee_pct: Optional[float] = Field(None, ge=0, le=0.5)
    logistics: Money = Field(None, ge=0, le=MONEY_MAX)
    price_drift_pct_mo: Optional[float] = Field(None, ge=0, le=0.2)
    dwell_days: Optional[float] = Field(None, ge=0, le=365)
    buyer_window_days: Optional[float] = Field(None, ge=0, le=60)

    rental_rate: Optional[float] = Field(None, ge=0, le=20)
    platform_fee_pct: Optional[float] = Field(None, ge=0, le=0.9)
    utilization: Optional[float] = Field(None, ge=0, le=1)
    first_month_utilization: Optional[float] = Field(None, ge=0, le=1)
    ramp_util_days: Optional[float] = Field(None, ge=0, le=90)
    ramp_days: Optional[float] = Field(None, ge=0, le=60)
    exit_days: Optional[float] = Field(None, ge=0, le=60)

    elec_per_kwh: Optional[float] = Field(None, ge=0, le=1)
    pue: Optional[float] = Field(None, ge=1, le=3)
    colo_per_kw_mo: Optional[float] = Field(None, ge=0, le=1000)
    maint_per_day: Optional[float] = Field(None, ge=0, le=500)
    activation_cost: Money = Field(None, ge=0, le=MONEY_MAX)
    exit_cost: Money = Field(None, ge=0, le=MONEY_MAX)

    horizon_months: Optional[int] = Field(None, ge=1, le=60)
    market_decay_pct_mo: Optional[float] = Field(None, ge=0, le=0.2)
    discount_rate_yr: Optional[float] = Field(None, ge=0, le=0.5)

    repair_parts_cost: Money = Field(None, ge=0, le=MONEY_MAX)
    repair_labor_cost: Money = Field(None, ge=0, le=MONEY_MAX)
    repair_test_cost: Money = Field(None, ge=0, le=MONEY_MAX)
    repair_days: Optional[float] = Field(None, ge=0, le=120)
    repair_success: Optional[float] = Field(None, ge=0, le=1)

    harvest_value: Money = Field(None, ge=0, le=MONEY_MAX)
    recycle_value: Money = Field(None, ge=0, le=MONEY_MAX)

    margin_abs: Money = Field(None, ge=0, le=MONEY_MAX)
    margin_pct: Optional[float] = Field(None, ge=0, le=0.5)
    bear_util_mult: Optional[float] = Field(None, ge=0, le=1)
    bear_dwell_short_mult: Optional[float] = Field(None, ge=0, le=1)
    bear_dwell_long_mult: Optional[float] = Field(None, ge=1)
    bear_decay_mult: Optional[float] = Field(None, ge=1)
    bear_repair_mult: Optional[float] = Field(None, ge=0, le=1)

    def to_model(self) -> dict:
        return self.model_dump(exclude_unset=True, exclude_none=True)


def error(description, example):
    return {"description": description,
            "content": {"application/json": {"example": {"detail": example}}}}


NOT_FOUND = {404: error("No asset with that ID", "no asset SYN-999")}
CONFLICT = {409: error("Not allowed from the asset's current state or recommendation",
                       "recommended route is SELL NOW, not HOST LONGER or YIELD WHILE LISTED; "
                       "send override=true with a note to proceed anyway")}
TOO_LARGE = {413: error("File over 5 MB or 5,000 rows", "at most 5000 rows per upload")}
