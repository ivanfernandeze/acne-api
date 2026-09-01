# Changelog — acne-api

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/);
versionado con [SemVer](https://semver.org/lang/es/).

## [0.1.0] — 2026-08-31

### Added

- **Dominio** (`common/domain/`) — fuente única de verdad: escala IGA y GAGS, modos de estudio y
  máquina de estados del caso, roles, definiciones y metas de TRM/TPD/TSP/TCAD, los 8 ítems Likert
  verbatim del Anexo 6, enunciados de HE₁–HE₄ y disclaimer de RNF-06.
- **Esquema clínico** (migración `InitialSchema`) — 15 tablas con 34 CHECK, 18 claves foráneas y
  comentarios SQL que declaran a qué objetivo sirve cada una.
- **`auth/` + `users/`** — JWT de acceso y refresco, cuatro roles, `study_mode` por usuario
  (RF-TR-01, RF-TR-02).
- **`patients/`** — pacientes anonimizados con identidad cifrada AES-256-GCM, consentimiento
  informado y derecho a retiro (RF-TR-03, RNF-07).
- **`cases/` + `images/`** — casos con apertura cronometrada e imágenes cifradas en reposo,
  servidas por token firmado con TTL de 15 min (RNF-02).
- **`study/`** — `StudyModeGuard`: las rutas de IA devuelven 403 en pretest; Anexo 4 digitalizado.
- **`inference/`** — cliente del motor de IA, cola respaldada por PostgreSQL con `FOR UPDATE SKIP
  LOCKED` y reintentos.
- **`diagnoses/`** — diagnóstico del especialista, cierre del cronómetro y Anexo 5 digitalizado.
- **`sessions/`** — jornadas de trabajo y Anexo 7 digitalizado (OE4).
- **`surveys/`** — cuestionario Likert con disparo automático a los N casos postest (OE3).
- **`indicators/`** — TRM, TPD, TSP y TCAD por modo y por profesional, matriz de confusión de 5
  clases y alertas de meta; snapshots inmutables (RNF-05).
- **`stats/`** — `POST /stats/hypothesis` y `/hypothesis/all` con la regla Shapiro-Wilk → t pareada
  o Wilcoxon, y `GET /stats/dataset-export` en CSV restringido a `admin`.
- **`reports/`** — los cuatro PDF de la Sección 11 con Playwright y disclaimer regulatorio.
- **`audit/`** — `GET /audit/thesis-coverage` y `GET /audit/iia-check`, más la traza append-only.
- **`meta/`** — `GET /meta/catalogs`, que sirve al frontend las constantes de instrumento que
  OpenAPI no puede generar.
- **Seeds** — `seed:admin` (cuentas con contraseñas aleatorias de un solo uso) y `seed:study`
  (30 casos sintéticos reproducibles con imágenes PNG cifradas y Grad-CAM simulado).

### Fixed

- **Cola de inferencia: trabajos fantasma.** `claimNext` interpretaba mal el resultado de
  TypeORM para `UPDATE ... RETURNING`, que puede llegar como `[filas, contador]`. Con la cola
  vacía, `raw[0]` era un arreglo vacío —no `undefined`— y superaba la comprobación, produciendo un
  "trabajo" con todos los campos `undefined`. Como TypeORM descarta silenciosamente las
  condiciones `undefined` de un `where`, el worker marcaba como `running` una inferencia ajena ya
  completada, una vez por cada ciclo de sondeo. Se normaliza y valida la fila devuelta, y se
  añaden pruebas de regresión.
- **Inferencias fallidas atascadas.** La recuperación tras un fallo filtraba por `status =
  'pending'`, pero `execute` ya había movido la fila a `running`, de modo que ninguna inferencia
  fallida llegaba a marcarse como tal. Ahora contempla ambos estados.
