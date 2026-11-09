"""Limpieza del dataset real y etiquetado débil cuando no trae etiquetas de falla.

- Normaliza nombres de columnas (español/inglés) y unidades (W -> kW).
- Descarta columnas estáticas o irrelevantes (identificadores de red, salud declarada, límites de firmware).
- Si no existe 'failure': una falla es hashrate < 5 % de la mediana del nodo durante >= 2 lecturas.
- Si no existe 'failure_type': diagnóstico heurístico comparando las 24 h previas contra la línea base del nodo.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

ALIASES = {
    "node_id": ["node_id", "node", "nodo", "machine", "machine_id", "rig", "worker", "id_nodo"],
    "timestamp": ["timestamp", "time", "fecha", "datetime", "fecha_hora", "date"],
    "temperature": ["temperature", "temp", "temperatura", "gpu_temp", "temp_c"],
    "power_kw": ["power_kw", "power", "power_w", "consumo", "watts", "consumo_w", "power_draw"],
    "fan_rpm": ["fan_rpm", "fan", "rpm", "fan_speed", "velocidad_ventilador"],
    "hashrate": ["hashrate", "hash_rate", "tasa_hash", "mhs", "hash"],
    "failure": ["failure", "falla", "fail"],
    "failure_type": ["failure_type", "tipo_falla", "fault_type"],
    "hours_to_failure": ["hours_to_failure", "horas_para_falla"],
}


def normalize_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    lower = {c.lower().strip(): c for c in df.columns}
    rename = {}
    for target, options in ALIASES.items():
        for opt in options:
            if opt in lower:
                rename[lower[opt]] = target
                break
    df = df.rename(columns=rename)
    required = ["node_id", "timestamp", "temperature", "power_kw", "fan_rpm", "hashrate"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"El dataset no tiene las columnas {missing}. Columnas encontradas: {list(df.columns)}")
    keep = [c for c in ALIASES if c in df.columns]
    dropped = [c for c in df.columns if c not in keep]
    return df[keep].copy(), dropped


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in ["temperature", "power_kw", "fan_rpm", "hashrate"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["timestamp", "temperature", "power_kw", "fan_rpm", "hashrate"])
    if df["power_kw"].median() > 100:  # viene en vatios
        df["power_kw"] = df["power_kw"] / 1000.0
    df = df[(df.temperature.between(-20, 150)) & (df.power_kw.between(0, 50))
            & (df.fan_rpm.between(0, 20000)) & (df.hashrate >= 0)]
    df = df.drop_duplicates(subset=["node_id", "timestamp"]).sort_values(["node_id", "timestamp"])
    return df.reset_index(drop=True)


def _heuristic_type(pre: pd.DataFrame, baseline: pd.Series) -> str:
    d = pre[["temperature", "power_kw", "fan_rpm", "hashrate"]].median()
    rpm_change = (d.fan_rpm - baseline.fan_rpm) / max(baseline.fan_rpm, 1)
    temp_change = d.temperature - baseline.temperature
    power_noise = pre.power_kw.std() / max(baseline.power_std, 1e-3)
    hash_change = (d.hashrate - baseline.hashrate) / max(baseline.hashrate, 1)
    if power_noise > 3:
        return "PSU_INSTABILITY"
    if rpm_change < -0.15 and temp_change > 4:
        return "FAN_WEAR"
    if rpm_change > 0.25 and temp_change > 6:
        return "THERMAL_PASTE"
    if rpm_change > 0.25:
        return "DUST_OBSTRUCTION"
    if hash_change < -0.10 and temp_change < 4:
        return "GPU_DEGRADATION"
    return "UNCLASSIFIED"


def weak_labels(df: pd.DataFrame, horizon_h: float = 24.0) -> pd.DataFrame:
    has_failure = "failure" in df.columns
    has_type = "failure_type" in df.columns
    if has_failure and has_type and "hours_to_failure" in df.columns:
        df["failure_type"] = df["failure_type"].fillna("NORMAL").astype(str)
        return df
    out = []
    for _, g in df.groupby("node_id", sort=False):
        g = g.copy()
        med = g.hashrate.median()
        if not has_failure:
            low = g.hashrate < 0.05 * med
            starts = low & ~low.shift(1, fill_value=False) & low.shift(-1, fill_value=False)
            g["failure"] = starts.astype(int)
        g["hours_to_failure"] = np.nan
        if not has_type:
            g["failure_type"] = "NORMAL"
        healthy = g[g.hashrate >= 0.5 * med]
        baseline = healthy[["temperature", "power_kw", "fan_rpm", "hashrate"]].median()
        baseline["power_std"] = healthy.power_kw.std()
        for idx in g.index[g.failure == 1]:
            t_fail = g.at[idx, "timestamp"]
            window = (g.timestamp <= t_fail) & (g.timestamp >= t_fail - pd.Timedelta(hours=48))
            g.loc[window, "hours_to_failure"] = (t_fail - g.loc[window, "timestamp"]).dt.total_seconds() / 3600
            if not has_type:
                pre = g[(g.timestamp < t_fail) & (g.timestamp >= t_fail - pd.Timedelta(hours=horizon_h))]
                kind = _heuristic_type(pre, baseline) if len(pre) >= 3 else "UNCLASSIFIED"
                g.loc[(g.timestamp <= t_fail) & (g.timestamp >= t_fail - pd.Timedelta(hours=horizon_h)), "failure_type"] = kind
        out.append(g)
    return pd.concat(out).sort_values(["node_id", "timestamp"]).reset_index(drop=True)
