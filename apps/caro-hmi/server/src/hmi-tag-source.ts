// hmi-tag-source.ts — Telemetry producer for module_type='HMI' tags.
//
// Allows HMI server code to write values like:
//   hmiTags.Module_Info_Module_Count = 11
// and publishes them through TelemetryIntake on a configurable timer.
//
// Property name derivation:
//   tag_path = 'CARO_1.HMI.Module_Info.Data_Rate', module = 'HMI' → 'Module_Info_Data_Rate'
//   tag_path = 'CARO_1.HMI.Status.Active', module = 'HMI'        → 'Status_Active'

import type { ActiveTag } from '@caro/db';
import type { TelemetryIntake, TelemetryMessage } from './telemetry-intake.js';
import type { DutyTracker } from './duty-tracker.js';
import { getModuleNames, setPackedBit, ModuleStatus } from '@caro/tag-registry-shared';

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

function mapStatusString(s: string | undefined): number {
  switch (s) {
    case 'OK':      return ModuleStatus.OK;
    case 'ONLINE':  return ModuleStatus.OK;
    case 'WARNING': return ModuleStatus.WARNING;
    case 'FAULT':   return ModuleStatus.FAULT;
    case 'STALLED': return ModuleStatus.STALLED;
    default:        return ModuleStatus.UNKNOWN;
  }
}

export class HmiTagSource {
  private readonly intake: TelemetryIntake;
  private readonly hmiPublishIntervalMs: number;
  private readonly dutyTracker: DutyTracker;
  private readonly onBeforePublish: (() => void) | undefined;
  private readonly values: Map<number, number | boolean | string | number[] | null>;
  private readonly propertyToTagId: Map<string, number>;
  // tagIdToProperty is for debugging only — not on the hot path
  private readonly tagIdToProperty: Map<number, string>;
  private readonly moduleId: string;
  private readonly moduleNames: string[];
  private publishTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    deps: HmiTagSourceDeps,
    values: Map<number, number | boolean | string | number[] | null>,
    propertyToTagId: Map<string, number>,
    tagIdToProperty: Map<number, string>,
    moduleId: string,
    moduleNames: string[],
  ) {
    this.intake = deps.intake;
    this.hmiPublishIntervalMs = deps.hmiPublishIntervalMs;
    this.dutyTracker = deps.dutyTracker;
    this.onBeforePublish = deps.onBeforePublish;
    this.values = values;
    this.propertyToTagId = propertyToTagId;
    this.tagIdToProperty = tagIdToProperty;
    this.moduleId = moduleId;
    this.moduleNames = moduleNames;
  }

  /**
   * Filters allTags to module_type='HMI', builds internal maps, and returns
   * a Proxy so callers can read/write tag values as named properties.
   *
   * Module ordering for Module_Info arrays is derived from the *full* allTags
   * input (not just HMI) to match the authoritative system-wide ordering.
   */
  static create(
    allTags: ActiveTag[],
    deps: HmiTagSourceDeps,
  ): HmiTagSource & Record<string, number | boolean | string | number[]> {
    const hmiTags = allTags.filter(t => t.module_type === 'HMI');

    const values          = new Map<number, number | boolean | string | number[] | null>();
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

    const resetCountTagId = propertyToTagId.get('Reset_Count');
    if (resetCountTagId !== undefined) {
      values.set(resetCountTagId, 0);
    }

    // Compute module ordering from all tags with a non-null module (HMI included).
    const tagEntryMap = new Map(
      allTags
        .filter(t => t.module != null)
        .map(t => [t.tag_id, { tag_id: t.tag_id, module_id: t.module! }]),
    );
    const moduleNames = getModuleNames(tagEntryMap);

    const instance = new HmiTagSource(deps, values, propertyToTagId, tagIdToProperty, moduleId, moduleNames);

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
            target.values.set(tagId, value as number | boolean | string | number[] | null);
            return true;
          }
          // Not an HMI tag property — reject unless it's a real class member
          if (!(prop in target)) {
            throw new Error(`HmiTagSource: unknown property "${prop}"`);
          }
        }
        return Reflect.set(target, prop, value);
      },
    }) as HmiTagSource & Record<string, number | boolean | string | number[]>;
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

  /** Trigger an immediate publish outside the normal interval. */
  publishNow(): void {
    this.publishTick();
  }

  /** Write a tag value directly by tag_id (for CmdController HMI writes). */
  setValue(tagId: number, value: number | boolean): void {
    if (this.values.has(tagId)) {
      this.values.set(tagId, value);
    }
  }

  /** Receive a RESET command — increments the Reset_Count tag if present. */
  reset(): void {
    const tagId = this.propertyToTagId.get('Reset_Count');
    if (tagId !== undefined) {
      const current = (this.values.get(tagId) as number) ?? 0;
      this.values.set(tagId, current + 1);
    }
  }

  private updateModuleInfoTags(): void {
    if (!this.propertyToTagId.has('Module_Info_Data_Rate')) return;

    const stats = this.intake.getModuleStats();
    const statsByModule = new Map(stats.map(s => [s.module_id, s]));

    const dataRate:   number[] = [];
    const pkgRate:    number[] = [];
    const status:     number[] = [];
    const tagsPerPkg: number[] = [];
    const watchdogWords = Math.max(1, Math.ceil(this.moduleNames.length / 16));
    const watchdog: number[] = new Array(watchdogWords).fill(0);

    for (let i = 0; i < this.moduleNames.length; i++) {
      const s = statsByModule.get(this.moduleNames[i]);
      dataRate.push(s ? s.bytes_per_sec / 1024 : 0);
      pkgRate.push(s ? s.packets_per_sec : 0);
      status.push(mapStatusString(s?.status));
      tagsPerPkg.push(s ? s.tags_in_last_packet : 0);
      if (s?.stalled) setPackedBit(i, watchdog, true);
    }

    // Write through the Proxy so values flow into the `values` Map.
    const self = this as unknown as Record<string, unknown>;
    self.Module_Info_Data_Rate    = dataRate;
    self.Module_Info_Pkg_Rate     = pkgRate;
    self.Module_Info_Status       = status;
    self.Module_Info_Tags_Per_Pkg = tagsPerPkg;
    self.Module_Info_Watchdog     = watchdog;
  }

  private publishTick(): void {
    if (this.values.size === 0) return;
    this.onBeforePublish?.();
    this.dutyTracker.track(() => {
      this.updateModuleInfoTags();
      const message: TelemetryMessage = {
        timestamp: Date.now(),
        status: 'ONLINE',
        tags: [...this.values.entries()].map(([tag_id, value]) => ({ tag_id, value })),
      };
      this.intake.ingest(this.moduleId, message);
    });
  }
}
