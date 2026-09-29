import type { OverseerConfig, QwenFinding, DomainId, StandingOrder } from './types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function canDispatchClaude(
  claudeConfig: OverseerConfig['claude'],
  recentDispatches: { ts: number }[],
): boolean {
  if (claudeConfig.requireApproval) return false;

  const now = Date.now();
  const hourlyCount = recentDispatches.filter(d => now - d.ts < HOUR_MS).length;
  const dailyCount = recentDispatches.filter(d => now - d.ts < DAY_MS).length;

  return hourlyCount < claudeConfig.maxDispatchesPerHour &&
         dailyCount < claudeConfig.maxDispatchesPerDay;
}

export function buildClaudePrompt(
  finding: QwenFinding,
  domain: DomainId,
  orders: StandingOrder[],
): string {
  const ref = finding.relatedRef ?? domain;
  const branchName = `overseer/${ref}-fix`;

  const lines: string[] = [
    `# Overseer Finding: ${finding.title}`,
    '',
    `**Domain:** ${domain}`,
    `**Severity:** ${finding.severity}`,
    `**Incident Type:** ${finding.incidentType}`,
    `**Confidence:** ${finding.confidenceLevel}`,
    '',
    '## Description',
    finding.description,
    '',
  ];

  if (finding.suggestedAction) {
    lines.push('## Suggested Action', finding.suggestedAction, '');
  }

  if (finding.relatedRef) {
    lines.push(`**Related Ref:** ${finding.relatedRef}`, '');
  }

  const applicableOrders = orders.filter(
    o => o.domains === 'all' || o.domains.includes(domain),
  );

  if (applicableOrders.length > 0) {
    lines.push('## Standing Orders');
    for (const order of applicableOrders) {
      lines.push(`- [${order.id}] ${order.text}`);
    }
    lines.push('');
  }

  lines.push(
    '## Instructions',
    `1. Investigate the finding described above.`,
    `2. Implement a fix on a new branch named \`${branchName}\`.`,
    `3. Run tests to verify the fix does not break anything.`,
    `4. POST your results to \`/__admin_overseer/log\` using:`,
    '',
    '```bash',
    `curl -s -X POST http://localhost:5175/__admin_overseer/log \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"domain":"${domain}","action":"claude-completed","summary":"<your summary>","ref":"${finding.relatedRef ?? ''}"}'`,
    '```',
  );

  return lines.join('\n');
}

export function buildAiderPrompt(
  finding: QwenFinding,
  domain: DomainId,
  incidentId: string,
): string {
  const lines: string[] = [
    `# Fix: ${finding.title}`,
    '',
    finding.description,
    '',
  ];

  if (finding.suggestedAction) {
    lines.push(`**Action:** ${finding.suggestedAction}`, '');
  }

  lines.push(
    'After applying the fix, report results with:',
    '',
    '```bash',
    `curl -s -X POST http://localhost:5175/__admin_overseer/log \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"domain":"${domain}","action":"auto-fixed","summary":"Aider fix applied","incidentId":"${incidentId}"}'`,
    '```',
  );

  return lines.join('\n');
}

export async function dispatchClaude(
  adminBase: string,
  prompt: string,
  label: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${adminBase}/__admin_exec/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, label }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { agentId?: string };
    return data.agentId ?? null;
  } catch {
    return null;
  }
}

export async function dispatchAider(
  adminBase: string,
  prompt: string,
  label: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${adminBase}/__admin_exec/aider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, label, mode: 'auto' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { agentId?: string };
    return data.agentId ?? null;
  } catch {
    return null;
  }
}
