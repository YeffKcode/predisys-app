"""Configuración del servicio ML.

Fuente única de verdad: el .env de la raíz del proyecto (el mismo que lee la API Node), para que
ML_SERVICE_TOKEN sea idéntico en ambos servicios. Las variables de entorno explícitas tienen prioridad.
"""
import hashlib
import os
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SERVICE_DIR.parent


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_env_file(PROJECT_ROOT / ".env")   # prioridad: .env compartido de la raíz
_load_env_file(SERVICE_DIR / ".env")    # solo completa claves que falten

MODEL_DIR = Path(os.getenv("MODEL_DIR", SERVICE_DIR / "models"))
SERVICE_TOKEN = os.getenv("ML_SERVICE_TOKEN", "")
WARNING_THRESHOLD = float(os.getenv("WARNING_THRESHOLD", "0.40"))
CRITICAL_THRESHOLD = float(os.getenv("CRITICAL_THRESHOLD", os.getenv("ALERT_THRESHOLD", "0.70")))
# Huella corta para comparar con la que imprime la API sin revelar el secreto
TOKEN_FINGERPRINT = hashlib.sha256(SERVICE_TOKEN.encode()).hexdigest()[:8] if SERVICE_TOKEN else None
