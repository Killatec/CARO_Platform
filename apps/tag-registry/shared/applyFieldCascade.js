/**
 * Apply field cascade when a template changes.
 * Propagates changes to all child instances in the template map.
 * Pure function - does not mutate input.
 *
 * @param {Map<string, Object>|Object} templateMap - Current template map (Map or object of name -> { template, hash })
 * @param {Object} changedTemplate - The template that changed
 * @returns {Map<string, Object>|Object} Updated template map (same type as input)
 */
export function applyFieldCascade(templateMap, changedTemplate) {
  if (!templateMap || !changedTemplate || !changedTemplate.template_name) {
    return templateMap;
  }

  const isMap = templateMap instanceof Map;

  // Convert to Map for processing
  let workingMap;
  if (isMap) {
    workingMap = new Map(templateMap);
  } else {
    workingMap = new Map(Object.entries(templateMap));
  }

  const changedTemplateName = changedTemplate.template_name;
  const changedFields = new Set(Object.keys(changedTemplate.fields || {}));

  // Update the changed template in the map
  const existingEntry = workingMap.get(changedTemplateName);
  if (existingEntry) {
    if (existingEntry.template) {
      // Wrapper object format
      workingMap.set(changedTemplateName, {
        ...existingEntry,
        template: changedTemplate
      });
    } else {
      // Direct template format
      workingMap.set(changedTemplateName, changedTemplate);
    }
  } else {
    workingMap.set(changedTemplateName, changedTemplate);
  }

  // Find all parent templates that reference the changed template
  for (const [parentName, parentEntry] of workingMap.entries()) {
    const parentTemplate = parentEntry.template || parentEntry;

    if (!parentTemplate.children || !Array.isArray(parentTemplate.children)) {
      continue;
    }

    let modified = false;
    const updatedChildren = [];

    for (const child of parentTemplate.children) {
      if (child.template_name === changedTemplateName) {
        // This child is an instance of the changed template
        const updatedChild = { ...child };

        // Reconcile instance field overrides
        if (child.fields && typeof child.fields === 'object') {
          const reconciledFields = {};

          // Keep only overrides for fields that still exist in the changed template
          for (const [fieldName, fieldValue] of Object.entries(child.fields)) {
            if (changedFields.has(fieldName)) {
              reconciledFields[fieldName] = fieldValue;
            } else {
              // Field was removed - drop the override
              modified = true;
            }
          }

          updatedChild.fields = reconciledFields;
        }

        updatedChildren.push(updatedChild);
        if (Object.keys(updatedChild.fields || {}).length !== Object.keys(child.fields || {}).length) {
          modified = true;
        }
      } else {
        updatedChildren.push(child);
      }
    }

    if (modified) {
      const updatedParentTemplate = {
        ...parentTemplate,
        children: updatedChildren
      };

      if (parentEntry.template) {
        // Wrapper object format
        workingMap.set(parentName, {
          ...parentEntry,
          template: updatedParentTemplate
        });
      } else {
        // Direct template format
        workingMap.set(parentName, updatedParentTemplate);
      }
    }
  }

  // Convert back to original format
  if (isMap) {
    return workingMap;
  } else {
    return Object.fromEntries(workingMap);
  }
}
