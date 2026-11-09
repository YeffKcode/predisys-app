"""Carga segura de los modelos .pkl y lógica de inferencia."""
from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path

import joblib
import numpy as np

from .config import CRITICAL_THRESHOLD, MODEL_DIR, WARNING_THRESHOLD
from .features import FEATURE_LABELS, window_to_vector
from .labels import DIAGNOSIS_LABELS, RECOMMENDATIONS


class ModelNotLoaded(RuntimeError):
    pass


class ModelStore:
    def __init__(self, model_dir: Path = MODEL_DIR):
        self.model_dir = Path(model_dir)
        self._lock = threading.Lock()
        self.metadata: dict | None = None
        self.iforest = None
        self.rf = None

    @property
    def loaded(self) -> bool:
        return self.iforest is not None and self.rf is not None

    def load(self) -> None:
        meta_path = self.model_dir / "metadata.json"
        if not meta_path.exists():
            raise ModelNotLoaded(f"No hay modelos en {self.model_dir}. Ejecuta: python -m training.train --synthetic")
        metadata = json.loads(meta_path.read_text())
        objects = {}
        for name, expected in metadata["sha256"].items():
            path = self.model_dir / name
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            # pickle puede ejecutar código: solo se carga si coincide con el hash registrado al entrenar
            if digest != expected:
                raise ModelNotLoaded(f"Integridad fallida en {name}: el hash no coincide con metadata.json")
            objects[name] = joblib.load(path)
        with self._lock:
            self.iforest = objects["isolation_forest.pkl"]
            self.rf = objects["random_forest.pkl"]
            self.metadata = metadata

    def _contributing(self, row) -> list[dict]:
        stats = self.metadata["feature_stats"]
        z = {c: (float(row[c]) - s["mean"]) / (s["std"] or 1.0) for c, s in stats.items()}
        top = sorted(z.items(), key=lambda kv: -abs(kv[1]))[:3]
        return [{
            "feature": f, "label": FEATURE_LABELS.get(f, f), "value": round(float(row[f]), 4),
            "z_score": round(v, 2), "direction": "alto" if v > 0 else "bajo",
        } for f, v in top if abs(v) >= 1.5]

    def predict(self, readings: list[dict]) -> dict:
        if not self.loaded:
            raise ModelNotLoaded("Modelos no cargados")
        with self._lock:
            iforest, rf, meta = self.iforest, self.rf, self.metadata
        X = window_to_vector(readings, window=meta["window"])
        Xv = X[iforest["features"]].to_numpy()
        score = float(-iforest["model"].score_samples(Xv)[0])
        is_anomaly = bool(iforest["model"].predict(Xv)[0] == -1)
        prob = float(iforest["calibrator"].predict_proba(np.array([[score]]))[0, 1])

        proba = rf["model"].predict_proba(X[rf["features"]].to_numpy())[0]
        classes = list(rf["classes"])
        ranked = sorted(zip(classes, proba), key=lambda kv: -kv[1])
        code, conf = ranked[0]
        if prob >= WARNING_THRESHOLD and code == "NORMAL":
            # El detector ve riesgo: se reporta la causa no normal más probable
            faults = [(c, p) for c, p in ranked if c != "NORMAL"]
            code, conf = faults[0] if faults and faults[0][1] >= 0.15 else ("UNCLASSIFIED", 1 - ranked[0][1])
        if prob < WARNING_THRESHOLD and code != "NORMAL" and conf < 0.6:
            code, conf = "NORMAL", float(dict(ranked).get("NORMAL", conf))

        risk = "CRITICAL" if prob >= CRITICAL_THRESHOLD else "WARNING" if prob >= WARNING_THRESHOLD else "HEALTHY"
        return {
            "anomaly_score": round(score, 5),
            "failure_probability": round(prob, 5),
            "is_anomaly": is_anomaly,
            "risk_level": risk,
            "diagnosis_code": code,
            "diagnosis": DIAGNOSIS_LABELS.get(code, code),
            "diagnosis_confidence": round(float(conf), 4),
            "recommendation": RECOMMENDATIONS.get(code, ""),
            "contributing_factors": self._contributing(X.iloc[0]),
            "class_probabilities": {c: round(float(p), 4) for c, p in ranked},
            "model_version": meta["version"],
            "readings_used": min(len(readings), meta["window"]),
        }


store = ModelStore()
