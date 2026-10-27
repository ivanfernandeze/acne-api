import { Workbook, type Borders, type Worksheet } from 'exceljs';

import type { ExportMode } from './dataset-export.service';

/**
 * Anexo 4 (OE1) como libro de Excel con el formato del instrumento de la tesis.
 *
 * El CSV de `tiempos` es para SPSS o R; este archivo es el que se imprime o se pega en los anexos.
 * Por eso reproduce las columnas de la ficha en papel — N.º, fecha, código de caso, t₀, t₁, TR,
 * fuente e ID de cronometraje — con t₀ y t₁ ya llenos desde `cronometrajes_revision`, en hora de
 * Lima, y en blanco y negro para que imprima igual en cualquier impresora.
 */
export interface Anexo4TimingRow {
  id: string;
  caso: string;
  paciente: string;
  modo: ExportMode;
  t0: Date;
  t1: Date | null;
  duracion_seg: number | null;
  valida: boolean;
  origen: string;
  es_sintetico: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  sistema: 'Sistema (auditoría)',
  transcrita: 'Manual, transcrito',
  importada: 'Manual, importado',
};

const NOTE_SYSTEM =
  't₀ se registra al abrir la ficha del caso y t₁ al firmar el diagnóstico definitivo; ambos los sella el servidor.';
const NOTE_MANUAL =
  'En las filas de fuente «Manual», t₀ es la hora de inicio anotada en la ficha en papel (al minuto) y ' +
  't₁ = t₀ + TR cronometrado a mano; los valores se cargaron al sistema después de la jornada.';

const SUBTITLES: Record<ExportMode | 'ambos', string> = {
  pretest: 'Registro de la preprueba (sin IA)',
  postest: 'Registro de la posprueba (con IA)',
  ambos: 'Registro de la preprueba (sin IA) y la posprueba (con IA)',
};

const FONT = 'Arial';
const THIN = { style: 'thin', color: { argb: 'FF000000' } } as const;
const MEDIUM = { style: 'medium', color: { argb: 'FF000000' } } as const;
const GRID: Partial<Borders> = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
};

interface Column {
  header: string;
  width: number;
  align: 'left' | 'center' | 'right';
}

