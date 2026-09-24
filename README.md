# acne-api

API de orquestación clínica del prototipo de diagnóstico asistido de acné con inteligencia
artificial — **Tesis UNT 2026**.

NestJS · TypeORM · PostgreSQL · Swagger/OpenAPI 3 · Playwright

---

## Contexto

Soporta la tesis **«Agilización del proceso de diagnóstico de acné mediante inteligencia
artificial en un centro especializado en dermatología»** (Universidad Nacional de Trujillo,
Escuela Académico Profesional de Ingeniería de Sistemas, 2026).

Este servicio no es un CRUD clínico: su razón de ser es **instrumentar la medición** que produce la
evidencia cuantitativa de las cuatro hipótesis específicas.

| Objetivo | Indicador | Fórmula | Meta |
|---|---|---|---|
| **OE1** Reducir el tiempo de revisión médica | TRM | (Σ TRᵢ)/n `[min/caso]` | Reducción ≥ 30 % |
| **OE2** Mejorar la precisión del diagnóstico preliminar | TPD | (DC/DT)×100 `[%]` | ≥ 90 % |
| **OE3** Mejorar la satisfacción del personal | TSP | (Σ PO/PT)×100 `[%]` | ≥ 80 % |
| **OE4** Incrementar la capacidad de atención | TCAD | NCR/TJ `[casos/h]` | Incremento significativo |

Diseño preexperimental pretest–postest de un solo grupo (**G: O₁ → X → O₂**) sobre un censo de 30
casos. **Cada caso es su propio control**: se mide dos veces, una sin IA y otra con IA.

> **Aviso:** Herramienta de apoyo diagnóstico con fines de investigación académica. No sustituye el
> juicio clínico del profesional médico. Prototipo académico UNT — no certificado como dispositivo
> médico.

---

## Levantamiento en menos de 10 minutos

Requiere **Node 20+**, **pnpm** y acceso a una PostgreSQL 16 o superior.

```bash
pnpm install
cp .env.example .env
```

Genere los dos secretos obligatorios y péguelos en `.env`:

```bash
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))"
```

> `ENCRYPTION_KEY` cifra la identidad del paciente y las imágenes. **Si cambia, los datos ya
> cifrados dejan de poder leerse.** Guárdela con el mismo cuidado que la contraseña de la base.

```bash
pnpm migration:run        # crea las 15 tablas del esquema clínico
pnpm seed:admin           # crea las cuentas e imprime las contraseñas UNA sola vez
pnpm dev                  # http://localhost:3001/api
```

Verificación:

```bash
curl http://localhost:3001/api/health
```

- Swagger UI: <http://localhost:3001/docs>
- OpenAPI: <http://localhost:3001/openapi.json>

### Datos de demostración

```bash
pnpm seed:study
```

Genera 30 casos sintéticos reproducibles (semilla fija) con sus dos mediciones, imágenes PNG
cifradas, Grad-CAM simulado, jornadas y cuestionarios. Todo queda marcado con
`is_synthetic = true` y **se excluye por defecto** de indicadores, contrastes y exportaciones: para
verlo hay que pedir explícitamente `?includeSynthetic=true`. Así los datos de demostración nunca
pueden confundirse con evidencia de la tesis.

---

## Arquitectura

Tres repositorios independientes que se comunican solo por contratos OpenAPI:

| Proyecto | Rol | Puerto |
|---|---|---|
| [`acne-web`](../acne-web) | Portal del dermatólogo y PWA del paciente | 3000 |
| **`acne-api`** (este) | Orquestación clínica, indicadores y estadística | 3001 |
| [`acne-ai-engine`](../acne-ai-engine) | Inferencia CNN, Grad-CAM y SciPy | 8000 |

### Dominios (`src/`)

```
common/domain/   Fuente única de verdad: IGA, GAGS, indicadores, hipótesis, Likert, disclaimer
common/crypto/   AES-256-GCM y tokens firmados (RNF-02)
auth/ users/     JWT + 4 roles + modo de estudio (RF-TR-01, RF-TR-02)
patients/        Anonimización, consentimiento e historia longitudinal (RF-TR-03, RNF-07)
anamnesis/       Cuestionario clínico de acné por visita (extensión, ver TRACEABILITY)
capture/         Sesiones de captura desde el móvil por QR (Sección 9.3, RNF-02)
cases/ images/   Casos, apertura cronometrada, imágenes cifradas
study/           Guard de la variable independiente y Anexo 4
inference/       Cliente del motor + cola con reintentos
diagnoses/       Juicio del especialista y Anexo 5
sessions/        Jornadas y Anexo 7 (OE4)
surveys/         Cuestionario Likert, Anexo 6 (OE3)
indicators/      TRM, TPD, TSP, TCAD, matriz de confusión
stats/           Contrastes HE₁–HE₄ y exportación CSV
reports/         Los cuatro PDF de la tesis
audit/           Trazabilidad de tesis e IIA
meta/            Catálogos del dominio para el frontend
```

