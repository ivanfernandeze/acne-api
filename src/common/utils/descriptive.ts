import { createHash } from 'node:crypto';

import type { DescriptiveStats } from 'src/common/domain';

/**
 * Descriptive statistics shared by every indicator and by the boxplots.
 *
 * Covers: RF-OE1-03, RF-OE2-03, RF-OE3-03, RF-OE4-02 and RNF-05 (the input hash makes each
 * computation reproducible by an external evaluator).
 */

/** Sample mean. Returns 0 for an empty sample, which callers guard against beforehand. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Sample standard deviation (n - 1 denominator, Bessel-corrected). */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Linear-interpolation percentile over a sorted array (the same definition NumPy and SciPy use),
 * so that the boxplots drawn by the portal match the numbers produced by the Python engine.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const first = sorted[0];
  if (sorted.length === 1 || first === undefined) return first ?? 0;

  const index = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) return first;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (index - lowerIndex);
}

export function describe(values: readonly number[]): DescriptiveStats {
  if (values.length === 0) {
    return { n: 0, mean: 0, sd: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: mean(values),
    sd: standardDeviation(values),
    min: sorted[0] ?? 0,
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q3: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Rounds to `decimals` places without accumulating float noise in reports. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * SHA-256 fingerprint of the ordered inputs of a computation.
 * Persisted alongside every indicator snapshot and hypothesis run so that a third party can prove
 * the reported number came from exactly this data (RNF-05).
 */
export function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
