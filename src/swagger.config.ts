import type { DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

import { CLINICAL_DISCLAIMER, THESIS_METADATA } from './common/domain';

/**
 * OpenAPI document description. It is also the contract `acne-web` compiles against, so the
 * disclaimer and the objective map travel with it and reach anyone reading the API.
 */
export function buildSwaggerConfig(builder: DocumentBuilder): Omit<OpenAPIObject, 'paths'> {
  return builder
    .setTitle('acne-api · Orquestación clínica')
    .setDescription(
      `**${THESIS_METADATA.title}**\n\n` +
        `${THESIS_METADATA.university} — ${THESIS_METADATA.school} — ${THESIS_METADATA.year}\n\n` +
        `Autores: ${THESIS_METADATA.authors.join(' · ')}. Asesor: ${THESIS_METADATA.advisor}.\n\n` +
        `> ${CLINICAL_DISCLAIMER}\n\n` +
        '### Mapa de objetivos\n\n' +
        '| Objetivo | Indicador | Dominios |\n' +
        '|---|---|---|\n' +
        '| OE1 — Tiempo de revisión | TRM = (Σ TRᵢ)/n | `study`, `indicators`, `stats` |\n' +
        '| OE2 — Precisión diagnóstica | TPD = (DC/DT)×100 | `inference`, `diagnoses`, `indicators` |\n' +
        '| OE3 — Satisfacción | TSP = (Σ PO/PT)×100 | `surveys`, `indicators`, `stats` |\n' +
        '| OE4 — Capacidad de atención | TCAD = NCR/TJ | `sessions`, `indicators`, `stats` |\n\n' +
        '**Variable independiente:** las rutas de `inference` devuelven **403** cuando el usuario ' +
        'opera en `study_mode = pretest` (RF-TR-01).',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addTag('auth', 'Autenticación y roles (RF-TR-02)')
    .addTag('users', 'Personal del estudio y modo de estudio (RF-TR-01)')
    .addTag('patients', 'Pacientes anonimizados y consentimiento (RF-TR-03, RNF-07)')
    .addTag('cases', 'Casos clínicos y apertura cronometrada (OE1)')
    .addTag('images', 'Imágenes cifradas y URLs firmadas (RNF-02)')
    .addTag('inference', 'Motor CNN — bloqueado en pretest (OE2, RF-TR-01)')
    .addTag('diagnoses', 'Diagnóstico del especialista y Anexo 5 (OE2)')
    .addTag('study', 'Diseño experimental y Anexo 4 (OE1)')
    .addTag('sessions', 'Jornadas de trabajo y Anexo 7 (OE4)')
    .addTag('surveys', 'Cuestionario Likert del Anexo 6 (OE3)')
    .addTag('indicators', 'TRM, TPD, TSP y TCAD (OE1–OE4)')
    .addTag('stats', 'Contraste de HE₁–HE₄ y exportación de datasets')
    .addTag('reports', 'Reportes PDF de la tesis (RNF-06)')
    .addTag('audit', 'Trazabilidad de tesis e IIA (RNF-04, RF-TR-04)')
    .addTag('meta', 'Catálogos del dominio')
    .addTag('health', 'Estado del servicio')
    .build();
}
