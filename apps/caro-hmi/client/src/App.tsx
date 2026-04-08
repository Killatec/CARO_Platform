import { HmiContextProvider } from '@caro/hmi-context';
import { Shell } from './shell/Shell.js';

export function App() {
  return (
    <HmiContextProvider apiUrl="/api/v1" wsUrl={`ws://${window.location.host}/ws`}>
      <Shell />
    </HmiContextProvider>
  );
}
