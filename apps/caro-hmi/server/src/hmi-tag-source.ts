// hmi-tag-source.ts — Telemetry producer for module_type='HMI' tags.
//
// Allows HMI server code to write values like:
//   hmiTags.Module_Count = 11
// and publishes them through TelemetryIntake on a configurable timer.
//
// Property name derivation:
//   tag_path = 'CARO_1.HMI.Module_Count', module = 'HMI' → 'Module_Count'
//   tag_path = 'CARO_1.HMI.Status.Active', module = 'HMI' → 'Status_Active'

import type { ActiveTag } from '@caro/db';
import type { TelemetryIntake, TelemetryMessage } from './telemetry-intake.js';
import type { DutyTracker } from './duty-tracker.js';

export interface HmiTagSourceDeps {
  intake: TelemetryIntake;
  hmiPublishIntervalMs: number;
  dutyTracker: DutyTracker;
  onBeforePublish?: () => void;
}

function derivePropertyName(tagPath: string, module: string): string | null {
  const segments = tagPath.split('.');
  const idx = segments.indexOf(module);
  if (idx === -1 || idx >= segments.length - 1) return null;
  return segments.slice(idx + 1).join('_');
}

export class HmiTagSource {
  private readonly intake: TelemetryIntake;
  private readonly hmiPublishIntervalMs: number;
  private readonly dutyTracker: DutyTracker;
  private readonly onBeforePublish: (() => void) | undefined;
  private readonly values: Map<number, number | boolean | string | null>;
  private readonly propertyToTagId: Map<string, number>;
  // tagIdToProperty is for debugging only — not on the hot path
  private readonly tagIdToProperty: Map<number, string>;
  private readonly moduleId: string;
  private publishTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    deps: HmiTagSourceDeps,
    values: Map<number, number | boolean | string | null>,
    propertyToTagId: Map<string, number>,
    tagIdToProperty: Map<number, string>,
    moduleId: string,
  ) {
    this.intake = deps.intake;
    this.hmiPublishIntervalMs = deps.hmiPublishIntervalMs;
    this.dutyTracker = deps.dutyTracker;
    this.onBeforePublish = deps.onBeforePublish;
    this.values = values;
    this.propertyToTagId = propertyToTagId;
    this.tagIdToProperty = tagIdToProperty;
    this.moduleId = moduleId;
  }

  /**
   * Filters allTags to module_type='HMI', builds internal maps, and returns
   * a Proxy so callers can read/write tag values as named properties.
   */
  static create(
    allTags: ActiveTag[],
    deps: HmiTagSourceDeps,
  ): HmiTagSource & Record<string, number | boolean | string> {
    const hmiTags = allTags.filter(t => t.module_type === 'HMI');

    const values        = new Map<number, number | boolean | string | null>();
    const propertyToTagId = new Map<string, number>();
    const tagIdToProperty = new Map<number, string>();
    // Track tag_path per property name for collision error messages only
    const propToTagPath = new Map<string, string>();
    let moduleId = 'HMI';

    for (const tag of hmiTags) {
      const module = tag.module ?? '';
      if (!module) {
        console.warn(`[HmiTagSource] tag_id=${tag.tag_id} (${tag.tag_path}) has no module column — skipping`);
        continue;
      }

      const prop = derivePropertyName(tag.tag_path, module);
      if (prop === null) {
        console.warn(`[HmiTagSource] Cannot derive property name for tag_id=${tag.tag_id} (${tag.tag_path}, module=${module}) — skipping`);
        continue;
      }

      if (propertyToTagId.has(prop)) {
        const existingPath = propToTagPath.get(prop)!;
        throw new Error(
          `[HmiTagSource] Property name collision: "${prop}" maps to both "${existingPath}" and "${tag.tag_path}"`,
        );
      }

      propertyToTagId.set(prop, tag.tag_id);
      tagIdToProperty.set(tag.tag_id, prop);
      propToTagPath.set(prop, tag.tag_path);
      values.set(tag.tag_id, null);

      // All HMI tags share the same module — capture from first valid tag
      if (moduleId === 'HMI' && module !== 'HMI') moduleId = module;
      else if (moduleId === 'HMI') moduleId = module;
    }

    const instance = new HmiTagSource(deps, values, propertyToTagId, tagIdToProperty, moduleId);

    return new Proxy(instance, {
      get(target, prop: string | symbol) {
        if (typeof prop === 'string') {
          const tagId = target.propertyToTagId.get(prop);
          if (tagId !== undefined) {
            return target.values.get(tagId) ?? null;
          }
        }
        // Fall through to actual class property (methods, private fields, etc.)
        return Reflect.get(target, prop);
      },

      set(target, prop: string | symbol, value: unknown) {
        if (typeof prop === 'string') {
          const tagId = target.propertyToTagId.get(prop);
          if (tagId !== undefined) {
            target.values.set(tagId, value as number | boolean | string | null);
            return true;
          }
          // Not an HMI tag property — reject unless it's a real class member
          if (!(prop in target)) {
            throw new Error(`HmiTagSource: unknown property "${prop}"`);
          }
        }
        return Reflect.set(target, prop, value);
      },
    }) as HmiTagSource & Record<string, number | boolean | string>;
  }

  startPublishing(): void {
    if (this.values.size === 0) return; // no HMI tags — no-op
    this.publishTimer = setInterval(() => this.publishTick(), this.hmiPublishIntervalMs);
  }

  stopPublishing(): void {
    if (this.publishTimer !== null) {
      clearInterval(this.publishTimer);
      this.publishTimer = null;
    }
  }

  private publishTick(): void {
    if (this.values.size === 0) return;
    this.onBeforePublish?.();
    this.dutyTracker.track(() => {
      const message: TelemetryMessage = {
        timestamp: Date.now(),
        status: 'ONLINE',
        tags: [...this.values.entries()].map(([tag_id, value]) => ({ tag_id, value })),
      };
      this.intake.ingest(this.moduleId, message);
    });
  }
}
