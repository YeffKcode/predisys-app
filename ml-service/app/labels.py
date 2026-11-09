"""Clases de diagnóstico del Random Forest y su texto para el operador."""
DIAGNOSIS_LABELS = {
    "NORMAL": "Operación normal",
    "THERMAL_PASTE": "Degradación de pasta térmica",
    "FAN_WEAR": "Desgaste de ventilador",
    "PSU_INSTABILITY": "Inestabilidad de la fuente de poder (PSU)",
    "GPU_DEGRADATION": "Degradación de chip/VRAM de la GPU",
    "DUST_OBSTRUCTION": "Obstrucción del flujo de aire (polvo)",
    "UNCLASSIFIED": "Anomalía no clasificada",
}

RECOMMENDATIONS = {
    "THERMAL_PASTE": "Programar repaste de las GPUs y revisar pads térmicos.",
    "FAN_WEAR": "Reemplazar ventiladores con rodamientos desgastados.",
    "PSU_INSTABILITY": "Medir rieles de 12 V y considerar el reemplazo de la PSU.",
    "GPU_DEGRADATION": "Reducir overclock de memoria y planificar el reemplazo de la GPU afectada.",
    "DUST_OBSTRUCTION": "Limpiar filtros, disipadores y verificar el flujo de aire del rack.",
    "UNCLASSIFIED": "Inspección manual del equipo.",
    "NORMAL": "Sin acción requerida.",
}
