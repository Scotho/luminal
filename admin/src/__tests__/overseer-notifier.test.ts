import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers';
import { buildDiscordEmbed, shouldSendAlert, resetCooldowns } from '../middleware/overseer/notifier';
import type { OverseerAlert } from '../middleware/overseer/types';

describe('buildDiscordEmbed', () => {
  const alert: OverseerAlert = {
    title: 'Bug Burst Detected',
    description: '5 reports in 10 minutes',
    color: 0xFF2244,
    domain: 'bugs',
    mode: 'watch',
    severity: 'critical',
    fields: [{ name: 'Top Error', value: 'TypeError: x', inline: true }],
    ref: 'BUG-14',
  };

  it('builds embed with all fields', () => {
    const embed = buildDiscordEmbed(alert);
    expect(embed.title).toContain('OVERSEER');
    expect(embed.title).toContain('Bug Burst Detected');
    expect(embed.color).toBe(0xFF2244);
    expect(embed.fields).toContainEqual(expect.objectContaining({ name: 'Domain' }));
    expect(embed.fields).toContainEqual(expect.objectContaining({ name: 'Mode' }));
    expect(embed.fields).toContainEqual(expect.objectContaining({ name: 'Ref', value: 'BUG-14' }));
  });
});

describe('shouldSendAlert', () => {
  beforeEach(() => resetCooldowns());

  it('allows first alert for a domain', () => {
    expect(shouldSendAlert('bugs', 15)).toBe(true);
  });

  it('blocks alert within cooldown window', () => {
    expect(shouldSendAlert('bugs', 15)).toBe(true);
    expect(shouldSendAlert('bugs', 15)).toBe(false);
  });

  it('allows alerts for different domains', () => {
    expect(shouldSendAlert('bugs', 15)).toBe(true);
    expect(shouldSendAlert('tests', 15)).toBe(true);
  });
});
