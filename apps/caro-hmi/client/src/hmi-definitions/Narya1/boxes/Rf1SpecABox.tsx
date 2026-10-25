import type { CSSProperties } from 'react';
import { NumericMon, NumericSet, BooleanMon, BooleanSet, SpecAChart } from '@caro/widgets';
import { MODULE_BOX, WIDGET_STACK } from '../../shared/index.js';
import { Rf1InterlockBox } from './Rf1InterlockBox.js';

const COLUMN_HEADER: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#1a1a2e',
  marginBottom: 6,
};

const ROW: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  columnGap: 80,
  rowGap: 16,
  alignItems: 'flex-start',
};

/**
 * Laid out like the legacy RF1_SpecA page: Sets / Band-Config /
 * Peak-Performance columns, the frequency-mapped chart across the full width,
 * then the spectrum-interlock settings beside the Spec_Intk interlock.
 * Spec_Start, Spec_Bin, Spec_Trace_Ok and Spec_Intk_{Band,Level,Freq}_Mon have
 * no field of their own — SpecAChart consumes them.
 */
export function Rf1SpecABox() {
  return (
    <div style={{ ...MODULE_BOX, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={ROW}>
        <div style={WIDGET_STACK}>
          <div style={COLUMN_HEADER}>Sets</div>
          <BooleanSet assetPath="RF1.SpecA.Enable" label="Enable" />
          <BooleanSet assetPath="RF1.SpecA.FFT_Enable" label="FFT Enable" />
          <BooleanSet assetPath="RF1.SpecA.Spectrum_En" label="Spectrum En" />
          <NumericSet assetPath="RF1.SpecA.Center_Freq" label="Center Freq Set" />
          <NumericSet assetPath="RF1.SpecA.Window.Set" label="Window Set" />
          <NumericSet assetPath="RF1.SpecA.FFT_Size" label="FFT Size Set" />
          <NumericSet assetPath="RF1.SpecA.Rate.Set" label="Rate Set" />
          <NumericSet assetPath="RF1.SpecA.RX_Gain" label="RX Gain Set" />
          <NumericSet assetPath="RF1.SpecA.Averages" label="Averages Set" />
        </div>
        <div style={WIDGET_STACK}>
          <div style={COLUMN_HEADER}>Band / Config</div>
          <NumericMon assetPath="RF1.SpecA.State" label="State" />
          <BooleanMon assetPath="RF1.SpecA.Connected" label="Connected" />
          <NumericMon assetPath="RF1.SpecA.Errors" label="Errors" />
          <NumericMon assetPath="RF1.SpecA.Window.Mon" label="Window Mon" />
          <NumericMon assetPath="RF1.SpecA.LO" label="LO" />
          <NumericMon assetPath="RF1.SpecA.Sample_Rate" label="Sample Rate" />
          <NumericMon assetPath="RF1.SpecA.Bin_Size" label="Bin Size" />
          <NumericMon assetPath="RF1.SpecA.FFT_Size_Mon" label="FFT Size Mon" />
        </div>
        <div style={WIDGET_STACK}>
          <div style={COLUMN_HEADER}>Peak / Performance</div>
          <BooleanMon assetPath="RF1.SpecA.Peak_Valid" label="Peak Valid" />
          <NumericMon assetPath="RF1.SpecA.Peak_Freq" label="Peak Freq" />
          <NumericMon assetPath="RF1.SpecA.Peak_Power" label="Peak Power" />
          <NumericMon assetPath="RF1.SpecA.Noise_Floor" label="Noise Floor" />
          <NumericMon assetPath="RF1.SpecA.CNR" label="CNR" />
          <NumericMon assetPath="RF1.SpecA.Rate.Mon" label="Rate Mon" />
          <NumericMon assetPath="RF1.SpecA.Throughput" label="Throughput" />
          <NumericMon assetPath="RF1.SpecA.Capture_T" label="Capture T" />
          <NumericMon assetPath="RF1.SpecA.Process_T" label="Process T" />
          <NumericMon assetPath="RF1.SpecA.Pipe_Duty" label="Pipe Duty" />
          <NumericMon assetPath="RF1.SpecA.CPU" label="CPU" />
          <NumericMon assetPath="RF1.SpecA.Bytes" label="Bytes" />
          <NumericMon assetPath="RF1.SpecA.Reset_Count" label="Reset Count" />
        </div>
      </div>
      <SpecAChart assetPath="RF1.SpecA" label="Spectrum" />
      <div style={ROW}>
        <div style={WIDGET_STACK}>
          <NumericSet assetPath="RF1.SpecA.Spec_Intk_Band_Set" label="Spec Intk Band Set" />
          <NumericSet assetPath="RF1.SpecA.Spec_Intk_Level_Set" label="Spec Intk Level Set" />
          <NumericSet assetPath="RF1.Dig_Intks.Spec_Intk_Delay_Set" label="Spec Intk Delay Set" />
          <NumericMon assetPath="RF1.Dig_Intks.Spec_Intk_Delay_Mon" label="Spec Intk Delay Mon" />
        </div>
        <Rf1InterlockBox path="Spec_Intk" label="Spec Intk" />
      </div>
    </div>
  );
}
