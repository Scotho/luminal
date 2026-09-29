import { bus } from './eventBus';

export interface ActivityEvent {
  id: string;
  type: 'agent' | 'task' | 'test' | 'session' | 'system';
  icon: string;
  text: string;
  detail?: string;
  ts: number;
}

const MAX_EVENTS = 100;
const _events: ActivityEvent[] = [];
const _listeners: Set<() => void> = new Set();

function push(event: Omit<ActivityEvent, 'id' | 'ts'>): void {
  _events.unshift({
    ...event,
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
  });
  if (_events.length > MAX_EVENTS) _events.length = MAX_EVENTS;
  for (const cb of _listeners) cb();
}

export function getEvents(): ActivityEvent[] { return _events; }

export function onUpdate(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Subscribe to bus events and funnel them into the activity feed. */
export function initActivityFeed(): void {
  bus.on('cc:done', (data) => {
    const status = data.exitCode === 0 ? 'completed' : 'failed';
    push({ type: 'agent', icon: '&#9881;', text: `Agent "${data.label}" ${status}` });
  });

  bus.on('task:done', (data) => {
    push({ type: 'task', icon: '&#9745;', text: `Task "${data.tag}" completed`, detail: data.prompt });
  });

  bus.on('bug:new', (data) => {
    push({ type: 'system', icon: '&#9888;', text: `Bug reported by ${data.username}`, detail: data.error });
  });
}
