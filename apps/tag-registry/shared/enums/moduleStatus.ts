export const ModuleStatus = {
  UNKNOWN: 0,
  OK:      1,
  WARNING: 2,
  FAULT:   3,
  STALLED: 4,
} as const;

export const ModuleStatusLabels: Record<number, string> = {
  0: 'UNKNOWN',
  1: 'OK',
  2: 'WARNING',
  3: 'FAULT',
  4: 'STALLED',
};

