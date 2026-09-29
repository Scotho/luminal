// ── Join Lobby UI Tests ─────────────────────────────────
import { describe, it, expect } from 'vitest';
import { showScreen, _resetForTesting } from '../navigation';

describe('Join Lobby UI', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('#join-lobby-overlay exists', () => {
    const el = document.getElementById('join-lobby-overlay')!;
    expect(el).toBeTruthy();
    expect(el.classList.contains('overlay-screen')).toBe(true);
  });

  it('has LOBBY title', () => {
    expect(document.getElementById('join-lobby-overlay')!.querySelector('h2')!.textContent).toBe('LOBBY');
  });

  it('has status display', () => {
    const status = document.getElementById('join-lobby-status')!;
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('JOINING LOBBY');
  });

  it('has players container', () => {
    expect(document.getElementById('join-lobby-players')).toBeTruthy();
  });

  it('has waiting message', () => {
    const waiting = document.getElementById('join-lobby-waiting')!;
    expect(waiting).toBeTruthy();
    expect(waiting.textContent).toContain('WAITING FOR HOST');
  });

  it('has leave button', () => {
    const btn = document.getElementById('btn-join-lobby-leave')!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('LEAVE');
  });

  it('can be shown via showScreen', () => {
    showScreen('joinLobby');
    expect(document.getElementById('join-lobby-overlay')!.classList.contains('hidden')).toBe(false);
  });
});
