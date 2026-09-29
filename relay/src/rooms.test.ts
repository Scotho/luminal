import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from './rooms.js';

function mockSocket(id: string) {
  const sent: string[] = [];
  return { id, send: (data: string) => sent.push(data), sentMessages: sent };
}

describe('RoomManager', () => {
  let rooms: RoomManager;
  beforeEach(() => { rooms = new RoomManager(); });

  it('joins and tracks room size', () => {
    rooms.join('m1', 'u1', mockSocket('s1') as any);
    expect(rooms.getRoomSize('m1')).toBe(1);
  });

  it('tracks multiple sockets in one room', () => {
    rooms.join('m1', 'u1', mockSocket('s1') as any);
    rooms.join('m1', 'u2', mockSocket('s2') as any);
    expect(rooms.getRoomSize('m1')).toBe(2);
  });

  it('relays to others in same room only', () => {
    const s1 = mockSocket('s1');
    const s2 = mockSocket('s2');
    const s3 = mockSocket('s3');
    rooms.join('m1', 'u1', s1 as any);
    rooms.join('m1', 'u2', s2 as any);
    rooms.join('m2', 'u3', s3 as any);

    rooms.relay('m1', 'u1', { kind: 'inputs', payload: [] });

    expect(s2.sentMessages).toHaveLength(1);
    expect(JSON.parse(s2.sentMessages[0]).fromUid).toBe('u1');
    expect(s1.sentMessages).toHaveLength(0);
    expect(s3.sentMessages).toHaveLength(0);
  });

  it('cleans up on leave', () => {
    const s1 = mockSocket('s1');
    rooms.join('m1', 'u1', s1 as any);
    rooms.leave(s1 as any);
    expect(rooms.getRoomSize('m1')).toBe(0);
    expect(rooms.roomCount).toBe(0);
  });

  it('handles reconnect (same uid replaces socket)', () => {
    const s1 = mockSocket('s1');
    const s2 = mockSocket('s2');
    rooms.join('m1', 'u1', s1 as any);
    rooms.join('m1', 'u1', s2 as any);
    expect(rooms.getRoomSize('m1')).toBe(1);
  });
});
