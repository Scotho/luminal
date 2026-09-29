import type { DomainId } from './types';

export async function writeHeartbeat(activeDomains: DomainId[]): Promise<void> {
  try {
    const dbUrl = process.env.FIREBASE_DATABASE_URL ?? 'https://luminal-app-default-rtdb.firebaseio.com';
    await fetch(`${dbUrl}/config/overseerHeartbeat.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now(), domains: activeDomains }),
    });
  } catch {
    // Non-fatal — heartbeat failure shouldn't stop monitoring
  }
}
