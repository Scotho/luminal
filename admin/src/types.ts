/** Generic snapshot envelope for JSON persistence. */
export interface Snapshot<T> {
  lastUpdated: string;   // ISO 8601
  summary: Record<string, number | string>;
  entries: T[];
}

/** Section identifiers for sidebar navigation. */
export type SectionName =
  | 'live' | 'users' | 'matches' | 'playtime' | 'bugs' | 'purge'
  | 'tasks' | 'audits' | 'test-center' | 'sessions'
  | 'viewer' | 'notifications' | 'notes' | 'specs' | 'pulls'
  | 'e2e-matrix' | 'links' | 'help' | 'settings' | 'pipeline' | 'ollama'
  | 'database' | 'feature-flags' | 'function-logs' | 'incidents' | 'firebase-metrics'
  | 'match-replay' | 'chat-moderation' | 'analytics' | 'scheduler' | 'agents'
  | 'overseer' | 'git' | 'impact-analysis' | 'leaderboard' | 'live-diff'
  | 'memory-economy'
  | 'file-browser'
  | 'testing'
  | 'ranked-sim'
  | 'iterative-loop'
  | 'animation-viewer'
  | 'perf-tracker'
  | 'flakiness-tracker'
  | 'announcements'
  | 'deploy-pipeline'
  | 'xp-sim'
  | 'trail-lab';

/** Single historical entry for a test run. */
export interface TestFlakinessHistoryEntry {
  ts: number;
  status: 'pass' | 'fail' | 'skip';
  durationMs?: number;
}

/** Tracked flakiness state for a single test. */
export interface TestFlakinessRecord {
  testName: string;
  file: string;
  runs: number;
  passes: number;
  fails: number;
  lastRunAt: number;
  lastStatus: 'pass' | 'fail' | 'skip';
  recentHistory: TestFlakinessHistoryEntry[];
  flakinessScore: number;
  quarantined: boolean;
  quarantineReason?: string;
}

/** Online player entry from RTDB status/. */
export interface StatusEntry {
  uid: string;
  online: boolean;
  ts: number;
}

/** Lobby entry from RTDB lobbies/. */
export interface LobbyEntry {
  id: string;
  host: string;
  guests: string[];
  status: string;
}

/** Match entry from RTDB matches/. */
export interface MatchEntry {
  id: string;
  players: string[];
  status: string;
  round: number;
}

/** Firestore user document. */
export interface UserDoc {
  uid: string;
  username: string;
  icon: string;
  about: string;
  color: number;
  timePlayed?: number;
  playtime?: number;
  createdAt: { seconds: number; nanoseconds: number } | null;
  socials: { discord: string; steam: string; twitch: string; youtube: string };
}

/** Firestore match document. */
export interface MatchDoc {
  players: { uid: string; username: string; color: number; vehicle: string }[];
  result: string;
  winnerUid: string;
  series: number;
  matchType: string;
  duration: number;
  map: string;
  createdAt: { seconds: number; nanoseconds: number } | null;
}

/** Firestore leaderboard document. */
export interface LeaderboardDoc {
  uid: string;
  username: string;
  color?: number;
  icon?: string;
  series: number;
  matchType: string;
  wins: number;
  losses: number;
  draws: number;
  currentStreak?: number;
  bestStreak?: number;
  totalTime: number;
  matchCount: number;
  winRate?: number;
  fastestWin?: number;
  lastUpdated?: { seconds: number; nanoseconds: number } | null;
}

/** Bug report from RTDB debugReports/. */
export interface BugReport {
  id: string;
  username: string;
  uid: string;
  gameMode: string;
  error: string;
  stack: string;
  url: string;
  userAgent: string;
  ts: number;
}

// -- CLI Script Output Types --

export interface ModuleInfo {
  tier: number;
  imports: string[];
  importedBy: string[];
  blastRadius: number;
  loc: number;
  exports: string[];
}

export interface ModuleMap {
  modules: Record<string, ModuleInfo>;
  tiers: Record<number, string[]>;
  generated: string;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  age: string;
  files: string[];
}

export interface HotModule {
  path: string;
  commits30d: number;
  lastTouched: string;
}

export interface WorktreeInfo {
  name: string;
  branch: string;
  behind: number;
  changedFiles: number;
}

export interface ActivityDigest {
  branch: string;
  aheadOfOrigin: number;
  uncommitted: { modified: number; untracked: number; deleted: number };
  recentCommits: CommitInfo[];
  hotModules: HotModule[];
  worktrees: WorktreeInfo[];
  generated: string;
}

export interface TestConfigHealth {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  lastRun: string | null;
  duration: number;
}

export interface TestFailure {
  test: string;
  config: string;
  error: string;
}

