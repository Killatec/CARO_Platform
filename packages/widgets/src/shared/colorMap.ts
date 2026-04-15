export type ColorKey = 'green' | 'red' | 'amber' | 'blue' | 'gray';

export const BOOLEAN_COLORS: Record<ColorKey, { hex: string; tw: string }> = {
  green: { hex: '#22c55e', tw: 'bg-green-500' },
  red:   { hex: '#ef4444', tw: 'bg-red-500'   },
  amber: { hex: '#f59e0b', tw: 'bg-amber-500' },
  blue:  { hex: '#3b82f6', tw: 'bg-blue-500'  },
  gray:  { hex: '#d1d5db', tw: 'bg-gray-400'  },
};

/** Returns the hex track color for a color key, defaulting to gray. */
export function getTrackHex(colorKey: string): string {
  return (BOOLEAN_COLORS as Record<string, { hex: string; tw: string }>)[colorKey]?.hex ?? '#d1d5db';
}

/** Returns the Tailwind dot class for a color key, defaulting to bg-gray-400. */
export function getDotClass(colorKey: string): string {
  return (BOOLEAN_COLORS as Record<string, { hex: string; tw: string }>)[colorKey]?.tw ?? 'bg-gray-400';
}
