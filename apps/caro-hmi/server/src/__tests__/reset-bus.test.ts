import { describe, it, expect, vi } from 'vitest';
import { ResetBus } from '../reset-bus.js';

describe('ResetBus', () => {
  it('resetAll calls all registered handlers', () => {
    const bus = new ResetBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.register('a', handlerA);
    bus.register('b', handlerB);

    bus.resetAll();

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it('resetAll returns names of handlers called', () => {
    const bus = new ResetBus();
    bus.register('watchdog', vi.fn());
    bus.register('alerts', vi.fn());

    const names = bus.resetAll();

    expect(names).toEqual(['watchdog', 'alerts']);
  });

  it('unregister removes handler', () => {
    const bus = new ResetBus();
    const handler = vi.fn();
    bus.register('watchdog', handler);
    bus.unregister('watchdog');

    bus.resetAll();

    expect(handler).not.toHaveBeenCalled();
  });

  it('resetAll with no handlers returns empty array', () => {
    const bus = new ResetBus();

    const names = bus.resetAll();

    expect(names).toEqual([]);
  });
});
