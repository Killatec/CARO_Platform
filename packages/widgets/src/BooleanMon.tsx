import { useLiveValue } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { WidgetLabel } from './shared/WidgetLabel.js';

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
  let stateText: string;
  let textClass: string;

  if (badQuality) {
    dotClass = 'w-3 h-3 rounded-full border-2 border-dashed border-red-400 bg-transparent';
    stateText = '---';
    textClass = 'text-red-500';
  } else {
    const isTrue = lv.value === true;
    const colorKey = isTrue ? trueColor : falseColor;
    dotClass = `w-3 h-3 rounded-full ${COLOR_MAP[colorKey] ?? 'bg-gray-400'}`;
    stateText = isTrue ? trueLabel : falseLabel;
    textClass = 'text-gray-800';
  }

  return (
    <div className="inline-flex flex-col p-2 rounded border border-gray-200 bg-white">
      <WidgetLabel label={displayLabel} />
      <div className="flex items-center gap-1.5">
        <span className={dotClass} data-testid="state-dot" />
        <span className={`text-sm font-medium ${textClass}`} data-testid="state-label">
          {stateText}
        </span>
      </div>
    </div>
  );
}
