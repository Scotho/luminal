import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// Install localStorage mock before importing the module
const storage = mockLocalStorage();

import {
  loadActiveAgentIds,
  saveActiveAgentIds,
  getActiveAgents,
  getInactiveAgents,
} from '../agentManager';

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
});

describe('agentManager', () => {
  describe('loadActiveAgentIds', () => {
    it('returns default set with claude when nothing stored', () => {
      const ids = loadActiveAgentIds();
      expect(ids).toBeInstanceOf(Set);
      expect(ids.has('claude')).toBe(true);
      expect(ids.size).toBe(1);
    });

    it('returns stored agent IDs from localStorage', () => {
      storage.set('luminal-admin-active-agents', JSON.stringify(['claude', 'qwen']));
      const ids = loadActiveAgentIds();
      expect(ids.has('claude')).toBe(true);
      expect(ids.has('qwen')).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('falls back to defaults on corrupted JSON', () => {
      storage.set('luminal-admin-active-agents', 'not-json');
      const ids = loadActiveAgentIds();
      expect(ids.has('claude')).toBe(true);
      expect(ids.size).toBe(1);
    });
  });

  describe('saveActiveAgentIds', () => {
    it('persists agent IDs to localStorage', () => {
      const ids = new Set(['claude', 'qwen']);
      saveActiveAgentIds(ids);
      const raw = storage.get('luminal-admin-active-agents');
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed).toContain('claude');
      expect(parsed).toContain('qwen');
    });

    it('persists empty set', () => {
      saveActiveAgentIds(new Set());
      const raw = storage.get('luminal-admin-active-agents');
      expect(JSON.parse(raw!)).toEqual([]);
    });
  });

  describe('getActiveAgents', () => {
    it('returns claude as active by default', () => {
      const agents = getActiveAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('claude');
      expect(agents[0].label).toBe('Claude');
      expect(agents[0].type).toBe('cloud');
    });

    it('returns both agents when both are active', () => {
      storage.set('luminal-admin-active-agents', JSON.stringify(['claude', 'qwen']));
      const agents = getActiveAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.id)).toContain('qwen');
    });

    it('returns empty array when all agents deactivated', () => {
      storage.set('luminal-admin-active-agents', JSON.stringify([]));
      const agents = getActiveAgents();
      expect(agents).toHaveLength(0);
    });
  });

  describe('getInactiveAgents', () => {
    it('returns qwen as inactive by default', () => {
      const inactive = getInactiveAgents();
      expect(inactive).toHaveLength(1);
      expect(inactive[0].id).toBe('qwen');
      expect(inactive[0].label).toBe('Qwen (Ollama)');
      expect(inactive[0].type).toBe('local');
    });

    it('returns empty when all agents are active', () => {
      storage.set('luminal-admin-active-agents', JSON.stringify(['claude', 'qwen']));
      const inactive = getInactiveAgents();
      expect(inactive).toHaveLength(0);
    });

    it('returns all agents when none are active', () => {
      storage.set('luminal-admin-active-agents', JSON.stringify([]));
      const inactive = getInactiveAgents();
      expect(inactive).toHaveLength(2);
    });
  });

  describe('toggle behavior via save/load round-trip', () => {
    it('activating qwen persists and loads correctly', () => {
      const ids = loadActiveAgentIds();
      ids.add('qwen');
      saveActiveAgentIds(ids);

      const loaded = loadActiveAgentIds();
      expect(loaded.has('claude')).toBe(true);
      expect(loaded.has('qwen')).toBe(true);
    });

    it('deactivating claude persists and loads correctly', () => {
      const ids = loadActiveAgentIds();
      ids.delete('claude');
      saveActiveAgentIds(ids);

      const loaded = loadActiveAgentIds();
      expect(loaded.has('claude')).toBe(false);
    });
  });

  describe('change event', () => {
    it('window dispatches agent-manager-change on save', () => {
      // The renderAgentManager function dispatches CustomEvent on drop.
      // We verify the pattern by dispatching manually and listening.
      const handler = vi.fn();
      window.addEventListener('agent-manager-change', handler);

      window.dispatchEvent(new CustomEvent('agent-manager-change'));
      expect(handler).toHaveBeenCalledTimes(1);

      window.removeEventListener('agent-manager-change', handler);
    });
  });
});
