import { IGA_CLASSES, type IgaClass } from 'src/common/domain';
import { round } from 'src/common/utils/descriptive';

import type { ClassificationReportDto, PerClassMetricsDto } from './dto/indicator.dto';

/**
 * Multi-class classification metrics over the five IGA classes.
 *
 * Covers: RF-OE2-04 — exactitud, sensibilidad, especificidad, F1 por clase, F1 macro y matriz de
 * confusión. AUC-ROC is not computed here because it needs the probability vector, which only
 * exists for AI predictions; `/model/eval` in the engine reports it over the frozen test set.
 */
export interface ClassifiedPair {
  reference: IgaClass;
  predicted: IgaClass;
}

export function buildClassificationReport(
  pairs: readonly ClassifiedPair[],
  studyMode: ClassificationReportDto['studyMode'],
  standard: ClassificationReportDto['standard'],
): ClassificationReportDto {
  const size = IGA_CLASSES.length;
  const indexOf = new Map<IgaClass, number>(IGA_CLASSES.map((c, i) => [c, i]));

  // Row = reference, column = predicted.
  const matrix: number[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));

  for (const pair of pairs) {
    const row = indexOf.get(pair.reference);
    const column = indexOf.get(pair.predicted);
    if (row === undefined || column === undefined) continue;
    const matrixRow = matrix[row];
    if (matrixRow === undefined) continue;
    matrixRow[column] = (matrixRow[column] ?? 0) + 1;
  }

  const total = pairs.length;
  let correct = 0;
  for (let i = 0; i < size; i++) correct += matrix[i]?.[i] ?? 0;

  const perClass: PerClassMetricsDto[] = IGA_CLASSES.map((igaClass, i) => {
    const truePositive = matrix[i]?.[i] ?? 0;

    let falseNegative = 0;
    for (let j = 0; j < size; j++) if (j !== i) falseNegative += matrix[i]?.[j] ?? 0;

    let falsePositive = 0;
    for (let j = 0; j < size; j++) if (j !== i) falsePositive += matrix[j]?.[i] ?? 0;

    const trueNegative = total - truePositive - falseNegative - falsePositive;

    const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
    const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
    const specificity =
      trueNegative + falsePositive === 0 ? 0 : trueNegative / (trueNegative + falsePositive);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    return {
      igaClass,
      support: truePositive + falseNegative,
      precision: round(precision, 4),
      recall: round(recall, 4),
      specificity: round(specificity, 4),
      f1: round(f1, 4),
    };
  });

  // Macro F1 averages over the classes that actually occur, so an absent class does not drag the
  // score to zero on the small samples this study works with.
  const present = perClass.filter((metrics) => metrics.support > 0);
  const f1Macro =
    present.length === 0 ? 0 : present.reduce((acc, m) => acc + m.f1, 0) / present.length;

  return {
    studyMode,
    accuracyPct: total === 0 ? 0 : round((correct / total) * 100, 2),
    correct,
    total,
    f1Macro: round(f1Macro, 4),
    aucRocMacro: null,
    confusionMatrix: matrix,
    perClass,
    standard,
  };
}
