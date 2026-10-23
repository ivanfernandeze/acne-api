import { IGA_LABELS, IGA_ORDINAL, type IgaClass } from './iga';

/**
 * How the readings of the protocol's views become one suggestion for the case.
 *
 * Averaging the three probability vectors was mathematically tidy and clinically unreadable: with
 * one view at `leve`, one at `severo` and one at `casi_sin_lesiones`, the mean lands on `moderado`
 * — a class no view saw — because IGA is ordinal and the middle collects mass from both ends. A
 * dermatologist does not average; they look at the face and decide.
 *
 * Rule, in order:
 *  1. **Majority** — if more than half of the views agree on a class, that class; the confidence
 *     and the vector are the mean over the agreeing views only.
 *  2. **Most confident view** — otherwise, the view whose ensemble was surest; its class, its
 *     confidence, its vector. The suggestion is then something a photograph actually showed.
 *
 * `decidedBy` names the views that produced the suggestion, so the portal can point at the rows
 * that count and the specialist can see what was ignored.
 */

/** `seleccion_manual`: a clinician pointed at one reading; see `lecturas_elegidas`. */
export type AnalysisRule = 'mayoria' | 'toma_mas_confiable' | 'seleccion_manual';

export const ANALYSIS_RULES: readonly AnalysisRule[] = ['mayoria', 'toma_mas_confiable', 'seleccion_manual'];

export interface AnalysisView {
  imageId: string;
  shotKey: string | null;
  igaClass: IgaClass;
  confidence: number;
  classProbs: Record<string, number>;
}

export interface AnalysisVerdict {
  igaClass: IgaClass | null;
  confidence: number | null;
  classProbs: Record<string, number> | null;
  agreement: 'unanime' | 'mayoria' | 'discrepancia' | null;
  rule: AnalysisRule | null;
  decidedBy: string[];
  /** Lowest and highest grade among the views, so the spread is never hidden. */
  range: { min: IgaClass; max: IgaClass } | null;
}

export function aggregateViews(views: AnalysisView[]): AnalysisVerdict {
  if (views.length === 0) {
    return {
      igaClass: null,
      confidence: null,
      classProbs: null,
      agreement: null,
      rule: null,
      decidedBy: [],
      range: null,
    };
  }

  const counts = new Map<IgaClass, number>();
  for (const view of views) counts.set(view.igaClass, (counts.get(view.igaClass) ?? 0) + 1);
  const [topClass, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [
    IgaClass,
    number,
  ];
  const agreement: AnalysisVerdict['agreement'] =
    topCount === views.length ? 'unanime' : topCount * 2 > views.length ? 'mayoria' : 'discrepancia';

  const sorted = [...views].sort((a, b) => IGA_ORDINAL[a.igaClass] - IGA_ORDINAL[b.igaClass]);
  const range = {
    min: (sorted[0] as AnalysisView).igaClass,
    max: (sorted[sorted.length - 1] as AnalysisView).igaClass,
  };

  const decisive =
    agreement === 'discrepancia'
      ? [[...views].sort((a, b) => b.confidence - a.confidence)[0] as AnalysisView]
      : views.filter((v) => v.igaClass === topClass);
  const rule: AnalysisRule = agreement === 'discrepancia' ? 'toma_mas_confiable' : 'mayoria';

  const classProbs: Record<string, number> = {};
  for (const view of decisive) {
    for (const [key, value] of Object.entries(view.classProbs)) {
      classProbs[key] = (classProbs[key] ?? 0) + value / decisive.length;
    }
  }
  for (const key of Object.keys(classProbs)) {
    classProbs[key] = Math.round((classProbs[key] as number) * 1e4) / 1e4;
  }
  const confidence =
    Math.round((decisive.reduce((sum, v) => sum + v.confidence, 0) / decisive.length) * 1e4) / 1e4;

  return {
    igaClass: (decisive[0] as AnalysisView).igaClass,
    confidence,
    classProbs,
    agreement,
    rule,
    decidedBy: decisive.map((v) => v.imageId),
    range,
  };
}

/** What the engine's gate said about one view (see `AcneVerdict` of the engine client). */
export type ViewVerdict = 'acne' | 'piel_sana' | 'no_acne';

/**
 * The case's verdict from its finished views.
 *
 * `no_acne` (another condition) views are left out of the suggestion. So: no finished view →
 * `null`; no gradable view → `no_acne` (incongruence, nothing to suggest); every gradable view
 * healthy → `piel_sana`; otherwise `acne`.
 */
export function caseVerdictOf(verdicts: readonly ViewVerdict[]): ViewVerdict | null {
  if (verdicts.length === 0) return null;
  const gradable = verdicts.filter((verdict) => verdict !== 'no_acne');
  if (gradable.length === 0) return 'no_acne';
  return gradable.every((verdict) => verdict === 'piel_sana') ? 'piel_sana' : 'acne';
}

/**
 * Which finished views the suggestion is built from, and which healthy ones were set aside.
 *
 * A view the gate called healthy skin answers `sin_lesiones` with the GATE's probability, not an
 * IGA classifier's confidence. Put next to graded views it competed on that number — a clear cheek
 * at «100 %» beat a severe one at 69 % and the case came out `sin_lesiones` — which compared two
 * different things. So: when any view was graded as acne, the healthy views are discarded (a clear
 * cheek beside an affected one says nothing about the grade of the lesions); only when NO view
 * shows acne do the healthy ones carry the suggestion, as `sin_lesiones`. Views declared another
 * condition never take part.
 */
export function viewsForSuggestion<V extends { verdict: ViewVerdict | null }>(
  views: readonly V[],
): { pool: V[]; healthySetAside: V[] } {
  const acne = views.filter((view) => view.verdict === 'acne' || view.verdict === null);
  const healthy = views.filter((view) => view.verdict === 'piel_sana');
  if (acne.length > 0) return { pool: acne, healthySetAside: healthy };
  return { pool: healthy, healthySetAside: [] };
}

/** One sentence for the physician: which rule produced the suggestion and from which views. */
export function describeRule(verdict: AnalysisVerdict, shotLabel: (key: string | null) => string, viewShot: (imageId: string) => string | null): string {
  if (verdict.igaClass === null || verdict.rule === null) return '';
  const views = verdict.decidedBy.map((id) => shotLabel(viewShot(id)));
  if (verdict.rule === 'mayoria') {
    const all = verdict.agreement === 'unanime' ? 'Las tres tomas' : `${views.length} de las tomas`;
    return `${all} coinciden en ${IGA_LABELS[verdict.igaClass].toLowerCase()} (${views.join(', ')}).`;
  }
  return (
    `Las tomas discrepan; se toma la lectura en la que los modelos estuvieron más seguros: ` +
    `${views.join(', ')} → ${IGA_LABELS[verdict.igaClass].toLowerCase()}.`
  );
}
