import { AnamnesisAnswerOption } from 'src/anamnesis/anamnesis-answer-option.entity';
import { AnamnesisAnswerRow } from 'src/anamnesis/anamnesis-answer.entity';
import { CaseAnamnesis } from 'src/anamnesis/case-anamnesis.entity';
import { AuditLog } from 'src/audit/audit-log.entity';
import { CaptureSession } from 'src/capture/capture-session.entity';
import { ClinicalCase } from 'src/cases/case.entity';
import { Diagnosis } from 'src/diagnoses/diagnosis.entity';
import { CaseImage } from 'src/images/case-image.entity';
import { IndicatorObservation } from 'src/indicators/indicator-observation.entity';
import { IndicatorSnapshot } from 'src/indicators/indicator-snapshot.entity';
import { AiInference } from 'src/inference/ai-inference.entity';
import { AssessmentDetail } from 'src/inference/assessment-detail.entity';
import { InferenceAssessment } from 'src/inference/inference-assessment.entity';
import { InferenceJob } from 'src/inference/inference-job.entity';
import { ChosenReading } from 'src/inference/chosen-reading.entity';
import { InferenceMember } from 'src/inference/inference-member.entity';
import { InferenceProbability } from 'src/inference/inference-probability.entity';
import { Consent } from 'src/patients/consent.entity';
import { Patient } from 'src/patients/patient.entity';
import { MedicationIndication } from 'src/prescriptions/medication-indication.entity';
import { Medication } from 'src/prescriptions/medication.entity';
import { PrescriptionDelivery } from 'src/prescriptions/prescription-delivery.entity';
import { PrescriptionItem } from 'src/prescriptions/prescription-item.entity';
import { Prescription } from 'src/prescriptions/prescription.entity';
import { AnamnesisQuestionRow } from 'src/questions/question.entity';
import { WorkSession } from 'src/sessions/work-session.entity';
import { HypothesisPair } from 'src/stats/hypothesis-pair.entity';
import { HypothesisRun } from 'src/stats/hypothesis-run.entity';
import { ReviewTiming } from 'src/study/review-timing.entity';
import { SurveyAnswer } from 'src/surveys/survey-answer.entity';
import { SurveyResponse } from 'src/surveys/survey-response.entity';
import { User } from 'src/users/user.entity';

/**
 * Single registry of persisted entities, shared by the Nest module and the TypeORM CLI.
 *
 * Only the transactional tables are mapped. The catalogues (`roles`, `clases_iga`,
 * `modos_estudio`, `preguntas_anamnesis`…) are created and populated by the migration and enforced
 * by foreign keys; the application validates against the TypeScript catalogues in
 * `common/domain/`, and `CatalogConsistencyService` fails startup if the two ever disagree. Mapping
 * them as entities as well would add a third copy without adding a guarantee.
 */
export const ENTITIES = [
  // Fuertes
  User,
  Patient,
  WorkSession,
  ClinicalCase,
  // Débiles del ingreso clínico
  Consent,
  CaseImage,
  CaptureSession,
  CaseAnamnesis,
  AnamnesisAnswerRow,
  AnamnesisAnswerOption,
  // Débiles de la inferencia
  InferenceJob,
  AiInference,
  InferenceProbability,
  InferenceMember,
  ChosenReading,
  InferenceAssessment,
  AssessmentDetail,
  // Débiles de la medición
  Diagnosis,
  ReviewTiming,
  SurveyResponse,
  SurveyAnswer,
  // Bitácoras inmutables
  IndicatorSnapshot,
  IndicatorObservation,
  HypothesisRun,
  HypothesisPair,
  AuditLog,
  // Proceso clínico: la receta que cierra la consulta. No alimenta ningún indicador.
  Medication,
  MedicationIndication,
  Prescription,
  PrescriptionItem,
  PrescriptionDelivery,
  AnamnesisQuestionRow,
];
