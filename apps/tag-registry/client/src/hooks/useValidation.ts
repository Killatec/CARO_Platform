import { useEffect, useMemo } from 'react';
import { validateTemplate, validateGraph, validateParentTypes } from '@caro/tag-registry-shared';
import type { Template, TemplateEntry, ValidationMessage } from '@caro/tag-registry-shared';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useUIStore } from '../stores/useUIStore.js';

export interface ValidationResult {
  messages: ValidationMessage[];
  isValid: boolean;
}

/**
 * Validation hook - runs all client-side validation checks
 * Synchronous, no server call, no debounce
 */
export function useValidation(
  templateMap: Map<string, TemplateEntry>,
  rootName: string | null
): ValidationResult {
  const setValidationState = useTemplateGraphStore(state => state.setValidationState);
  const { requiredParentTypes, uniqueParentTypes } = useUIStore(s => s.validationConfig);

  const result = useMemo((): ValidationResult => {
    const messages: ValidationMessage[] = [];

    if (!templateMap || templateMap.size === 0) {
      return { messages: [], isValid: true };
    }

    const templates = new Map<string, Template>();
    for (const [name, entry] of templateMap.entries()) {
      if (entry && entry.template) {
        templates.set(name, entry.template);
      }
    }

    for (const [, template] of templates.entries()) {
      const templateResult = validateTemplate(template);
      messages.push(...templateResult.errors);
      messages.push(...templateResult.warnings);
    }

    const graphResult = validateGraph(templates);
    messages.push(...graphResult.errors);
    messages.push(...graphResult.warnings);

    if (rootName) {
      const parentTypesResult = validateParentTypes(templates, rootName, {
        requiredParentTypes,
        uniqueParentTypes,
      });
      messages.push(...parentTypesResult.errors);
      messages.push(...parentTypesResult.warnings);
    }

    const isValid = messages.length === 0;

    return { messages, isValid };
  }, [templateMap, rootName, requiredParentTypes, uniqueParentTypes]);

  useEffect(() => {
    setValidationState(result);
  }, [result, setValidationState]);

  return result;
}
