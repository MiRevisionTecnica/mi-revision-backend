/** Documentos con fecha de vencimiento que la app controla. */
export const DocumentKind = {
  REVISION_TECNICA: 'REVISION_TECNICA',
  /** Revisión de gases. Va aparte: tiene su propia fecha en el certificado. */
  GASES: 'GASES',
  SOAP: 'SOAP',
  PERMISO_CIRCULACION: 'PERMISO_CIRCULACION',
  /**
   * Licencia de conducir.
   *
   * Es de la persona, no del vehículo: se guarda en la cuenta. Colgarla del auto
   * daría avisos duplicados cuando alguien tenga más de uno, y la perdería al
   * venderlo.
   */
  LICENCIA_CONDUCIR: 'LICENCIA_CONDUCIR',
  OTRO: 'OTRO',
} as const;

export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

/** Tipos con vencimiento que pertenecen al vehículo, en el orden en que se muestran. */
export const EXPIRABLE_KINDS: DocumentKind[] = [
  DocumentKind.REVISION_TECNICA,
  DocumentKind.GASES,
  DocumentKind.SOAP,
  DocumentKind.PERMISO_CIRCULACION,
];

/** Tipos con vencimiento que pertenecen a la persona. */
export const PERSONAL_EXPIRABLE_KINDS: DocumentKind[] = [DocumentKind.LICENCIA_CONDUCIR];

export const ReminderChannel = {
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
} as const;

export type ReminderChannel = (typeof ReminderChannel)[keyof typeof ReminderChannel];
