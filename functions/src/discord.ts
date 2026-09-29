// ── Discord DM Utility ───────────────────────────────────────
// Sends direct messages to the Luminal admin via Discord bot API.
// Bot token comes from Firebase secrets; user ID is constant.

import { logger } from 'firebase-functions';

const DISCORD_API = 'https://discord.com/api/v10';
const ADMIN_DISCORD_USER_ID = '134074174263132160';

interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: EmbedField[];
  timestamp?: string;
  footer?: { text: string };
}

/** Create (or reuse) a DM channel with the admin user, then send an embed. */
export async function sendDM(
  botToken: string,
  embed: DiscordEmbed,
): Promise<boolean> {
  try {
    // Step 1: Open DM channel
    const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: ADMIN_DISCORD_USER_ID }),
    });

    if (!channelRes.ok) {
      const text = await channelRes.text();
      logger.error(`Discord DM channel creation failed (${channelRes.status}): ${text}`);
      return false;
    }

    const channel = (await channelRes.json()) as { id: string };

    // Step 2: Send message with embed
    const msgRes = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          ...embed,
          timestamp: embed.timestamp || new Date().toISOString(),
          footer: {
            text: `${embed.footer?.text || 'Luminal'} · Dashboard: http://192.168.2.10:5175`,
          },
        }],
      }),
    });

    if (!msgRes.ok) {
      const text = await msgRes.text();
      logger.error(`Discord DM send failed (${msgRes.status}): ${text}`);
      return false;
    }

    logger.info(`Discord DM sent: ${embed.title}`);
    return true;
  } catch (err) {
    logger.error('Discord DM error:', err);
    return false;
  }
}

// ── Alert Colors ─────────────────────────────────────────────
export const ALERT_COLOR = {
  CRITICAL: 0xFF2244,   // red — outages, crashes
  WARNING: 0xFF8800,    // orange — spikes, degradation
  SUCCESS: 0x22CC66,    // green — recovery
  INFO: 0x49A2B2,       // teal — informational
} as const;
