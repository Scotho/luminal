import { describe, it, expect } from 'vitest';
import { RingBuffer, computePercentiles } from './telemetry';

describe('RingBuffer', () => {
  it('tracks length correctly', () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.length).toBe(0);
    rb.push(1);
    rb.push(2);
    expect(rb.length).toBe(2);
  });

  it('returns elements in insertion order via toArray', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(10);
    rb.push(20);
    rb.push(30);
    expect(rb.toArray()).toEqual([10, 20, 30]);
  });

  it('wraps around when full', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // overwrites 1
    expect(rb.length).toBe(3);
    expect(rb.toArray()).toEqual([2, 3, 4]);
  });

  it('reduce works before full', () => {
    const rb = new RingBuffer<number>(10);
    rb.push(5);
    rb.push(10);
    rb.push(15);
    const sum = rb.reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(30);
  });

  it('reduce works after wrap-around', () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) rb.push(i);
    // Should contain [3, 4, 5]
    const sum = rb.reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(12);
  });

  it('clear resets state', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it('works with computePercentiles', () => {
    const rb = new RingBuffer<number>(100);
    for (let i = 1; i <= 100; i++) rb.push(i);
    const pct = computePercentiles(rb);
    expect(pct.p50).toBeCloseTo(50.5, 0);
    expect(pct.p95).toBeGreaterThan(90);
    expect(pct.p99).toBeGreaterThan(95);
  });
});
