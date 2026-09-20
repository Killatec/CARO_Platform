import { useEffect, useMemo, useRef } from 'react';
import { useResolveAssetPath, useLiveValue, useTagMap } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { getModuleNames, packedBit, ModuleStatus, ModuleStatusLabels } from '@caro/tag-registry-shared';

const PR: React.CSSProperties = { paddingRight: '3rem' };

function statusClass(code: number | undefined): string {
  switch (code) {
    case ModuleStatus.OK:      return 'text-green-600 font-medium';
    case ModuleStatus.WARNING: return 'text-amber-600 font-medium';
    case ModuleStatus.FAULT:
    case ModuleStatus.STALLED: return 'text-red-600 font-medium';
    default:                   return 'text-gray-400';
  }
}

/**
 * Resolves an abbreviated asset path to exactly one tag. Unlike
 * packages/widgets' useSingleTag (correctly a page-authoring error for a
 * widget), zero or ambiguous matches here are not errors — a system may
 * legitimately have no Module_Info subtree, so both cases render as
 * unresolved rather than throwing. An ambiguous match (>1) also warns once,
 * since silently taking the first match would show one module's numbers
 * under another's name with nothing to indicate it.
 */
function useSingleOptionalTag(assetPath: string): TagDef | undefined {
  const matches = useResolveAssetPath(assetPath);
  const warnedRef = useRef(false);

  useEffect(() => {
    if (matches.length > 1 && !warnedRef.current) {
      warnedRef.current = true;
      console.warn(
        `[ModuleInfoTable] "${assetPath}" matched ${matches.length} tags — treating as unresolved: ` +
        matches.map(t => t.tag_path).join(', '),
      );
    }
  }, [assetPath, matches]);

  return matches.length === 1 ? matches[0] : undefined;
}

export function ModuleInfoTable() {
  const tagMap = useTagMap();
  // Ordering must match the server's (hmi-tag-source.ts) exactly — status[],
  // dataRate[], pkgRate[] and tagsPerPkg[] below are positional arrays indexed
  // by that ordering. Both sides filter out tags with no module ancestor before
  // calling getModuleNames — server: tagEntryMap's `t.module != null`; here:
  // module_id !== 'unknown' (tag-map.ts's getModuleId fallback for the same
  // condition, server-side, baked into the TagDef this tagMap is built from).
  // The two derive their sequence from the same filtered set by construction —
  // not by relying on registry validation config to guarantee every tag has one.
  const moduleNames = useMemo(() => {
    const withModule = new Map([...tagMap].filter(([, tag]) => tag.module_id !== 'unknown'));
    return getModuleNames(withModule);
  }, [tagMap]);

  const moduleCountId = useSingleOptionalTag('HMI.Module_Info.Module_Count')?.tag_id;
  const statusId      = useSingleOptionalTag('HMI.Module_Info.Status')?.tag_id;
  const dataRateId    = useSingleOptionalTag('HMI.Module_Info.Data_Rate')?.tag_id;
  const pkgRateId     = useSingleOptionalTag('HMI.Module_Info.Pkg_Rate')?.tag_id;
  const tagsPerPkgId  = useSingleOptionalTag('HMI.Module_Info.Tags_Per_Pkg')?.tag_id;
  const watchdogId    = useSingleOptionalTag('HMI.Module_Info.Watchdog')?.tag_id;

  const moduleCount = useLiveValue(moduleCountId).value as number | null;
  const status      = useLiveValue(statusId).value as number[] | null;
  const dataRate    = useLiveValue(dataRateId).value as number[] | null;
  const pkgRate     = useLiveValue(pkgRateId).value as number[] | null;
  const tagsPerPkg  = useLiveValue(tagsPerPkgId).value as number[] | null;
  const watchdog    = useLiveValue(watchdogId).value as number[] | null;

  const hasMismatch = moduleCount !== null && (
    (status?.length    !== moduleCount) ||
    (dataRate?.length  !== moduleCount) ||
    (pkgRate?.length   !== moduleCount) ||
    (tagsPerPkg?.length !== moduleCount)
  );

  const rowCount = hasMismatch
    ? Math.min(
        moduleNames.length,
        status?.length    ?? moduleNames.length,
        dataRate?.length  ?? moduleNames.length,
        pkgRate?.length   ?? moduleNames.length,
        tagsPerPkg?.length ?? moduleNames.length,
      )
    : moduleNames.length;

  return (
    <>
      {hasMismatch && (
        <div className="text-xs text-red-600 mb-1">
          {`Module array length mismatch — expected ${moduleCount}, got ${status?.length ?? '?'}`}
        </div>
      )}
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Module</th>
            <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Status</th>
            <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Packets/s</th>
            <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>KB/s</th>
            <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2" style={PR}>Tags</th>
            <th className="text-center text-xs uppercase text-gray-500 font-medium pb-2">Watchdog</th>
          </tr>
        </thead>
        <tbody>
          {rowCount === 0 ? (
            <tr>
              <td colSpan={6} className="text-gray-400 text-xs py-2">No modules</td>
            </tr>
          ) : (
            Array.from({ length: rowCount }, (_, i) => (
              <tr key={moduleNames[i]} className="border-b border-gray-100">
                <td className="py-1.5 font-mono text-xs text-gray-800" style={PR}>{moduleNames[i]}</td>
                <td className={`py-1.5 text-center ${statusClass(status?.[i])}`} style={PR}>
                  {ModuleStatusLabels[status?.[i] ?? 0] ?? 'UNKNOWN'}
                </td>
                <td className="py-1.5 text-center tabular-nums" style={PR}>{pkgRate?.[i] ?? 0}</td>
                <td className="py-1.5 text-center tabular-nums" style={PR}>{(dataRate?.[i] ?? 0).toFixed(1)}</td>
                <td className="py-1.5 text-center tabular-nums" style={PR}>{tagsPerPkg?.[i] ?? 0}</td>
                <td className="py-1.5 text-center">
                  <span className={`inline-block w-3 h-3 rounded-full ${
                    packedBit(i, watchdog ?? []) ? 'bg-red-500' : 'bg-green-500'
                  }`} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
