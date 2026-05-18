// Temporary diagnostic for tracking spine fetch lifecycle around preset events.
// Remove this file and all its imports when the gap investigation closes.
let armed = false;
let sessionId = 0;
export function armSpineDiag(): number {
  sessionId++;
  armed = true;
  return sessionId;
}
export function isSpineDiagArmed(): boolean {
  return armed;
}
export function getSpineDiagSession(): number {
  return sessionId;
}
export function disarmSpineDiag(): void {
  armed = false;
}
