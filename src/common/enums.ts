/** Documentos con fecha de vencimiento que la app controla. */
export const DocumentKind = {
  REVISION_TECNICA: 'REVISION_TECNICA',
  SOAP: 'SOAP',
  PERMISO_CIRCULACION: 'PERMISO_CIRCULACION',
  OTRO: 'OTRO',
} as const;

export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

/** Tipos con vencimiento, en el orden en que se muestran. */
export const EXPIRABLE_KINDS: DocumentKind[] = [
  DocumentKind.REVISION_TECNICA,
  DocumentKind.SOAP,
  DocumentKind.PERMISO_CIRCULACION,
];

export const ReminderChannel = {
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
} as const;

export type ReminderChannel = (typeof ReminderChannel)[keyof typeof ReminderChannel];
