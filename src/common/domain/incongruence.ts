import { reportsActiveAcne, type AnamnesisAnswer } from './anamnesis';
import { IGA_LABELS, type IgaClass } from './iga';

/** Grades under which the model is saying, in effect, "I see no disease here". */
const CLEAN_SKIN_CLASSES: ReadonlySet<IgaClass> = new Set<IgaClass>([
  'sin_lesiones',
  'casi_sin_lesiones',
]);

/**
 * Messages to show next to the AI suggestion when the questionnaire and the photograph disagree.
 *
 * Fires when the model grades the image as clean or almost clean while the history describes
 * active lesions (`reportsActiveAcne`). The two usual explanations are both worth catching before
 * a diagnosis is signed: the photograph is not of the affected area (or not of this patient), or
 * the questionnaire was answered about an earlier episode. It is derived on read, never stored,
 * and it is advice for the professional, not a verdict (RNF-06).
 *
 * Returns an empty list when there is nothing to say — no grade yet, a grade with lesions, or a
 * questionnaire that does not claim active disease. Whoever renders it must keep it inside the
 * `aiVisible` branch: it is a statement about what the model saw.
 */
export function anamnesisImageMismatch(
  igaClass: IgaClass | null,
  answers: Readonly<Record<string, AnamnesisAnswer>>,
): string[] {
  if (igaClass === null || !CLEAN_SKIN_CLASSES.has(igaClass)) return [];
  const report = reportsActiveAcne(answers);
  if (!report.active) return [];

  return [
    `El modelo clasificó la imagen como "${IGA_LABELS[igaClass]}", pero la anamnesis ` +
      `${report.evidence.join('; ')}.`,
    'Revise si la fotografía corresponde al paciente y a la zona afectada, o si el cuestionario ' +
      'describe un episodio anterior ya resuelto.',
  ];
}
