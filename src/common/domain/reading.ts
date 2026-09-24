import { reportsActiveAcne, type AnamnesisAnswer } from './anamnesis';
import type { ClinicalAssessment } from './assessment';
import { IGA_LABELS, IGA_ORDINAL, type IgaClass } from './iga';

/**
 * A structured clinical reading of the case, written from what the system actually knows.
 *
 * The CNN ensemble emits five probabilities per photograph and nothing else — no lesion count, no
 * lesion type, no prose. What the case DOES carry with certainty is: which view got which grade,
 * how much the models and the views agreed, what each IGA grade means clinically, and what the
 * patient answered. This module turns exactly that into the same shape the LLM backend used
 * (`ClinicalAssessment`), so the portal renders it with the same component, and it never claims a
 * finding the pixels were not asked about: "zonas comprometidas" are named by the view that was
 * graded, not by a localisation the model did not perform.
 *
 * Every sentence is advice for the specialist, not a decision (RNF-06); the considerations quote
 * what management guidelines ask to weigh and never a drug or a dose.
 */

export interface ReadingMember {
  tag: string;
  igaClass: IgaClass | null;
  confidence: number | null;
}

export interface ReadingView {
  imageId?: string;
  shotKey: string | null;
  igaClass: IgaClass | null;
  confidence: number | null;
  members: ReadingMember[];
}

export interface ReadingInput {
  igaClass: IgaClass | null;
  confidence: number | null;
  agreement: 'unanime' | 'mayoria' | 'discrepancia' | null;
  views: ReadingView[];
  answers: Readonly<Record<string, AnamnesisAnswer>>;
  ageYears: number | null;
  sex: string | null;
  rule?: 'mayoria' | 'toma_mas_confiable' | 'seleccion_manual' | null;
  ruleDescription?: string;
  decidedBy?: string[];
  range?: { min: IgaClass; max: IgaClass } | null;
}

/** IGA (Investigator's Global Assessment, FDA 2018) — what each grade looks like on the face. */
export const IGA_CLINICAL_DESCRIPTIONS: Readonly<Record<IgaClass, string>> = {
  sin_lesiones: 'piel limpia, sin lesiones inflamatorias ni no inflamatorias (IGA 0).',
  casi_sin_lesiones:
    'lesiones no inflamatorias aisladas (comedones) y, como mucho, una lesión inflamatoria pequeña (IGA 1).',
  leve: 'algunas lesiones no inflamatorias con unas pocas pápulas o pústulas; sin nódulos (IGA 2).',
  moderado:
    'numerosas lesiones no inflamatorias e inflamatorias (pápulas y pústulas); como mucho un nódulo pequeño (IGA 3).',
  severo:
    'abundantes lesiones inflamatorias y no inflamatorias, con posibles nódulos o quistes (IGA 4).',
};

const VIEW_ZONE: Readonly<Record<string, string>> = {
  general: 'rostro de frente (frente, nariz, mentón y ambas mejillas)',
  perfil_derecho: 'mejilla y región malar derecha',
  perfil_izquierdo: 'mejilla y región malar izquierda',
  acercamiento: 'zona del acercamiento',
  borde: 'límite entre la zona afectada y la piel sana',
  pecho: 'pecho',
  espalda: 'espalda',
  otra: 'otra zona indicada',
};

const VIEW_LABEL: Readonly<Record<string, string>> = {
  general: 'la vista general',
  perfil_derecho: 'el perfil derecho',
  perfil_izquierdo: 'el perfil izquierdo',
  acercamiento: 'el acercamiento',
  borde: 'la toma del borde',
  pecho: 'la toma del pecho',
  espalda: 'la toma de la espalda',
  otra: 'la otra toma',
};

