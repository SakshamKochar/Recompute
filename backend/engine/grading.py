"""Health score and grade, delegated to the diagnostic engine (engine/diagnostics.py)."""
import csv
from pathlib import Path
from .diagnostics import evaluate, GRADES
ROOT = Path(__file__).resolve().parents[1]


def health_score(report, gpu_count=8):
    ev = evaluate(report, gpu_count)
    return ev["score"], ev["deductions"]


def grade_table():
    with open(ROOT / "data/sources/grade_table.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def grade_for(score, report, gpu_count=8):
    """Grade for a given score, then the report's hard caps (failed GPU, chassis fault, memory history)."""
    uncapped = next(r["grade"] for r in grade_table() if score >= float(r["min_score"]))
    grade, reason = uncapped, None
    for c in evaluate(report, gpu_count)["caps"]:
        if GRADES.index(grade) < GRADES.index(c["max_grade"]):
            grade, reason = c["max_grade"], c["reason"]
    return {"grade": grade, "uncapped_grade": uncapped, "cap_reason": reason}


def factors(grade):
    r = next(r for r in grade_table() if r["grade"] == grade)
    return {k: (float(r[k]) if k not in ("grade", "status", "basis") else r[k]) for k in r}
