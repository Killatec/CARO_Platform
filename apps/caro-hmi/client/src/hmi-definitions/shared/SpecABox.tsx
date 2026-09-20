import { NumericMon, NumericSet, BooleanMon, BooleanSet, SpectrumChart } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from './styles.js';

export function SpecABox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>Spec A</h2>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
        <div style={WIDGET_STACK}>
          <BooleanSet assetPath="Pole.SpecA.Enable"       label="Enable" />
          <BooleanSet assetPath="Pole.SpecA.FFT_Enable"   label="FFT Enable" />
          <BooleanSet assetPath="Pole.SpecA.Spectrum_En"  label="Spectrum En" />
          
          <NumericSet assetPath="Pole.SpecA.FFT_Size"     label="FFT Size" />
          <NumericSet assetPath="Pole.SpecA.Center_Freq"  label="Center Freq" />
          <NumericSet assetPath="Pole.SpecA.Window.Set"   label="Window Set" />
          <NumericMon assetPath="Pole.SpecA.Window.Mon"   label="Window Mon" />
          <NumericSet assetPath="Pole.SpecA.RX_Gain"      label="RX Gain" />
          <NumericSet assetPath="Pole.SpecA.Averages"     label="Averages" />
          <NumericSet assetPath="Pole.SpecA.Rate.Set"     label="Rate Set" />
          <NumericMon assetPath="Pole.SpecA.Rate.Mon"     label="Rate Mon" />
          <NumericMon assetPath="Pole.SpecA.State"        label="State" />
          <BooleanMon assetPath="Pole.SpecA.Connected"    label="Connected" />
          <NumericMon assetPath="Pole.SpecA.Bin_Size"     label="Bin Size" />
          <NumericMon assetPath="Pole.SpecA.Errors"       label="Errors" />
          <NumericMon assetPath="Pole.SpecA.Throughput"   label="Throughput" />
          <NumericMon assetPath="Pole.SpecA.Capture_T"    label="Capture T" />
          <NumericMon assetPath="Pole.SpecA.Process_T"    label="Process T" />
          <NumericMon assetPath="Pole.SpecA.Pipe_Duty"    label="Pipe Duty" />
          <NumericMon assetPath="Pole.SpecA.Bytes"        label="Bytes" />
          <NumericMon assetPath="Pole.SpecA.Sample_Rate"  label="Sample Rate" />
          <NumericMon assetPath="Pole.SpecA.Peak_Freq"    label="Peak Freq" />
          <NumericMon assetPath="Pole.SpecA.Peak_Power"   label="Peak Power" />
          <NumericMon assetPath="Pole.SpecA.Noise_Floor"  label="Noise Floor" />
          <NumericMon assetPath="Pole.SpecA.CNR"          label="CNR" />
        </div>
        <SpectrumChart assetPath="Pole.SpecA.Spectrum" label="Spectrum" yMax={2100} />
      </div>
    </div>
  );
}
