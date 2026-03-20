import { apiClient } from './client.js';

/**
 * List all templates, optionally filtered by type
 */
export async function listTemplates(type) {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  const result = await apiClient.get(`/templates${query}`);
  return result.templates;
}

/**
 * Get a single template with hash
 */
export async function getTemplate(template_name) {
  return apiClient.get(`/templates/${encodeURIComponent(template_name)}`);
}

/**
 * Load root template graph
 * Returns: { root_template_name, templates: { name: { template, hash } } }
 */
export async function loadRoot(template_name) {
  if (!template_name) {
    console.error('loadRoot called with null/undefined template_name');
    return;
  }
  return apiClient.get(`/templates/root/${encodeURIComponent(template_name)}`);
}

/**
 * Batch save templates with hash checking and cascade confirmation
 * @param {Array} changes - Array of { template_name, original_hash, template }
 * @param {boolean} confirmed - Whether the user has confirmed cascade changes
 */
export async function batchSave(changes, deletions = [], confirmed = false) {
  return apiClient.post('/templates/batch', { changes, deletions, confirmed });
}

/**
 * Delete a template and remove all references
 * @param {string} template_name - Template name to delete
 * @param {string} original_hash - Current hash for optimistic locking
 * @param {boolean} confirmed - Whether the user has confirmed deletion
 */
export async function deleteTemplate(template_name, original_hash, confirmed = false) {
  return apiClient.delete(`/templates/${encodeURIComponent(template_name)}`, {
    original_hash,
    confirmed
  });
}

/**
 * Validate all templates on disk
 */
export async function validateAll() {
  return apiClient.post('/templates/validate', {});
}
