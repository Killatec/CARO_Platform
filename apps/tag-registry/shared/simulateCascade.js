/**
 * Simulate the cascade effects of proposed template changes.
 * Identifies upstream parent templates affected by the changes.
 *
 * @param {Map<string, Object>|Object} currentTemplateMap - Current template map (Map or object of name -> { template, hash })
 * @param {Array<Object>} proposedChanges - Array of { template_name, template, original_hash }
 * @returns {Object} { requiresConfirmation: boolean, diff: {...}, affectedParents: [...] }
 */
export function simulateCascade(currentTemplateMap, proposedChanges) {
  if (!currentTemplateMap || !proposedChanges || proposedChanges.length === 0) {
    return {
      requiresConfirmation: false,
      diff: {
        fields_added: [],
        fields_removed: [],
        fields_changed: [],
        instance_fields_changed: []
      },
      affectedParents: []
    };
  }

  // Convert to Map for processing
  let workingMap;
  if (currentTemplateMap instanceof Map) {
    workingMap = new Map(currentTemplateMap);
  } else {
    workingMap = new Map(Object.entries(currentTemplateMap));
  }

  // Extract template objects
  const currentTemplates = new Map();
  for (const [name, value] of workingMap.entries()) {
    if (value && typeof value === 'object') {
      currentTemplates.set(name, value.template || value);
    }
  }

  // Build set of changed template names
  const changedTemplateNames = new Set(proposedChanges.map(c => c.template_name));

  // Compute field-level diffs for each changed template
  const allFieldsAdded = [];
  const allFieldsRemoved = [];
  const allFieldsChanged = [];

  for (const change of proposedChanges) {
    const currentTemplate = currentTemplates.get(change.template_name);
    const proposedTemplate = change.template;

    if (!currentTemplate || !proposedTemplate) {
      continue;
    }

    const currentFields = new Set(Object.keys(currentTemplate.fields || {}));
    const proposedFields = new Set(Object.keys(proposedTemplate.fields || {}));

    // Fields added
    for (const field of proposedFields) {
      if (!currentFields.has(field)) {
        allFieldsAdded.push({
          template_name: change.template_name,
          field
        });
      }
    }

    // Fields removed
    for (const field of currentFields) {
      if (!proposedFields.has(field)) {
        allFieldsRemoved.push({
          template_name: change.template_name,
          field
        });
      }
    }

    // Fields changed — compare full field definition; report default values in diff
    for (const field of currentFields) {
      if (proposedFields.has(field)) {
        const currentDef = currentTemplate.fields[field];
        const proposedDef = proposedTemplate.fields[field];
        if (JSON.stringify(currentDef) !== JSON.stringify(proposedDef)) {
          allFieldsChanged.push({
            template_name: change.template_name,
            field,
            old_value: currentDef?.default ?? currentDef,
            new_value: proposedDef?.default ?? proposedDef
          });
        }
      }
    }
  }

  // Compute instance-level field diffs: for each dirty (parent) template,
  // diff its children[i].fields between original and proposed versions.
  // Instance overrides live on the PARENT's children array, not the child template.
  const allInstanceFieldsChanged = [];

  for (const change of proposedChanges) {
    const currentTemplate = currentTemplates.get(change.template_name);
    const proposedTemplate = change.template;

    if (!currentTemplate || !proposedTemplate) {
      continue;
    }

    const currentChildren = currentTemplate.children || [];
    const proposedChildren = proposedTemplate.children || [];

    // Index proposed children by asset_name for O(1) lookup
    const proposedChildByAssetName = new Map(
      proposedChildren.filter(c => c.asset_name).map(c => [c.asset_name, c])
    );

    for (let i = 0; i < currentChildren.length; i++) {
      const currentChild = currentChildren[i];
      if (!currentChild.asset_name) continue;

      // Primary lookup by asset_name; fall back to same-index child when the
      // asset_name itself was renamed — allows field diffs and renames to both
      // be detected for the same child.
      const proposedChild =
        proposedChildByAssetName.get(currentChild.asset_name) ?? proposedChildren[i];
      if (!proposedChild) continue;

      const currentChildFields = currentChild.fields || {};
      const proposedChildFields = proposedChild.fields || {};

      const allChildFieldNames = new Set([
        ...Object.keys(currentChildFields),
        ...Object.keys(proposedChildFields)
      ]);

      for (const fieldName of allChildFieldNames) {
        const hasOld = Object.prototype.hasOwnProperty.call(currentChildFields, fieldName);
        const hasNew = Object.prototype.hasOwnProperty.call(proposedChildFields, fieldName);

        if (hasOld && hasNew) {
          if (JSON.stringify(currentChildFields[fieldName]) !== JSON.stringify(proposedChildFields[fieldName])) {
            allInstanceFieldsChanged.push({
              template_name: change.template_name,
              asset_name: currentChild.asset_name,
              field: fieldName,
              old_value: currentChildFields[fieldName],
              new_value: proposedChildFields[fieldName]
            });
          }
        } else if (!hasOld && hasNew) {
          allInstanceFieldsChanged.push({
            template_name: change.template_name,
            asset_name: currentChild.asset_name,
            field: fieldName,
            old_value: undefined,
            new_value: proposedChildFields[fieldName]
          });
        } else if (hasOld && !hasNew) {
          allInstanceFieldsChanged.push({
            template_name: change.template_name,
            asset_name: currentChild.asset_name,
            field: fieldName,
            old_value: currentChildFields[fieldName],
            new_value: undefined
          });
        }
      }
    }

    // Detect asset_name renames/additions/removals by comparing by position index.
    // Children matched by asset_name above are already handled; unmatched ones indicate
    // a rename, addition, or removal of the child slot itself.
    const currentAssetNames = currentChildren.map(c => c.asset_name);
    const proposedAssetNames = proposedChildren.map(c => c.asset_name);

    const currentAssetNameSet = new Set(currentAssetNames.filter(Boolean));
    const proposedAssetNameSet = new Set(proposedAssetNames.filter(Boolean));

    // asset_names only in original (renamed away or removed)
    const removedAssetNames = currentAssetNames.filter(n => n && !proposedAssetNameSet.has(n));
    // asset_names only in proposed (renamed to or added)
    const addedAssetNames = proposedAssetNames.filter(n => n && !currentAssetNameSet.has(n));

    // Pair by position index: same index = rename; excess on either side = pure add/remove
    const pairCount = Math.min(removedAssetNames.length, addedAssetNames.length);
    for (let i = 0; i < pairCount; i++) {
      allInstanceFieldsChanged.push({
        template_name: change.template_name,
        asset_name: removedAssetNames[i],
        field: 'asset_name',
        old_value: removedAssetNames[i],
        new_value: addedAssetNames[i]
      });
    }
    // Pure removals (no corresponding addition at same position)
    for (let i = pairCount; i < removedAssetNames.length; i++) {
      allInstanceFieldsChanged.push({
        template_name: change.template_name,
        asset_name: removedAssetNames[i],
        field: 'asset_name',
        old_value: removedAssetNames[i],
        new_value: undefined
      });
    }
    // Pure additions (no corresponding removal at same position)
    for (let i = pairCount; i < addedAssetNames.length; i++) {
      allInstanceFieldsChanged.push({
        template_name: change.template_name,
        asset_name: addedAssetNames[i],
        field: 'asset_name',
        old_value: undefined,
        new_value: addedAssetNames[i]
      });
    }
  }

  // Templates whose field schema actually changed (additions/removals/value changes).
  // Used for affectedParents: only schema changes to a child template affect how a
  // parent uses it — pure instance-override edits on a dirty template do not.
  const schemaChangedNames = new Set([
    ...allFieldsAdded.map(f => f.template_name),
    ...allFieldsRemoved.map(f => f.template_name),
    ...allFieldsChanged.map(f => f.template_name)
  ]);

  // Find affected instances: one entry per child instance (asset_name) within
  // any template that references a schema-changed child.
  // A template can simultaneously have its own schema changed and be a parent
  // of another schema-changed child — both are reported.
  const affectedParents = [];

  for (const [parentName, parentTemplate] of currentTemplates.entries()) {
    if (!parentTemplate.children || !Array.isArray(parentTemplate.children)) {
      continue;
    }

    for (const child of parentTemplate.children) {
      // Skip circular self-references and non-schema-changed children
      if (child.template_name === parentName) continue;
      if (!schemaChangedNames.has(child.template_name)) continue;

      const droppedInstanceValues = [];

      const change = proposedChanges.find(c => c.template_name === child.template_name);
      if (change && change.template) {
        const newChildFields = new Set(Object.keys(change.template.fields || {}));

        if (child.fields && typeof child.fields === 'object') {
          for (const [fieldName, fieldValue] of Object.entries(child.fields)) {
            if (!newChildFields.has(fieldName)) {
              droppedInstanceValues.push({
                field: fieldName,
                asset_name: child.asset_name,
                value: fieldValue
              });
            }
          }
        }
      }

      affectedParents.push({
        parent_template_name: parentName,
        asset_name: child.asset_name,
        dropped_instance_values: droppedInstanceValues
      });
    }
  }

  const requiresConfirmation = affectedParents.length > 0;

  return {
    requiresConfirmation,
    diff: {
      fields_added: allFieldsAdded,
      fields_removed: allFieldsRemoved,
      fields_changed: allFieldsChanged,
      instance_fields_changed: allInstanceFieldsChanged
    },
    affectedParents
  };
}
