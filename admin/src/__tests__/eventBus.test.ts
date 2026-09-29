import { describe, it, expect, vi } from 'vitest';
import { bus } from '../ui/eventBus';

describe('EventBus', () => {
  it('delivers payload to subscribers', () => {
    const cb = vi.fn();
    bus.on('task:done', cb);
    bus.emit('task:done', { id: '1', tag: 'test', prompt: 'hello' });
    expect(cb).toHaveBeenCalledWith({ id: '1', tag: 'test', prompt: 'hello' });
    bus.off('task:done', cb);
  });

  it('supports multiple listeners on the same event', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bus.on('bug:new', cb1);
    bus.on('bug:new', cb2);
    bus.emit('bug:new', { id: '1', error: 'err', username: 'u' });
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
    bus.off('bug:new', cb1);
    bus.off('bug:new', cb2);
  });

  it('does not call removed listeners', () => {
    const cb = vi.fn();
    bus.on('cc:done', cb);
    bus.off('cc:done', cb);
    bus.emit('cc:done', { label: 'test', exitCode: 0 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not throw when emitting with no listeners', () => {
    expect(() => bus.emit('task:done', { id: '1', tag: 't', prompt: 'p' })).not.toThrow();
  });

  it('isolates events — listeners only receive their event type', () => {
    const taskCb = vi.fn();
    const bugCb = vi.fn();
    bus.on('task:done', taskCb);
    bus.on('bug:new', bugCb);
    bus.emit('task:done', { id: '1', tag: 't', prompt: 'p' });
    expect(taskCb).toHaveBeenCalledOnce();
    expect(bugCb).not.toHaveBeenCalled();
    bus.off('task:done', taskCb);
    bus.off('bug:new', bugCb);
  });
});
