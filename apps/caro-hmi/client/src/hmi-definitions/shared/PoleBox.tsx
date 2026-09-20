import { NumericMon, NumericSet, BooleanMon, BooleanSet } from '@caro/widgets';
import { Button } from '@caro/ui';
import { useCommandSender } from '@caro/hmi-context';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from './styles.js';

const MODULE_ID = 'Pole';

function CommandButton({ cmd, label }: { cmd: string; label: string }) {
  const { send, isPending, error } = useCommandSender();
  return (
    <Button
      variant={error(MODULE_ID, cmd) ? 'danger' : 'secondary'}
      disabled={isPending(MODULE_ID, cmd)}
      onClick={() => void send(MODULE_ID, cmd)}
    >
      {error(MODULE_ID, cmd) ?? label}
    </Button>
  );
}

export function PoleBox() {
  return (
    <>
      {/* App */}
      <div style={MODULE_BOX}>
        <h2 style={MODULE_TITLE}>App</h2>
        <div style={{ ...WIDGET_STACK, marginBottom: 12 }}>
          <BooleanSet assetPath="Pole.Py_Enable"    label="Py Enable" />
          <BooleanMon assetPath="Pole.Py_Connected" label="Py Connected" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <CommandButton cmd="Stop_App" label="Stop App" />
        </div>
      </div>

      {/* Speed */}
      <div style={MODULE_BOX}>
        <h2 style={MODULE_TITLE}>Speed</h2>
        <div style={WIDGET_STACK}>
          <NumericSet assetPath="Pole.Speed_Max" label="Speed Max" />
          <NumericSet assetPath="Pole.Accel_Max" label="Accel Max" />
          <NumericMon assetPath="Pole.Speed_Mon" label="Speed Mon" />
          <BooleanSet assetPath="Pole.Motor_En"  label="Motor En" />
          <BooleanSet assetPath="Pole.Motor_Dir" label="Motor Dir" />
          <BooleanMon assetPath="Pole.Aux_SW_1"  label="Aux SW 1" />
          <BooleanMon assetPath="Pole.Aux_SW_2"  label="Aux SW 2" />
          <BooleanMon assetPath="Pole.End_SW_1"  label="End SW 1" />
          <BooleanMon assetPath="Pole.End_SW_2"  label="End SW 2" />
        </div>
      </div>

      {/* Position */}
      <div style={MODULE_BOX}>
        <h2 style={MODULE_TITLE}>Position</h2>
        <div style={WIDGET_STACK}>
          <NumericMon assetPath="Pole.Position_Raw" label="Position Raw" />
          <NumericSet assetPath="Pole.Pos_Scale"    label="Pos Scale" />
          <NumericSet assetPath="Pole.Pos_Offset"   label="Pos Offset" />
          <NumericMon assetPath="Pole.Position"     label="Position" />
        </div>
      </div>

      {/* Angle */}
      <div style={MODULE_BOX}>
        <h2 style={MODULE_TITLE}>Angle</h2>
        <div style={WIDGET_STACK}>
          <NumericMon assetPath="Pole.Angle_Raw"    label="Angle Raw" />
          <NumericSet assetPath="Pole.Angle_Offset" label="Angle Offset" />
          <NumericMon assetPath="Pole.Angle_Mon"    label="Angle Mon" />
        </div>
      </div>

      {/* Tests */}
      <div style={MODULE_BOX}>
        <h2 style={MODULE_TITLE}>Tests</h2>
        <div style={{ ...WIDGET_STACK, marginBottom: 12 }}>
          <NumericSet assetPath="Pole.Pos_1" label="Pos 1" />
          <NumericSet assetPath="Pole.Pos_2" label="Pos 2" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <CommandButton cmd="Home"       label="Home" />
          <CommandButton cmd="Go_to_Pos_1" label="Go to Pos 1" />
          <CommandButton cmd="Go_to_Pos_2" label="Go to Pos 2" />
        </div>
      </div>

      {/* CPU Mon */}
      <div style={MODULE_BOX}>
        <h2 style={MODULE_TITLE}>CPU Mon</h2>
        <div style={WIDGET_STACK}>
          <NumericMon assetPath="Pole.CPU_Duty"      label="CPU_Duty" />
          <NumericMon assetPath="Pole.CPU_Duty_0"    label="CPU_Duty_0" />
          <NumericMon assetPath="Pole.CPU_Duty_1"    label="CPU_Duty_1" />
          <NumericMon assetPath="Pole.Pole_CPU"      label="Pole_CPU" />
        </div>
      </div>


    </>
  );
}
