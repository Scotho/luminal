// admin/src/ui/errorClassifier.ts

export type ErrorCategory = 'rate_limit' | 'context_exceeded' | 'permission_denied' | 'build_failure' | 'test_failure' | 'network' | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  icon: string;
  label: string;
  suggestion: string;
  autoRetryable: boolean;
  retryDelayMs?: number;
}

const PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory; icon: string; label: string; suggestion: string; autoRetryable: boolean; retryDelayMs?: number }> = [
  { pattern: /rate.?limit|429|too many requests/i, category: 'rate_limit', icon: '⏱', label: 'Rate Limited', suggestion: 'Auto-retrying after cooldown...', autoRetryable: true, retryDelayMs: 30_000 },
  { pattern: /context.?window|token.?limit|maximum.?context|prompt.?too.?long/i, category: 'context_exceeded', icon: '📏', label: 'Context Exceeded', suggestion: 'Try compacting the conversation or starting a new session.', autoRetryable: false },
  { pattern: /permission|denied|not.?allowed|forbidden/i, category: 'permission_denied', icon: '🔒', label: 'Permission Denied', suggestion: 'Check tool permissions or run with elevated access.', autoRetryable: false },
  { pattern: /build.?fail|compilation.?error|tsc.*error|type.?error/i, category: 'build_failure', icon: '🔨', label: 'Build Failure', suggestion: 'Fix the type errors shown above, then retry.', autoRetryable: false },
  { pattern: /test.?fail|FAIL|vitest.*fail|expect.*received/i, category: 'test_failure', icon: '✗', label: 'Test Failure', suggestion: 'Send failures to agent for diagnosis.', autoRetryable: false },
  { pattern: /ECONNREFUSED|ENOTFOUND|network|timeout|fetch.?fail/i, category: 'network', icon: '🌐', label: 'Network Error', suggestion: 'Check connectivity and retry.', autoRetryable: true, retryDelayMs: 5_000 },
];

export function classifyError(errorText: string): ClassifiedError {
  for (const p of PATTERNS) {
    if (p.pattern.test(errorText)) {
      return { category: p.category, icon: p.icon, label: p.label, suggestion: p.suggestion, autoRetryable: p.autoRetryable, retryDelayMs: p.retryDelayMs };
    }
  }
  return { category: 'unknown', icon: '⚠', label: 'Error', suggestion: '', autoRetryable: false };
}