### Cómo se protege la validez del experimento

- **Bloqueo real de la IA en pretest.** `StudyModeGuard` devuelve **403** en cualquier ruta de
  inferencia cuando el usuario opera en `pretest`. Ocultar el botón no basta: una llamada
  rezagada del cliente contaminaría la observación O₁ y después no habría forma de saber cuáles de
  los 30 casos quedaron afectados.
- **Cronometraje sellado por el servidor.** `t₀` y `t₁` los pone la API, nunca el navegador, y la
  apertura es idempotente por caso y condición: recargar la página no acorta el tiempo medido.
- **Patrón de referencia común.** `cases.ground_truth_iga` es lo que hace comparables pretest y
  postest en RF-OE2-05; sin él, cada condición se juzgaría contra una vara distinta.
- **Logs inmutables.** `indicator_snapshots` y `hypothesis_runs` guardan los datos exactos, la
  semilla y la versión de la función estadística, de modo que un evaluador externo puede
  reproducir cualquier cifra citada (RNF-05).

---

## Endpoints principales

| Método | Ruta | Objetivo |
|---|---|---|
| `POST` | `/api/auth/login` | RF-TR-02 |
| `PATCH` | `/api/users/me/study-mode` | RF-TR-01 — aplicar la intervención X |
| `POST` | `/api/cases/:id/open` | RF-OE1-01 — sella `t₀` |
| `POST` | `/api/diagnoses/case/:id` | Cierra `t₁`, congela concordancia y suma NCR |
| `POST` | `/api/inference/case/:id/image/:id` | **403 en pretest** |
| `GET` | `/api/indicators/dashboard` | TRM · TPD · TSP · TCAD |
| `POST` | `/api/stats/hypothesis/all` | HE₁–HE₄ + H₁ en un clic |
| `GET` | `/api/stats/dataset-export` | CSV del estudio (solo `admin`) |
| `GET` | `/api/reports/:report/pdf` | Los cuatro entregables |
| `GET` | `/api/audit/thesis-coverage` | RNF-04 |
| `GET` | `/api/audit/iia-check` | RF-TR-04 |
| `GET` | `/api/meta/catalogs` | Catálogos para el frontend |

---

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor en modo watch |
| `pnpm build` / `pnpm start` | Compilar y ejecutar |
| `pnpm test` / `pnpm test:cov` | Pruebas unitarias y cobertura |
| `pnpm lint` / `pnpm typecheck` | Calidad estática |
| `pnpm migration:run` / `migration:revert` | Migraciones |
| `pnpm seed:admin` / `pnpm seed:study` | Cuentas y datos de demostración |
| `pnpm generate:ai-types` | Regenera los tipos del motor desde su OpenAPI |

Para los PDF, la primera vez: `npx playwright install chromium`.

---

## Adaptadores intercambiables

El stack obligatorio de la tesis pide Redis/BullMQ, MinIO y MLflow. Como esa infraestructura aún
no está levantada, cada uno vive detrás de una interfaz y se conmuta por variable de entorno.
Ninguna sustitución elimina cobertura de objetivos; todas están declaradas en
[`../acne-infra/TRACEABILITY.md`](../acne-infra/TRACEABILITY.md), sección 4.

| Interfaz | Por defecto | Activable con |
|---|---|---|
| `StorageProvider` | Disco local cifrado | `STORAGE_DRIVER=minio` |
| `QueueProvider` | Cola en PostgreSQL | `QUEUE_DRIVER=bullmq` *(pendiente de implementar)* |
| `WhatsAppService` (`src/messaging/`) | Canal simulado (registrado, no enviado) | `INFOBIP_BASE_URL` + `INFOBIP_API_KEY` → envío real por Infobip (texto); además `PUBLIC_BASE_URL` (túnel ngrok) → la receta va como PDF adjunto; ver `.env.example` |

---

## Trazabilidad

Toda tanda de cambios actualiza [`../acne-infra/TRACEABILITY.md`](../acne-infra/TRACEABILITY.md) y
este `CHANGELOG.md`. La matriz servida por `GET /api/audit/thesis-coverage` debe coincidir con el
documento; la cobertura se **calcula**, no se declara: mientras el motor use el stub determinista,
OE2, OG e IIA bajan automáticamente a `partial`.
