import { NumericSet, BooleanSet } from '@caro/widgets';
import { MODULE_BOX, MODULE_TITLE, WIDGET_STACK } from '../../shared/index.js';

/**
 * An_Display_1/2 and Dig_Display_1/2 are plain Int16 setpoints in the
 * registry and render as raw numbers here. The reference UI shows them as
 * resolved text labels (e.g. "Phase_Set") — that label-lookup rendering
 * needs a new widget, tracked in Docs/platform_todo.md.
 */
export function Rf1DisplayBox() {
  return (
    <div style={MODULE_BOX}>
      <h2 style={MODULE_TITLE}>RF1 Display</h2>
      <div style={WIDGET_STACK}>
        <NumericSet assetPath="RF1.Display.An_Display_1" label="An Display 1" />
        <NumericSet assetPath="RF1.Display.An_Display_2" label="An Display 2" />
        <NumericSet assetPath="RF1.Display.Dig_Display_1" label="Dig Display 1" />
        <NumericSet assetPath="RF1.Display.Dig_Display_2" label="Dig Display 2" />
        <NumericSet assetPath="RF1.Display.Display_1_Offset" label="Display 1 Offset" />
        <NumericSet assetPath="RF1.Display.Display_2_Offset" label="Display 2 Offset" />
        <BooleanSet assetPath="RF1.Display.GPIO033_Clk_En" label="GPIO033 Clk En" />
        <BooleanSet assetPath="RF1.Display.GPIO033_Value" label="GPIO033 Value" />
      </div>
    </div>
  );
}
