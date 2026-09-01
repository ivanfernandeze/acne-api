/**
 * Regulatory disclaimer. Covers: RNF-06 — must appear verbatim on every report the system emits.
 */
export const CLINICAL_DISCLAIMER =
  'Herramienta de apoyo diagnóstico con fines de investigación académica. No sustituye el juicio ' +
  'clínico del profesional médico. Prototipo académico UNT — no certificado como dispositivo ' +
  'médico. Diagnóstico preliminar sujeto a validación por el especialista.';

/** Institutional header shown on every generated PDF. */
export const THESIS_METADATA = {
  title:
    'Agilización del proceso de diagnóstico de acné mediante inteligencia artificial en un centro ' +
    'especializado en dermatología',
  university: 'Universidad Nacional de Trujillo',
  faculty: 'Facultad de Ingeniería',
  school: 'Escuela Académico Profesional de Ingeniería de Sistemas',
  authors: ['Díaz Sifuentes, Sergio Helí', 'Fernández Esquerre, Iván Jeremí'],
  advisor: 'Ing. Mendoza Rivera, Ricardo Darío',
  researchLine: 'Gestión de Desarrollo de Software',
  year: 2026,
} as const;

/** APA 7 references cited by the generated reports (section 13 of the specification). */
export const APA_REFERENCES: readonly string[] = [
  'Callens, J. (2025). Clinical perception of dermatological decision support systems.',
  'Chen, X. (2024). Human-AI collaboration in medical image reading: a meta-analysis.',
  'Choy, G. (2023). Artificial intelligence applied to diagnosis.',
  'Durango, A. (2023). CRISP-DM aplicado a proyectos de ciencia de datos.',
  'González, M. (2026). Percepción de la inteligencia artificial en salud.',
  'Hernández, R. (2023). Metodología de la investigación.',
  'Huang, Y. (2025). Generative AI in medical documentation.',
  'Khan, S. (2025). Artificial intelligence in low- and middle-income countries.',
  'Riaño, C. (2022). Redes neuronales convolucionales en detección dermatológica.',
  'Sánchez, P. (2024). Teledermatología: concordancia y resolución sin derivación.',
  'Tipán, D. (2026). Teledermatología en Ecuador.',
  'Traini, G. (2025). Acne vulgaris: grading systems and clinical assessment.',
  'Vasam, M. (2023). Global Acne Grading System: fundamentals.',
  'Venkatesh, K. (2024). Defining artificial intelligence for clinical diagnosis.',
  'Watanabe, K. (2025). EfficientNet-B2 for IGA-based acne severity classification.',
];
