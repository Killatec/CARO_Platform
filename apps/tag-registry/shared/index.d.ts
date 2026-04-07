/**
 * Type declarations for the apps/tag-registry/shared JavaScript package.
 * Consumed by the server TypeScript migration; shared source remains JS.
 */

import type { NewTagInput } from '@caro/db';

// ── Template shape ────────────────────────────────────────────────────────────

export interface FieldDef {
  field_type: 'Numeric' | 'String' | 'Boolean';
  default: number | string | boolean;
}

export interface ChildRef {
  template_name: string;
  asset_name: string;
  fields: Record<string, unknown>;
}

export interface Template {
  template_name: string;
  template_type: string;
  data_type?: string;
  is_setpoint?: boolean;
  fields: Record<string, FieldDef>;
  children: ChildRef[];
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid?: boolean;
  errors: string[];
  warnings: string[];
}

// ── Cascade ───────────────────────────────────────────────────────────────────

export interface CascadeResult {
  requiresConfirmation: boolean;
  diff: unknown;
  affectedParents: string[];
}

// ── Exports ───────────────────────────────────────────────────────────────────

export declare function hashTemplate(template: Template): string;
export declare function validateTemplate(template: Template): ValidationResult;
export declare function validateGraph(templates: Map<string, Template>): ValidationResult;
export declare function simulateCascade(
  templates: Map<string, Template>,
  changes: Array<{ template_name: string; template: Template }>
): CascadeResult;
export declare function applyFieldCascade(
  templateMap: Map<string, Template>,
  updatedTemplate: Template
): Map<string, Template>;
export declare function resolveRegistry(
  templateMap: Map<string, Template>,
  rootName: string
): NewTagInput[];
export declare function validateParentTypes(
  templates: Map<string, Template>,
  config: { requiredParentTypes?: string[]; uniqueParentTypes?: boolean }
): ValidationResult;

export declare const ERROR_CODES: {
  readonly TEMPLATE_NOT_FOUND: string;
  readonly TEMPLATE_NAME_CONFLICT: string;
  readonly STALE_TEMPLATE: string;
  readonly INVALID_REFERENCE: string;
  readonly CIRCULAR_REFERENCE: string;
  readonly SCHEMA_VALIDATION_ERROR: string;
  readonly INVALID_ASSET_NAME: string;
  readonly DUPLICATE_SIBLING_NAME: string;
  readonly UNKNOWN_FIELD: string;
  readonly TAG_PATH_COLLISION: string;
  readonly TAG_PATH_TOO_LONG: string;
  readonly PARENT_TYPE_MISSING: string;
  readonly DUPLICATE_PARENT_TYPE: string;
  readonly EMPTY_BRANCH: string;
  readonly TYPE_FOLDER_MISMATCH: string;
  readonly VALIDATION_ERROR: string;
};

export declare const DATA_TYPES: {
  readonly F32: string;
  readonly F64: string;
  readonly I32: string;
  readonly I32_ARRAY: string;
  readonly BOOL: string;
  readonly STRING: string;
};

export declare const DATA_TYPE_VALUES: string[];
export declare const MAX_TAG_PATH_LENGTH: number;
export declare const MAX_IDENTIFIER_LENGTH: number;
export declare const I32_MIN: number;
export declare const I32_MAX: number;
