import { APA_REFERENCES, CLINICAL_DISCLAIMER, THESIS_METADATA } from 'src/common/domain';

/**
 * HTML layout of the generated PDFs.
 *
 * Note on styling: the Tailwind-only rule of section 12.3 governs `acne-web`. These templates are
 * rendered by headless Chromium inside the API and never reach the portal, so they carry their own
 * print stylesheet — a PDF has no utility-class runtime and needs `@page` rules that Tailwind
 * cannot express.
 */

export interface ReportMeta {
  title: string;
  subtitle: string;
  objective: string;
  generatedBy: string;
  includesSynthetic: boolean;
}

const PRINT_STYLES = `
  @page { size: A4; margin: 20mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; margin: 0;
  }
  h1, h2, h3 { font-family: 'Poppins', 'Inter', system-ui, sans-serif; color: #0f2f4f; margin: 0 0 6px; }
  h1 { font-size: 17pt; }
  h2 { font-size: 13pt; margin-top: 20px; border-bottom: 1.5px solid #0f2f4f; padding-bottom: 4px; }
  h3 { font-size: 11.5pt; margin-top: 14px; }
  header.cover { border-bottom: 3px solid #0f2f4f; padding-bottom: 12px; margin-bottom: 18px; }
  .institution { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.6px; color: #4a5568; }
  .thesis-title { font-size: 11pt; font-style: italic; color: #2d3748; margin: 8px 0; }
  .meta { font-size: 8.5pt; color: #4a5568; }
  .meta strong { color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9pt; }
  th, td { border: 1px solid #cbd5e0; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #edf2f7; font-weight: 600; color: #0f2f4f; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
  .card { flex: 1 1 180px; border: 1px solid #cbd5e0; border-radius: 6px; padding: 10px 12px; }
  /* Deliberately NOT uppercased: text-transform would turn the alpha of "a = 0,05" into a Latin
     letter A, and these labels carry statistical notation, not decoration. */
  .card .label { font-size: 8pt; font-weight: 600; letter-spacing: 0.4px; color: #4a5568; }
  .card .value { font-size: 18pt; font-weight: 700; color: #0f2f4f; font-variant-numeric: tabular-nums; }
  .card .unit { font-size: 9pt; color: #4a5568; font-weight: 400; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8pt; font-weight: 600; }
  .badge.ok { background: #d1fae5; color: #065f46; }
  .badge.warn { background: #fef3c7; color: #92400e; }
  .badge.bad { background: #fee2e2; color: #991b1b; }
  .alert { border-left: 4px solid #d97706; background: #fffbeb; padding: 9px 12px; margin: 10px 0; font-size: 9pt; }
  .disclaimer { border: 1.5px solid #991b1b; background: #fef2f2; color: #7f1d1d;
                padding: 10px 12px; margin-top: 22px; font-size: 8.5pt; border-radius: 4px; }
  .synthetic { border: 1.5px dashed #b45309; background: #fffbeb; color: #92400e;
               padding: 8px 12px; margin: 12px 0; font-size: 9pt; border-radius: 4px; }
  .references { font-size: 8.5pt; color: #2d3748; }
  .references li { margin-bottom: 3px; text-indent: -18px; padding-left: 18px; }
  footer { margin-top: 20px; border-top: 1px solid #cbd5e0; padding-top: 8px;
           font-size: 8pt; color: #718096; }
  .conclusion { background: #eff6ff; border-left: 4px solid #0f2f4f; padding: 10px 12px; margin: 10px 0; }
`;

export function renderDocument(meta: ReportMeta, body: string): string {
  const generatedAt = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>${PRINT_STYLES}</style>
</head>
<body>
<header class="cover">
  <div class="institution">
    ${escapeHtml(THESIS_METADATA.university)} · ${escapeHtml(THESIS_METADATA.faculty)}<br>
    ${escapeHtml(THESIS_METADATA.school)}
  </div>
  <p class="thesis-title">«${escapeHtml(THESIS_METADATA.title)}»</p>
  <h1>${escapeHtml(meta.title)}</h1>
  <p class="meta">${escapeHtml(meta.subtitle)}</p>
  <p class="meta">
    <strong>Objetivo:</strong> ${escapeHtml(meta.objective)}<br>
    <strong>Autores:</strong> ${THESIS_METADATA.authors.map(escapeHtml).join(' · ')}<br>
    <strong>Asesor:</strong> ${escapeHtml(THESIS_METADATA.advisor)}<br>
    <strong>Generado:</strong> ${escapeHtml(generatedAt)} · <strong>Por:</strong> ${escapeHtml(meta.generatedBy)}
  </p>
</header>

${
  meta.includesSynthetic
    ? `<div class="synthetic"><strong>Atención:</strong> este reporte incluye datos sintéticos de
       demostración generados por <code>seed:study</code>. No constituye evidencia de la tesis.</div>`
    : ''
}

${body}

<h2>Referencias</h2>
<ul class="references">
  ${APA_REFERENCES.map((reference) => `<li>${escapeHtml(reference)}</li>`).join('\n  ')}
</ul>

<div class="disclaimer"><strong>Aviso:</strong> ${escapeHtml(CLINICAL_DISCLAIMER)}</div>

<footer>
  ${escapeHtml(THESIS_METADATA.university)} · Línea de investigación: ${escapeHtml(THESIS_METADATA.researchLine)} ·
  ${THESIS_METADATA.year} · Documento generado automáticamente por acne-api.
</footer>
</body>
</html>`;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Spanish (Peru) number formatting: decimal comma, as the thesis text uses. */
export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(decimals).replace('.', ',');
}

export function badge(state: boolean | null, okText: string, badText: string): string {
  if (state === null) return '<span class="badge warn">Sin datos</span>';
  return state
    ? `<span class="badge ok">${escapeHtml(okText)}</span>`
    : `<span class="badge bad">${escapeHtml(badText)}</span>`;
}
