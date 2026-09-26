/**
 * Tag Defs service — builds the "Generate Tag Defs" ZIP for a root template.
 * Spec: RF_Control Docs/CARO_MIGRATION.md D32; tag_registry_api_spec.md §7.
 */

import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import {
  buildTagDefsFile,
  listMqttModuleTemplates,
  validateGraph,
  ERROR_CODES,
} from '@caro/tag-registry-shared';
import { CaroError } from '@caro/server/errorHandler';
import { loadRoot } from './templateService.js';

export interface TagDefsZip {
  fileName: string;
  zip: Uint8Array;
  templateNames: string[];
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `TagDefs_YYYY-MM-DD_HHmmss.zip`, server local time. */
export function tagDefsZipName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `TagDefs_${date}_${time}.zip`;
}

/**
 * One `<template_name>.json` per MQTT module template reachable from rootName,
 * flat at the ZIP root. Reads saved (on-disk) templates only.
 */
export async function generateTagDefsZip(rootName: string, now: Date = new Date()): Promise<TagDefsZip> {
  const { templates } = await loadRoot(rootName);
  const templateMap = new Map(Object.entries(templates).map(([name, entry]) => [name, entry.template]));

  // resolveRegistry skips broken references silently — refuse rather than
  // emit a firmware artifact with tags quietly missing.
  const graph = validateGraph(templateMap);
  if (graph.errors.length > 0) {
    const err = new Error(`Template graph for "${rootName}" has validation errors`) as CaroError;
    err.status = 422;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    err.details = graph.errors;
    throw err;
  }

  const templateNames = listMqttModuleTemplates(templateMap);
  if (templateNames.length === 0) {
    const err = new Error(`No MQTT module templates are reachable from "${rootName}"`) as CaroError;
    err.status = 422;
    err.code = ERROR_CODES.NO_MQTT_MODULES;
    throw err;
  }

  const files: Zippable = {};
  for (const name of templateNames) {
    files[`${name}.json`] = strToU8(JSON.stringify(buildTagDefsFile(templateMap, name), null, 2) + '\n');
  }

  return { fileName: tagDefsZipName(now), zip: zipSync(files, { mtime: now }), templateNames };
}
