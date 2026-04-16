import { NumericMon, NumericSet, BooleanMon, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from './styles.js';

const CHANNELS = ['Acc_Fwd', 'Acc_Ref', 'Kly_Fwd', 'Kly_Ref'] as const;

function channelLabel(ch: string): string {
  return ch.replace('_', ' ');
}

export interface RfModuleBoxProps {
  module: string; // e.g. "RF1", "RF2"
}

export function RfModuleBox({ module }: RfModuleBoxProps) {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>{module}</h2>
      <div style={WIDGET_STACK}>
        {/* Reset Count */}
        <NumericMon assetPath={`${module}.Reset_Count`} label="Reset Count" />

        {/* Setpoints */}
        {CHANNELS.map(ch => (
          <NumericSet key={`${module}.${ch}.sp`} assetPath={`${module}.${ch}.setpoint`} label={`${channelLabel(ch)} SP`} />
        ))}

        {/* Monitors */}
        {CHANNELS.map(ch => (
          <NumericMon key={`${module}.${ch}.mon`} assetPath={`${module}.${ch}.monitor`} label={`${channelLabel(ch)}`} />
        ))}

        {/* Interlock Enable (BooleanSet) */}
        {CHANNELS.map(ch => (
          <BooleanSet key={`${module}.${ch}.ie`} assetPath={`${module}.${ch}.interlock_enable`} label={`${channelLabel(ch)} Intlk En`} />
        ))}

        {/* Interlock Status (BooleanMon) */}
        {CHANNELS.map(ch => (
          <BooleanMon key={`${module}.${ch}.is`} assetPath={`${module}.${ch}.interlock_status`} label={`${channelLabel(ch)} Intlk`} />
        ))}
      </div>
    </div>
  );
}
