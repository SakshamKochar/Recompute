"""Numeric provenance type and display helpers."""
from dataclasses import dataclass, asdict
@dataclass(frozen=True)
class Num:
    id: str; value: object; display: str; unit: str; status: str; formula: str; inputs: dict; source: str|None=None
    def to_dict(self): return asdict(self)
def money(v):
    return f"${v:,.2f}" if abs(v) < 10 and v != int(v) else f"${v:,.0f}"
def rate(v): return f"${v:.2f}/GPU-hr"
def share(v):
    p=v*100; return f"{p:.0f}%" if abs(p-round(p))<1e-9 else f"{p:.1f}%"
def num(i,v,unit,status,formula,inputs=None,source=None,display=None):
    if display is None:
        display = money(v) if unit=="USD" else (rate(v) if unit=="USD/GPU-hr" else str(v))
    return Num(i,v,display,unit,status,formula,inputs or {},source)
