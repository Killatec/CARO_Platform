import { ERROR_CODES, TRENDABLE_TYPES, SCALAR_TYPES, MAX_TAG_NAME_LENGTH, IN_TAG_NAME_FIELD, type DataType } from './constants.js';
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

    if (tag.tag_name.length > MAX_TAG_NAME_LENGTH) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.TAG_NAME_TOO_LONG,
        message: `tag_name for "${tag.tag_path}" is ${tag.tag_name.length} characters — exceeds MAX_TAG_NAME_LENGTH (${MAX_TAG_NAME_LENGTH})`,
        ref: { tag_path: tag.tag_path },
      });
    }

    if (tag.tag_name === '') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.TAG_NAME_EMPTY,
        message: `tag_name for "${tag.tag_path}" is empty — no level in the path has ${IN_TAG_NAME_FIELD} set to true`,
        ref: { tag_path: tag.tag_path },
      });
    }
  }

  // Duplicate tag_name check — case-insensitive, entire-registry scope.
  // Empty names are already reported as TAG_NAME_EMPTY; skip them here.
  const nameGroups = new Map<string, ResolvedTag[]>();
  for (const tag of tags) {
    if (tag.tag_name === '') continue;
    const key = tag.tag_name.toLowerCase();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(tag);
  }
  for (const [, group] of nameGroups) {
    if (group.length < 2) continue;
    const conflictPaths = group.map(t => t.tag_path).join(', ');
    for (const tag of group) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.DUPLICATE_TAG_NAME,
        message: `tag_name "${tag.tag_name}" is not unique — resolved by: ${conflictPaths}`,
        ref: { tag_path: tag.tag_path },
      });
    }
  }

  const valid = errors.length === 0 && warnings.length === 0;
  return { valid, errors, warnings };
}
