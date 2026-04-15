type ResetHandler = () => void;

export class ResetBus {
  private handlers: Map<string, ResetHandler> = new Map();

  /** Register a named reset handler. Name is for logging/debugging. */
  register(name: string, handler: ResetHandler): void {
    this.handlers.set(name, handler);
  }

  /** Unregister by name. */
  unregister(name: string): void {
    this.handlers.delete(name);
  }

  /** Fire all registered handlers. Returns list of names that were called. */
  resetAll(): string[] {
    const names: string[] = [];
    for (const [name, handler] of this.handlers) {
      handler();
      names.push(name);
    }
    return names;
  }
}
