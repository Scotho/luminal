// admin/src/ui/outputChaining.ts
import type { CCSession } from '../types';
import { dispatchCC } from './ccDispatch';

/** Extract the final result or last N lines of assistant text from a completed session. */
export function extractChainableOutput(session: CCSession, maxChars = 4000): string {
  if (session.result) return session.result.slice(0, maxChars);

  // Fall back to last assistant/result cards
  const assistantCards = session.cards.filter(c => c.role === 'assistant' || c.type === 'result');
  if (assistantCards.length === 0) return '';
  const lastCards = assistantCards.slice(-3);
  return lastCards.map(c => c.body).join('\n\n').slice(0, maxChars);
}

/** Build a chained prompt that injects previous agent output as context. */
export function buildChainedPrompt(sourceSession: CCSession, newPrompt: string): string {
  const output = extractChainableOutput(sourceSession);
  if (!output) return newPrompt;
  return `The previous agent ("${sourceSession.label}") completed with this output:\n\n<previous-agent-output>\n${output}\n</previous-agent-output>\n\nContinue with the following task:\n\n${newPrompt}`;
}

/** Chain: dispatch a new agent with previous output as context. */
export async function chainToNewAgent(
  sourceSession: CCSession,
  newPrompt: string,
  label?: string,
): Promise<string> {
  const chainedPrompt = buildChainedPrompt(sourceSession, newPrompt);
  return dispatchCC(label ?? `Chain: ${newPrompt.slice(0, 30)}`, chainedPrompt);
}
