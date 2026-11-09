"""PrediSys ML Service: sirve los modelos serializados (.pkl) para la API Node."""
from __future__ import annotations

import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import SERVICE_TOKEN, TOKEN_FINGERPRINT
from .model_store import ModelNotLoaded, store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("predisys-ml")


@asynccontextmanager
async def lifespan(_app):
    if TOKEN_FINGERPRINT:
        log.info("ML_SERVICE_TOKEN cargado (huella %s, debe coincidir con la de la API)", TOKEN_FINGERPRINT)
    else:
        log.warning("ML_SERVICE_TOKEN vacío: /predict queda sin autenticación. Defínelo en el .env de la raíz.")
    try:
        store.load()
        log.info("Modelos cargados: versión %s", store.metadata["version"])
    except ModelNotLoaded as exc:
        log.error(str(exc))
    yield


app = FastAPI(title="PrediSys ML Service", version="1.0.0", docs_url="/docs", lifespan=lifespan)


class Reading(BaseModel):
    temperature: float = Field(ge=-20, le=150)
    power_kw: float = Field(ge=0, le=50)
    fan_rpm: float = Field(ge=0, le=20000)
    hashrate: float = Field(ge=0, le=1_000_000)


class PredictRequest(BaseModel):
    machine_id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    readings: list[Reading] = Field(min_length=1, max_length=200)


def require_token(x_internal_token: str | None = Header(default=None)):
    if SERVICE_TOKEN and not hmac.compare_digest(x_internal_token or "", SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Token interno inválido")


@app.get("/health")
def health():
    return {
        "status": "ok" if store.loaded else "no_model",
        "model_version": store.metadata["version"] if store.loaded else None,
        "dataset_source": store.metadata["dataset"]["source"] if store.loaded else None,
    }


@app.get("/model/info", dependencies=[Depends(require_token)])
def model_info():
    if not store.loaded:
        raise HTTPException(503, "Modelos no cargados")
    m = store.metadata
    return {k: m[k] for k in ("version", "trained_at", "window", "features", "thresholds", "dataset", "metrics", "feature_importances", "classes")}


@app.post("/model/reload", dependencies=[Depends(require_token)])
def reload_models():
    try:
        store.load()
    except ModelNotLoaded as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"reloaded": True, "model_version": store.metadata["version"]}


@app.post("/predict", dependencies=[Depends(require_token)])
def predict(req: PredictRequest):
    try:
        result = store.predict([r.model_dump() for r in req.readings])
    except ModelNotLoaded as exc:
        raise HTTPException(503, str(exc)) from exc
    result["machine_id"] = req.machine_id
    return result
