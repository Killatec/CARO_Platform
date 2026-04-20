/**
 * Constants used across the CARO Platform.
 * Environment-agnostic - safe for both server and client.
 */

export const DEFAULT_DATA_TYPE = 'f32';
export const DEFAULT_MODULE_TYPE = 'HMI';

export const ERROR_CODES = {
  // Template errors
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  TEMPLATE_NAME_CONFLICT: 'TEMPLATE_NAME_CONFLICT',
  STALE_TEMPLATE: 'STALE_TEMPLATE',

  // Validation errors
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  CIRCULAR_REFERENCE: 'CIRCULAR_REFERENCE',
  SCHEMA_VALIDATION_ERROR: 'SCHEMA_VALIDATION_ERROR',
  INVALID_ASSET_NAME: 'INVALID_ASSET_NAME',
  DUPLICATE_SIBLING_NAME: 'DUPLICATE_SIBLING_NAME',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  TAG_PATH_COLLISION: 'TAG_PATH_COLLISION',
  TAG_PATH_TOO_LONG: 'TAG_PATH_TOO_LONG',
  PARENT_TYPE_MISSING: 'PARENT_TYPE_MISSING',
  DUPLICATE_PARENT_TYPE: 'DUPLICATE_PARENT_TYPE',

  // Warnings
  EMPTY_BRANCH: 'EMPTY_BRANCH',
  TYPE_FOLDER_MISMATCH: 'TYPE_FOLDER_MISMATCH',

  // Generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export const MAX_TAG_PATH_LENGTH = 100;
export const MAX_IDENTIFIER_LENGTH = 40;

/**
 * Ancestor types that must appear at most once in a tag's ancestor chain.
 * Other types (e.g. "Group", "system") may repeat without triggering
 * DUPLICATE_PARENT_TYPE.
 */
export const UNIQUE_ANCESTOR_TYPES = new Set(['module', 'parameter']);

/**
 * All supported data_type values.
 *
 * Convention: when used as a packed status word, `i16` is interpreted bitwise
 * as an unsigned 16-bit value (LSB = bit 0). `i16[]` follows the same
 * convention, with module index i stored in word (i >> 4), bit (i & 0x0F).
 */
export type DataType = 'f32' | 'bool' | 'i16' | 'string' | 'f32[]' | 'i16[]';

/** Scalar (single-value) data types. Arrays are read-only; is_setpoint requires a scalar type. */
export const SCALAR_TYPES: Set<DataType> = new Set(['f32', 'bool', 'i16', 'string']);

/** Array data types. */
export const ARRAY_TYPES: Set<DataType> = new Set(['f32[]', 'i16[]']);

/** Numeric scalar types (excludes bool and string). */
export const NUMERIC_SCALAR_TYPES: Set<DataType> = new Set(['f32', 'i16']);

/** Types that may have trends: true. Arrays never trend. */
export const TRENDABLE_TYPES: Set<DataType> = new Set(['f32', 'i16', 'bool']);

/** Types that resolve unit and format display columns. */
export const TYPES_WITH_UNIT: Set<DataType> = new Set(['f32', 'i16', 'f32[]', 'i16[]']);
