# PrediSys · API (Entrega 1: backend)

## Arranque
```bash
docker compose up -d                 # MySQL 8 local (o usa la URL de Amazon RDS en .env)
cp .env.example .env                 # genera JWT_SECRET, DATA_ENCRYPTION_KEY y EMAIL_HASH_KEY
npm run setup                        # install + prisma generate + db push + seed
npm run dev                          # http://localhost:4000/api
```
Usuario inicial: valores `SEED_ADMIN_*` del `.env`. Sin SMTP en desarrollo, el código de recuperación se imprime en consola.

## Mapa de requisitos → código
| # | Requisito | Dónde |
|---|-----------|-------|
| 1 | 401 sin sesión → redirección | `middlewares/auth.js` (el frontend redirige al recibir `AUTH_REQUIRED`) |
| 2 | Logout bloquea otras pestañas | `auth.controller.logout` revoca la sesión en BD + `Cache-Control: no-store` |
| 3 | Sesiones concurrentes independientes | modelo `Session`, `session.service.createSession` (máximo configurable) |
| 4 | Expiración dinámica del JWT | `settings.tokenTtlMinutes`, JWT deslizante reemitido en cada petición |
| 5 | Expiración de sesión por inactividad | `settings.sessionIdleMinutes`, validada en servidor |
| 6 | 15 caracteres especiales | `utils/schemas.js` (`identifier`, `safeText`) + `middlewares/sanitize.js` |
| 7 | Enmascaramiento / portapapeles | Frontend (entrega 2) |
| 8 | Secuencias numéricas | Login las acepta como entrada; `lib/password.js` las rechaza al crear claves |
| 9 | Bloqueo tras 5 intentos | `auth.controller.login` (`failedLoginAttempts`, `lockedUntil`) |
| 10 | Código de recuperación por correo | `forgotPassword` / `resetPassword` (código bcrypt, 15 min, 5 intentos) |
| 11–12 | Roles, permisos, multirrol | `rbac.controller`, `adminUsers.setUserRoles` |
| 13 | Correo duplicado | `emailHash` UNIQUE + verificación previa |
| 14 | Override admin de contraseña | `adminUsers.adminSetPassword` (aplica la política: "a" se rechaza) |
| 15 | Perfil: correo y clave | `profile.controller.updateCredentials` |
| 16 | AuditLogs en tiempo real | `audit.service` + SSE `GET /api/audit/stream` |
| 17 | error.log | `lib/logger.js`, `errorHandler`, `POST /api/admin/system/force-error?type=sync|async|database` |
| 18 | bcrypt + cifrado en reposo | `lib/password.js` (≥10 rondas), `lib/crypto.js` (AES-256-GCM para correo y nombre) |
| 19 | Magic bytes | `utils/fileSignature.js` (rechaza MZ/ELF/Mach-O/shebang y discrepancias extensión/MIME) |
| 20 | CRUD máquinas y componentes | `machines.controller`, `components.controller` |

---

# Entrega 2: ML, alertas, notificaciones y blockchain

## Flujo de una lectura
```
POST /api/telemetry ─► ml-service /predict ─► TelemetryLog (score + diagnóstico)
                          │  Isolation Forest → probabilidad calibrada
                          │  Random Forest   → diagnóstico + variables que lo originaron
                          ▼
                 ¿prob ≥ 0.40? ─► Alert (bitácora en RDS, hash SHA-256 del registro canónico)
                          ├─► SSE /api/alerts/stream          (app, en tiempo real)
                          ├─► Correo  (SMTP / Amazon SES)     ┐ según preferencias de cada usuario
                          ├─► SMS     (Twilio / Amazon SNS)   ┘ + lista de guardia
                          └─► CRÍTICA: AlertRegistry en Testnet (Sepolia) ─► verificación de integridad
Worker (cada 60 s): reintentos con backoff, conciliación de transacciones, escalamiento a los 15 min
```

## 1. Servicio ML (`ml-service/`)
```bash
cd ml-service
pip install -r requirements.txt
python -m training.train --data data/dataset_predisys.csv     # dataset real (columnas en español o inglés)
# o, para desarrollo:  python -m training.train --synthetic
uvicorn app.main:app --port 8000
pytest -q
```
El entrenamiento usa GroupKFold por nodo y guarda `metadata.json`, que incluye métricas, hashes SHA-256 de los `.pkl` e importancia de variables. Al cargar, el servicio rechaza cualquier `.pkl` cuyo hash no coincida. Si el dataset real no trae etiquetas de falla, `training/labeling.py` las infiere: una caída del hashrate a menos del 5 % marca la falla y el diagnóstico se obtiene por heurística sobre las 24 h previas.

Los modelos incluidos se entrenaron con el **dataset sintético** (50 000 filas, 25 nodos). Para los resultados del proyecto hay que reentrenar con `dataset_predisys`.