export async function buildAnexo4Workbook(
  rows: Anexo4TimingRow[],
  mode: ExportMode | null,
): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = 'Prototipo de apoyo al diagnóstico de acné';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Anexo4_OE1', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.5,
        right: 0.5,
        top: 0.6,
        bottom: 0.6,
        header: 0.3,
        footer: 0.3,
      },
    },
    headerFooter: { oddFooter: '&L&8Anexo 4 · OE1&R&8Página &P de &N' },
  });

  const columns: Column[] = [
    { header: 'N.º', width: 6, align: 'center' },
    { header: 'Fecha', width: 12, align: 'center' },
    { header: 'Código de caso', width: 16, align: 'center' },
    { header: 'Paciente', width: 16, align: 'center' },
    ...(mode === null ? [{ header: 'Condición', width: 12, align: 'center' } as Column] : []),
    { header: 'Hora de apertura de la ficha (t₀)', width: 14, align: 'center' },
    {
      header: 'Hora de firma del diagnóstico (t₁)',
      width: 14,
      align: 'center',
    },
    { header: 'TR registrado (min)', width: 12, align: 'center' },
    { header: 'TR (min:s)', width: 10, align: 'center' },
    { header: 'Fuente', width: 21, align: 'left' },
    { header: 'ID de cronometraje (sistema)', width: 38, align: 'left' },
    { header: 'Observación', width: 28, align: 'left' },
  ];
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });
  const lastColumn = columns.length;

  // ── Encabezado del instrumento ─────────────────────────────────────────────
  writeMerged(sheet, 1, lastColumn, 'FICHA DE REGISTRO DEL TIEMPO DE REVISIÓN MÉDICA', {
    size: 14,
    bold: true,
  });
  writeMerged(sheet, 2, lastColumn, 'Anexo 4 · Objetivo específico 1 (OE1)', {
    size: 10,
  });
  writeMerged(sheet, 3, lastColumn, SUBTITLES[mode ?? 'ambos'], {
    size: 11,
    bold: true,
    italic: true,
  });
  sheet.getRow(1).height = 22;
  for (let col = 1; col <= lastColumn; col++) sheet.getCell(3, col).border = { bottom: MEDIUM };

  const valid = rows.filter((row) => row.valida && reviewMs(row) !== null);
  const minutes = valid.map((row) => (reviewMs(row) as number) / 60_000);
  const bySystem = rows.filter((row) => row.origen === 'sistema').length;
  const source =
    bySystem === rows.length
      ? 'Cronometraje sellado por el servidor'
      : bySystem === 0
        ? 'Cronometraje manual (ficha en papel), cargado al sistema'
        : 'Mixta: ver la columna Fuente';
  // Lo que trae la ficha, no lo que pidió la casilla: con la casilla marcada y cero sintéticos, el
  // encabezado decía «Reales y sintéticos» sobre datos todos reales.
  const synthetic = rows.filter((row) => row.es_sintetico).length;
  const issued = `${formatDate(new Date())} ${formatTime(new Date()).slice(0, 5)}`;

  // ── Datos del registro (izquierda) y resumen (derecha), sobre la tabla ──────
  // El resumen va arriba y no al pie: al pie, con 30 casos, Excel lo partía entre dos páginas.
  const metaLastColumn = lastColumn - 2;
  const summaryLabelColumn = lastColumn - 1;
  sectionTitle(sheet, 4, 1, metaLastColumn, 'DATOS DEL REGISTRO');
  sectionTitle(sheet, 4, summaryLabelColumn, lastColumn, 'RESUMEN');

  const meta: Array<[string, string]> = [
    ['Variable', 'Tiempo de revisión médica: TR = t₁ − t₀ (minutos)'],
    ['Fuente de los datos', source],
    ['Zona horaria', 'Hora de Lima (UTC−5)'],
    ['Datos incluidos', synthetic === 0 ? 'Solo reales' : `Reales y ${synthetic} sintéticos`],
    ['Fecha de emisión', issued],
  ];
  meta.forEach(([label, value], index) => {
    const row = 5 + index;
    sheet.mergeCells(row, 1, row, 3);
    sheet.mergeCells(row, 4, row, metaLastColumn);
    styleCell(sheet.getCell(row, 1), `${label}:`, { bold: true }, 'left');
    styleCell(sheet.getCell(row, 4), value, {}, 'left');
  });

  const summary: Array<[string, number | null, string]> = [
    ['Registros en la ficha', rows.length, '0'],
    ['Registros válidos', valid.length, '0'],
    ['TR promedio — TRM (min)', mean(minutes), '0.00'],
    ['Desviación estándar (min)', stdDev(minutes), '0.00'],
    ['TR mínimo (min)', minutes.length === 0 ? null : Math.min(...minutes), '0.00'],
    ['TR máximo (min)', minutes.length === 0 ? null : Math.max(...minutes), '0.00'],
  ];
  summary.forEach(([label, value, format], index) => {
    const row = 5 + index;
    styleCell(sheet.getCell(row, summaryLabelColumn), label, {}, 'left');
    const cell = sheet.getCell(row, lastColumn);
    styleCell(cell, value === null ? '—' : Number(value.toFixed(4)), { bold: true }, 'center');
    if (value !== null) cell.numFmt = format;
  });

  // ── Tabla ──────────────────────────────────────────────────────────────────
  const headerRow = 12;
  columns.forEach((column, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    styleCell(cell, column.header, { bold: true }, 'center');
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' },
    };
    cell.border = { top: MEDIUM, left: THIN, right: THIN, bottom: MEDIUM };
  });
  sheet.getRow(headerRow).height = 42;

  rows.forEach((row, index) => {
    const notes = [
      row.valida ? null : 'No válida (excluida del TRM)',
      row.t1 === null ? 'Sin firma' : null,
      row.es_sintetico ? 'Sintético' : null,
    ].filter((note): note is string => note !== null);

    const values: Array<string | number | null> = [
      index + 1,
      formatDate(row.t0),
      row.caso,
      row.paciente,
      ...(mode === null ? [row.modo === 'pretest' ? 'Preprueba' : 'Posprueba'] : []),
      formatTime(row.t0),
      row.t1 === null ? '—' : formatTime(row.t1),
      reviewMs(row) === null ? null : Number(((reviewMs(row) as number) / 60_000).toFixed(2)),
      reviewMs(row) === null ? '—' : minutesSeconds(reviewMs(row) as number),
      SOURCE_LABELS[row.origen] ?? row.origen,
      row.id,
      notes.join('; '),
    ];

    const rowNumber = headerRow + 1 + index;
    values.forEach((value, col) => {
      const column = columns[col] as Column;
      const cell = sheet.getCell(rowNumber, col + 1);
      styleCell(
        cell,
        value,
        column.header === 'ID de cronometraje (sistema)' ? { size: 8 } : {},
        column.align,
      );
      cell.border = GRID;
      if (typeof value === 'number' && column.header.startsWith('TR registrado')) {
        cell.numFmt = '0.00';
      }
    });
  });

  // Cierra la tabla con un borde grueso, como la ficha impresa.
  const lastDataRow = headerRow + Math.max(rows.length, 1);
  if (rows.length === 0) {
    sheet.mergeCells(lastDataRow, 1, lastDataRow, lastColumn);
    styleCell(
      sheet.getCell(lastDataRow, 1),
      'Sin registros para esta condición.',
      { italic: true },
      'center',
    );
  }
  for (let col = 1; col <= lastColumn; col++) {
    const cell = sheet.getCell(lastDataRow, col);
    cell.border = { ...GRID, bottom: MEDIUM };
  }

  // ── Nota y firmas ──────────────────────────────────────────────────────────
  const notesRow = lastDataRow + 2;
  writeMerged(
    sheet,
    notesRow,
    lastColumn,
    `Nota: ${[
      bySystem > 0 ? NOTE_SYSTEM : null,
      bySystem < rows.length ? NOTE_MANUAL : null,
      'Las revisiones no válidas se conservan en la ficha pero no entran en el cálculo del TRM.',
    ]
      .filter((part) => part !== null)
      .join(' ')}`,
    { size: 8, italic: true },
    'left',
  );
  // Una celda combinada no crece sola con el texto: sin alto fijo, la segunda línea se corta.
  sheet.getRow(notesRow).height = 24;
  sheet.getCell(notesRow, 1).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

  const signRow = notesRow + 4;
  const signatures: Array<[number, number, string]> = [
    [1, 3, 'Responsable del registro'],
    [summaryLabelColumn, summaryLabelColumn, 'Firma y sello'],
  ];
  for (const [from, to, label] of signatures) {
    if (to > from) sheet.mergeCells(signRow, from, signRow, to);
    styleCell(sheet.getCell(signRow, from), label, { size: 9 }, 'center');
    for (let col = from; col <= to; col++) sheet.getCell(signRow, col).border = { top: THIN };
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }];
  sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function sectionTitle(
  sheet: Worksheet,
  row: number,
  from: number,
  to: number,
  title: string,
): void {
  if (to > from) sheet.mergeCells(row, from, row, to);
  styleCell(sheet.getCell(row, from), title, { bold: true, size: 9 }, 'left');
  for (let col = from; col <= to; col++) sheet.getCell(row, col).border = { bottom: THIN };
}

