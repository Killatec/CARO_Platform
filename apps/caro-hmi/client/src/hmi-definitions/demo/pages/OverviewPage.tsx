/**
 * Demo Overview Page
 *
 * Two RF module boxes displayed side-by-side (responsive).
 * Each box: setpoints → monitors → interlock enable → interlock status
 */
import type { CSSProperties } from 'react';
import { NumericMon, NumericSet, BooleanMon, BooleanSet, AnalogIn } from '@caro/widgets';
import { WidgetErrorBoundary } from '../../../shell/WidgetErrorBoundary.js';
import { ModuleStatusTable } from '../../../components/ModuleStatusTable.js';

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

const MODULES_CONTAINER: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'flex-start',
};

const MODULE_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
};

const MODULE_TITLE: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#1a1a2e',
  marginBottom: 12,
  paddingBottom: 6,
  borderBottom: '2px solid #e5e7eb',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const WIDGET_STACK: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const SECTION_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
  width: 'fit-content',
};

const ANALOG_IN_STACK: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  alignItems: 'flex-start',
};

// ─── Module Status Table Box ─────────────────────────────────────────────────

const MODULE_STATUS_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
  marginBottom: 16,
};

function ModuleStatusBox() {
  return (
    <div style={MODULE_STATUS_BOX}>
      <h2 style={MODULE_TITLE}>Module Status</h2>
      <ModuleStatusTable />
    </div>
  );
}

// ─── HMI Status Box ──────────────────────────────────────────────────────────

const HMI_BOX: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
  marginBottom: 16,
};

function HmiStatusBox() {
  return (
    <div style={HMI_BOX}>
      <h2 style={MODULE_TITLE}>HMI Status</h2>
      <div style={WIDGET_STACK}>
        <WidgetErrorBoundary assetPath="HMI.Module_Count">
          <NumericMon assetPath="HMI.Module_Count" label="Module Count" />
        </WidgetErrorBoundary>
        <WidgetErrorBoundary assetPath="HMI.Tag_Count">
          <NumericMon assetPath="HMI.Tag_Count" label="Tag Count" />
        </WidgetErrorBoundary>
        <WidgetErrorBoundary assetPath="HMI.Telemetry_CPU">
          <NumericMon assetPath="HMI.Telemetry_CPU" label="Telemetry_CPU" />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}

// ─── Channels ────────────────────────────────────────────────────────────────

const CHANNELS = ['Acc_Fwd', 'Acc_Ref', 'Kly_Fwd', 'Kly_Ref'] as const;

function channelLabel(ch: string): string {
  return ch.replace('_', ' ');
}

// ─── RF Module Box ───────────────────────────────────────────────────────────

interface RfModuleBoxProps {
  module: string; // e.g. "RF1", "RF2"
}

function RfModuleBox({ module }: RfModuleBoxProps) {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>{module}</h2>
      <div style={WIDGET_STACK}>
        {/* Setpoints */}
        {CHANNELS.map(ch => (
          <WidgetErrorBoundary key={`${module}.${ch}.sp`} assetPath={`${module}.${ch}.setpoint`}>
            <NumericSet assetPath={`${module}.${ch}.setpoint`} label={`${channelLabel(ch)} SP`} />
          </WidgetErrorBoundary>
        ))}

        {/* Monitors */}
        {CHANNELS.map(ch => (
          <WidgetErrorBoundary key={`${module}.${ch}.mon`} assetPath={`${module}.${ch}.monitor`}>
            <NumericMon assetPath={`${module}.${ch}.monitor`} label={`${channelLabel(ch)}`} />
          </WidgetErrorBoundary>
        ))}

        {/* Interlock Enable (BooleanSet) */}
        {CHANNELS.map(ch => (
          <WidgetErrorBoundary key={`${module}.${ch}.ie`} assetPath={`${module}.${ch}.interlock_enable`}>
            <BooleanSet assetPath={`${module}.${ch}.interlock_enable`} label={`${channelLabel(ch)} Intlk En`} />
          </WidgetErrorBoundary>
        ))}

        {/* Interlock Status (BooleanMon) */}
        {CHANNELS.map(ch => (
          <WidgetErrorBoundary key={`${module}.${ch}.is`} assetPath={`${module}.${ch}.interlock_status`}>
            <BooleanMon assetPath={`${module}.${ch}.interlock_status`} label={`${channelLabel(ch)} Intlk`} />
          </WidgetErrorBoundary>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function OverviewPage() {
  return (
    <div style={PAGE_STYLE}>
      <h1 style={HEADING_STYLE}>System Overview — Live Telemetry</h1>
      <div style={MODULES_CONTAINER}>
        <div style={{ flexBasis: '100%', display: 'flex' }}>
          <HmiStatusBox />
        </div>
        <div style={{ flexBasis: '100%', display: 'flex' }}>
          <ModuleStatusBox />
        </div>
        {(['RF1', 'RF2'] as const).map(m => (
          <RfModuleBox key={m} module={m} />
        ))}

        {/* Analog Inputs — stacked alignment demo */}
        <div>
          <div style={SECTION_BOX}>
            <h2 style={MODULE_TITLE}>Analog Inputs</h2>
            <div style={ANALOG_IN_STACK}>
              <WidgetErrorBoundary assetPath="RF1.PRF">
                <AnalogIn assetPath="RF1.PRF" label="PRF" showHeader={true} />
              </WidgetErrorBoundary>
              <WidgetErrorBoundary assetPath="RF2.PRF">
                <AnalogIn assetPath="RF2.PRF" label="PRF" />
              </WidgetErrorBoundary>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
