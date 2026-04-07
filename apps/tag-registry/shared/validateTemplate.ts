import { DATA_TYPE_VALUES, ERROR_CODES, MAX_IDENTIFIER_LENGTH } from './constants.js';
import type { Template, ValidationResult, ValidationMessage } from './types.js';

const VALID_FIELD_TYPES = ['Numeric', 'String', 'Boolean'];

export function validateTemplate(template: Template | null | undefined): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  if (!template) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
      message: 'Template is null or undefined',
    });
    return { valid: false, errors, warnings };
  }

  if (!template.template_name) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
      message: 'template_name is required',
      ref: { template_name: template.template_name },
    });
  }

  if (!template.template_type) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
      message: 'template_type is required',
      ref: { template_name: template.template_name },
    });
  }

  if (template.template_name && template.template_name.length > MAX_IDENTIFIER_LENGTH) {
    errors.push({
      severity: 'error',
      code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
      message: `template_name exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters`,
      ref: { template_name: template.template_name, field: 'template_name' },
    });
  }

  const isTag = template.template_type === 'tag';

  if (isTag) {
    if (!template.data_type) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: 'Tag templates must have data_type',
        ref: { template_name: template.template_name },
      });
    } else if (!DATA_TYPE_VALUES.includes(template.data_type)) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: `Invalid data_type: ${template.data_type}. Must be one of: ${DATA_TYPE_VALUES.join(', ')}`,
        ref: { template_name: template.template_name, field: 'data_type' },
      });
    }

    if (typeof template.is_setpoint !== 'boolean') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: 'Tag templates must have is_setpoint (boolean)',
        ref: { template_name: template.template_name },
      });
    }

    if (template.children && template.children.length > 0) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: 'Tag templates may not have children',
        ref: { template_name: template.template_name },
      });
    }
  }

  if (template.children && Array.isArray(template.children)) {
    const seenAssetNames = new Set<string>();

    for (let i = 0; i < template.children.length; i++) {
      const child = template.children[i];

      if (!child.template_name) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
          message: `Child at index ${i} missing template_name`,
          ref: { template_name: template.template_name },
        });
      }

      if (!child.asset_name) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.INVALID_ASSET_NAME,
          message: `Child at index ${i} has empty asset_name`,
          ref: { template_name: template.template_name },
        });
      } else {
        if (child.asset_name.includes('.')) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.INVALID_ASSET_NAME,
            message: `asset_name "${child.asset_name}" contains a dot character`,
            ref: { template_name: template.template_name, asset_name: child.asset_name },
          });
        }

        if (child.asset_name.length > MAX_IDENTIFIER_LENGTH) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
            message: `asset_name "${child.asset_name}" exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters`,
            ref: { template_name: template.template_name, asset_name: child.asset_name },
          });
        }

        if (seenAssetNames.has(child.asset_name)) {
          errors.push({
            severity: 'error',
            code: ERROR_CODES.DUPLICATE_SIBLING_NAME,
            message: `Duplicate asset_name "${child.asset_name}" among siblings`,
            ref: { template_name: template.template_name, asset_name: child.asset_name },
          });
        }
        seenAssetNames.add(child.asset_name);
      }
    }
  }

  if (template.fields && typeof template.fields === 'object') {
    for (const [fieldName, fieldDef] of Object.entries(template.fields)) {
      if (fieldDef === null || typeof fieldDef !== 'object' || !('field_type' in fieldDef) || !('default' in fieldDef)) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
          message: `Field "${fieldName}" must be an object with field_type and default`,
          ref: { template_name: template.template_name, field: fieldName },
        });
        continue;
      }

      if (!VALID_FIELD_TYPES.includes(fieldDef.field_type)) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
          message: `Field "${fieldName}" has invalid field_type "${fieldDef.field_type}". Must be one of: ${VALID_FIELD_TYPES.join(', ')}`,
          ref: { template_name: template.template_name, field: fieldName },
        });
        continue;
      }

      const expectedType =
        fieldDef.field_type === 'Numeric' ? 'number'
        : fieldDef.field_type === 'Boolean' ? 'boolean'
        : 'string';

      if (typeof fieldDef.default !== expectedType) {
        errors.push({
          severity: 'error',
          code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
          message: `Field "${fieldName}" default value type mismatch: expected ${expectedType}, got ${typeof fieldDef.default}`,
          ref: { template_name: template.template_name, field: fieldName },
        });
      }
    }
  }

  const valid = errors.length === 0 && warnings.length === 0;
  return { valid, errors, warnings };
}
