/**
 * Template service - manages template file I/O and validation
 */

import { readdir, readFile, writeFile, unlink, rename } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { existsSync } from 'fs';
import {
  hashTemplate,
  validateTemplate,
  validateGraph,
  simulateCascade,
  applyFieldCascade,
  ERROR_CODES
} from '../../../shared/index.js';

// In-memory index: template_name -> { file_path, hash, template }
let templateIndex = new Map();

// Get TEMPLATES_DIR from environment (function to defer until env is loaded)
function getTemplatesDir() {
  return process.env.TEMPLATES_DIR;
}

/**
 * Initialize the template index by scanning TEMPLATES_DIR recursively
 */
export async function initializeIndex() {
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
async function scanDirectory(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const template = JSON.parse(content);

          if (template.template_name) {
            const hash = hashTemplate(template);
            const relativePath = relative(getTemplatesDir(), fullPath);

            templateIndex.set(template.template_name, {
              file_path: relativePath,
              hash,
              template
            });
          }
        } catch (err) {
          console.warn(`Failed to load template from ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * List all templates, optionally filtered by type
 */
export async function listTemplates(type) {
  const results = [];

  for (const [template_name, entry] of templateIndex.entries()) {
    if (!type || entry.template.template_type === type) {
      results.push({
        template_name,
        template_type: entry.template.template_type,
        file_path: entry.file_path
      });
    }
  }

  return results;
}

/**
 * Get a single template with hash
 */
export async function getTemplate(template_name) {
  const entry = templateIndex.get(template_name);

  if (!entry) {
    const error = new Error(`Template "${template_name}" not found`);
    error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    throw error;
  }

  return {
    template: entry.template,
    hash: entry.hash
  };
}

/**
 * Load full reachable template graph from a root
 */
export async function loadRoot(template_name) {
  const entry = templateIndex.get(template_name);

  if (!entry) {
    const error = new Error(`Root template "${template_name}" not found`);
    error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    throw error;
  }

  const reachable = new Map();
  const visited = new Set();

  function walk(name) {
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
      hash: templateEntry.hash
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
    templates: Object.fromEntries(reachable)
  };
}

/**
 * Batch save templates with hash checking, cascade confirmation, and pending deletions.
 * @param {Array} changes - Array of { template_name, original_hash, template }
 * @param {Array} deletions - Array of { template_name, original_hash } to delete atomically
 * @param {boolean} confirmed - Whether the user has confirmed cascade changes
 */
export async function batchSave(changes, deletions = [], confirmed = false) {
  const hasChanges = changes && changes.length > 0;
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
          const error = new Error(`Template "${template_name}" already exists`);
          error.code = ERROR_CODES.TEMPLATE_NAME_CONFLICT;
          throw error;
        }
      } else {
        const entry = templateIndex.get(template_name);
        if (!entry) {
          const error = new Error(`Template "${template_name}" not found`);
          error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
          throw error;
        }
        if (entry.hash !== original_hash) {
          const error = new Error(`Template "${template_name}" has been modified by another user. Please refresh and try again.`);
          error.code = ERROR_CODES.STALE_TEMPLATE;
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
        const error = new Error(`Template "${template_name}" not found`);
        error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
        throw error;
      }
      if (entry.hash !== original_hash) {
        const error = new Error(`Template "${template_name}" has been modified by another user. Please refresh and try again.`);
        error.code = ERROR_CODES.STALE_TEMPLATE;
        throw error;
      }
    }
  }

  // Step 2: Build proposed template map (index + changes - deletions)
  const deletionSet = new Set(hasDeletions ? deletions.map(d => d.template_name) : []);

  const proposedMap = new Map(templateIndex);
  if (hasChanges) {
    for (const change of changes) {
      proposedMap.set(change.template_name, { template: change.template, hash: null });
    }
  }
  for (const name of deletionSet) {
    proposedMap.delete(name);
  }

  // Extract templates for validation
  const proposedTemplates = new Map();
  for (const [name, entry] of proposedMap.entries()) {
    proposedTemplates.set(name, entry.template);
  }

  // Step 3: Run validateGraph — INVALID_REFERENCE surfaces if remaining templates
  // reference a deleted template.
  const graphValidation = validateGraph(proposedTemplates);
  if (!graphValidation.valid) {
    const error = new Error('Template graph validation failed');
    error.code = ERROR_CODES.VALIDATION_ERROR;
    error.details = graphValidation.errors;
    throw error;
  }

  // Step 4: Run simulateCascade on field changes to identify upstream parents
  const currentTemplates = new Map();
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
      affectedParents: cascadeResult.affectedParents
    };
  }

  // Step 6: Apply cascade updates to build final template set
  let cascadedMap = new Map(currentTemplates);
  if (hasChanges) {
    for (const change of changes) {
      cascadedMap = applyFieldCascade(cascadedMap, change.template);
    }
  }

  // Collect all templates that changed (direct saves + cascade-updated parents),
  // excluding any that are being deleted.
  const templatesToWrite = new Map();
  for (const [name, template] of cascadedMap.entries()) {
    if (!deletionSet.has(name) && template !== currentTemplates.get(name)) {
      templatesToWrite.set(name, template);
    }
  }

  // Step 7: Write changed files atomically
  const modifiedFiles = [];

  for (const [template_name, template] of templatesToWrite.entries()) {
    const existingEntry = templateIndex.get(template_name);
    let filePath;

    if (existingEntry) {
      filePath = existingEntry.file_path;
    } else {
      // New template — determine file path based on template_type
      const subdir = template.template_type === 'tag' ? 'tags' :
                     template.template_type === 'parameter' ? 'parameters' : 'modules';
      filePath = join(subdir, `${template_name}.json`);
    }

    const fullPath = join(getTemplatesDir(), filePath);
    const tmpPath = fullPath + '.tmp';

    const content = JSON.stringify(template, null, 2) + '\n';
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, fullPath);

    modifiedFiles.push(filePath);

    const hash = hashTemplate(template);
    templateIndex.set(template_name, { file_path: filePath, hash, template });
  }

  // Step 8: Delete files for pending deletions
  const deletedFiles = [];

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
export async function deleteTemplate(template_name, original_hash, confirmed = false) {
  const entry = templateIndex.get(template_name);

  if (!entry) {
    const error = new Error(`Template "${template_name}" not found`);
    error.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    throw error;
  }

  // Check hash
  if (entry.hash !== original_hash) {
    const error = new Error(`Template "${template_name}" has been modified. Please refresh and try again.`);
    error.code = ERROR_CODES.STALE_TEMPLATE;
    throw error;
  }

  // Find all templates that reference this one.
  // This is intentionally separate from simulateCascade: deletion uses simple reference
  // counting (how many children entries point to this template_name), not field cascade logic.
  const affectedParents = [];

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
          references_removed: referencesCount
        });
      }
    }
  }

  // If not confirmed and there are affected parents, return preview
  if (!confirmed && affectedParents.length > 0) {
    return {
      requires_confirmation: true,
      affected_parents: affectedParents
    };
  }

  // Remove all references from affected parents
  for (const affected of affectedParents) {
    const parentEntry = templateIndex.get(affected.template_name);
    const parentTemplate = parentEntry.template;

    const updatedChildren = parentTemplate.children.filter(
      child => child.template_name !== template_name
    );

    const updatedTemplate = {
      ...parentTemplate,
      children: updatedChildren
    };

    // Write updated parent template
    const fullPath = join(getTemplatesDir(), parentEntry.file_path);
    const tmpPath = fullPath + '.tmp';
    const content = JSON.stringify(updatedTemplate, null, 2) + '\n';
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, fullPath);

    // Update index
    const hash = hashTemplate(updatedTemplate);
    templateIndex.set(affected.template_name, {
      file_path: parentEntry.file_path,
      hash,
      template: updatedTemplate
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
    affected_parents: affectedParents
  };
}

/**
 * Run full validation across all template files
 */
export async function validateAll() {
  const errors = [];
  const warnings = [];

  // Validate each template individually
  for (const [template_name, entry] of templateIndex.entries()) {
    const result = validateTemplate(entry.template);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  // Validate the full graph
  const templates = new Map();
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
    warnings
  };
}
