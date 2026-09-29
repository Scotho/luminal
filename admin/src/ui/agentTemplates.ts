import { icon } from './icons';

export interface AgentTemplate {
  id: string;
  label: string;
  prompt: string;
  icon: string;
}

export interface TemplateGroup {
  id: string;
  label: string;
  templates: AgentTemplate[];
}

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    id: 'start',
    label: 'Start',
    templates: [
      { id: 'chat', label: 'Chat', icon: icon('message-square', 14), prompt: 'You are in an interactive chat session with the developer via the Luminal admin dashboard. This is a persistent conversation \u2014 the developer will send follow-up messages. Respond conversationally and concisely. You have full access to the codebase. Wait for the developer to tell you what they need.' },
      { id: 'orchestrate', label: 'Orchestrate', icon: icon('cpu', 14), prompt: '/orchestrate' },
      { id: 'brainstorm', label: 'Brainstorm', icon: icon('sparkles', 14), prompt: 'I want to brainstorm a new feature or improvement. Help me explore the design space, ask clarifying questions, and suggest approaches. Don\'t implement anything yet.' },
    ],
  },
  {
    id: 'code',
    label: 'Code Quality',
    templates: [
      { id: 'code-review', label: 'Code Review', icon: icon('eye', 14), prompt: 'Review the recent changes on the current branch. Check for bugs, security issues, performance problems, and code quality. Report findings organized by severity.' },
      { id: 'simplify', label: 'Simplify', icon: icon('list-checks', 14), prompt: '/simplify' },
      { id: 'refactor', label: 'Refactor', icon: icon('rotate-ccw', 14), prompt: 'Analyze the codebase for code smells, large files, duplicated logic, and unclear naming. Propose and implement targeted refactoring improvements.' },
      { id: 'performance', label: 'Performance Audit', icon: icon('zap', 14), prompt: 'Profile the codebase for performance bottlenecks. Focus on render loops, memory allocations in hot paths, and unnecessary re-renders. Suggest optimizations.' },
      { id: 'security', label: 'Security Scan', icon: icon('shield', 14), prompt: 'Scan the codebase for security vulnerabilities: XSS risks, injection points, exposed secrets, insecure dependencies. Report findings with severity ratings.' },
    ],
  },
  {
    id: 'test',
    label: 'Testing',
    templates: [
      { id: 'write-tests', label: 'Write Tests', icon: icon('clipboard-check', 14), prompt: 'Identify modules with missing test coverage and write unit tests for them. Follow existing test patterns in src/**/*.test.ts. Mock external dependencies.' },
      { id: 'fix-failing-tests', label: 'Fix Failing Tests', icon: icon('bug', 14), prompt: 'Run the test suite, identify failing tests, diagnose root causes, and fix them. Do not skip or delete tests.' },
      { id: 'write-e2e', label: 'Write E2E Test', icon: icon('globe', 14), prompt: '/write-online-test' },
      { id: 'run-e2e', label: 'Run E2E', icon: icon('play', 14), prompt: '/run-e2e' },
      { id: 'e2e-audit', label: 'E2E Audit', icon: icon('notebook-text', 14), prompt: '/e2e-audit' },
      { id: 'verify-bug', label: 'Verify Bug', icon: icon('bug', 14), prompt: '/verify-bug' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    templates: [
      { id: 'status', label: 'Status', icon: icon('activity', 14), prompt: '/status' },
      { id: 'activity', label: 'Activity', icon: icon('clock', 14), prompt: '/activity' },
      { id: 'test-health', label: 'Test Health', icon: icon('flask-conical', 14), prompt: '/test-health' },
      { id: 'codebase-health', label: 'Codebase Health', icon: icon('bar-chart-3', 14), prompt: '/codebase-health' },
    ],
  },
  {
    id: 'ops',
    label: 'Ops & Deploy',
    templates: [
      { id: 'ops-triage', label: 'Ops Triage', icon: icon('alert-triangle', 14), prompt: '/ops-triage' },
      { id: 'close-session', label: 'Close Session', icon: icon('x', 14), prompt: '/close-session' },
      { id: 'deploy-check', label: 'Deploy Check', icon: icon('server', 14), prompt: '/deploy check' },
      { id: 'inspect-ui', label: 'Inspect UI', icon: icon('monitor', 14), prompt: '/inspect-ui' },
    ],
  },
  {
    id: 'docs',
    label: 'Docs',
    templates: [
      { id: 'doc-update', label: 'Update Docs', icon: icon('file-text', 14), prompt: 'Audit documentation for accuracy against current code. Update outdated docs, fix broken links, and fill gaps in README and inline comments.' },
      { id: 'docs-maintenance', label: 'Docs Maintenance', icon: icon('notebook-text', 14), prompt: '/docs-maintenance' },
    ],
  },
];

/** Flat list for backwards compatibility */
export const BUILTIN_TEMPLATES: AgentTemplate[] = TEMPLATE_GROUPS.flatMap(g => g.templates);
