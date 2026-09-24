import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { IGA_LABELS, SEX_LABELS, isIgaClass } from 'src/common/domain';
import { APP_CONFIG, type AppConfig } from 'src/config/configuration';
import { Patient } from 'src/patients/patient.entity';
import { escapeHtml } from 'src/reports/report-layout';
import { SignaturesService } from 'src/signatures/signatures.service';

import { Prescription } from './prescription.entity';

/**
 * The prescription as a document — what the patient takes to the pharmacy.
 *
 * Until 21/09/2026 the prescription existed only as rows and as a WhatsApp text; the «descarga»
 * channel recorded a download that produced nothing. This renders an A4 PDF with what a Peruvian
 * prescription carries: the clinic's letterhead (`CLINIC_*`), the patient, the prescriber with
 * their specialty, the diagnosis of the case (definitive text, ICD-10 and IGA grade), the
 * medications with dose, frequency, duration, quantity and per-item indication, the general
 * instructions, the observations addressed to the patient, the physician's signature image
 * (`usuarios.firma_ruta`) and the SHA-256 fingerprint that lets the clinic check a printed copy
 * against the record. The fingerprint is not a legally recognised electronic signature and the
 * footer says so.
 *
 * Rendered on demand with Playwright's Chromium (already a dependency of the reports); nothing is
 * cached because the fingerprint pins the content and a prescription is generated a handful of
 * times.
 */
@Injectable()
export class PrescriptionPdfService {
  private readonly logger = new Logger(PrescriptionPdfService.name);

