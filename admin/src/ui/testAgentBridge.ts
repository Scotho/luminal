// admin/src/ui/testAgentBridge.ts
import { dispatchCC } from './ccDispatch';

interface TestFailure {
  file: string;
  test: string;
  error: string;
}

/** Format test failures as a structured prompt for a CC agent. */
export function formatFailuresAsPrompt(failures: TestFailure[], config: string): string {
  const header = `The following ${failures.length} test(s) failed in the "${config}" suite. Diagnose the root causes and fix them. Do not skip or delete tests.\n\n`;
  const body = failures.map(f =>
    `### ${f.test}\n**File:** ${f.file}\n**Error:**\n\`\`\`\n${f.error.slice(0, 500)}\n\`\`\``
  ).join('\n\n');
  return header + body;
}

/** Dispatch a CC agent to fix the given test failures. Returns the new session ID. */
export async function sendFailuresToAgent(failures: TestFailure[], config: string): Promise<string> {
  const prompt = formatFailuresAsPrompt(failures, config);
  const label = `Fix: ${config} (${failures.length} failure${failures.length > 1 ? 's' : ''})`;
  return dispatchCC(label, prompt);
}

/** Open the CC flyout panel (utility for callers). */
export function openFlyout(): void {
  const flyout = document.getElementById('cc-flyout');
  if (flyout) {
    flyout.classList.remove('collapsed');
  }
}