export interface TestHealth {
  configs: Record<string, TestConfigHealth>;
  failures: TestFailure[];
  untested: string[];
  coverage: { withTests: number; total: number; percent: number };
  generated: string;
}

// -- Dashboard Data Types --

export interface TaskEntry {
  id: string;
  ref: string;               // "TASK-12" or "QA-7" — human-readable identifier
  refs?: string[];            // cross-references: ["SPEC-8", "BUG-3"]
  tag: string;
  prompt: string;
  source: string;
  status: 'pending' | 'done';
  priority: number;        // 1 (critical) – 5 (low), default 3
  created: string;
  modified?: string;        // ISO 8601 — updated on any field change
  completed?: string;
  parentId?: string;        // links sub-task to a master task
  children?: string[];      // master task lists sub-task ids
}

export interface TaskGroupSuggestion {
  name: string;
  taskIds: string[];
  rationale: string;
}

export interface AuditEntry {
  name: string;
  label: string;
  description: string;
  prompt: string;
  intervalDays: number;
  lastRun: string | null;
  builtin: boolean;
}

export interface ReminderEntry {
  id: string;
  text: string;
  done: boolean;
  created: string;
  completed?: string;
}

export interface NotificationEntry {
  id: string;
  type: 'task:done' | 'bug:new' | 'cc:done';
  title: string;
  message: string;
  ts: string;           // ISO 8601
}

// -- Session Orchestrator Types --

export type SessionType = 'feature' | 'bugfix' | 'polish' | 'tuning' | 'chore';
export type SessionStatus = 'todo' | 'active' | 'blocked' | 'done' | 'done-followup' | 'needs-attention';
export type SessionSection = 'current-stack' | 'backlog';

export interface SessionPhase {
  label: string;
  done: boolean;
}

export interface SessionNote {
  ts: string;       // ISO 8601
  text: string;
}

export interface Session {
  id: string;
  summary: string;
  type: SessionType;
  status: SessionStatus;
  section: SessionSection;
  phases: SessionPhase[];
  plan: string;
  specPath?: string;
  branch?: string;
  refs?: string[];             // cross-references: ["TASK-12", "BUG-3", "SPEC-8"]
  source?: 'admin' | 'external';   // who created this session
  notes: SessionNote[];
  created: string;
  completed?: string;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  prompt: string;
  agentStatus: 'pending' | 'running' | 'done' | 'error';
  output?: string;
}

export type RefType = 'TASK' | 'BUG' | 'QA' | 'SPEC';
export type CounterState = Record<RefType, number>;

// -- Test Gate Enforcement Types --

/** A single test-gate validation attempt for a session. */
export interface TestGateAttempt {
  ts: string;                   // ISO 8601
  passed: boolean;
  results: {
    unit: boolean;
    build: boolean;
    lint: boolean;
    browser: boolean;
  };
  specHash: string;             // SHA-256 of spec file at plan time (anti-gaming)
  testFileHashes: Record<string, string>;  // path → SHA-256 of test files
  notes?: string;               // agent-provided context on failure
}

/** Tracks the full test-gate state for a session. */
export interface TestGateState {
  sessionId: string;
  specHashAtPlan: string;       // original spec hash captured at plan phase
  testFileHashesAtPlan: Record<string, string>;  // original test file hashes
  attempts: TestGateAttempt[];
  relaxed: boolean;             // true if validation was relaxed after 10+ failures
  relaxedAt?: string;           // ISO 8601
  relaxedReason?: string;       // justification provided at relaxation
  incidentId?: string;          // incident created on relaxation
}

/** Incident types including validation-relaxation for test gate audit trail. */
export type IncidentType = 'outage' | 'deploy' | 'config-change' | 'hotfix' | 'rollback' | 'validation-relaxation';

export interface Incident {
  id: string;
  ts: number;
  type: IncidentType;
  title: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  resolved: boolean;
  resolvedAt?: number;
  source?: 'manual' | 'overseer' | 'test-gate';
  /** Linked session ID (for validation-relaxation incidents). */
  sessionRef?: string;
  /** Number of failures before relaxation was granted. */
  failureCount?: number;
}

export interface ReorderEntry {
  ts: string;
  previousOrder: string[];
  newOrder: string[];
  reason: string;
}

export interface TestRun {
  id: string;
  config: string;
  startedAt: string;
  duration: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ file: string; test: string; error: string }>;
  followup?: boolean;
}

export interface ProcessStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  type?: 'test' | 'claude' | 'script';
  startedAt?: string;
  pid?: number;
}

// -- Server Health Types --

export interface ServerMeta {
  version: string;
  deployedAt: number;
}

// -- CC Session Types --

export type CCCardType = 'text' | 'tool' | 'error' | 'system' | 'result' | 'file-context';

