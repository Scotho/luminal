import { describe, it, expect } from 'vitest';
import { ScriptedInputDriver } from './scriptedInputDriver';
import { createSimState } from '../../core/simulation';
import type { InputFrame } from '../../core/simulation';

describe('ScriptedInputDriver', () => {
  const dummyState = createSimState(0, [{ x: 0, z: 0, angle: 0, baseSpeed: 40 }]);

  it('returns scripted input at matching tick', () => {
    const script: Array<{ tick: number; input: Partial<InputFrame> }> = [
      { tick: 5, input: { turnDir: 1 } },
      { tick: 10, input: { turnDir: -1, dash: true } },
    ];
    const driver = new ScriptedInputDriver(script);

    const at5 = driver.getInput(5, dummyState, 0);
    expect(at5.turnDir).toBe(1);
    expect(at5.accelerate).toBe(false);

    const at10 = driver.getInput(10, dummyState, 0);
    expect(at10.turnDir).toBe(-1);
    expect(at10.dash).toBe(true);
  });

  it('returns neutral input for unscripted ticks', () => {
    const driver = new ScriptedInputDriver([{ tick: 5, input: { turnDir: 1 } }]);
    const at3 = driver.getInput(3, dummyState, 0);
    expect(at3.turnDir).toBe(0);
    expect(at3.accelerate).toBe(false);
    expect(at3.dash).toBe(false);
    expect(at3.brake).toBe(false);
  });

  it('holds last scripted input until next scripted tick', () => {
    const script = [
      { tick: 5, input: { turnDir: 1 } },
      { tick: 20, input: { turnDir: -1 } },
    ];
    const driver = new ScriptedInputDriver(script);
    const at12 = driver.getInput(12, dummyState, 0);
    expect(at12.turnDir).toBe(1); // holds tick-5 input
  });

  it('reports done after last scripted tick + hold duration', () => {
    const script = [{ tick: 5, input: { turnDir: 1 } }];
    const driver = new ScriptedInputDriver(script, 60); // hold for 60 ticks after last
    expect(driver.isDone(5)).toBe(false);
    expect(driver.isDone(64)).toBe(false);
    expect(driver.isDone(66)).toBe(true);
  });
});
