import { AuditLog } from 'src/audit/audit-log.entity';
import { ClinicalCase } from 'src/cases/case.entity';
import { Diagnosis } from 'src/diagnoses/diagnosis.entity';
import { CaseImage } from 'src/images/case-image.entity';
import { IndicatorSnapshot } from 'src/indicators/indicator-snapshot.entity';
import { AiInference } from 'src/inference/ai-inference.entity';
import { InferenceJob } from 'src/inference/inference-job.entity';
import { Consent } from 'src/patients/consent.entity';
import { Patient } from 'src/patients/patient.entity';
import { WorkSession } from 'src/sessions/work-session.entity';
import { HypothesisRun } from 'src/stats/hypothesis-run.entity';
import { ReviewTiming } from 'src/study/review-timing.entity';
import { SurveyAnswer } from 'src/surveys/survey-answer.entity';
import { SurveyResponse } from 'src/surveys/survey-response.entity';
import { User } from 'src/users/user.entity';

/** Single registry of persisted entities, shared by the Nest module and the TypeORM CLI. */
export const ENTITIES = [
  User,
  Patient,
  Consent,
  WorkSession,
  ClinicalCase,
  CaseImage,
  AiInference,
  InferenceJob,
  Diagnosis,
  ReviewTiming,
  SurveyResponse,
  SurveyAnswer,
  IndicatorSnapshot,
  HypothesisRun,
  AuditLog,
];