const CONSIDERATIONS: Readonly<Record<IgaClass, string[]>> = {
  sin_lesiones: [
    'Sin lesiones activas: si el paciente está en tratamiento, valorar la fase de mantenimiento y la prevención de recaídas.',
    'Si la anamnesis refiere lesiones, comprobar que la fotografía corresponda al episodio actual.',
  ],
  casi_sin_lesiones: [
    'Cuadro mínimo: las guías contemplan manejo tópico y medidas de cuidado de la piel; valorar si hay lesiones fuera del encuadre.',
    'Revisar los perfiles y el tronco antes de descartar mayor extensión.',
  ],
  leve: [
    'Acné leve: las guías contemplan tratamiento tópico (retinoide y/o antimicrobiano tópico) como primera línea.',
    'Vigilar la tendencia a cicatrizar y la carga psicológica, que pueden justificar un manejo más intensivo aunque el grado sea leve.',
  ],
  moderado: [
    'Acné moderado: las guías contemplan tratamiento tópico combinado y, según extensión y respuesta, terapia sistémica.',
    'Valorar el compromiso del tronco (pecho/espalda) y las lesiones inflamatorias profundas, que orientan hacia tratamiento sistémico.',
    'Documentar la extensión por zona para poder medir la respuesta en la siguiente visita.',
  ],
  severo: [
    'Acné severo: las guías contemplan tratamiento sistémico; valorar derivación o manejo por especialista con experiencia en retinoides orales.',
    'Antes de un retinoide oral en mujeres en edad fértil: descartar embarazo y planificar anticoncepción (teratogenia).',
    'Valorar riesgo de cicatrización permanente: la demora en tratar el acné nodular deja secuelas.',
  ],
};

