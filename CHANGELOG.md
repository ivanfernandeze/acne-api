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

### Changed

- **Historia clínica longitudinal del paciente.** `GET /patients/:id/history` devuelve la
  cronología completa de visitas de una persona —severidad IGA de cada una, diagnósticos firmados,
  cronometrías de ambas condiciones, imágenes y sugerencia del modelo— más un resumen de evolución
  (`trend`, `severityDelta`, `averageReviewMinutes`). Es la vista **clínica**, complementaria a la
  bandeja de casos: la bandeja se organiza en torno al experimento y responde «qué falta revisar»,
  esta responde lo que el dermatólogo pregunta en un control, «cómo ha evolucionado este paciente».
  El bloque de IA llega en `null` para quien opera en pretest, igual que en la ficha de caso
  (RF-TR-01), y cada consulta queda registrada como `patient.history.read`.
  `GET /patients` incorpora además el resumen por paciente (`caseCount`, `lastVisitAt`,
  `lastSeverity`) para poder triar el registro de un vistazo.
- **La siembra sintética reparte los 30 casos entre ~21 pacientes.** Antes generaba un paciente por
  caso, de modo que ninguna historia tenía seguimiento y la curva de evolución quedaba
  estructuralmente vacía. El censo que fija la tesis es de 30 **casos**, no de 30 pacientes, así
  que repartirlos es a la vez más realista y fiel al diseño: algunos pacientes acumulan dos o tres
  visitas separadas ~45 días, con una trayectoria de severidad que suele mejorar un escalón IGA
  bajo tratamiento. Las 30 unidades pareadas de HE₁, HE₂ y los indicadores no cambian.
  Los nombres se sortean ahora dentro del sexo registrado; sorteados por separado producían filas
  como «José … femenino», que se leen como un fallo de integridad en cuanto se muestra el registro.
- **Nombre del paciente visible para el profesional tratante, y búsqueda por nombre.**
  `GET /patients` y `GET /cases` devuelven `fullName` / `patientName` descifrado cuando el
  solicitante es `dermatologo` o `residente`, y `null` para el resto de roles. Ambos aceptan
  `search`, que filtra por nombre, código de paciente o código de caso.
  RF-TR-03 cifra la identidad y la reserva al profesional tratante; no le pide elegir entre
  códigos, que es justamente como se abre el caso equivocado. La anonimización se mantiene donde
  importa: **anexos, exportación CSV y reportes PDF siguen usando solo códigos**, verificado.
  El filtrado ocurre en memoria tras descifrar, porque el nombre es ciphertext y ningún `LIKE` de
  SQL lo alcanza; es suficiente para el censo de 30 casos, pero un registro en producción
  necesitaría un índice ciego.
- Los listados con identidad registran **una** entrada de auditoría por consulta
  (`patient.list.identity`, `case.list.identity`) en lugar de una por fila, para no sepultar los
  eventos puntuales de `patient.identity.read` bajo el ruido de cada refresco.

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
