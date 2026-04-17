/**
 * Template service - manages template file I/O and validation
 */

import { readdir, readFile, writeFile, unlink, rename } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { existsSync } from 'fs';
import { getTagTypes, getModuleTypes } from '@caro/db';
import {
  hashTemplate,
  validateTemplate,
  validateGraph,
  simulateCascade,
  applyFieldCascade,
  ERROR_CODES,
} from '@caro/tag-registry-shared';
import type { Template, ValidationMessage, AffectedParent as CascadeAffectedParent } from '@caro/tag-registry-shared';
import { CaroError } from '@caro/server/errorHandler';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateIndexEntry {
  file_path: string;
  hash: string;
  template: Template;
}

export interface TemplateListItem {
  template_name: string;
  template_type: string;
  file_path: string;
}

export interface TemplateWithHash {
  template: Template;
  hash: string;
}

export interface LoadRootResult {
  root_template_name: string;
  templates: Record<string, TemplateWithHash>;
}

export interface BatchChange {
  template_name: string;
  original_hash: string | null;
  template: Template;
}

export interface BatchDeletion {
  template_name: string;
  original_hash: string;
}

type BatchSaveResult =
  | { requires_confirmation: false; modified_files: string[]; deleted_files: string[] }
  | { requires_confirmation: true; diff: unknown; affectedParents: CascadeAffectedParent[] };

interface AffectedParent {
  template_name: string;
  references_removed: number;
}

type DeleteTemplateResult =
  | { requires_confirmation: true; affected_parents: AffectedParent[] }
  | { requires_confirmation: false; deleted: true; affected_parents: AffectedParent[] };

export interface ValidateAllResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

// ── In-memory index ───────────────────────────────────────────────────────────

// In-memory index: template_name -> { file_path, hash, template }
let templateIndex = new Map<string, TemplateIndexEntry>();

// Get TEMPLATES_DIR from environment (function to defer until env is loaded)
function getTemplatesDir(): string {
  return process.env.TEMPLATES_DIR as string;
}

// ── Index management ──────────────────────────────────────────────────────────

/**
 * Initialize the template index by scanning TEMPLATES_DIR recursively
 */
export async function initializeIndex(): Promise<void> {
  const templatesDir = getTemplatesDir();
  if (!templatesDir) {
    throw new Error('TEMPLATES_DIR environment variable is not set');
  }

  templateIndex = new Map();
  await scanDirectory(templatesDir);
  console.log(`Loaded ${templateIndex.size} templates from ${templatesDir}`);
}

/**
 * Recursively scan a directory for .json template files
 */
