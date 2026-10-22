import { NumericMon, NumericSet, BooleanMon, BooleanSet, SpectrumChart } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

/**
 * The reference UI plots the spectrum on an MHz X-axis derived from
 * Center_Freq/LO/Bin_Size. @caro/widgets' SpectrumChart is bin-index-only by
 * design (no frequency mapping) — used here as an interim approximation
 * pending a frequency-mapped variant (see Docs/platform/platform_todo.md).
 */
export function Rf1SpecABox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Spec A</h2>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={WIDGET_STACK}>
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
          <NumericMon assetPath="RF1.SpecA.State" label="State" />
          <BooleanMon assetPath="RF1.SpecA.Connected" label="Connected" />
          <NumericMon assetPath="RF1.SpecA.Window.Mon" label="Window Mon" />
          <NumericMon assetPath="RF1.SpecA.LO" label="LO" />
          <NumericMon assetPath="RF1.SpecA.Sample_Rate" label="Sample Rate" />
          <NumericMon assetPath="RF1.SpecA.Bin_Size" label="Bin Size" />
          <NumericMon assetPath="RF1.SpecA.FFT_Size_Mon" label="FFT Size Mon" />
        </div>
        <div style={WIDGET_STACK}>
          <BooleanMon assetPath="RF1.SpecA.Peak_Valid" label="Peak Valid" />
          <NumericMon assetPath="RF1.SpecA.Peak_Freq" label="Peak Freq" />
          <NumericMon assetPath="RF1.SpecA.Peak_Power" label="Peak Power" />
          <NumericMon assetPath="RF1.SpecA.Noise_Floor" label="Noise Floor" />
          <NumericMon assetPath="RF1.SpecA.CNR" label="CNR" />
          <NumericMon assetPath="RF1.SpecA.Spec_Start" label="Spec Start" />
          <NumericMon assetPath="RF1.SpecA.Spec_Bin" label="Spec Bin" />
          <NumericMon assetPath="RF1.SpecA.Spec_Intk_Freq_Mon" label="Spec Intk Freq" />
          <BooleanMon assetPath="RF1.SpecA.Spec_Trace_Ok" label="Spec Trace Ok" />
          <NumericMon assetPath="RF1.SpecA.Bytes" label="Bytes" />
          <NumericMon assetPath="RF1.SpecA.Errors" label="Errors" />
          <NumericMon assetPath="RF1.SpecA.Reset_Count" label="Reset Count" />
          <NumericMon assetPath="RF1.SpecA.Rate.Mon" label="Rate Mon" />
          <NumericMon assetPath="RF1.SpecA.Throughput" label="Throughput" />
          <NumericMon assetPath="RF1.SpecA.Capture_T" label="Capture T" />
          <NumericMon assetPath="RF1.SpecA.Process_T" label="Process T" />
          <NumericMon assetPath="RF1.SpecA.Pipe_Duty" label="Pipe Duty" />
          <NumericMon assetPath="RF1.SpecA.CPU" label="CPU" />
        </div>
        <SpectrumChart assetPath="RF1.SpecA.Spectrum" label="Spectrum" yMin={-140} yMax={0} />
      </div>
      <div style={{ ...WIDGET_STACK, marginTop: 16 }}>
        <NumericSet assetPath="RF1.SpecA.Spec_Intk_Band_Set" label="Spec Intk Band Set" />
        <NumericMon assetPath="RF1.SpecA.Spec_Intk_Band_Mon" label="Spec Intk Band Mon" />
        <NumericSet assetPath="RF1.SpecA.Spec_Intk_Level_Set" label="Spec Intk Level Set" />
        <NumericMon assetPath="RF1.SpecA.Spec_Intk_Level_Mon" label="Spec Intk Level Mon" />
        <NumericSet assetPath="RF1.Dig_Intks.Spec_Intk_Delay_Set" label="Spec Intk Delay Set" />
        <NumericMon assetPath="RF1.Dig_Intks.Spec_Intk_Delay_Mon" label="Spec Intk Delay Mon" />
      </div>
    </div>
  );
}