export function buildCaseReading(input: ReadingInput): ClinicalAssessment {
  const { igaClass } = input;
  if (igaClass === null) {
    return {
      summary: 'El análisis todavía no tiene una toma completada; no hay lectura del caso.',
      lesionTypes: [],
      affectedZones: [],
      severityRationale: '',
      differentials: [],
      considerations: [],
      anamnesisFlags: [],
    };
  }

  const done = input.views.filter((v) => v.igaClass !== null);
  const label = IGA_LABELS[igaClass];
  const confidence = input.confidence ?? 0;

  // --- summary ---------------------------------------------------------------------------------
  const perView = done
    .map((v) => `${VIEW_LABEL[v.shotKey ?? ''] ?? 'una toma'} como ${IGA_LABELS[v.igaClass as IgaClass].toLowerCase()}`)
    .join(', ');
  const agreementText =
    input.agreement === 'unanime'
      ? 'Las tomas coinciden en el grado.'
      : input.agreement === 'mayoria'
        ? 'La mayoría de las tomas coincide en el grado.'
        : 'Las tomas discrepan entre sí, lo que resta fiabilidad a la sugerencia.';
  const confidenceText =
    confidence >= 0.7
      ? 'con confianza alta'
      : confidence >= 0.45
        ? 'con confianza media'
        : 'con confianza baja';
  const summary =
    `Sugerencia para el caso: ${label} — ${IGA_CLINICAL_DESCRIPTIONS[igaClass]} ` +
    `Obtenida ${confidenceText} (${Math.round(confidence * 100)} %) a partir de ${done.length} toma(s): ` +
    `${perView}. ${agreementText}`;

  // --- affected zones (by view) -----------------------------------------------------------------
  const affectedZones = done
    .filter((v) => IGA_ORDINAL[v.igaClass as IgaClass] >= IGA_ORDINAL.leve)
    .map((v) => {
      const zone = VIEW_ZONE[v.shotKey ?? ''] ?? 'zona no identificada';
      return `${zone}: ${IGA_LABELS[v.igaClass as IgaClass].toLowerCase()} (según ${VIEW_LABEL[v.shotKey ?? ''] ?? 'la toma'})`;
    });
  const asymmetry = describeAsymmetry(done);

  // --- rationale ---------------------------------------------------------------------------------
  const rationale: string[] = [];
  const ordered = Object.keys(IGA_ORDINAL) as IgaClass[];
  const index = ordered.indexOf(igaClass);
  const lower = ordered[index - 1];
  const upper = ordered[index + 1];
  const neighbours = [lower, upper].filter((c): c is IgaClass => c !== undefined);
  const ruleText =
    input.ruleDescription !== undefined && input.ruleDescription !== ''
      ? input.ruleDescription
      : 'La clase sale de las tomas obligatorias; en cada una habla el modelo que estuvo más seguro.';
  rationale.push(
    `${ruleText} Las alternativas contiguas eran ${neighbours.map((c) => IGA_LABELS[c].toLowerCase()).join(' y ')}.`,
  );
  if (input.range && input.range.min !== input.range.max) {
    rationale.push(
      `Las tomas van de ${IGA_LABELS[input.range.min].toLowerCase()} a ${IGA_LABELS[input.range.max].toLowerCase()}.`,
    );
  }
  const dissent = done.flatMap((v) =>
    v.members
      .filter((m) => m.igaClass !== null && m.igaClass !== v.igaClass)
      .map((m) => `${m.tag} leyó ${VIEW_LABEL[v.shotKey ?? ''] ?? 'la toma'} como ${IGA_LABELS[m.igaClass as IgaClass].toLowerCase()}`),
  );
  if (dissent.length > 0) rationale.push(`Votos discordantes: ${dissent.join('; ')}.`);
  if (asymmetry !== null) rationale.push(asymmetry);
  if (confidence < 0.45) {
    rationale.push(
      'Con confianza baja conviene contrastar la sugerencia con los mapas de calor de cada toma y, si las fotografías no muestran el rostro completo y de frente con luz uniforme, repetirlas.',
    );
  }

  // --- anamnesis flags ---------------------------------------------------------------------------
  const flags = anamnesisFlags(input.answers, input.sex, input.ageYears, igaClass);

  // --- differentials (only what the history suggests; the model does not evaluate them) --------
  const differentials: string[] = [];
  if (input.ageYears !== null && input.ageYears >= 30 && input.answers['episodio_previo']?.value === 'primera vez') {
    differentials.push('Rosácea o acné del adulto de inicio tardío (primer episodio después de los 30 años).');
  }
  if (chosen(input.answers['medicacion_actual']) || chosen(input.answers['suplementos'])) {
    differentials.push('Acné inducido por fármacos o suplementos (corticoides, anabolizantes, vitamina B12, litio).');
  }
  if (input.answers['maquillaje']?.value === 'usa y no siempre lo retira') {
    differentials.push('Acné cosmético por productos comedogénicos.');
  }
  differentials.push('Foliculitis, dermatitis perioral y erupciones acneiformes: no las evalúa el modelo; descartar en la exploración.');

  // --- considerations ----------------------------------------------------------------------------
  const considerations = [...CONSIDERATIONS[igaClass]];
  const trunk = chosenList(input.answers['zona_extrafacial']).filter((v) => v !== 'ninguna');
  if (trunk.length > 0) {
    considerations.push(`Refiere lesiones en ${trunk.join(' y ')}: el compromiso del tronco pesa en la severidad y orienta al tratamiento sistémico; considere fotografiarlo.`);
  }
  if (input.agreement === 'discrepancia') {
    considerations.push('Las tomas discrepan: registre el diagnóstico sobre la exploración directa y use la sugerencia solo como orientación.');
  }

  return {
    summary,
    lesionTypes: [],
    affectedZones,
    severityRationale: rationale.join(' '),
    differentials,
    considerations,
    anamnesisFlags: flags,
  };
}

function describeAsymmetry(views: ReadingView[]): string | null {
  const right = views.find((v) => v.shotKey === 'perfil_derecho');
  const left = views.find((v) => v.shotKey === 'perfil_izquierdo');
  if (right?.igaClass == null || left?.igaClass == null) return null;
  const gap = IGA_ORDINAL[right.igaClass] - IGA_ORDINAL[left.igaClass];
  if (Math.abs(gap) < 2) return null;
  const worse = gap > 0 ? 'derecho' : 'izquierdo';
  const better = gap > 0 ? 'izquierdo' : 'derecho';
  return `Asimetría marcada: el perfil ${worse} se lee ${Math.abs(gap)} grados por encima del ${better}; compruebe que ambas tomas sean del mismo paciente y de la misma visita.`;
}

