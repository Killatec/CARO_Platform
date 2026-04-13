export class DutyTracker {
  private busyMs: number = 0;

  track<T>(fn: () => T): T {
    const t0 = performance.now();
    const result = fn();
    this.busyMs += performance.now() - t0;
    return result;
  }

  snapshot(intervalMs: number): number {
    const duty = (this.busyMs / intervalMs) * 100;
    this.busyMs = 0;
    return duty;
  }
}
