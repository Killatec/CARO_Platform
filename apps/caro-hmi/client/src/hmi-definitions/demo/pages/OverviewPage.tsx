/**
 * Demo Overview Page
 *
 * Asset paths are derived from the CARO_1 system template hierarchy:
 *   CARO_1 (system) → RF1 (rf_power_module) → Acc_Fwd / Acc_Ref / Kly_Fwd (analog_control)
 *     → monitor (f32, readback), setpoint (f32, setpoint),
 *       interlock_status (bool, readback), interlock_enable (bool, setpoint)
 *
 * If the registry is empty or uses different paths, each widget degrades to
 * its WidgetErrorBoundary — the page will not crash.
 *
 * Update these assetPaths to match your actual tag_path values in the registry.
 */
import type { CSSProperties } from 'react';
import { NumericMon, NumericSet, BooleanMon } from '@caro/widgets';
import { WidgetErrorBoundary } from '../../../shell/WidgetErrorBoundary.js';

// ─── Styles ──────────────────────────────────────────────────────────────────

const PAGE_STYLE: CSSProperties = {
  padding: 0,
};

const HEADING_STYLE: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#1a1a2e',
  marginBottom: 20,
};

const SECTION_STYLE: CSSProperties = {
  marginBottom: 28,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 12,
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: 6,
};

const GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 12,
};

const CARD_STYLE: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const CARD_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

// ─── Widget card wrapper ──────────────────────────────────────────────────────

interface WidgetCardProps {
  label: string;
  assetPath: string;
  children: React.ReactNode;
}

function WidgetCard({ label, assetPath, children }: WidgetCardProps) {
  return (
    <div style={CARD_STYLE}>
      <span style={CARD_LABEL_STYLE}>{label}</span>
      <WidgetErrorBoundary assetPath={assetPath}>
        {children}
      </WidgetErrorBoundary>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function OverviewPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>System Overview — Live Telemetry</h1>

      {/* RF Module 1 — Monitor values */}
      <section style={SECTION_STYLE}>
        <h2 style={SECTION_TITLE_STYLE}>RF1 — Monitor Channels</h2>
        <div style={GRID_STYLE}>
          <WidgetCard label="Acc Fwd Power" assetPath="RF1.Acc_Fwd.monitor">
            <NumericMon assetPath="RF1.Acc_Fwd.monitor" label="Acc Fwd" />
          </WidgetCard>

          <WidgetCard label="Acc Ref Power" assetPath="RF1.Acc_Ref.monitor">
            <NumericMon assetPath="RF1.Acc_Ref.monitor" label="Acc Ref" />
          </WidgetCard>

          <WidgetCard label="Kly Fwd Power" assetPath="RF1.Kly_Fwd.monitor">
            <NumericMon assetPath="RF1.Kly_Fwd.monitor" label="Kly Fwd" />
          </WidgetCard>

          <WidgetCard label="Kly Ref Power" assetPath="RF1.Kly_Ref.monitor">
            <NumericMon assetPath="RF1.Kly_Ref.monitor" label="Kly Ref" />
          </WidgetCard>
        </div>
      </section>

      {/* RF Module 1 — Status */}
      <section style={SECTION_STYLE}>
        <h2 style={SECTION_TITLE_STYLE}>RF1 — Status &amp; Interlocks</h2>
        <div style={GRID_STYLE}>
          <WidgetCard label="Acc Fwd Interlock" assetPath="RF1.Acc_Fwd.interlock_status">
            <BooleanMon assetPath="RF1.Acc_Fwd.interlock_status" label="Acc Fwd Interlock" />
          </WidgetCard>

          <WidgetCard label="Acc Ref Interlock" assetPath="RF1.Acc_Ref.interlock_status">
            <BooleanMon assetPath="RF1.Acc_Ref.interlock_status" label="Acc Ref Interlock" />
          </WidgetCard>

          <WidgetCard label="Kly Fwd Interlock" assetPath="RF1.Kly_Fwd.interlock_status">
            <BooleanMon assetPath="RF1.Kly_Fwd.interlock_status" label="Kly Fwd Interlock" />
          </WidgetCard>
        </div>
      </section>

      {/* Setpoints — writes will fail without auth in Phase 3 */}
      <section style={SECTION_STYLE}>
        <h2 style={SECTION_TITLE_STYLE}>RF1 — Setpoints (Phase 3: writes not yet wired)</h2>
        <div style={GRID_STYLE}>
          <WidgetCard label="Acc Fwd Setpoint" assetPath="RF1.Acc_Fwd.setpoint">
            <NumericSet assetPath="RF1.Acc_Fwd.setpoint" label="Acc Fwd SP" />
          </WidgetCard>

          <WidgetCard label="Acc Ref Setpoint" assetPath="RF1.Acc_Ref.setpoint">
            <NumericSet assetPath="RF1.Acc_Ref.setpoint" label="Acc Ref SP" />
          </WidgetCard>
        </div>
      </section>
    </div>
  );
}
