import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Modal, formatDateTime } from '@caro/ui';
import { HandshakeStatusLabels } from '@caro/tag-registry-shared';
import { getHandshakeDetails } from '../api/handshake.js';
import type { HandshakeDetails } from '../api/handshake.js';

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));
const list = (v: string[]): string => (v.length === 0 ? 'none' : v.join(', '));

function Section({ title, ts, children }: { title: string; ts?: number; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h4 className="text-xs uppercase text-gray-500 font-medium mb-1">
        {title}
        {ts !== undefined && <span className="ml-2 normal-case text-gray-400">{formatDateTime(ts)}</span>}
      </h4>
      <table className="text-sm"><tbody>{children}</tbody></table>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="pr-6 py-0.5 text-gray-500 align-top whitespace-nowrap">{label}</td>
      <td className="py-0.5 font-mono text-xs break-all">{value}</td>
    </tr>
  );
}

function Details({ d }: { d: HandshakeDetails }) {
  return (
    <>
      <p className="mb-4 text-sm">
        State: <span className="font-medium">{HandshakeStatusLabels[d.status] ?? 'UNKNOWN'}</span>
      </p>

      {d.request === null ? (
        <p className="text-sm text-gray-400">No HANDSHAKE_REQUEST received since the HMI server started.</p>
      ) : (
        <Section title="Request" ts={d.request.ts_ms}>
          <Row label="IP" value={show(d.request.ip)} />
          <Row label="Instance ID" value={show(d.request.instance_id)} />
          <Row label="Firmware hash" value={show(d.request.fw_hash)} />
          <Row label="Template" value={show(d.request.tag_registry_template)} />
          <Row label="Template rev" value={show(d.request.tag_registry_rev)} />
          <Row label="Module time (UTC ms)" value={show(d.request.ts_utc_ms)} />
        </Section>
      )}

      {d.tag_list && (
        <Section title="TAG_LIST sent" ts={d.tag_list.ts_ms}>
          <Row label="Tags" value={String(d.tag_list.tags)} />
          <Row label="Size" value={`${d.tag_list.bytes} B`} />
        </Section>
      )}

      {d.confirm && (
        <Section title="CONFIRM" ts={d.confirm.ts_ms}>
          <Row label="Missing IDs" value={list(d.confirm.missing_ids)} />
          <Row label="Unknown tags" value={list(d.confirm.unknown_tags)} />
          {d.confirm.truncated && <Row label="Truncated" value="yes — the module's lists did not fit its buffer" />}
        </Section>
      )}

      {d.push && (
        <Section title="Set push" ts={d.push.ts_ms}>
          <Row label="Outcome" value={d.push.outcome} />
          <Row label="Sets" value={`${d.push.sets} (${d.push.unpopulated} unpopulated)`} />
          <Row label="Rejected" value={d.push.rejected.length === 0
            ? 'none'
            : d.push.rejected.map(r => `${r.tag_id}:${r.rejection_code ?? '?'}`).join(', ')} />
          <Row label="Consecutive timeouts" value={String(d.push.consecutive_timeouts)} />
        </Section>
      )}
    </>
  );
}

/** Handshake details for one module, fetched when opened; Refresh fetches again. */
export function HandshakeDetailsModal({ moduleId, onClose }: { moduleId: string | null; onClose: () => void }) {
  const [details, setDetails] = useState<HandshakeDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (moduleId === null) return;
    setError(null);
    getHandshakeDetails(moduleId)
      .then(setDetails)
      .catch((err: Error) => { setDetails(null); setError(err.message); });
  }, [moduleId]);

  useEffect(() => {
    setDetails(null);
    load();
  }, [load]);

  return (
    <Modal isOpen={moduleId !== null} onClose={onClose} title={`Handshake — ${moduleId ?? ''}`}>
      {error !== null && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {details === null && error === null && <p className="text-sm text-gray-400">Loading…</p>}
      {details !== null && <Details d={details} />}
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="secondary" onClick={load}>Refresh</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
