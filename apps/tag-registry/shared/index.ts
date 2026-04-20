/**
 * @caro/tag-registry-shared - Environment-agnostic validation and business logic
 *
 * Pure functions only - no fs, no Express, no DOM.
 * Safe for both Node.js server and browser client.
 */

export { validateTemplate } from './validateTemplate.js';
export { validateGraph } from './validateGraph.js';
export { validateResolvedTags } from './validateResolvedTags.js';
export { simulateCascade } from './simulateCascade.js';
export { applyFieldCascade } from './applyFieldCascade.js';
export { validateParentTypes } from './validateParentTypes.js';
export { resolveRegistry } from './resolveRegistry.js';
export { hashTemplate } from './hashTemplate.js';
export { deepEqual, deepNotEqual } from './utils.js';
export { getModuleNames } from './moduleOrder.js';
export { packedBit, setPackedBit } from './bitPacking.js';
export { ModuleStatus, ModuleStatusLabels } from './enums/moduleStatus.js';
export * from './constants.js';
export type {
  FieldDef, ChildRef, Template, TemplateEntry,
  ValidationMessageRef, ValidationMessage, ValidationResult,
  ProposedChange, CascadeDiff, CascadeResult, AffectedParent,
  MetaLevel, ResolvedTag,
} from './types.js';
