import { apiClient } from '@caro/ui/api/client';
import type { Template, TemplateEntry } from '@caro/tag-registry-shared';

export interface TemplateListItem {
  template_name: string;
  template_type: string;
  file_path: string;
}

export interface LoadRootResponse {
  root_template_name: string;
  templates: Record<string, TemplateEntry>;
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

export interface BatchSaveResult {
  ok: boolean;
  requires_confirmation?: boolean;
  diff?: unknown;
  affectedParents?: unknown[];
  new_templates?: unknown[];
  children_changed?: unknown[];
  pending_deletions?: unknown[];
}

/**
 * List all templates, optionally filtered by type
 */
export async function listTemplates(type?: string): Promise<TemplateListItem[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  const result = await apiClient.get<{ templates: TemplateListItem[] }>(`/templates${query}`);
  return result.templates;
}

/**
 * Get a single template with hash
 */
export async function getTemplate(template_name: string): Promise<TemplateEntry> {
  return apiClient.get<TemplateEntry>(`/templates/${encodeURIComponent(template_name)}`);
}

/**
 * Load root template graph
 * Returns: { root_template_name, templates: { name: { template, hash } } }
 */
export async function loadRoot(template_name: string | null | undefined): Promise<LoadRootResponse | undefined> {
  if (!template_name) {
    console.error('loadRoot called with null/undefined template_name');
    return;
  }
  return apiClient.get<LoadRootResponse>(`/templates/root/${encodeURIComponent(template_name)}`);
}

/**
 * Batch save templates with hash checking and cascade confirmation
 */
export async function batchSave(
  changes: BatchChange[],
  deletions: BatchDeletion[] = [],
  confirmed = false
): Promise<BatchSaveResult> {
  return apiClient.post<BatchSaveResult>('/templates/batch', { changes, deletions, confirmed });
}

/**
 * Delete a template and remove all references
 */
export async function deleteTemplate(
  template_name: string,
  original_hash: string | null,
  confirmed = false
): Promise<unknown> {
  return apiClient.delete(`/templates/${encodeURIComponent(template_name)}`, {
    original_hash,
    confirmed
  });
}

/**
 * Validate all templates on disk
 */
export async function validateAll(): Promise<unknown> {
  return apiClient.post('/templates/validate', {});
}
