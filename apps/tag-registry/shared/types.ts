export interface FieldDef {
  field_type: 'Numeric' | 'String' | 'Boolean' | 'TagType' | 'ModuleType';
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
  fields: Record<string, FieldDef>;
  children: ChildRef[];
}

export interface TemplateEntry {
  template: Template;
  hash: string | null;
}

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

export interface ProposedChange {
  template_name: string;
  template: Template;
  original_hash?: string | null;
}

export interface FieldDiff {
  template_name: string;
  field: string;
}

export interface FieldChanged extends FieldDiff {
  old_value: unknown;
  new_value: unknown;
}

export interface InstanceFieldChanged {
  template_name: string;
  asset_name: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export interface CascadeDiff {
  fields_added: FieldDiff[];
  fields_removed: FieldDiff[];
  fields_changed: FieldChanged[];
  instance_fields_changed: InstanceFieldChanged[];
}

export interface DroppedInstanceValue {
  field: string;
  asset_name: string;
  value: unknown;
}

export interface AffectedParent {
  parent_template_name: string;
  asset_name: string;
  dropped_instance_values: DroppedInstanceValue[];
}

export interface CascadeResult {
  requiresConfirmation: boolean;
  diff: CascadeDiff;
  affectedParents: AffectedParent[];
}

export interface MetaLevel {
  type: string;
  name: string;
  fields: Record<string, unknown>;
}

export interface ResolvedTag {
  tag_path: string;
  data_type: string;
  module: string | null;
  module_type: string | null;
  is_setpoint: boolean;
  trends: boolean;
  meta: MetaLevel[];
}

/** Extracts a Template from either a direct Template or a TemplateEntry wrapper. */
export function extractTemplate(value: Template | TemplateEntry): Template {
  return 'template' in value ? value.template : value;
}