/** Conversation role for thread rendering. */
export type CCCardRole = 'user' | 'assistant' | 'tool' | 'agent' | 'system';

export interface CCCard {
  id: string;
  type: CCCardType;
  title: string;
  preview: string;   // 3-4 line summary
  body: string;       // full content for expanded view
  ts: number;
  role?: CCCardRole;        // conversation role (user prompt, assistant text, tool call, etc.)
  depth?: number;           // agent nesting depth (0 = orchestrator, 1+ = subagent)
  agentLabel?: string;      // label for agent dispatch blocks
  toolStatus?: 'running' | 'done' | 'error';  // tool call status
  fileContextPaths?: string[];   // file paths included in context (file-context cards)
  fileContextLoading?: boolean;  // true while files are being fetched
  /** Tool call start timestamp (set when tool starts). */
  toolStartTs?: number;
  /** Tool call duration in ms (set when tool completes). */
  toolDuration?: number;
  /** Tool result content (truncated, for display in the tool card). */
  toolResult?: string;
  /** @internal System event subtype for consolidation (hook_started, task_started, etc.). */
  _systemSubtype?: string;
  /** @internal Hook ID for pairing hook_started/hook_response. */
  _hookId?: string;
  /** @internal Task ID for consolidating task lifecycle cards. */
  _taskId?: string;
}

export interface CCUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheCreation?: number;
}

export interface CCSession {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: number;
  duration: number | null;
  cards: CCCard[];
  result: string | null;
  usage: CCUsage | null;
  exitCode: number | null;
  prompt: string | null;
  backend: 'cc' | 'ollama' | 'aider';
  /** All agent IDs used in this conversation (supports resume chain). */
  agentIds: string[];
  /** Agent ID to use for --resume on next follow-up. */
  lastAgentId: string | null;
  /** Aider autonomy mode for this session (only set when backend is 'aider'). */
  aiderMode?: 'suggest' | 'auto';
  /** Cached file contents for aider context injection. Key = relative path. */
  aiderFileContexts?: Record<string, { content: string; hash: number }>;
  /** Effort level used when dispatching this session. */
  effort?: EffortLevel;
  /** Timestamp of last received output line — used for stall detection. */
  lastActivityTs?: number;
  /** True once a stall toast has been dispatched for the current silent period. */
  _stallNotified?: boolean;
  /** Running token count from stream-json usage events. */
  tokenCount?: { input: number; output: number; cacheRead: number };
  /** Transient progress text from task_progress stream events (cleared on next significant event). */
  progressText?: string;
}

export interface CCUsageRecord {
  sessionId: string;
  label: string;
  ts: string;
  duration: number | null;
  usage: CCUsage;
  exitCode: number | null;
}

/** Archived agent session for audit history. */
export interface AgentHistoryEntry {
  id: string;
  label: string;
  backend: 'cc' | 'ollama' | 'aider';
  status: 'done' | 'error' | 'cancelled';
  startedAt: number;
  closedAt: string;           // ISO 8601
  duration: number | null;
  usage: CCUsage | null;
  exitCode: number | null;
  prompt: string | null;
  cards: CCCard[];
}

// -- Pipeline Types --

export interface DeployEntry {
  version: string;
  timestamp: string;
  target: string;       // 'live+test' | 'live' | 'test' | 'rules' | 'functions' | 'rollback'
  commit: string;       // short SHA for git checkout during rollback
  branch: string;
  notes: string[];
  duration: number;
}

/** Valid targets the admin Deploy Pipeline UI may request. */
export type DeployTarget = 'live' | 'test' | 'rules' | 'functions' | 'hosting';

/** A single deploy invocation tracked by the admin Deploy Pipeline. */
export interface DeployRecord {
  id: string;
  target: DeployTarget;
  version?: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'success' | 'failure' | 'aborted';
  exitCode?: number;
  /** Last ~4KB of logs — persisted for history drawer playback. */
  logTail?: string;
  triggeredBy?: string;
}

export interface CoverageEntry {
  timestamp: string;
  commit: string;
  branch: string;
  coverage: number;
  testCount: number | null;
  passed: number | null;
  failed: number | null;
  duration: number | null;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export const EFFORT_GLYPHS: Record<EffortLevel, string> = {
  low: '○',
  medium: '◐',
  high: '●',
  max: '◉',
};

export interface PipelineStatus {
  build: {
    status: string;
    conclusion: string | null;
    runNumber: number;
    branch: string;
    sha: string;
    updatedAt: string;
    url: string;
  } | null;
  deploy: DeployEntry | null;
  coverage: {
    percent: number;
    testCount: number | null;
    delta: number;
  } | null;
  prs: {
    open: number;
    unaddressedAIComments: number;
  };
}
