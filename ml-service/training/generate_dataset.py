"""Genera un dataset SINTÉTICO con la misma forma que dataset_predisys (25 nodos x 2000 = 50 000 filas).

Sirve para desarrollo y pruebas mientras no se usa el dataset real. Cada nodo tiene una línea base
propia, volatilidad benigna de Proof of Work (caídas breves de hashrate que NO son fallas) y 0-2
episodios de degradación progresiva que terminan en falla (hashrate = 0) y luego reparación.

Uso:  python -m training.generate_dataset --out data/dataset_predisys_synthetic.csv
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

FAULTS = ["THERMAL_PASTE", "FAN_WEAR", "PSU_INSTABILITY", "GPU_DEGRADATION", "DUST_OBSTRUCTION"]


def _apply_fault(kind, p, sl, temp, power, rpm, hsh, rng, base):
    n = len(p)
    if kind == "THERMAL_PASTE":
        temp[sl] += 14 * p
        rpm[sl] += 900 * p
        power[sl] += 0.05 * p
        hsh[sl] -= 45 * p ** 2
    elif kind == "FAN_WEAR":
        rpm[sl] += -800 * p + rng.normal(0, 1, n) * (40 + 320 * p)
        temp[sl] += 16 * p
        hsh[sl] -= 35 * p ** 2
    elif kind == "PSU_INSTABILITY":
        power[sl] += rng.normal(0, 1, n) * (0.02 + 0.25 * p)
        dips = rng.random(n) < 0.05 + 0.25 * p
        hsh[sl] -= np.where(dips, base["hash"] * rng.uniform(0.2, 0.5, n), 60 * p ** 2)
    elif kind == "GPU_DEGRADATION":
        hsh[sl] -= 150 * p + rng.normal(0, 1, n) * 25 * p
        temp[sl] += 3 * p
    elif kind == "DUST_OBSTRUCTION":
        rpm[sl] += 1200 * p
        temp[sl] += 10 * p
        power[sl] += 0.08 * p


def generate(nodes: int = 25, rows_per_node: int = 2000, interval_min: int = 10, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-01-01T00:00:00Z")
    frames = []
    for node in range(1, nodes + 1):
        N = rows_per_node
        base = {"temp": rng.uniform(65, 71), "power": rng.uniform(1.30, 1.45),
                "rpm": rng.uniform(1900, 2200), "hash": rng.uniform(560, 600)}
        temp = base["temp"] + rng.normal(0, 1.0, N)
        power = base["power"] + rng.normal(0, 0.015, N)
        rpm = base["rpm"] + rng.normal(0, 40, N)
        hsh = base["hash"] + rng.normal(0, 6, N)
        # Volatilidad benigna de PoW / cambio de pool
        for _ in range(rng.integers(4, 9)):
            i = int(rng.integers(0, N - 3))
            hsh[i:i + int(rng.integers(1, 3))] *= rng.uniform(0.85, 0.95)

        ftype = np.array(["NORMAL"] * N, dtype=object)
        failure = np.zeros(N, dtype=int)
        htf = np.full(N, np.nan)

        cursor = int(rng.integers(100, 400))
        for _ in range(int(rng.choice([0, 1, 1, 2]))):
            dur = int(rng.integers(150, 400))
            fail_len = int(rng.integers(6, 15))
            if cursor + dur + fail_len + 50 >= N:
                break
            kind = str(rng.choice(FAULTS))
            s, f = cursor, cursor + dur
            p = np.linspace(0, 1, dur)
            _apply_fault(kind, p, slice(s, f), temp, power, rpm, hsh, rng, base)
            # Falla: el nodo deja de aportar hashrate
            hsh[f:f + fail_len] = 0
            power[f:f + fail_len] = base["power"] * 0.25 + rng.normal(0, 0.01, fail_len)
            temp[f:f + fail_len] = base["temp"] - 15 + rng.normal(0, 1, fail_len)
            labeled = s + int(dur * 0.2)  # el inicio del episodio es indistinguible de lo normal
            ftype[labeled:f + fail_len] = kind
            failure[f] = 1
            htf[s:f] = (f - np.arange(s, f)) * interval_min / 60
            htf[f:f + fail_len] = 0
            cursor = f + fail_len + int(rng.integers(100, 400))

        frames.append(pd.DataFrame({
            "node_id": f"node-{node:02d}",
            "timestamp": start + pd.to_timedelta(np.arange(N) * interval_min, unit="min"),
            "temperature": np.round(temp, 2),
            "power_kw": np.round(np.clip(power, 0.05, None), 4),
            "fan_rpm": np.round(np.clip(rpm, 0, None)).astype(int),
            "hashrate": np.round(np.clip(hsh, 0, None), 2),
            "failure_type": ftype,
            "failure": failure,
            "hours_to_failure": htf,
        }))
    return pd.concat(frames, ignore_index=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/dataset_predisys_synthetic.csv")
    ap.add_argument("--nodes", type=int, default=25)
    ap.add_argument("--rows", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    df = generate(a.nodes, a.rows, seed=a.seed)
    df.to_csv(a.out, index=False)
    print(f"Dataset sintético: {len(df)} filas, {df.node_id.nunique()} nodos, {int(df.failure.sum())} fallas -> {a.out}")