function writeMerged(
  sheet: Worksheet,
  row: number,
  lastColumn: number,
  value: string,
  font: FontOptions,
  align: Column['align'] = 'center',
): void {
  sheet.mergeCells(row, 1, row, lastColumn);
  styleCell(sheet.getCell(row, 1), value, font, align);
}

interface FontOptions {
  size?: number;
  bold?: boolean;
  italic?: boolean;
}

function styleCell(
  cell: ReturnType<Worksheet['getCell']>,
  value: string | number | null,
  font: FontOptions,
  align: Column['align'],
): void {
  cell.value = value;
  cell.font = { name: FONT, size: 10, color: { argb: 'FF000000' }, ...font };
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
}

/** Lima no tiene horario de verano: UTC−5 todo el año. */
function limaIso(value: Date): string {
  return new Date(value.getTime() - 5 * 3_600_000).toISOString();
}

function formatDate(value: Date): string {
  const [year, month, day] = limaIso(value).slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * TR en milisegundos, de t₁ − t₀ y no de `duracion_segundos`.
 *
 * `duracion_segundos` es entero: un TR de 5,64 min (338,4 s) se guarda como 338 s y se leía 5,63.
 * t₁ − t₀ conserva el valor anotado en la ficha. Sin t₁, queda la duración guardada.
 */
function reviewMs(row: Anexo4TimingRow): number | null {
  if (row.t1 !== null) return new Date(row.t1).getTime() - new Date(row.t0).getTime();
  return row.duracion_seg === null ? null : row.duracion_seg * 1000;
}

/** Truncado al segundo, como las horas de la ficha: así t₁ − t₀ a la vista da exactamente esto. */
function minutesSeconds(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatTime(value: Date): string {
  return limaIso(value).slice(11, 19);
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Desviación estándar muestral (n − 1), la que reportan SPSS y R. */
function stdDev(values: number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  const squares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}