| Métrica (validación por nodo no visto) | Isolation Forest | Umbral estático 80 °C |
|---|---|---|
| ROC-AUC | 0.974 | 0.743 |
| Fallas anticipadas | 75 % | 45.8 % |
| Mediana de anticipación | 17.5 h | n/a |
| Falsos positivos (umbral 0.70) | 0.98 % | 0 % |

El Random Forest obtuvo F1 macro de 0.83. Por clase, el desgaste de ventilador llega a 0.94 y la inestabilidad de PSU a 0.94.

## 2. Blockchain (Testnet Sepolia)
1. Crea una wallet **solo para pruebas** y obtén ETH de Sepolia en un faucet.
2. En `.env`, configura `CHAIN_RPC_URL` y `CHAIN_PRIVATE_KEY`.
3. Ejecuta `npm run chain:deploy`. Compila `AlertRegistry.sol`, lo despliega y escribe la dirección en `blockchain/deployment.json`.
4. Agrega `ALERT_REGISTRY_ADDRESS=0x…` y `BLOCKCHAIN_ENABLED=true`.

Solo se anclan alertas **CRÍTICAS**. En la cadena quedan el hash, la máquina, la probabilidad y la marca de tiempo; la telemetría nunca sale de RDS. El contrato no tiene funciones de edición ni borrado. `GET /api/alerts/:id/verify` recalcula el hash desde la bitácora y lo compara con el guardado y con el que está en la cadena: `VERIFIED`, `TAMPERED` o `NOT_ANCHORED`. Reconocer o resolver una alerta no cambia el hash, porque solo se firman los campos inmutables. El script de despliegue y la API rechazan chainIds de redes principales.

## 3. Notificaciones fuera de la app
| Canal | Desarrollo | Producción |
|---|---|---|
| Correo | se imprime en consola | SMTP (`SMTP_HOST`), compatible con Amazon SES |
| SMS | `SMS_PROVIDER=console` | `twilio` (API REST) o `sns` (Amazon SNS, credenciales IAM) |

**Preferencias de cada usuario** (`/api/profile/notifications`):
- Correo y SMS se activan por separado.
- Se elige la severidad mínima: advertencia o crítica.
- Hay un horario silencioso, incluso cruzando medianoche, que solo suprime SMS de advertencia.
- Para activar SMS hay que verificar el celular con un código de 6 dígitos, para no enviar alertas a números ajenos.
- `POST /api/profile/notifications/test` envía un mensaje de prueba.

**Protecciones contra el exceso de mensajes:**
- Ventana de enfriamiento de 30 min por máquina; dentro de ella solo sube el contador de ocurrencias, salvo que la severidad pase de advertencia a crítica.
- Reintentos con backoff, máximo 3.
- `ALERT_ONCALL_EMAILS` y `ALERT_ONCALL_PHONES` definen la lista de guardia, que recibe toda alerta crítica.
- Una crítica sin reconocer a los 15 min se escala una sola vez a los usuarios con `alerts.manage`.

Destinatarios y números se guardan cifrados con AES-256-GCM; en la API solo aparecen enmascarados.

## 4. Demostración
```bash
npm run simulate -- --fault=Rig-07:FAN_WEAR --interval=5 --ramp=15
```
Fallas disponibles: `THERMAL_PASTE`, `FAN_WEAR`, `PSU_INSTABILITY`, `GPU_DEGRADATION`, `DUST_OBSTRUCTION`.

## Endpoints nuevos
`GET /alerts` · `GET /alerts/summary` · `GET /alerts/stream` (SSE) · `GET /alerts/:id` · `GET /alerts/:id/verify` · `POST /alerts/:id/acknowledge|resolve|anchor|notify` · `GET /admin/blockchain/status` · `GET|PUT /profile/notifications` · `POST /profile/notifications/phone` · `POST /profile/notifications/phone/verify` · `DELETE /profile/notifications/phone` · `POST /profile/notifications/test`

Permisos nuevos: `alerts.read` (OPERATOR, TECHNICIAN, AUDITOR, ADMIN) y `alerts.manage` (TECHNICIAN, ADMIN).

---

# Entrega 3: frontend (sala de control)

## Arranque
```bash
# Terminal 1: API (puerto 4000)       Terminal 2: ML (puerto 8000)
npm run dev                           cd ml-service && uvicorn app.main:app --port 8000
# Terminal 3: frontend (puerto 5173, con proxy /api → 4000)
cd client && cp .env.example .env && npm install && npm run dev
```
En producción, `npm run client:build` genera `client/dist`. Express lo sirve en el mismo origen que la API, así que la cookie HTTPOnly con `SameSite=Strict` funciona sin CORS.

Stack: React 18, Vite 5, React Router 6, Recharts y Lucide. El estilo está en un único `styles.css` con tokens de color.

