import { useLiveValue } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveFormat, resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, VALUE_CLASS, VALUE_BAD_CLASS, UNIT_CLASS } from './shared/widgetStyles.js';
import { withErrorBoundary } from './shared/withErrorBoundary.js';

export interface NumericMonProps {
  assetPath: string;
  label?: string;
}

function NumericMonInner({ assetPath, label }: NumericMonProps) {
  const tag = useSingleTag(assetPath, 'NumericMon');
  const lv = useLiveValue(tag.tag_id);
  const fmt = resolveFormat(tag);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;

  return (
    <div className={ROW_CONTAINER}>
      <span className={LABEL_CLASS}>{displayLabel}</span>
      {badQuality ? (
        <span className={VALUE_BAD_CLASS}>---</span>
      ) : (
        <span className={VALUE_CLASS}>{fmt(lv.value as number)}</span>
      )}
      <span className={UNIT_CLASS}>{tag.unit ?? '-'}</span>
    </div>
  );
}

export const NumericMon = withErrorBoundary(NumericMonInner);
