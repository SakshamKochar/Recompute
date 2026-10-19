"""Shared deterministic constants."""
from datetime import date
REF_DATE = date(2026, 9, 30)
ENGINE_VERSION="2.0.0"
MODEL_VERSION="v0.9"
CONSTANTS = {
 "insurance_pct": (0.005, "share", "HYPOTHESIS"), "transit_days": (3, "days", "HYPOTHESIS"),
 "inspection_days": (7, "days", "HYPOTHESIS"), "base_dwell": (57, "days", "TO_VERIFY"),
 "dwell_low": (45, "days", "TO_VERIFY"), "dwell_high": (70, "days", "TO_VERIFY"),
 "selling_power_anchor": (110, "days", "HYPOTHESIS"), "selling_power_span": (85, "days", "HYPOTHESIS")}
