"""Ingeniería de características compartida por entrenamiento e inferencia.

Usar exactamente la misma función en ambos lados evita el "training/serving skew":
el modelo .pkl siempre recibe las columnas en el mismo orden y con el mismo cálculo.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

BASE_COLUMNS = ["temperature", "power_kw", "fan_rpm", "hashrate"]
DEFAULT_WINDOW = 12

FEATURE_COLUMNS = [
    "temperature", "power_kw", "fan_rpm", "hashrate",
    "efficiency", "rpm_per_deg",
    "temp_slope", "rpm_slope", "power_slope", "hash_slope",
    "temp_std", "rpm_std", "power_std", "hash_std",
    "hash_drop_pct",
]

FEATURE_LABELS = {
    "temperature": "Temperatura",
    "power_kw": "Consumo eléctrico",
    "fan_rpm": "Velocidad de ventiladores",
    "hashrate": "Tasa de hash",
    "efficiency": "Eficiencia (MH/s por kW)",
    "rpm_per_deg": "RPM necesarias por °C",
    "temp_slope": "Tendencia de temperatura",
    "rpm_slope": "Tendencia de RPM",
    "power_slope": "Tendencia de consumo",
    "hash_slope": "Tendencia de hashrate",
    "temp_std": "Inestabilidad térmica",
    "rpm_std": "Inestabilidad de ventiladores",
    "power_std": "Fluctuación de consumo",
    "hash_std": "Volatilidad de hashrate",
    "hash_drop_pct": "Caída de hashrate vs. máximo reciente",
}


def _rolling_slope(series: pd.Series, window: int) -> pd.Series:
    """Pendiente de regresión lineal por muestra dentro de la ventana móvil."""
    t = pd.Series(np.arange(len(series), dtype=float), index=series.index)
    cov = series.rolling(window, min_periods=2).cov(t)
    var = t.rolling(window, min_periods=2).var()
    return (cov / var).replace([np.inf, -np.inf], np.nan).fillna(0.0)


def _features_for_group(g: pd.DataFrame, window: int) -> pd.DataFrame:
    g = g.copy()

    def roll(col: str):
        return g[col].rolling(window, min_periods=1)

    g["efficiency"] = g["hashrate"] / g["power_kw"].clip(lower=0.05)
    g["rpm_per_deg"] = g["fan_rpm"] / g["temperature"].clip(lower=1.0)
    for col, name in (("temperature", "temp_slope"), ("fan_rpm", "rpm_slope"),
                      ("power_kw", "power_slope"), ("hashrate", "hash_slope")):
        g[name] = _rolling_slope(g[col], window)
    for col, name in (("temperature", "temp_std"), ("fan_rpm", "rpm_std"),
                      ("power_kw", "power_std"), ("hashrate", "hash_std")):
        g[name] = roll(col).std().fillna(0.0)
    recent_max = roll("hashrate").max()
    g["hash_drop_pct"] = ((recent_max - g["hashrate"]) / recent_max.clip(lower=1.0)).fillna(0.0)
    return g


def build_features(df: pd.DataFrame, group_col: str | None = None, window: int = DEFAULT_WINDOW) -> pd.DataFrame:
    """Calcula las características por nodo (si group_col) respetando el orden temporal."""
    missing = [c for c in BASE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Faltan columnas de telemetría: {missing}")
    if group_col is None:
        return _features_for_group(df, window)
    parts = [_features_for_group(g, window) for _, g in df.groupby(group_col, sort=False)]
    return pd.concat(parts).loc[df.index]


def window_to_vector(readings: list[dict], window: int = DEFAULT_WINDOW) -> pd.DataFrame:
    """Convierte la ventana enviada por la API en una fila de características (la lectura más reciente)."""
    df = pd.DataFrame(readings, columns=BASE_COLUMNS).astype(float).tail(window).reset_index(drop=True)
    feats = build_features(df, window=window)
    return feats[FEATURE_COLUMNS].tail(1)
