import type { OverseerAlert, DomainId } from './types';
import { readJsonFile } from '../processPlugin';

// ── Internal types ─────────────────────────────────────────

interface AlertsConfig {
  webhooks?: { commitHistory?: string; releaseNotes?: string };
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  timestamp: string;
  footer: { text: string };
}

// ── Cooldown tracking ──────────────────────────────────────

const _lastAlert = new Map<DomainId, number>();

export function shouldSendAlert(domain: DomainId, cooldownMinutes: number): boolean {
  const now = Date.now();
  const last = _lastAlert.get(domain);
  if (last !== undefined && now - last < cooldownMinutes * 60 * 1000) {
    return false;
  }
  _lastAlert.set(domain, now);
  return true;
}

export function resetCooldowns(): void {
  _lastAlert.clear();
}

// ── Embed builder ──────────────────────────────────────────

export function buildDiscordEmbed(alert: OverseerAlert): DiscordEmbed {
  const fields: DiscordEmbed['fields'] = [
    { name: 'Domain',   value: alert.domain,   inline: true },
    { name: 'Mode',     value: alert.mode,      inline: true },
    { name: 'Severity', value: alert.severity,  inline: true },
    ...alert.fields,
  ];

  if (alert.ref) {
    fields.push({ name: 'Ref', value: alert.ref, inline: true });
  }

  return {
    title: `OVERSEER: ${alert.title}`,
    description: alert.description,
    color: alert.color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'Luminal OVERSEER' },
  };
}

// ── Alert sender ───────────────────────────────────────────

export async function sendDiscordAlert(
  alert: OverseerAlert,
  cooldownMinutes: number,
): Promise<boolean> {
  if (!shouldSendAlert(alert.domain, cooldownMinutes)) return false;

  const config = readJsonFile<AlertsConfig>('alerts.json', {});
  const webhookUrl = config.webhooks?.commitHistory;
  if (!webhookUrl) return false;

  const embed = buildDiscordEmbed(alert);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Alert colors ───────────────────────────────────────────

export const ALERT_COLORS = {
  CRITICAL: 0xFF2244,
  WARNING:  0xFF8800,
  SUCCESS:  0x22CC66,
  INFO:     0x49A2B2,
} as const;
