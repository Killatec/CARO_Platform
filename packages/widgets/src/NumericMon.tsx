import { useLiveValue } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveDecimalPlaces, resolveLabel } from './shared/utils.js';
import { WidgetLabel } from './shared/WidgetLabel.js';

export interface NumericMonProps {
  assetPath: string;
  label?: string;
}

export function NumericMon({ assetPath, label }: NumericMonProps) {
  const tag = useSingleTag(assetPath, 'NumericMon');
  const lv = useLiveValue(tag.tag_id);
  const decimals = resolveDecimalPlaces(tag);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;

  return (
    <div className="inline-flex flex-col p-2 rounded border border-gray-200 bg-white min-w-[80px]">
      <WidgetLabel label={displayLabel} unit={tag.unit} />
      {badQuality ? (
        <div className="px-2 py-1 rounded bg-red-500/10 border border-red-400 text-red-600 font-mono text-sm">
          ---
        </div>
      ) : (
        <div className="font-mono text-sm text-gray-900">
          {(lv.value as number).toFixed(decimals)}
          {tag.unit && (
            <span className="text-gray-500 text-xs ml-1">{tag.unit}</span>
          )}
        </div>
      )}
    </div>
  );
}
