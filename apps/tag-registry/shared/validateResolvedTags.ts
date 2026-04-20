import { ERROR_CODES, TRENDABLE_TYPES, SCALAR_TYPES, type DataType } from './constants.js';
import type { ResolvedTag, ValidationResult, ValidationMessage } from './types.js';

/**
 * Post-resolution semantic validation for resolved tags.
 *
 * Template-level validation (`validateTemplate`) catches illegal combinations
 * when they are expressed as template defaults, but parent meta overrides can
 * change `data_type` after template validation has already passed.  This pass
 * runs over the final resolved values and enforces the same rules on what was
 * actually resolved.
 */
export function validateResolvedTags(tags: ResolvedTag[]): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  for (const tag of tags) {
    const dt = tag.data_type as DataType;

    if (tag.trends && !TRENDABLE_TYPES.has(dt)) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: `trends: true is not valid for resolved data_type "${tag.data_type}" — trendable types are: ${[...TRENDABLE_TYPES].join(', ')}`,
        ref: { tag_path: tag.tag_path },
      });
    }

    if (tag.is_setpoint && !SCALAR_TYPES.has(dt)) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: `is_setpoint: true is not valid for resolved data_type "${tag.data_type}" — array types are read-only`,
        ref: { tag_path: tag.tag_path },
      });
    }
  }

  const valid = errors.length === 0 && warnings.length === 0;
  return { valid, errors, warnings };
}
