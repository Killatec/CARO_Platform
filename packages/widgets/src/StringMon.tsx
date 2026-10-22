import { useLiveValue } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, VALUE_TEXT_CLASS, VALUE_TEXT_BAD_CLASS } from './shared/widgetStyles.js';
import { withErrorBoundary } from './shared/withErrorBoundary.js';

export interface StringMonProps {
  assetPath: string;
  label?: string;
}

function StringMonInner({ assetPath, label }: StringMonProps) {
  const tag = useSingleTag(assetPath, 'StringMon');
  const lv = useLiveValue(tag.tag_id);
  const displayLabel = resolveLabel(assetPath, label);

  if (lv.value === null) {
    return (
      <div className={ROW_CONTAINER}>
        <span className={LABEL_CLASS}>{displayLabel}</span>
        <span className={VALUE_TEXT_BAD_CLASS}>---</span>
      </div>
    );
  }

  // Shown as received: a module still publishing a number or boolean for this tag is displayed, not hidden.
  const text = String(lv.value);
  return (
    <div className={ROW_CONTAINER}>
      <span className={LABEL_CLASS}>{displayLabel}</span>
      <span className={VALUE_TEXT_CLASS} title={text}>{text}</span>
    </div>
  );
}

export const StringMon = withErrorBoundary(StringMonInner);