async function scanDirectory(dirPath: string): Promise<void> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const template = JSON.parse(content) as Template;

          if (template.template_name) {
            const hash = hashTemplate(template);
            const relativePath = relative(getTemplatesDir(), fullPath);

            templateIndex.set(template.template_name, {
              file_path: relativePath,
              hash,
              template,
            });
          }
        } catch (err) {
          console.warn(`Failed to load template from ${fullPath}:`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * List all templates, optionally filtered by type
 */
export async function listTemplates(type?: string): Promise<TemplateListItem[]> {
  const results: TemplateListItem[] = [];

  for (const [template_name, entry] of templateIndex.entries()) {
    if (!type || entry.template.template_type === type) {
      results.push({
        template_name,
        template_type: entry.template.template_type,
        file_path: entry.file_path,
      });
    }
  }

  return results;
}

/**
 * Get a single template with hash
 */
export async function getTemplate(template_name: string): Promise<TemplateWithHash> {
  const entry = templateIndex.get(template_name);

  if (!entry) {
    const error = new Error(`Template "${template_name}" not found`) as CaroError;
    error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    error.status = 404;
    throw error;
  }

  return {
    template: entry.template,
    hash: entry.hash,
  };
}

/**
 * Load full reachable template graph from a root
 */
export async function loadRoot(template_name: string): Promise<LoadRootResult> {
  const entry = templateIndex.get(template_name);

  if (!entry) {
    const error = new Error(`Root template "${template_name}" not found`) as CaroError;
    error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    error.status = 404;
    throw error;
  }

  const reachable = new Map<string, TemplateWithHash>();
  const visited = new Set<string>();

  function walk(name: string): void {
    if (visited.has(name)) {
      return;
    }

    visited.add(name);
    const templateEntry = templateIndex.get(name);

    if (!templateEntry) {
      return;
    }

    reachable.set(name, {
      template: templateEntry.template,
      hash: templateEntry.hash,
    });

    // Recurse into children
    if (templateEntry.template.children && Array.isArray(templateEntry.template.children)) {
      for (const child of templateEntry.template.children) {
        if (child.template_name) {
          walk(child.template_name);
        }
      }
    }
  }

  walk(template_name);

  return {
    root_template_name: template_name,
    templates: Object.fromEntries(reachable),
  };
}

/**
 * Batch save templates with hash checking, cascade confirmation, and pending deletions.
 */
export async function batchSave(
  changes: BatchChange[],
  deletions: BatchDeletion[] = [],
  confirmed = false
): Promise<BatchSaveResult> {
  const hasChanges  = changes  && changes.length  > 0;
  const hasDeletions = deletions && deletions.length > 0;

  if (!hasChanges && !hasDeletions) {
    return { requires_confirmation: false, modified_files: [], deleted_files: [] };
  }

  // Step 1a: Validate original_hash values for changes
  if (hasChanges) {
    for (const change of changes) {
      const { template_name, original_hash } = change;

      if (original_hash === null) {
        // Assert that this is a new template
        if (templateIndex.has(template_name)) {
          const error = new Error(`Template "${template_name}" already exists`) as CaroError;
          error.code = ERROR_CODES.TEMPLATE_NAME_CONFLICT;
          error.status = 409;
          throw error;
        }
      } else {
        const entry = templateIndex.get(template_name);
        if (!entry) {
          const error = new Error(`Template "${template_name}" not found`) as CaroError;
          error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
          error.status = 404;
          throw error;
        }
        if (entry.hash !== original_hash) {
          const error = new Error(`Template "${template_name}" has been modified by another user. Please refresh and try again.`) as CaroError;
          error.code = ERROR_CODES.STALE_TEMPLATE;
          error.status = 409;
          throw error;
        }
      }
    }
  }

  // Step 1b: Validate original_hash values for deletions
  if (hasDeletions) {
    for (const { template_name, original_hash } of deletions) {
      const entry = templateIndex.get(template_name);
      if (!entry) {
        const error = new Error(`Template "${template_name}" not found`) as CaroError;
        error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
        error.status = 404;
        throw error;
      }
      if (entry.hash !== original_hash) {
        const error = new Error(`Template "${template_name}" has been modified by another user. Please refresh and try again.`) as CaroError;
        error.code = ERROR_CODES.STALE_TEMPLATE;
        error.status = 409;
        throw error;
      }
    }
  }

  // Step 1c: Validate TagType and ModuleType field values against lookup tables
  if (hasChanges) {
    const [tagTypes, moduleTypes] = await Promise.all([getTagTypes(), getModuleTypes()]);
    const validTagTypeNames = new Set(tagTypes.map(t => t.type_name));
    const validModuleTypeNames = new Set(moduleTypes.map(t => t.type_name));

    for (const { template } of changes) {
      for (const [fieldName, fieldDef] of Object.entries(template.fields || {})) {
        if (fieldDef.field_type === 'TagType' && typeof fieldDef.default === 'string' && !validTagTypeNames.has(fieldDef.default)) {
          const err = new Error(`Field "${fieldName}" has invalid TagType value "${fieldDef.default}". Valid type names: ${[...validTagTypeNames].join(', ')}`) as CaroError;
          err.code = ERROR_CODES.SCHEMA_VALIDATION_ERROR;
          err.status = 400;
          throw err;
        }
        if (fieldDef.field_type === 'ModuleType' && typeof fieldDef.default === 'string' && !validModuleTypeNames.has(fieldDef.default)) {
          const err = new Error(`Field "${fieldName}" has invalid ModuleType value "${fieldDef.default}". Valid module type names: ${[...validModuleTypeNames].join(', ')}`) as CaroError;
          err.code = ERROR_CODES.SCHEMA_VALIDATION_ERROR;
          err.status = 400;
          throw err;
        }
      }
    }
  }

  // Step 2: Build proposed template map (index + changes - deletions)
  const deletionSet = new Set<string>(hasDeletions ? deletions.map(d => d.template_name) : []);

  const proposedMap = new Map<string, TemplateIndexEntry>(templateIndex);
  if (hasChanges) {
    for (const change of changes) {
      proposedMap.set(change.template_name, { template: change.template, hash: '', file_path: '' });
    }
  }
  for (const name of deletionSet) {
    proposedMap.delete(name);
  }

  // Extract templates for validation
  const proposedTemplates = new Map<string, Template>();
  for (const [name, entry] of proposedMap.entries()) {
    proposedTemplates.set(name, entry.template);
  }

  // Step 3: Run validateGraph — INVALID_REFERENCE surfaces if remaining templates
  // reference a deleted template.
  const graphValidation = validateGraph(proposedTemplates);
  if (!graphValidation.valid) {
    const error = new Error('Template graph validation failed') as CaroError;
    error.code = ERROR_CODES.VALIDATION_ERROR;
    error.status = 422;
    error.details = graphValidation.errors;
    throw error;
  }

  // Step 4: Run simulateCascade on field changes to identify upstream parents
  const currentTemplates = new Map<string, Template>();
  for (const [name, entry] of templateIndex.entries()) {
    currentTemplates.set(name, entry.template);
  }

  const cascadeChanges = hasChanges ? changes : [];
  const cascadeResult = simulateCascade(currentTemplates, cascadeChanges);

  // Step 5: Check if confirmation is needed
  if (cascadeResult.requiresConfirmation && !confirmed) {
    return {
      requires_confirmation: true,
      diff: cascadeResult.diff,
      affectedParents: cascadeResult.affectedParents,
    };
  }

  // Step 6: Apply cascade updates to build final template set
  let cascadedMap = new Map<string, Template>(currentTemplates);
  if (hasChanges) {
    for (const change of changes) {
      cascadedMap = applyFieldCascade(cascadedMap, change.template) as Map<string, Template>;
    }
  }

  // Collect all templates that changed (direct saves + cascade-updated parents),
  // excluding any that are being deleted.
  const templatesToWrite = new Map<string, Template>();
  for (const [name, template] of cascadedMap.entries()) {
    if (!deletionSet.has(name) && template !== currentTemplates.get(name)) {
      templatesToWrite.set(name, template);
    }
  }

  // Step 7: Write changed files atomically
  const modifiedFiles: string[] = [];

  for (const [template_name, template] of templatesToWrite.entries()) {
    const existingEntry = templateIndex.get(template_name);
    let filePath: string;

    if (existingEntry) {
      filePath = existingEntry.file_path;
    } else {
      // New template — flat structure, all templates live directly in TEMPLATES_DIR
      filePath = `${template_name}.json`;
    }

    const fullPath = join(getTemplatesDir(), filePath);
    const tmpPath  = fullPath + '.tmp';

    const content = JSON.stringify(template, null, 2) + '\n';
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, fullPath);

    modifiedFiles.push(filePath);

    const hash = hashTemplate(template);
    templateIndex.set(template_name, { file_path: filePath, hash, template });
  }

  // Step 8: Delete files for pending deletions
  const deletedFiles: string[] = [];

  for (const { template_name } of (deletions || [])) {
    const entry = templateIndex.get(template_name);
    if (entry) {
      const fullPath = join(getTemplatesDir(), entry.file_path);
      await unlink(fullPath);
      templateIndex.delete(template_name);
      deletedFiles.push(entry.file_path);
    }
  }

  return {
    requires_confirmation: false,
    modified_files: modifiedFiles,
    deleted_files: deletedFiles,
  };
}

/**
 * Delete template and remove all references
 */
export async function deleteTemplate(
  template_name: string,
  original_hash: string,
  confirmed = false
): Promise<DeleteTemplateResult> {
  const entry = templateIndex.get(template_name);

  if (!entry) {
    const error = new Error(`Template "${template_name}" not found`) as CaroError;
    error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    error.status = 404;
    throw error;
  }

  // Check hash
  if (entry.hash !== original_hash) {
    const error = new Error(`Template "${template_name}" has been modified. Please refresh and try again.`) as CaroError;
    error.code = ERROR_CODES.STALE_TEMPLATE;
    error.status = 409;
    throw error;
  }

  // Find all templates that reference this one.
  const affectedParents: AffectedParent[] = [];

  for (const [parentName, parentEntry] of templateIndex.entries()) {
    if (parentName === template_name) continue;

    const parentTemplate = parentEntry.template;
    if (parentTemplate.children && Array.isArray(parentTemplate.children)) {
      const referencesCount = parentTemplate.children.filter(
        child => child.template_name === template_name
      ).length;

      if (referencesCount > 0) {
        affectedParents.push({
          template_name: parentName,
          references_removed: referencesCount,
        });
      }
    }
  }

  // If not confirmed and there are affected parents, return preview
  if (!confirmed && affectedParents.length > 0) {
    return {
      requires_confirmation: true,
      affected_parents: affectedParents,
    };
  }

  // Remove all references from affected parents
  for (const affected of affectedParents) {
    const parentEntry = templateIndex.get(affected.template_name)!;
    const parentTemplate = parentEntry.template;

    const updatedChildren = parentTemplate.children.filter(
      child => child.template_name !== template_name
    );

    const updatedTemplate: Template = {
      ...parentTemplate,
      children: updatedChildren,
    };

    // Write updated parent template
    const fullPath = join(getTemplatesDir(), parentEntry.file_path);
    const tmpPath  = fullPath + '.tmp';
    const content  = JSON.stringify(updatedTemplate, null, 2) + '\n';
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, fullPath);

    // Update index
    const hash = hashTemplate(updatedTemplate);
    templateIndex.set(affected.template_name, {
      file_path: parentEntry.file_path,
      hash,
      template: updatedTemplate,
    });
  }

  // Delete the template file
  const fullPath = join(getTemplatesDir(), entry.file_path);
  await unlink(fullPath);

  // Remove from index
  templateIndex.delete(template_name);

  return {
    requires_confirmation: false,
    deleted: true,
    affected_parents: affectedParents,
  };
}

/**
 * Run full validation across all template files
 */
export async function validateAll(): Promise<ValidateAllResult> {
  const errors:   ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  // Validate each template individually
  for (const [, entry] of templateIndex.entries()) {
    const result = validateTemplate(entry.template);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  // Validate the full graph
  const templates = new Map<string, Template>();
  for (const [name, entry] of templateIndex.entries()) {
    templates.set(name, entry.template);
  }

  const graphResult = validateGraph(templates);
  errors.push(...graphResult.errors);
  warnings.push(...graphResult.warnings);

  const valid = errors.length === 0 && warnings.length === 0;

  return {
    valid,
    errors,
    warnings,
  };
}
