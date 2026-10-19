"""Selling power metrics."""
from .grading import factors
CONSTANTS={"median_days":57,"low_days":45,"high_days":70,"anchor_days":110,"span_days":85}
def selling_power(grade):
 f=factors(grade)["dwell_factor"]; e=round(57*f); lo=round(45*f); hi=round(70*f); score=max(0,min(100,round(100*(110-e)/85)))
 label="Very strong" if e<=35 else "Strong" if e<=50 else "Typical" if e<=65 else "Slow" if e<=85 else "Very slow"
 return {"expected_days":e,"range_days":[lo,hi],"score":score,"label":label,"dwell_factor":f}
