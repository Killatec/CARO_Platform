/**
 * Type declarations for the apps/tag-registry/shared JavaScript package.
 * Consumed by the server and client TypeScript migrations; shared source remains JS.
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
  trends?: boolean;
  fields: Record<string, FieldDef>;
  children: ChildRef[];
}

export interface TemplateEntry {
  template: Template;
  hash: string | null;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationMessageRef {
  template_name?: string;
  field?: string;
  tag_path?: string;
  [key: string]: unknown;
}

export interface ValidationMessage {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  ref?: ValidationMessageRef;
}

export interface ValidationResult {
  valid?: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

// ── Cascade ───────────────────────────────────────────────────────────────────

export interface CascadeDiff {
  fields_added: Array<{ template_name: string; field: string }>;
  fields_removed: Array<{ template_name: string; field: string }>;
  fields_changed: Array<{ template_name: string; field: string; old_value: unknown; new_value: unknown }>;
  instance_fields_changed: Array<{ template_name: string; asset_name: string; field: string; old_value: unknown; new_value: unknown }>;
}

export interface AffectedParent {
  parent_template_name: string;
  asset_name: string;
  dropped_instance_values?: Array<{ field: string; value: unknown }>;
}

export interface CascadeResult {
  requiresConfirmation: boolean;
  diff: CascadeDiff;
  affectedParents: AffectedParent[];
}

// ── Exports ───────────────────────────────────────────────────────────────────

export declare function hashTemplate(template: Template): string;
export declare function validateTemplate(template: Template): ValidationResult;
export declare function validateGraph(templates: Map<string, Template>): ValidationResult;
export declare function simulateCascade(
  currentTemplateMap: Map<string, TemplateEntry>,
  proposedChanges: Array<{ template_name: string; template: Template; original_hash?: string | null }>
): CascadeResult;
export declare function applyFieldCascade(
  templateMap: Map<string, TemplateEntry>,
  changedTemplate: Template
): Map<string, TemplateEntry>;
export declare function resolveRegistry(
  templateMap: Map<string, TemplateEntry>,
  rootName: string
): NewTagInput[];
export declare function validateParentTypes(
  templateMap: Map<string, Template>,
  rootName: string,
  options?: { requiredParentTypes?: string[]; uniqueParentTypes?: boolean }
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
