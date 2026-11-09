import os

os.environ["ML_SERVICE_TOKEN"] = "test-token"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

H = {"X-Internal-Token": "test-token"}


def normal(n=12):
    return [{"temperature": 68 + (i % 3) * 0.5, "power_kw": 1.38, "fan_rpm": 2050, "hashrate": 585} for i in range(n)]


def fan_wear(n=12):
    return [{"temperature": 80 + i * 0.4, "power_kw": 1.37, "fan_rpm": 1500 - i * 40 + (300 if i % 2 else -300),
             "hashrate": 560 - i * 2} for i in range(n)]


def test_health_and_auth():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"
        assert c.post("/predict", json={"machine_id": "Rig-01", "readings": normal()}).status_code == 401


def test_normal_vs_degraded():
    with TestClient(app) as c:
        ok = c.post("/predict", json={"machine_id": "Rig-01", "readings": normal()}, headers=H).json()
        bad = c.post("/predict", json={"machine_id": "Rig-07", "readings": fan_wear()}, headers=H).json()
        assert ok["risk_level"] == "HEALTHY", ok
        assert bad["failure_probability"] > ok["failure_probability"]
        assert bad["risk_level"] in ("WARNING", "CRITICAL"), bad
        assert bad["diagnosis_code"] != "NORMAL"


def test_validation():
    with TestClient(app) as c:
        r = c.post("/predict", json={"machine_id": "Rig-01;DROP", "readings": normal()}, headers=H)
        assert r.status_code == 422
        r = c.post("/predict", json={"machine_id": "Rig-01", "readings": [{"temperature": 999, "power_kw": 1, "fan_rpm": 1, "hashrate": 1}]}, headers=H)
        assert r.status_code == 422
