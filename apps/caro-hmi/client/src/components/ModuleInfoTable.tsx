import { useMemo } from 'react';
import { useResolveAssetPath, useLiveValue, useTagMap } from '@caro/hmi-context';
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

export function ModuleInfoTable() {
  const tagMap = useTagMap();
  const moduleNames = useMemo(() => getModuleNames(tagMap), [tagMap]);

  const moduleCountTags = useResolveAssetPath('CARO_1.HMI.Module_Info.Module_Count');
  const statusTags      = useResolveAssetPath('CARO_1.HMI.Module_Info.Status');
  const dataRateTags    = useResolveAssetPath('CARO_1.HMI.Module_Info.Data_Rate');
  const pkgRateTags     = useResolveAssetPath('CARO_1.HMI.Module_Info.Pkg_Rate');
  const tagsPerPkgTags  = useResolveAssetPath('CARO_1.HMI.Module_Info.Tags_Per_Pkg');
  const watchdogTags    = useResolveAssetPath('CARO_1.HMI.Module_Info.Watchdog');

  const moduleCountId = moduleCountTags[0]?.tag_id;
  const statusId      = statusTags[0]?.tag_id;
  const dataRateId    = dataRateTags[0]?.tag_id;
  const pkgRateId     = pkgRateTags[0]?.tag_id;
  const tagsPerPkgId  = tagsPerPkgTags[0]?.tag_id;
  const watchdogId    = watchdogTags[0]?.tag_id;

  const moduleCount = useLiveValue(moduleCountId ?? 0).value as number | null;
  const status      = useLiveValue(statusId      ?? 0).value as number[] | null;
  const dataRate    = useLiveValue(dataRateId    ?? 0).value as number[] | null;
  const pkgRate     = useLiveValue(pkgRateId     ?? 0).value as number[] | null;
  const tagsPerPkg  = useLiveValue(tagsPerPkgId  ?? 0).value as number[] | null;
  const watchdog    = useLiveValue(watchdogId    ?? 0).value as number[] | null;

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
