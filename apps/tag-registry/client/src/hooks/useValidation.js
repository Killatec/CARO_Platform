import { useEffect, useMemo } from 'react';
import { validateTemplate, validateGraph, validateParentTypes } from '../../../shared/index.js';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useUIStore } from '../stores/useUIStore.js';

/**
 * Validation hook - runs all client-side validation checks
 * Synchronous, no server call, no debounce
 */
export function useValidation(templateMap, rootName) {
  const setValidationState = useTemplateGraphStore(state => state.setValidationState);
  const { requiredParentTypes, uniqueParentTypes } = useUIStore(s => s.validationConfig);

  const result = useMemo(() => {
    const messages = [];

    if (!templateMap || templateMap.size === 0) {
      return { messages: [], isValid: true };
    }

    // Extract templates for validation
    const templates = new Map();
    for (const [name, entry] of templateMap.entries()) {
      if (entry && entry.template) {
        templates.set(name, entry.template);
      }
    }

    // Validate each template individually
    for (const [template_name, template] of templates.entries()) {
      const templateResult = validateTemplate(template);
      messages.push(...templateResult.errors);
      messages.push(...templateResult.warnings);
    }

    // Validate the full graph
    const graphResult = validateGraph(templates);
    messages.push(...graphResult.errors);
    messages.push(...graphResult.warnings);

    // Validate parent types if root is selected
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

  // Update validation state in store
  useEffect(() => {
    setValidationState(result);
  }, [result, setValidationState]);

  return result;
}
