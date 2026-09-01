import { IGA_LABELS, IGA_CLASSES, STUDY_MODE_LABELS } from 'src/common/domain';
import type { ClassificationReportDto, DashboardDto, IndicatorComparisonDto } from 'src/indicators/dto/indicator.dto';
import type { GeneralHypothesisResultDto, HypothesisTestResultDto } from 'src/stats/dto/stats.dto';
import type { SurveySummaryDto } from 'src/surveys/dto/survey.dto';

import { badge, escapeHtml, fmt } from './report-layout';

/** REPORTE-INDICADORES — TRM, TPD, TSP y TCAD comparados pretest vs postest. */
export function renderIndicatorsReport(dashboard: DashboardDto): string {
  const sections = dashboard.indicators.map(renderIndicatorSection).join('\n');
  return `
    <h2>Resumen ejecutivo</h2>
    <table>
      <thead>
        <tr>
          <th>Indicador</th><th>Objetivo</th><th class="num">Pretest</th><th class="num">Postest</th>
          <th class="num">Variación</th><th>Meta</th>
        </tr>
      </thead>
      <tbody>
        ${dashboard.indicators
          .map(
            (indicator) => `
        <tr>
          <td><strong>${escapeHtml(indicator.indicator)}</strong> — ${escapeHtml(indicator.definition.name)}</td>
          <td>${escapeHtml(indicator.definition.objective)}</td>
          <td class="num">${fmt(indicator.pretest?.value ?? null)} ${escapeHtml(indicator.definition.unit)}</td>
          <td class="num">${fmt(indicator.postest?.value ?? null)} ${escapeHtml(indicator.definition.unit)}</td>
          <td class="num">${indicator.relativeChangePct === null ? '—' : `${fmt(indicator.relativeChangePct, 1)} %`}</td>
          <td>${badge(indicator.targetMet, 'Cumple', 'No cumple')}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    ${sections}`;
}

function renderIndicatorSection(indicator: IndicatorComparisonDto): string {
  const definition = indicator.definition;
  const rows = (['pretest', 'postest'] as const)
    .map((mode) => {
      const value = mode === 'pretest' ? indicator.pretest : indicator.postest;
      if (value === null) {
        return `<tr><td>${escapeHtml(STUDY_MODE_LABELS[mode])}</td><td colspan="8">Sin mediciones</td></tr>`;
      }
      const d = value.descriptive;
      return `<tr>
        <td>${escapeHtml(STUDY_MODE_LABELS[mode])}</td>
        <td class="num">${d.n}</td>
        <td class="num">${fmt(d.mean)}</td>
        <td class="num">${fmt(d.sd)}</td>
        <td class="num">${fmt(d.min)}</td>
        <td class="num">${fmt(d.q1)}</td>
        <td class="num">${fmt(d.median)}</td>
        <td class="num">${fmt(d.q3)}</td>
        <td class="num">${fmt(d.max)}</td>
      </tr>`;
    })
    .join('');

  return `
    <h2>${escapeHtml(definition.objective)} · ${escapeHtml(indicator.indicator)} — ${escapeHtml(definition.name)}</h2>
    <p class="meta">
      <strong>Fórmula:</strong> ${escapeHtml(definition.formula)} ·
      <strong>Unidad:</strong> ${escapeHtml(definition.unit)} ·
      <strong>Instrumento:</strong> ${escapeHtml(definition.instrument)} ·
      <strong>Meta:</strong> ${escapeHtml(definition.target)}
    </p>
    <div class="cards">
      <div class="card"><div class="label">Pretest (IIA = 0)</div>
        <div class="value">${fmt(indicator.pretest?.value ?? null)} <span class="unit">${escapeHtml(definition.unit)}</span></div></div>
      <div class="card"><div class="label">Postest (IIA = 1)</div>
        <div class="value">${fmt(indicator.postest?.value ?? null)} <span class="unit">${escapeHtml(definition.unit)}</span></div></div>
      <div class="card"><div class="label">Variación relativa</div>
        <div class="value">${indicator.relativeChangePct === null ? '—' : `${fmt(indicator.relativeChangePct, 1)}`} <span class="unit">%</span></div></div>
    </div>
    <h3>Estadística descriptiva</h3>
    <table>
      <thead><tr>
        <th>Condición</th><th class="num">n</th><th class="num">Media</th><th class="num">DE</th>
        <th class="num">Mín</th><th class="num">Q1</th><th class="num">Mediana</th><th class="num">Q3</th><th class="num">Máx</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${indicator.alert === null ? '' : `<div class="alert"><strong>Alerta:</strong> ${escapeHtml(indicator.alert)}</div>`}`;
}

/** REPORTE-CONTRASTE-HIPOTESIS — Shapiro-Wilk, prueba aplicada, p-valor y decisión. */
export function renderHypothesisReport(result: GeneralHypothesisResultDto): string {
  return `
    <h2>Hipótesis general</h2>
    <p><strong>H₁:</strong> ${escapeHtml(result.h1)}</p>
    <p><strong>H₀:</strong> ${escapeHtml(result.h0)}</p>
    <div class="conclusion"><strong>Conclusión:</strong> ${escapeHtml(result.conclusion)}</div>

    <h2>Resumen de los contrastes</h2>
    <table>
      <thead><tr>
        <th>Hipótesis</th><th>Indicador</th><th class="num">n</th><th>Shapiro-Wilk</th>
        <th>Prueba aplicada</th><th class="num">Estadístico</th><th class="num">p-valor</th><th>Decisión</th>
      </tr></thead>
      <tbody>
        ${result.results
          .map(
            (test) => `<tr>
          <td><strong>${escapeHtml(test.hypothesis)}</strong></td>
          <td>${escapeHtml(test.indicator)}</td>
          <td class="num">${test.nPairs}</td>
          <td>${
            test.normality.applicable
              ? `W = ${fmt(test.normality.statistic, 4)}; p = ${fmt(test.normality.pValue, 4)}<br>
                 <em>${test.normality.normal ? 'Normal' : 'No normal'}</em>`
              : 'No aplicable'
          }</td>
          <td>${escapeHtml(test.testLabel)}</td>
          <td class="num">${fmt(test.statistic, 4)}</td>
          <td class="num">${test.pValue < 0.001 ? '&lt; 0,001' : fmt(test.pValue, 4)}</td>
          <td>${badge(test.rejectsNull, 'Se rechaza H₀', 'No se rechaza H₀')}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>

    ${result.results.map(renderHypothesisDetail).join('\n')}`;
}

function renderHypothesisDetail(test: HypothesisTestResultDto): string {
  return `
    <h2>${escapeHtml(test.hypothesis)} — ${escapeHtml(test.indicator)}</h2>
    <p><strong>Hipótesis alterna:</strong> ${escapeHtml(test.statement)}</p>
    <p><strong>Hipótesis nula:</strong> ${escapeHtml(test.nullStatement)}</p>
    <div class="cards">
      <div class="card"><div class="label">Media pretest</div><div class="value">${fmt(test.pretestMean)}</div></div>
      <div class="card"><div class="label">Media postest</div><div class="value">${fmt(test.postestMean)}</div></div>
      <div class="card"><div class="label">Diferencia</div><div class="value">${fmt(test.meanDifference)}</div></div>
      <div class="card"><div class="label">p-valor (α = ${fmt(test.alpha, 3)})</div>
        <div class="value">${test.pValue < 0.001 ? '&lt;0,001' : fmt(test.pValue, 4)}</div></div>
    </div>
    ${
      test.effectSize === null
        ? ''
        : `<p class="meta"><strong>Tamaño del efecto:</strong> ${escapeHtml(test.effectSize.kind)} =
           ${fmt(test.effectSize.value, 4)} (${escapeHtml(test.effectSize.magnitude)})</p>`
    }
    <div class="conclusion">${escapeHtml(test.conclusion)}</div>
    <p class="meta">
      <strong>Trazabilidad (RNF-05):</strong> ejecución <code>${escapeHtml(test.id)}</code> ·
      semilla ${test.seed} · función ${escapeHtml(test.functionVersion)} ·
      hash de insumos <code>${escapeHtml(test.inputHash.slice(0, 16))}…</code> ·
      ${escapeHtml(test.executedAt)}
    </p>
    <h3>Datos pareados</h3>
    <table>
      <thead><tr><th>Unidad</th><th class="num">Pretest</th><th class="num">Postest</th><th class="num">Diferencia</th></tr></thead>
      <tbody>
        ${test.pairs
          .map(
            (pair) => `<tr>
              <td>${escapeHtml(pair.label)}</td>
              <td class="num">${fmt(pair.pretest)}</td>
              <td class="num">${fmt(pair.postest)}</td>
              <td class="num">${fmt(pair.difference)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

/** REPORTE-USABILIDAD — Anexo 6 por ítem y global. */
export function renderUsabilityReport(summary: SurveySummaryDto): string {
  return `
    <h2>Resultados globales</h2>
    <div class="cards">
      <div class="card"><div class="label">Encuestados</div><div class="value">${summary.respondents}</div></div>
      <div class="card"><div class="label">TSP</div><div class="value">${fmt(summary.tspPct, 1)} <span class="unit">%</span></div></div>
      <div class="card"><div class="label">Likert promedio</div><div class="value">${fmt(summary.meanLikert)} <span class="unit">/5</span></div></div>
      <div class="card"><div class="label">Meta (≥ 80 % y ≥ 4/5)</div>
        <div class="value" style="font-size:12pt">${badge(summary.targetMet, 'Cumple', 'No cumple')}</div></div>
    </div>
    ${summary.alert === null ? '' : `<div class="alert"><strong>Alerta:</strong> ${escapeHtml(summary.alert)}</div>`}

    <h2>Resultados por ítem</h2>
    <table>
      <thead><tr>
        <th class="num">N.º</th><th>Ítem del instrumento</th><th class="num">Media</th><th class="num">DE</th>
        <th class="num">TSP %</th><th class="num">1</th><th class="num">2</th><th class="num">3</th>
        <th class="num">4</th><th class="num">5</th>
      </tr></thead>
      <tbody>
        ${summary.items
          .map(
            (item) => `<tr>
          <td class="num">${item.itemNumber}</td>
          <td>${escapeHtml(item.text)}</td>
          <td class="num">${fmt(item.mean)}</td>
          <td class="num">${fmt(item.sd)}</td>
          <td class="num">${fmt(item.tspPct, 1)}</td>
          <td class="num">${item.distribution[1] ?? 0}</td>
          <td class="num">${item.distribution[2] ?? 0}</td>
          <td class="num">${item.distribution[3] ?? 0}</td>
          <td class="num">${item.distribution[4] ?? 0}</td>
          <td class="num">${item.distribution[5] ?? 0}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <p class="meta">Escala: 1 = Muy bajo · 2 = Bajo · 3 = Normal · 4 = Alto · 5 = Muy alto.
    TSP = (Σ PO / PT) × 100, con PT = 40 puntos por encuestado (8 ítems × 5).</p>`;
}

/** REPORTE-EVALUACION-MODELO — métricas de clasificación sobre las 5 clases IGA. */
export function renderModelEvaluationReport(
  report: ClassificationReportDto,
  engineNote: string | null,
): string {
  const header = IGA_CLASSES.map((c) => `<th class="num">${escapeHtml(IGA_LABELS[c])}</th>`).join('');
  const matrixRows = IGA_CLASSES.map((reference, i) => {
    const row = report.confusionMatrix[i] ?? [];
    const cells = IGA_CLASSES.map((_, j) => {
      const value = row[j] ?? 0;
      const isDiagonal = i === j;
      return `<td class="num"${isDiagonal ? ' style="background:#d1fae5;font-weight:600"' : ''}>${value}</td>`;
    }).join('');
    return `<tr><th>${escapeHtml(IGA_LABELS[reference])}</th>${cells}</tr>`;
  }).join('');

  return `
    ${
      engineNote === null
        ? ''
        : `<div class="alert"><strong>Estado del modelo:</strong> ${escapeHtml(engineNote)}</div>`
    }
    <h2>Métricas globales</h2>
    <div class="cards">
      <div class="card"><div class="label">Exactitud (TPD)</div><div class="value">${fmt(report.accuracyPct, 1)} <span class="unit">%</span></div></div>
      <div class="card"><div class="label">Aciertos</div><div class="value">${report.correct} <span class="unit">/ ${report.total}</span></div></div>
      <div class="card"><div class="label">F1 macro</div><div class="value">${fmt(report.f1Macro, 3)}</div></div>
      <div class="card"><div class="label">AUC-ROC macro</div><div class="value">${fmt(report.aucRocMacro, 3)}</div></div>
    </div>
    <p class="meta"><strong>Patrón de referencia:</strong> ${escapeHtml(report.standard)} ·
    <strong>Condición:</strong> ${escapeHtml(report.studyMode)}</p>
    <p class="meta">Referencia de calibración: Watanabe (2025) reporta 90,0 % de exactitud,
    F1 macro 0,885 y AUC-ROC macro 0,998 sobre 349 imágenes faciales con IGA. El criterio de éxito
    declarado en la Fase 1 es replicar ≥ 85 % de ese F1 macro, es decir F1 macro ≥ 0,752.</p>

    <h2>Matriz de confusión (5 clases IGA)</h2>
    <table>
      <thead><tr><th>Referencia \\ Predicción</th>${header}</tr></thead>
      <tbody>${matrixRows}</tbody>
    </table>

    <h2>Métricas por clase</h2>
    <table>
      <thead><tr>
        <th>Clase IGA</th><th class="num">Soporte</th><th class="num">Precisión</th>
        <th class="num">Sensibilidad</th><th class="num">Especificidad</th><th class="num">F1</th>
      </tr></thead>
      <tbody>
        ${report.perClass
          .map(
            (metrics) => `<tr>
          <td>${escapeHtml(IGA_LABELS[metrics.igaClass])}</td>
          <td class="num">${metrics.support}</td>
          <td class="num">${fmt(metrics.precision, 3)}</td>
          <td class="num">${fmt(metrics.recall, 3)}</td>
          <td class="num">${fmt(metrics.specificity, 3)}</td>
          <td class="num">${fmt(metrics.f1, 3)}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}
