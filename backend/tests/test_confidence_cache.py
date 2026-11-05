from app import checks


def test_confidence_reuses_equivalent_inputs_and_isolates_results(monkeypatch):
    checks._cached_confidence.cache_clear()
    calls = []
    def compute(inputs):
        calls.append(inputs)
        return {"drivers": [{"move": inputs["utilization"]}]}
    monkeypatch.setattr(checks, "_compute_confidence", compute)
    first = checks.decision_confidence({"utilization": 0.5})
    first["drivers"][0]["move"] = 999
    second = checks.decision_confidence({"asset_profile": "a100_8x", "utilization": 0.5})
    assert second["drivers"][0]["move"] == 0.5
    assert len(calls) == 1
    checks.decision_confidence({"utilization": 0.6})
    assert len(calls) == 2
    checks._cached_confidence.cache_clear()


def test_confidence_cache_preserves_model_answer():
    checks._cached_confidence.cache_clear()
    inputs = {"asset_profile": "h100_8x", "utilization": 0.7}
    assert checks.decision_confidence(inputs) == checks._compute_confidence(inputs)
    assert checks.decision_confidence({"health_pass": False}) == checks._compute_confidence({"health_pass": False})
    checks._cached_confidence.cache_clear()
