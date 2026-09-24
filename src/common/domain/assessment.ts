/**
 * The reasoned clinical reading that accompanies a grade.
 *
 * Mirror of `acne-ai-engine/app/models/base.py::ClinicalAssessment`. Any change must be made in both
 * places and noted in the CHANGELOG of each repository, exactly as with the IGA scale.
 *
 * WHY IT EXISTS: a class plus a probability vector tells the physician *what* the model concluded
 * and nothing about *why*. A suggestion that cannot be inspected can only be trusted or ignored,
 * and neither is clinical judgement. This is the model's account of its own reading, so the
 * specialist can agree or disagree with the reasoning rather than with a label.
 *
 * WHAT IT IS NOT: a diagnosis. The record's diagnosis is the one the specialist signs in
 * `diagnoses`, and OE2 measures that against `cases.ground_truth_iga`. Nothing here enters an
 * indicator or a hypothesis contrast.
 */
export interface ClinicalAssessment {
  /** The reading in prose, as a dermatologist would dictate it. */
  summary: string;
  /** Elementary lesions seen: comedones, pápulas, pústulas, nódulos, cicatrices… */
  lesionTypes: string[];
  /** Facial zones involved — the same regions GAGS scores. */
  affectedZones: string[];
  /** Why that IGA class and not the neighbouring one. The ordinal scale lives or dies here. */
  severityRationale: string;
  /** What else could look like this: rosácea, foliculitis, dermatitis perioral… */
  differentials: string[];
  /** Management points for the specialist to weigh. Never a prescription and never a dose. */
  considerations: string[];
  /** What the history changes: pregnancy, current medication, allergies, prior failed treatment. */
  anamnesisFlags: string[];
}
