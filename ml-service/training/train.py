"""Entrenamiento de PrediSys.

  Isolation Forest  -> puntaje de anomalía (no supervisado)
  Regresión logística sobre ese puntaje -> probabilidad de falla calibrada (Platt)
  Random Forest     -> diagnóstico del tipo de falla

Validación cruzada GroupKFold por nodo: el modelo se evalúa siempre sobre máquinas que no vio,
para certificar que aprende reglas generales y no memoriza el historial de una tarjeta.

Uso:
  python -m training.train --data data/dataset_predisys.csv          # dataset real
  python -m training.train --synthetic                               # genera y usa dataset sintético
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.features import DEFAULT_WINDOW, FEATURE_COLUMNS, build_features  # noqa: E402
from training.generate_dataset import generate  # noqa: E402
from training.labeling import clean, normalize_columns, weak_labels  # noqa: E402

SEED = 42
HORIZON_H = 24.0
WARNING, CRITICAL = 0.40, 0.70
STATIC_TEMP_ALARM = 80.0  # alarma convencional por umbral fijo


def make_isolation_forest():
    return IsolationForest(n_estimators=200, max_samples=512, contamination="auto", random_state=SEED, n_jobs=-1)


def make_random_forest():
    return RandomForestClassifier(n_estimators=200, max_depth=14, min_samples_leaf=5,
                                  class_weight="balanced", random_state=SEED, n_jobs=-1)


def anomaly_score(model, X):
    return -model.score_samples(X)  # mayor = más anómalo


def lead_times(df: pd.DataFrame, prob: np.ndarray, threshold: float) -> list[float]:
    """Horas de anticipación: primera alerta >= threshold en las 48 h previas a cada falla."""
    leads = []
    d = df.assign(prob=prob)
    for _, g in d.groupby("node_id", sort=False):
        for idx in g.index[g.failure == 1]:
            t_fail = g.at[idx, "timestamp"]
            pre = g[(g.timestamp <= t_fail) & (g.timestamp >= t_fail - pd.Timedelta(hours=48))]
            hits = pre[pre.prob >= threshold]
            leads.append(float((t_fail - hits.timestamp.iloc[0]).total_seconds() / 3600) if len(hits) else 0.0)
    return leads


def binary_metrics(y, prob, threshold):
    pred = (prob >= threshold).astype(int)
    neg = y == 0
    return {
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
        "false_positive_rate": round(float(pred[neg].mean()) if neg.any() else 0.0, 4),
    }


def load_dataset(args) -> tuple[pd.DataFrame, dict]:
    if args.synthetic or not args.data:
        df = generate()
        info = {"source": "synthetic", "note": "Dataset sintético de desarrollo; reentrenar con dataset_predisys real."}
    else:
        raw = pd.read_csv(args.data)
        df, dropped = normalize_columns(raw)
        info = {"source": str(args.data), "raw_rows": len(raw), "dropped_columns": dropped}
    df = clean(df)
    df = weak_labels(df, HORIZON_H)
    df["precursor"] = ((df.hours_to_failure.notna()) & (df.hours_to_failure <= HORIZON_H)).astype(int)
    df.loc[df.failure_type.isin(["", "nan"]), "failure_type"] = "NORMAL"
    info.update({"rows": len(df), "nodes": int(df.node_id.nunique()), "failures": int(df.failure.sum()),
                 "precursor_rows": int(df.precursor.sum()),
                 "class_distribution": df.failure_type.value_counts().to_dict()})
    return df, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--out", type=Path, default=ROOT / "models")
    ap.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    ap.add_argument("--folds", type=int, default=5)
    args = ap.parse_args()
    t0 = time.time()

    df, info = load_dataset(args)
    print(f"[1/5] Dataset: {info['rows']} filas, {info['nodes']} nodos, {info['failures']} fallas")
    feats = build_features(df, group_col="node_id", window=args.window)
    X = feats[FEATURE_COLUMNS].to_numpy()
    y_prec = df.precursor.to_numpy()
    y_type = df.failure_type.to_numpy()
    groups = df.node_id.to_numpy()

    print(f"[2/5] Validación cruzada GroupKFold ({args.folds} folds por nodo)")
    oof_prob = np.zeros(len(df))
    oof_lof = np.zeros(len(df))
    oof_type = np.empty(len(df), dtype=object)
    for k, (tr, te) in enumerate(GroupKFold(n_splits=args.folds).split(X, y_prec, groups), 1):
        iforest = make_isolation_forest().fit(X[tr])
        calib = LogisticRegression().fit(anomaly_score(iforest, X[tr]).reshape(-1, 1), y_prec[tr])
        oof_prob[te] = calib.predict_proba(anomaly_score(iforest, X[te]).reshape(-1, 1))[:, 1]

        scaler = StandardScaler().fit(X[tr])
        rng = np.random.default_rng(SEED + k)
        sample = rng.choice(tr, size=min(8000, len(tr)), replace=False)
        lof = LocalOutlierFactor(n_neighbors=30, novelty=True).fit(scaler.transform(X[sample]))
        oof_lof[te] = -lof.score_samples(scaler.transform(X[te]))

        rf = make_random_forest().fit(X[tr], y_type[tr])
        oof_type[te] = rf.predict(X[te])
        print(f"      fold {k}: AUC IF={roc_auc_score(y_prec[te], oof_prob[te]):.3f}")

    print("[3/5] Métricas")
    leads_if = lead_times(df, oof_prob, CRITICAL)
    static_score = df.temperature.to_numpy()
    static_prob = (static_score >= STATIC_TEMP_ALARM).astype(float)
    leads_static = lead_times(df, static_prob, 0.5)
    detected = [x for x in leads_if if x > 0]
    metrics = {
        "horizon_hours": HORIZON_H,
        "isolation_forest": {
            "roc_auc": round(float(roc_auc_score(y_prec, oof_prob)), 4),
            "pr_auc": round(float(average_precision_score(y_prec, oof_prob)), 4),
            "brier_score": round(float(brier_score_loss(y_prec, oof_prob)), 4),
            "at_warning": binary_metrics(y_prec, oof_prob, WARNING),
            "at_critical": binary_metrics(y_prec, oof_prob, CRITICAL),
            "failures_anticipated_pct": round(100 * len(detected) / max(len(leads_if), 1), 1),
            "median_lead_time_hours": round(float(np.median(detected)), 2) if detected else 0.0,
        },
        "comparison": {
            "local_outlier_factor_roc_auc": round(float(roc_auc_score(y_prec, oof_lof)), 4),
            "static_threshold": {
                "rule": f"temperatura >= {STATIC_TEMP_ALARM} °C",
                "roc_auc": round(float(roc_auc_score(y_prec, static_score)), 4),
                **binary_metrics(y_prec, static_prob, 0.5),
                "failures_anticipated_pct": round(100 * sum(x > 0 for x in leads_static) / max(len(leads_static), 1), 1),
            },
        },
        "random_forest": {
            "macro_f1": round(float(f1_score(y_type, oof_type, average="macro")), 4),
            "accuracy": round(float((y_type == oof_type).mean()), 4),
            "per_class_f1": {c: round(float(f1_score(y_type == c, oof_type == c)), 4) for c in sorted(set(y_type))},
        },
    }
    print(json.dumps(metrics, indent=2, ensure_ascii=False))

    print("[4/5] Entrenamiento final con todo el dataset")
    iforest = make_isolation_forest().fit(X)
    calib = LogisticRegression().fit(anomaly_score(iforest, X).reshape(-1, 1), y_prec)
    rf = make_random_forest().fit(X, y_type)
    normal = feats.loc[df.precursor == 0, FEATURE_COLUMNS]
    feature_stats = {c: {"mean": float(normal[c].mean()), "std": float(normal[c].std() or 1.0)} for c in FEATURE_COLUMNS}
    importances = dict(sorted(zip(FEATURE_COLUMNS, map(float, rf.feature_importances_)), key=lambda kv: -kv[1]))

    print("[5/5] Serializando modelos")
    args.out.mkdir(parents=True, exist_ok=True)
    version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    files = {
        "isolation_forest.pkl": {"model": iforest, "calibrator": calib, "features": FEATURE_COLUMNS},
        "random_forest.pkl": {"model": rf, "features": FEATURE_COLUMNS, "classes": list(rf.classes_)},
    }
    hashes = {}
    for name, obj in files.items():
        path = args.out / name
        joblib.dump(obj, path, compress=3)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    metadata = {
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "window": args.window,
        "features": FEATURE_COLUMNS,
        "thresholds": {"warning": WARNING, "critical": CRITICAL},
        "dataset": info,
        "metrics": metrics,
        "feature_stats": feature_stats,
        "feature_importances": importances,
        "classes": list(rf.classes_),
        "sha256": hashes,
        "training_seconds": round(time.time() - t0, 1),
    }
    (args.out / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False, default=str))
    print(f"Modelos v{version} guardados en {args.out} ({metadata['training_seconds']} s)")


if __name__ == "__main__":
    main()
