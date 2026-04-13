import { useLiveValue } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, COL } from './shared/widgetStyles.js';

export interface BooleanMonProps {
  assetPath: string;
  label?: string;
  trueLabel?: string;
  falseLabel?: string;
  trueColor?: string;
  falseColor?: string;
}

const COLOR_MAP: Record<string, string> = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  gray: 'bg-gray-400',
};

export function BooleanMon({
  assetPath,
  label,
  trueLabel = 'ON',
  falseLabel = 'OFF',
  trueColor = 'green',
  falseColor = 'gray',
}: BooleanMonProps) {
  const tag = useSingleTag(assetPath, 'BooleanMon');
  const lv = useLiveValue(tag.tag_id);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;

  let dotClass: string;

  if (badQuality) {
    dotClass = 'w-3 h-3 rounded-full border-2 border-dashed border-red-400 bg-transparent';
  } else {
    const isTrue = lv.value === true;
    const colorKey = isTrue ? trueColor : falseColor;
    dotClass = `w-3 h-3 rounded-full ${COLOR_MAP[colorKey] ?? 'bg-gray-400'}`;
  }

  return (
    <div className={ROW_CONTAINER}>
      <span className={LABEL_CLASS}>{displayLabel}</span>
      <div className={`${COL.value} flex items-center justify-end pr-1`}>
        <span className={dotClass} data-testid="state-dot" />
      </div>
    </div>
  );
}
