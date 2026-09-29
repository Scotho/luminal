// ── Typed Event Bus ──────────────────────────────────────────────────────────

export interface EventMap {
  'task:done': { id: string; tag: string; prompt: string };
  'bug:new':  { id: string; error: string; username: string };
  'cc:done':  { label: string; exitCode: number | null };
  'cc:stalled': { label: string; idleSeconds: number };
}

export type EventName = keyof EventMap;
type Listener<K extends EventName> = (payload: EventMap[K]) => void;

class EventBus {
  private _listeners = new Map<EventName, Set<Listener<never>>>();

  on<K extends EventName>(event: K, cb: Listener<K>): void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(cb as Listener<never>);
  }

  off<K extends EventName>(event: K, cb: Listener<K>): void {
    this._listeners.get(event)?.delete(cb as Listener<never>);
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    for (const cb of listeners) (cb as Listener<K>)(payload);
  }
}

/** Singleton event bus for admin dashboard notifications. */
export const bus = new EventBus();
