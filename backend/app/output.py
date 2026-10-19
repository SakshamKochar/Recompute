from typing import Annotated, Literal, Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import AllowInfNan, BaseModel, ConfigDict, Field, Strict, StrictStr, ValidationError, model_validator

from .recompute_model import _recommend, recommend, resolve_defaults  # noqa: F401  (resolve_defaults re-exported)
from .schema import MODEL_VERSION, error

ROUTES = ("SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER", "HARVEST", "RECYCLE", "REPAIR")
HEALTHY_ROUTES = ROUTES[:4]
STRESSED_ROUTES = ("LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER", "REPAIR")

Route = Literal[ROUTES]
Number = Annotated[float, Strict(), AllowInfNan(False)]


class ModelResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route: Route
    base: dict[Route, Optional[Number]]
    stress: dict[Literal[STRESSED_ROUTES], Number]
    eligible: list[Route] = Field(min_length=1)
    breakeven_dwell_days: Optional[Number]
    breakeven_utilization: Optional[Number]
    daily_compute_margin: Number
    after_repair_route: Optional[Literal[HEALTHY_ROUTES]]
    audit: list[Annotated[StrictStr, Field(min_length=1)]] = Field(min_length=1)

    @model_validator(mode="after")
    def consistent(self):
        if set(self.base) != set(ROUTES):
            raise ValueError(f"base must have all seven routes, missing {sorted(set(ROUTES) - set(self.base))}")
        if len(set(self.eligible)) != len(self.eligible):
            raise ValueError("eligible has duplicates")
        if self.route not in self.eligible:
            raise ValueError(f"route {self.route} is not in eligible {self.eligible}")
        if self.base[self.route] is None:
            raise ValueError(f"route {self.route} has no value in base")
        if ("REPAIR" in self.eligible) != (self.after_repair_route is not None):
            raise ValueError("after_repair_route must be set exactly when REPAIR is eligible")
        return self


class ModelOutputError(Exception):
    def __init__(self, problems):
        self.problems = problems


def checked_recommend(inputs, light=False):
    """light=True skips the two break-even searches (Saksham's light mode); values and route are identical."""
    result = _recommend(inputs, light=True) if light else recommend(inputs)
    try:
        ModelResult.model_validate(result)
    except ValidationError as e:
        raise ModelOutputError([{"field": ".".join(map(str, p["loc"])) or "result", "problem": p["msg"]}
                                for p in e.errors(include_url=False)]) from None
    return result


async def model_output_handler(request: Request, exc: ModelOutputError):
    return JSONResponse(status_code=500, content={"detail": {
        "error": "model returned an invalid result", "model_version": MODEL_VERSION, "problems": exc.problems}})


MODEL_ERROR = {500: error("The model returned a result that breaks the output contract",
                          {"error": "model returned an invalid result", "model_version": MODEL_VERSION,
                           "problems": [{"field": "route", "problem": "Input should be 'SELL NOW', ..."}]})}
