// ── Loading Screen Tests ────────────────────────────────
import { describe, it, expect } from 'vitest';

describe('Loading Screen', () => {
  it('#loading-screen exists', () => {
    expect(document.getElementById('loading-screen')).toBeTruthy();
  });

  it('has LUMINAL logo', () => {
    const logo = document.getElementById('loading-screen')!.querySelector('.game-logo');
    expect(logo).toBeTruthy();
    expect(logo!.getAttribute('alt')).toBe('LUMINAL.live');
  });

  it('has loading status text', () => {
    const status = document.getElementById('loading-status')!;
    expect(status).toBeTruthy();
    expect(status.textContent).toBe('LOADING');
  });

  it('has click prompt with canvas', () => {
    const prompt = document.getElementById('click-prompt')!;
    expect(prompt).toBeTruthy();
    expect(prompt.querySelector('canvas')).toBeTruthy();
  });

  it('has version number', () => {
    const version = document.getElementById('version-loading')!;
    expect(version).toBeTruthy();
    expect(version.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('loading status text can be updated', () => {
    const status = document.getElementById('loading-status')!;
    status.textContent = 'LOADING MODELS';
    expect(status.textContent).toBe('LOADING MODELS');
    // Reset
    status.textContent = 'LOADING';
  });
});
