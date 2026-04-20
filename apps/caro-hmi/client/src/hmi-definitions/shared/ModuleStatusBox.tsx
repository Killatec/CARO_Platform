import { ModuleInfoTable } from '../../components/ModuleInfoTable.js';
import { STATUS_BOX, MODULE_TITLE } from './styles.js';

export function ModuleStatusBox() {
  return (
    <div style={STATUS_BOX}>
      <h2 style={MODULE_TITLE}>Module Status</h2>
      <ModuleInfoTable />
    </div>
  );
}
