import { BooleanMon, NumericMon } from '@caro/widgets';
import { STATUS_BOX, MODULE_TITLE, WIDGET_STACK } from './styles.js';

export function TrendStatusBox() {
  return (
    <div style={STATUS_BOX}>
      <h2 style={MODULE_TITLE}>Trend Status</h2>
      <div style={WIDGET_STACK}>
        <BooleanMon assetPath="HMI.Trend_Info.Trending"    label="Trending" />
        <NumericMon assetPath="HMI.Trend_Info.Queue_Depth" label="Queue_Depth" />
        <NumericMon assetPath="HMI.Trend_Info.Rows_Per_Sec" label="Rows_Per_Sec" />
        <NumericMon assetPath="HMI.Trend_Info.Flush_ms"    label="Flush_ms" />
        <NumericMon assetPath="HMI.Trend_Info.Dropped_Pkgs" label="Dropped_Pkgs" />
        <NumericMon assetPath="HMI.Trend_Info.Error_Count" label="Error_Count" />
        <NumericMon assetPath="HMI.Trend_Info.DB_Size"    label="DB_Size" />
      </div>
    </div>
  );
}
