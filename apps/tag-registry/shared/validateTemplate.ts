import { ERROR_CODES, MAX_IDENTIFIER_LENGTH } from './constants.js';
import type { Template, ValidationResult, ValidationMessage } from './types.js';

const VALID_FIELD_TYPES = ['Numeric', 'String', 'Boolean', 'TagType'];

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
    const dataTypeField = template.fields?.data_type;
    if (!dataTypeField || typeof dataTypeField !== 'object' || !('field_type' in dataTypeField)) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: 'Tag templates must have a "data_type" field',
        ref: { template_name: template.template_name, field: 'data_type' },
      });
    } else if (dataTypeField.field_type !== 'TagType') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: `Field "data_type" must have field_type "TagType", got "${dataTypeField.field_type}"`,
        ref: { template_name: template.template_name, field: 'data_type' },
      });
    }

    const isSetpointField = template.fields?.is_setpoint;
    if (!isSetpointField || typeof isSetpointField !== 'object' || !('field_type' in isSetpointField)) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: 'Tag templates must have an "is_setpoint" field',
        ref: { template_name: template.template_name, field: 'is_setpoint' },
      });
    } else if (isSetpointField.field_type !== 'Boolean') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: `Field "is_setpoint" must have field_type "Boolean", got "${isSetpointField.field_type}"`,
        ref: { template_name: template.template_name, field: 'is_setpoint' },
      });
    }

    const trendsField = template.fields?.Trends;
    if (!trendsField || typeof trendsField !== 'object' || !('field_type' in trendsField)) {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: 'Tag templates must have a "Trends" field',
        ref: { template_name: template.template_name, field: 'Trends' },
      });
    } else if (trendsField.field_type !== 'Boolean') {
      errors.push({
        severity: 'error',
        code: ERROR_CODES.SCHEMA_VALIDATION_ERROR,
        message: `Field "Trends" must have field_type "Boolean", got "${trendsField.field_type}"`,
        ref: { template_name: template.template_name, field: 'Trends' },
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
        fieldDef.field_type === 'Numeric'  ? 'number'
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
