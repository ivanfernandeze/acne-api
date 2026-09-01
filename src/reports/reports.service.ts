import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { IndicatorsService } from 'src/indicators/indicators.service';
import { AiEngineClient } from 'src/inference/ai-engine.client';
import { StatsService } from 'src/stats/stats.service';
import { SurveysService } from 'src/surveys/surveys.service';

import { renderDocument, type ReportMeta } from './report-layout';
import {
  renderHypothesisReport,
  renderIndicatorsReport,
  renderModelEvaluationReport,
  renderUsabilityReport,
} from './report-templates';

export type ReportName =
  | 'indicadores'
  | 'contraste-hipotesis'
  | 'usabilidad'
  | 'evaluacion-modelo';

export const REPORT_NAMES: readonly ReportName[] = [
  'indicadores',
  'contraste-hipotesis',
  'usabilidad',
  'evaluacion-modelo',
];

export const REPORT_FILENAMES: Readonly<Record<ReportName, string>> = {
  indicadores: 'REPORTE-INDICADORES',
  'contraste-hipotesis': 'REPORTE-CONTRASTE-HIPOTESIS',
  usabilidad: 'REPORTE-USABILIDAD',
  'evaluacion-modelo': 'REPORTE-EVALUACION-MODELO',
};

/**
 * PDF generation with Playwright + Chromium.
 *
 * Covers: section 3 (reporte exportable), the Section 11 deliverables and RNF-06 (every document
 * carries the regulatory disclaimer verbatim).
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly indicators: IndicatorsService,
    private readonly stats: StatsService,
    private readonly surveys: SurveysService,
    private readonly aiEngine: AiEngineClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async generate(
    report: ReportName,
    options: { includeSynthetic: boolean; generatedBy: string; executedBy: string | null },
  ): Promise<Buffer> {
    const html = await this.buildHtml(report, options);
    return this.renderPdf(html);
  }

  async buildHtml(
    report: ReportName,
    options: { includeSynthetic: boolean; generatedBy: string; executedBy: string | null },
  ): Promise<string> {
    const includeSynthetic = options.includeSynthetic;

    switch (report) {
      case 'indicadores': {
        const dashboard = await this.indicators.dashboard({ includeSynthetic });
        return renderDocument(
          this.meta(
            'REPORTE-INDICADORES',
            'TRM · TPD · TSP · TCAD — comparativa pretest vs postest con estadística descriptiva',
            'OE1 · OE2 · OE3 · OE4',
            options,
          ),
          renderIndicatorsReport(dashboard),
        );
      }

      case 'contraste-hipotesis': {
        const result = await this.stats.runAll({ includeSynthetic }, options.executedBy);
        return renderDocument(
          this.meta(
            'REPORTE-CONTRASTE-HIPOTESIS',
            'Shapiro-Wilk → t de Student pareada o Wilcoxon · α = 0,05 · HE₁, HE₂, HE₃, HE₄ y H₁',
            'OG (compuesto de OE1–OE4)',
            options,
          ),
          renderHypothesisReport(result),
        );
      }

      case 'usabilidad': {
        const summary = await this.surveys.summary(includeSynthetic);
        return renderDocument(
          this.meta(
            'REPORTE-USABILIDAD',
            'Anexo 6 — Cuestionario Likert de 8 ítems, resultados por ítem y global',
            'OE3 — Satisfacción del personal médico (TSP)',
            options,
          ),
          renderUsabilityReport(summary),
        );
      }

      case 'evaluacion-modelo': {
        const [report_, engineNote] = await Promise.all([
          this.indicators.classificationReport('postest', { includeSynthetic }),
          this.modelStatusNote(),
        ]);
        return renderDocument(
          this.meta(
            'REPORTE-EVALUACION-MODELO',
            'Métricas del clasificador sobre las cinco clases IGA',
            'OE2 — Precisión del diagnóstico preliminar (TPD)',
            options,
          ),
          renderModelEvaluationReport(report_, engineNote),
        );
      }
    }
  }

  private meta(
    title: string,
    subtitle: string,
    objective: string,
    options: { includeSynthetic: boolean; generatedBy: string },
  ): ReportMeta {
    return {
      title,
      subtitle,
      objective,
      generatedBy: options.generatedBy,
      includesSynthetic: options.includeSynthetic,
    };
  }

  /**
   * States, on the model report itself, whether the numbers come from a trained CNN or from the
   * deterministic stub. A metrics report that does not say which is a trap for the reader.
   */
  private async modelStatusNote(): Promise<string | null> {
    try {
      const iia = await this.aiEngine.iiaCheck();
      if (iia.operational) return null;
      return (
        `El motor opera con el backend "${iia.model_backend}" (versión ${iia.version}) y ` +
        '`/audit/iia-check` reporta `operational: false`. Las métricas de este documento NO ' +
        'provienen de una CNN entrenada y no pueden citarse como resultado de la tesis hasta que ' +
        'se cargue un checkpoint válido.'
      );
    } catch {
      return 'No fue posible contactar al motor de IA para verificar el estado del modelo.';
    }
  }

  /**
   * Chromium is launched per report rather than kept warm: report generation is rare (a handful
   * of times during the defence) and a resident browser would hold ~150 MB for nothing.
   */
  private async renderPdf(html: string): Promise<Buffer> {
    let chromium: typeof import('playwright').chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch (error: unknown) {
      throw new ServiceUnavailableException(
        `Playwright no está disponible: ${String(error)}. Instálelo con "pnpm add playwright" y ` +
          'descargue el navegador con "npx playwright install chromium".',
      );
    }

    let browser: import('playwright').Browser | null = null;
    try {
      browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#718096;padding:0 16mm;' +
          'display:flex;justify-content:space-between;">' +
          '<span>Universidad Nacional de Trujillo — Prototipo académico, no certificado como dispositivo médico</span>' +
          '<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>' +
          '</div>',
        margin: { top: '20mm', bottom: '18mm', left: '16mm', right: '16mm' },
      });
      return pdf;
    } catch (error: unknown) {
      this.logger.error(`Fallo al generar el PDF: ${String(error)}`);
      throw new ServiceUnavailableException(
        'No se pudo generar el PDF. Si es la primera ejecución, descargue el navegador con ' +
          '"npx playwright install chromium" dentro de acne-api.',
      );
    } finally {
      if (browser !== null) await browser.close();
    }
  }
}