  constructor(
    @InjectRepository(Prescription)
    private readonly repository: Repository<Prescription>,
    private readonly dataSource: DataSource,
    private readonly encryption: EncryptionService,
    private readonly signatures: SignaturesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async render(prescriptionId: string): Promise<{ pdf: Buffer; filename: string }> {
    const html = await this.buildHtml(prescriptionId);
    const prescription = await this.repository.findOne({
      where: { id: prescriptionId },
    });
    const filename = `${prescription?.prescriptionCode ?? 'receta'}.pdf`;
    return { pdf: await this.renderPdf(html), filename };
  }

  async buildHtml(prescriptionId: string): Promise<string> {
    const prescription = await this.repository.findOne({
      where: { id: prescriptionId },
      relations: { items: true, case: true, physician: true, diagnosis: true },
    });
    if (prescription === null)
      throw new NotFoundException(`No existe la receta ${prescriptionId}.`);

    const patient = await this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('p')
      .addSelect(['p.encryptedFullName', 'p.encryptedDocumentId'])
      .where('p.id = :id', { id: prescription.patientId })
      .getOne();

    const icd10Name =
      prescription.diagnosis?.icd10Code == null
        ? null
        : ((
            await this.dataSource.query<Array<{ nombre: string }>>(
              `SELECT "nombre" FROM "cie10" WHERE "codigo" = $1 LIMIT 1`,
              [prescription.diagnosis.icd10Code],
            )
          )[0]?.nombre ?? null);

    let signatureDataUri: string | null = null;
    try {
      const bytes = await this.signatures.read(prescription.physicianId);
      signatureDataUri = `data:image/png;base64,${bytes.toString('base64')}`;
    } catch {
      signatureDataUri = null; // sin rúbrica registrada: se imprime solo el nombre
    }

    const clinic = this.config.clinic;
    const patientName = this.encryption.decryptOptional(patient?.encryptedFullName ?? null);
    const patientDocument = this.encryption.decryptOptional(patient?.encryptedDocumentId ?? null);
    const age = ageAt(patient?.birthDate ?? null, prescription.createdAt);
    const sex = patient?.sex != null && patient.sex in SEX_LABELS ? SEX_LABELS[patient.sex] : null;
    const diagnosis = prescription.diagnosis ?? null;
    const igaLabel =
      diagnosis !== null && isIgaClass(diagnosis.igaClass) ? IGA_LABELS[diagnosis.igaClass] : null;
    const items = [...(prescription.items ?? [])].sort((a, b) => a.order - b.order);
    const verification = prescription.digitalSignature?.slice(0, 12).toUpperCase() ?? null;

    const row = (label: string, value: string | null): string =>
      value === null || value.trim() === ''
        ? ''
        : `<div class="kv"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(prescription.prescriptionCode)}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; color: #1a202c; font-size: 10.5pt; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4c1d95; padding-bottom: 8px; }
  .clinic h1 { margin: 0; font-size: 15pt; color: #4c1d95; }
  .clinic p { margin: 2px 0 0; font-size: 9pt; color: #4a5568; }
  .doc { text-align: right; }
  .doc .title { font-size: 13pt; font-weight: 700; letter-spacing: .04em; }
  .doc .code { font-family: ui-monospace, Consolas, monospace; font-size: 11pt; color: #4c1d95; }
  .doc p { margin: 2px 0 0; font-size: 9pt; color: #4a5568; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: .06em; color: #4c1d95; margin: 14px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .kv { display: flex; gap: 6px; font-size: 9.5pt; }
  .kv .k { color: #718096; min-width: 92px; }
  .kv .v { color: #1a202c; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 4px; }
  th { text-align: left; background: #f3f0ff; color: #4c1d95; padding: 6px 8px; border-bottom: 1px solid #c4b5fd; font-weight: 600; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  td.n { width: 22px; color: #718096; }
  td.q { text-align: right; white-space: nowrap; }
  .ind { color: #4a5568; font-size: 9pt; margin-top: 2px; }
  .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 9.5pt; white-space: pre-wrap; }
  .sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; gap: 24px; }
  .sig { text-align: center; min-width: 220px; }
  .sig img { max-height: 64px; max-width: 220px; display: block; margin: 0 auto 4px; }
  .sig .line { border-top: 1px solid #1a202c; padding-top: 4px; font-size: 9.5pt; }
  .sig .sub { font-size: 8.5pt; color: #718096; }
  .verify { font-size: 8.5pt; color: #4a5568; }
  .verify code { font-family: ui-monospace, Consolas, monospace; font-size: 10pt; color: #1a202c; letter-spacing: .08em; }
  .foot { margin-top: 18px; font-size: 8pt; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style></head><body>
  <div class="head">
    <div class="clinic">
      <h1>${escapeHtml(clinic.name)}</h1>
      ${clinic.subtitle !== '' ? `<p>${escapeHtml(clinic.subtitle)}</p>` : ''}
      ${clinic.address !== '' ? `<p>${escapeHtml(clinic.address)}</p>` : ''}
      <p>${[
        clinic.phone !== '' ? `Tel. ${clinic.phone}` : '',
        clinic.email,
        clinic.taxId !== '' ? `RUC ${clinic.taxId}` : '',
      ]
        .filter((s) => s !== '')
        .map(escapeHtml)
        .join(' · ')}</p>
    </div>
    <div class="doc">
      <div class="title">RECETA MÉDICA</div>
      <div class="code">${escapeHtml(prescription.prescriptionCode)}</div>
      <p>Fecha de emisión: ${escapeHtml(formatDate(prescription.createdAt))}</p>
      <p>Caso ${escapeHtml(prescription.case?.caseCode ?? '')}</p>
    </div>
  </div>

  <h2>Paciente</h2>
  <div class="grid">
    ${row('Nombre', patientName)}
    ${row('Documento', patientDocument)}
    ${row('Código', patient?.patientCode ?? null)}
    ${row('Edad', age === null ? null : `${age} años`)}
    ${row('Sexo', sex)}
  </div>

  <h2>Diagnóstico</h2>
  <div class="grid">
    ${row('Diagnóstico', diagnosis?.definitiveDiagnosis ?? null)}
    ${row('CIE-10', diagnosis?.icd10Code == null ? null : `${diagnosis.icd10Code}${icd10Name === null ? '' : ` — ${icd10Name}`}`)}
    ${row('Severidad (IGA)', igaLabel)}
    ${diagnosis?.gagsScore != null ? row('GAGS', String(diagnosis.gagsScore)) : ''}
  </div>
  ${diagnosis === null ? '<p class="ind">Receta emitida sin diagnóstico enlazado.</p>' : ''}

  <h2>Prescripción</h2>
  <table>
    <thead><tr><th></th><th>Medicamento</th><th>Dosis</th><th>Frecuencia</th><th>Duración</th><th style="text-align:right">Cantidad</th></tr></thead>
    <tbody>
      ${items
        .map(
          (item, index) => `<tr>
        <td class="n">${index + 1}</td>
        <td><strong>${escapeHtml(item.name)}</strong>${item.indication !== null && item.indication.trim() !== '' ? `<div class="ind">${escapeHtml(item.indication)}</div>` : ''}</td>
        <td>${escapeHtml(item.dose)}</td><td>${escapeHtml(item.frequency)}</td><td>${escapeHtml(item.duration)}</td>
        <td class="q">${item.quantity}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>

  ${
    prescription.instructions !== null && prescription.instructions.trim() !== ''
      ? `<h2>Indicaciones generales</h2><div class="box">${escapeHtml(prescription.instructions)}</div>`
      : ''
  }
  ${
    diagnosis?.patientNotes != null && diagnosis.patientNotes.trim() !== ''
      ? `<h2>Observaciones para el paciente</h2><div class="box">${escapeHtml(diagnosis.patientNotes)}</div>`
      : ''
  }

  <div class="sign">
    <div class="verify">
      ${verification === null ? '' : `Código de verificación: <code>${escapeHtml(verification)}</code><br>`}
      Huella SHA-256 del contenido registrado${prescription.signedAt === null ? '' : `, ${escapeHtml(formatDateTime(prescription.signedAt))}`}.<br>
      Permite comprobar en el consultorio que esta copia coincide con la receta registrada.
    </div>
    <div class="sig">
      ${signatureDataUri === null ? '<div style="height:64px"></div>' : `<img src="${signatureDataUri}" alt="Firma">`}
      <div class="line"><strong>${escapeHtml(prescription.physician?.fullName ?? '')}</strong></div>
      <div class="sub">${escapeHtml(prescription.physician?.specialty ?? 'Médico/a tratante')}</div>
    </div>
  </div>

  <div class="foot">
    ${escapeHtml(clinic.name)} · Documento generado por el prototipo académico Acné UNT (Universidad Nacional de Trujillo).
    La huella y la rúbrica impresas no constituyen firma electrónica con valor legal (D.L. 1075); la receta válida es la que el
    profesional emita por los cauces del centro. Ante cualquier duda sobre el tratamiento, consulte a su médico/a.
  </div>
</body></html>`;
  }

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
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
      });
    } catch (error: unknown) {
      this.logger.error(`Fallo al generar el PDF de la receta: ${String(error)}`);
      throw new ServiceUnavailableException(
        'No se pudo generar el PDF de la receta. Si es la primera ejecución, descargue el navegador ' +
          'con "npx playwright install chromium" dentro de acne-api.',
      );
    } finally {
      if (browser !== null) await browser.close();
    }
  }
}

function ageAt(birthDate: string | Date | null, at: Date): number | null {
  if (birthDate === null) return null;
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    at.getMonth() < birth.getMonth() ||
    (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
