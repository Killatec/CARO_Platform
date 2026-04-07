import type { Template, TemplateEntry } from './types.js';
import { extractTemplate } from './types.js';

type TMap = Map<string, Template | TemplateEntry>;
type TRecord = Record<string, Template | TemplateEntry>;

export function applyFieldCascade(
  templateMap: TMap | TRecord | null | undefined,
  changedTemplate: Template | null | undefined,
): TMap | TRecord | null | undefined {
  if (!templateMap || !changedTemplate || !changedTemplate.template_name) {
    return templateMap;
  }

  const isMap = templateMap instanceof Map;

  let workingMap: TMap;
  if (isMap) {
    workingMap = new Map(templateMap as TMap);
  } else {
    workingMap = new Map(Object.entries(templateMap as TRecord)) as TMap;
  }

  const changedTemplateName = changedTemplate.template_name;
  const changedFields = new Set(Object.keys(changedTemplate.fields || {}));

  const existingEntry = workingMap.get(changedTemplateName);
  if (existingEntry) {
    if ('template' in existingEntry) {
      workingMap.set(changedTemplateName, { ...(existingEntry as TemplateEntry), template: changedTemplate });
    } else {
      workingMap.set(changedTemplateName, changedTemplate);
    }
  } else {
    workingMap.set(changedTemplateName, changedTemplate);
  }

  for (const [parentName, parentEntry] of workingMap.entries()) {
    const parentTemplate = extractTemplate(parentEntry);

    if (!parentTemplate.children || !Array.isArray(parentTemplate.children)) continue;

    let modified = false;
    const updatedChildren = parentTemplate.children.map(child => {
      if (child.template_name !== changedTemplateName) return child;

      const updatedChild = { ...child };
      if (child.fields && typeof child.fields === 'object') {
        const reconciledFields: Record<string, unknown> = {};
        for (const [fieldName, fieldValue] of Object.entries(child.fields)) {
          if (changedFields.has(fieldName)) {
            reconciledFields[fieldName] = fieldValue;
          } else {
            modified = true;
          }
        }
        updatedChild.fields = reconciledFields;
      }
      if (Object.keys(updatedChild.fields || {}).length !== Object.keys(child.fields || {}).length) {
        modified = true;
      }
      return updatedChild;
    });

    if (modified) {
      const updatedParentTemplate = { ...parentTemplate, children: updatedChildren };
      if ('template' in parentEntry) {
        workingMap.set(parentName, { ...(parentEntry as TemplateEntry), template: updatedParentTemplate });
      } else {
        workingMap.set(parentName, updatedParentTemplate);
      }
    }
  }

  if (isMap) return workingMap;
  return Object.fromEntries(workingMap) as TRecord;
}
