import { ModuleStatusTable } from '../../components/ModuleStatusTable.js';
import { STATUS_BOX, MODULE_TITLE } from './styles.js';

export function ModuleStatusBox() {
  return (
    <div style={STATUS_BOX}>
      <h2 style={MODULE_TITLE}>Module Status</h2>
      <ModuleStatusTable />
    </div>
  );
}