## Diseño
Sala de control térmica. Las máquinas se agrupan por rack, como están en la granja; la ubicación debe empezar por «Rack N». Cada una lleva una franja lateral que se llena y se calienta según su probabilidad de falla. Los KPIs van en una sola banda de instrumentos y los detalles abren en un panel lateral. Tipografía: IBM Plex Sans y, para las lecturas grandes, Plex Sans Condensed.

## Pantallas
| Ruta | Contenido |
|---|---|
| `/login` | Mensajes por motivo de cierre, intentos restantes y cuenta regresiva de bloqueo |
| `/register` | Lista de requisitos de contraseña en vivo y errores por campo (correo duplicado) |
| `/forgot-password` | Paso 1: correo. Paso 2: código de 6 dígitos y nueva contraseña |
| `/dashboard` | Banda de KPIs, filtro por riesgo y muro de racks. El panel lateral de cada máquina tiene telemetría (probabilidad y 4 variables), componentes (CRUD), documentos (subida) y alertas |
| `/alerts`, `/alerts/:id` | Lista filtrable. El detalle muestra diagnóstico, variables que originaron la alerta, reconocer/resolver, avisos enviados y verificación de integridad en blockchain. Es el enlace que llega en correo y SMS |
| `/admin/rbac` | Pestañas de usuarios, roles y permisos, auditoría en vivo, sesiones y sistema. Cada pestaña aparece solo con su permiso |
| `/profile` | Correo y contraseña, avisos (correo, SMS con verificación, horario silencioso, notificaciones del navegador) y sesiones activas |

## Requisitos en la interfaz
| # | Cómo se cumple |
|---|---|
| 1 | `ProtectedRoute` redirige a `/login?next=…`; `next` solo acepta rutas internas, para evitar redirecciones abiertas |
| 2 | Logout → `BroadcastChannel`, con `localStorage` de respaldo → todas las pestañas van a `/login`. `pageshow` revalida la sesión al volver con «atrás» |
| 3 | Perfil → sesiones activas con dispositivo e IP; se pueden cerrar una por una o todas |
| 4–5 | Temporizador en la barra superior a partir de las cabeceras `X-Token-Expires-At` / `X-Session-Idle-Expires-At`. Aviso un minuto antes con «Seguir conectado». Verificación cada 30 s sin extender la sesión |
| 6 | El error de validación del servidor se muestra en el campo |
| 7 | `type=password`; copiar, cortar, arrastrar y menú contextual bloqueados; «mostrar» dura solo 5 s y aun así no permite copiar |
| 8, 14 | Lista de requisitos en vivo. El formulario igual envía la contraseña para que el servidor la rechace y quede auditada |
| 9 | Intentos restantes, mensaje de bloqueo con cuenta regresiva y botón deshabilitado |
| 11–12 | Crear rol con permisos y asignarlo a varios usuarios en el mismo paso; varios roles por usuario; editar todos los permisos de un rol |
| 16 | Auditoría vía SSE con indicador «En vivo», pausa, filtros y detalle JSON |
| 17 | Sistema → tres botones de fallo forzado; se resalta en `error.log` la fila con el mismo `requestId` |
| 19 | Subida de documentos; el motivo del rechazo (p. ej. «Se detectó contenido ejecutable») aparece en pantalla |
| 20 | Agregar, editar y eliminar máquinas y componentes, con especificaciones clave-valor |

---

# Entrega 4: panel interactivo, laboratorio de fallas e informes

## Actualizar una instalación existente
```bash
npm install                  # agrega pdfkit
npm run init-env             # completa ML_SERVICE_TOKEN y demás secretos pendientes en .env
npm run db:update            # nuevas columnas/tablas + permisos faults.inject y reports.export
npm run client:build         # o: cd client && npm install && npm run dev
# reinicia la API y el servicio ML (los dos leen ahora el MISMO .env de la raíz)
```

## Corrección del error 401 al analizar
El token interno se configuraba en tres lugares que no se sincronizaban: el `.env` de la raíz, el `.env` de `ml-service` (Python nunca lo leía) y un valor por defecto de `docker-compose`.

Ahora la única fuente es el `.env` de la raíz:
- `ml-service` lo carga al arrancar y `docker-compose` usa `env_file: .env`.
- Al iniciar, la API y el servicio ML imprimen una huella del token (8 caracteres); ambas deben coincidir.
- Si no coinciden, la pestaña Sistema, la barra superior y el mensaje de error lo indican explícitamente.