function chosen(answer: AnamnesisAnswer | undefined): boolean {
  return answer?.value === true;
}

function chosenList(answer: AnamnesisAnswer | undefined): string[] {
  if (answer === undefined || answer.value === null) return [];
  return Array.isArray(answer.value) ? answer.value.map(String) : [String(answer.value)];
}

function withDetail(text: string, answer: AnamnesisAnswer | undefined): string {
  const detail = (answer?.detail ?? '').trim();
  return detail === '' ? text : `${text}: ${detail}`;
}

function anamnesisFlags(
  answers: Readonly<Record<string, AnamnesisAnswer>>,
  sex: string | null,
  ageYears: number | null,
  igaClass: IgaClass,
): string[] {
  const flags: string[] = [];
  const pregnancy = answers['embarazo_menopausia']?.value;
  if (pregnancy === 'embarazo actual') {
    flags.push('Embarazo actual declarado: los retinoides orales y varios tópicos están contraindicados (teratogenia).');
  } else if (pregnancy === 'embarazo reciente') {
    flags.push('Embarazo reciente: comprobar lactancia antes de indicar tratamiento sistémico.');
  } else if (
    sex === 'femenino' &&
    ageYears !== null &&
    ageYears >= 18 &&
    IGA_ORDINAL[igaClass] >= IGA_ORDINAL.moderado &&
    pregnancy !== 'menopausia'
  ) {
    flags.push('Mujer en edad fértil con acné moderado-severo: descartar embarazo y planificar anticoncepción antes de un retinoide oral.');
  }
  if (chosen(answers['medicacion_actual'])) flags.push(withDetail('Medicación en curso: revisar interacciones y fármacos acneigénicos', answers['medicacion_actual']));
  if (chosen(answers['alergia_medicamentos'])) flags.push(withDetail('Alergia a medicamentos declarada', answers['alergia_medicamentos']));
  if (chosen(answers['enfermedad_cronica'])) flags.push(withDetail('Enfermedad crónica', answers['enfermedad_cronica']));
  if (chosen(answers['tratamientos_previos'])) flags.push(withDetail('Tratamientos previos para el acné', answers['tratamientos_previos']));
  const symptoms = chosenList(answers['sintomas']).filter((v) => v !== 'ninguna');
  if (symptoms.length > 0) flags.push(`Molestias referidas: ${symptoms.join(', ')}.`);
  const duration = chosenList(answers['tiempo_evolucion'])[0];
  if (duration !== undefined) flags.push(`Tiempo de evolución referido: ${duration}.`);
  if (answers['episodio_previo']?.value === 'ya las tuvo antes') flags.push(withDetail('Episodios previos', answers['episodio_previo']));
  if (answers['empeora_premenstrual']?.value === true) flags.push('Empeoramiento premenstrual: componente hormonal a valorar.');
  if (answers['antecedente_familiar']?.value === 'sí') flags.push('Antecedente familiar de acné.');
  if (chosen(answers['suplementos'])) flags.push(withDetail('Suplementos en uso', answers['suplementos']));
  if (answers['fotoproteccion']?.value === false) flags.push('No usa fotoprotección: relevante si se indican retinoides o antibióticos fotosensibilizantes.');
  if (answers['caida_cabello']?.value === true || answers['vello_inusual']?.value === true || answers['menstruacion_regular']?.value === 'no') {
    flags.push('Signos de hiperandrogenismo referidos (caída de cabello, hirsutismo o ciclos irregulares): valorar estudio hormonal.');
  }
  const { active } = reportsActiveAcne(answers);
  if (!active) flags.push('La anamnesis no describe lesiones activas; si el cuadro es evidente en la exploración, complete el cuestionario.');
  return flags;
}