## Nuevo panel (Vista general)
- **Indicadores:** salud de flota, poder de cómputo, consumo y riesgos críticos. Se pueden pulsar para filtrar.
- **Cuadrícula de máquinas:** cada rig va coloreado por riesgo, y las lecturas de prueba llevan la marca PRUEBA.
- **Gráficos interactivos:** la dona de salud global y el histograma de score filtran la cuadrícula al pulsarlos. El ranking de riesgo abre el rig seleccionado.
- **Barra lateral:**
  - Navegación: Analítica ML, Alertas, Administración y Perfil.
  - Herramientas: Base de hardware, Calculadora GPU y Calculadora CPU.
  - Lista de rigs con búsqueda (atajo `/`), orden por riesgo y minigráficas de tendencia.
- **Barra superior:**
  - Reloj y estado del modelo y del canal en vivo.
  - Exportar informe (PDF y CSV).
  - Campana con las alertas abiertas.
  - Tema claro/oscuro.
  - Información del modelo.

## Agregar máquinas para analizar
Usa «Agregar máquina» en el panel o en la cuadrícula. Se abre su ficha, donde puedes:
- «Generar línea base»: 12 lecturas sanas que pasan por el modelo.
- «Registrar lectura»: valores manuales.

Después, «Analizar ahora» funciona porque la máquina ya tiene ventana de datos.

## Laboratorio de fallas de prueba
Está en la ficha de cada máquina, en el panel y en Analítica ML. Se elige uno de los 5 tipos de falla, su intensidad y el número de lecturas (6–40). El sistema genera lecturas progresivamente degradadas con los mismos patrones físicos del entrenamiento y las pasa por el flujo real: ventana → Isolation Forest → Random Forest → alerta.

**El resultado muestra:**
- la probabilidad paso a paso;
- en qué paso llegó a advertencia y a crítico;
- si el diagnóstico coincide con la falla inyectada.

**Salvaguardas:**
- Las lecturas quedan marcadas como `isSynthetic` y las alertas como `isTest`.
- No se anclan en blockchain, no se escalan y no envían correo ni SMS salvo que se marque la opción. En ese caso llegan con el prefijo [PRUEBA].
- Requieren el permiso `faults.inject`, tienen un límite de 15 inyecciones cada 10 min y solo puede haber una en curso por máquina.
- Todo queda auditado.
- «Limpiar datos de prueba» borra lecturas y alertas sintéticas sin tocar los datos reales ni el historial de pruebas.

Verificación contra el modelo real: 10 de 10 inyecciones (5 fallas × intensidad media y alta) con diagnóstico correcto. La degradación de GPU en intensidad media solo alcanza advertencia, un hallazgo útil para el análisis.

## Exportar informe
- **PDF de flota** (`GET /api/reports/fleet.pdf`): KPIs, distribución de riesgo, estado de máquinas, alertas abiertas y pruebas del modelo.
- **CSV de telemetría** (`GET /api/reports/telemetry.csv`).

**Seguridad:**
- Permiso `reports.export` y límite de 20 exportaciones cada 15 min.
- Generación en el servidor y `Cache-Control: no-store`.
- El PDF lleva un identificador de documento y la huella SHA-256 de los datos en cada página, con metadatos. Se abre sin contraseña pero tiene la edición bloqueada.
- En el CSV se neutraliza la inyección de fórmulas (`=`, `+`, `-`, `@`).
- Cada exportación se audita con las huellas de los datos y del archivo.

---

## Si no puedes iniciar sesión como administrador
```bash
npm run admin:diagnose             # revisa existencia, bloqueo, roles, si la clave del .env coincide y si las claves de cifrado cambiaron
npm run admin:reset                # pide una nueva contraseña oculta, desbloquea la cuenta y cierra sesiones
npm run admin:reset -- --from-env  # usa SEED_ADMIN_PASSWORD del .env
```
No usa la pantalla de login, así que no consume intentos. Queda en auditoría como `ADMIN_PASSWORD_RESET_CLI`.
En `.env`, escribe siempre las contraseñas entre comillas dobles: `#` sin comillas inicia un comentario.

---

## Alertas por correo y SMS: configuración real
Por defecto ambos canales están en **modo consola**: nada sale del servidor, todo se imprime en la terminal de la API. Ahora la app lo indica: esos avisos aparecen como «Omitido» con el motivo, no como «Enviado».

1. **Correo:** en el `.env` de la raíz configura `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`. Hay ejemplos de Gmail (contraseña de aplicación) y Amazon SES en `.env.example`.
2. **Correo real del administrador:** `admin@predisys.local` no existe. Cámbialo en *Perfil y preferencias → Correo y contraseña*.
3. **SMS (opcional):** `SMS_PROVIDER=twilio` o `sns`. En cuentas de prueba solo llegan a números verificados en el proveedor.
4. Reinicia la API y comprueba:
   ```bash
   npm run notify:check -- --to=tu@correo.com --sms=+573001234567
   ```
5. En la app: *Administración → Sistema → Canales de aviso* muestra qué canal falla, por qué, y quién recibiría una alerta crítica.
