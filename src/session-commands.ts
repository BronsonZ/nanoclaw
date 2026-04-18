import type { NewMessage } from './types.js';
import { logger } from './logger.js';

/**
 * Extract a session slash command from a message, stripping the trigger prefix if present.
 * Returns the slash command (e.g., '/compact', '/clear') or null if not a session command.
 */
export function extractSessionCommand(
  content: string,
  triggerPattern: RegExp,
): string | null {
  let text = content.trim();
  text = text.replace(triggerPattern, '').trim();
  if (text === '/compact') return '/compact';
  if (text === '/clear') return '/clear';
  if (text === '/context') return '/context';
  if (text === '/context full') return '/context full';
  return null;
}

export interface ContextSnapshot {
  schemaVersion: number;
  capturedAt: string;
  sessionId?: string;
  model: string;
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  autoCompactThreshold?: number;
  isAutoCompactEnabled: boolean;
  categories: { name: string; tokens: number }[];
  mcpTools: {
    name: string;
    serverName: string;
    tokens: number;
    isLoaded?: boolean;
  }[];
  skills?: { totalSkills: number; includedSkills: number; tokens: number };
  memoryFiles: { path: string; tokens: number; type?: string }[];
  systemTools?: { name: string; tokens: number }[];
  systemPromptSections?: { name: string; tokens: number }[];
  apiUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  } | null;
}

export type ContextSnapshotResult =
  | { ok: true; snapshot: ContextSnapshot }
  | { ok: false; reason: 'missing' | 'parse-error' };

/**
 * Check if a session command sender is authorized.
 * Allowed: main group (any sender), or trusted/admin sender (is_from_me) in any group.
 */
export function isSessionCommandAllowed(
  isMainGroup: boolean,
  isFromMe: boolean,
): boolean {
  return isMainGroup || isFromMe;
}

/** Minimal agent result interface — matches the subset of ContainerOutput used here. */
export interface AgentResult {
  status: 'success' | 'error';
  result?: string | object | null;
}

/** Dependencies injected by the orchestrator. */
export interface SessionCommandDeps {
  sendMessage: (text: string) => Promise<void>;
  setTyping: (typing: boolean) => Promise<void>;
  runAgent: (
    prompt: string,
    onOutput: (result: AgentResult) => Promise<void>,
  ) => Promise<'success' | 'error'>;
  closeStdin: () => void;
  advanceCursor: (timestamp: string) => void;
  formatMessages: (msgs: NewMessage[], timezone: string) => string;
  /** Whether the denied sender would normally be allowed to interact (for denial messages). */
  canSenderInteract: (msg: NewMessage) => boolean;
  /** Clear the group's session pointer (in-memory + DB). Used by /clear. */
  clearSession: () => void;
  /** Read the latest context usage snapshot for this group. Used by /context. */
  getContextSnapshot: () => ContextSnapshotResult;
}

function resultToText(result: string | object | null | undefined): string {
  if (!result) return '';
  const raw = typeof result === 'string' ? result : JSON.stringify(result);
  return raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const deltaSec = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.round(deltaHr / 24);
  return `${deltaDay}d ago`;
}

export function formatContextSnapshot(
  snap: ContextSnapshot,
  now: Date = new Date(),
): string {
  const pct = Math.round(snap.percentage);
  const lines: string[] = [];
  lines.push(
    `Context: ${fmtNum(snap.totalTokens)} / ${fmtNum(snap.maxTokens)} tokens (${pct}%)`,
  );
  lines.push(`Model: \`${snap.model}\``);
  if (snap.autoCompactThreshold) {
    lines.push(`Auto-compact at: ${fmtNum(snap.autoCompactThreshold)}`);
  }
  lines.push(`Captured: ${fmtRelativeTime(snap.capturedAt, now)}`);

  const topCats = snap.categories
    .slice()
    .sort((a, b) => b.tokens - a.tokens)
    .filter((c) => c.tokens > 0)
    .slice(0, 5);
  if (topCats.length > 0) {
    lines.push('');
    lines.push('Top categories:');
    for (const c of topCats) {
      lines.push(`  ${c.name}: ${fmtNum(c.tokens)}`);
    }
  }
  return lines.join('\n');
}

export function formatContextSnapshotFull(
  snap: ContextSnapshot,
  now: Date = new Date(),
): string {
  const pct = Math.round(snap.percentage);
  const lines: string[] = [];
  lines.push(
    `Context: ${fmtNum(snap.totalTokens)} / ${fmtNum(snap.maxTokens)} tokens (${pct}%)`,
  );
  lines.push(
    `Model: \`${snap.model}\` (raw max: ${fmtNum(snap.rawMaxTokens)})`,
  );
  if (snap.autoCompactThreshold) {
    const state = snap.isAutoCompactEnabled ? 'on' : 'off';
    lines.push(
      `Auto-compact at: ${fmtNum(snap.autoCompactThreshold)} (${state})`,
    );
  }
  lines.push(`Captured: ${fmtRelativeTime(snap.capturedAt, now)}`);

  const cats = snap.categories
    .slice()
    .sort((a, b) => b.tokens - a.tokens)
    .filter((c) => c.tokens > 0);
  if (cats.length > 0) {
    lines.push('');
    lines.push('Categories:');
    for (const c of cats) {
      lines.push(`  ${c.name}: ${fmtNum(c.tokens)}`);
    }
  }

  if (snap.mcpTools.length > 0) {
    lines.push('');
    lines.push('Top MCP tools:');
    for (const t of snap.mcpTools.slice(0, 10)) {
      const status = t.isLoaded ? 'loaded' : 'deferred';
      lines.push(`  \`${t.name}\`: ${fmtNum(t.tokens)} (${status})`);
    }
  }

  if (snap.memoryFiles.length > 0) {
    lines.push('');
    lines.push('Memory files:');
    for (const m of snap.memoryFiles.slice(0, 10)) {
      lines.push(`  \`${m.path}\`: ${fmtNum(m.tokens)}`);
    }
  }

  if (snap.systemTools && snap.systemTools.length > 0) {
    lines.push('');
    lines.push('System tools:');
    for (const t of snap.systemTools) {
      lines.push(`  \`${t.name}\`: ${fmtNum(t.tokens)}`);
    }
  }

  if (snap.systemPromptSections && snap.systemPromptSections.length > 0) {
    lines.push('');
    lines.push('System prompt sections:');
    for (const s of snap.systemPromptSections) {
      lines.push(`  ${s.name}: ${fmtNum(s.tokens)}`);
    }
  }

  if (snap.skills) {
    lines.push('');
    lines.push(
      `Skills: ${snap.skills.includedSkills}/${snap.skills.totalSkills} included (${fmtNum(snap.skills.tokens)} tokens)`,
    );
  }

  if (snap.apiUsage) {
    lines.push('');
    lines.push('Last-turn API usage:');
    lines.push(`  input: ${fmtNum(snap.apiUsage.input_tokens)}`);
    lines.push(`  output: ${fmtNum(snap.apiUsage.output_tokens)}`);
    lines.push(
      `  cache creation: ${fmtNum(snap.apiUsage.cache_creation_input_tokens)}`,
    );
    lines.push(
      `  cache read: ${fmtNum(snap.apiUsage.cache_read_input_tokens)}`,
    );
  }

  return lines.join('\n');
}

/**
 * Handle session command interception in processGroupMessages.
 * Scans messages for a session command, handles auth + execution.
 * Returns { handled: true, success } if a command was found; { handled: false } otherwise.
 * success=false means the caller should retry (cursor was not advanced).
 */
export async function handleSessionCommand(opts: {
  missedMessages: NewMessage[];
  isMainGroup: boolean;
  groupName: string;
  triggerPattern: RegExp;
  timezone: string;
  deps: SessionCommandDeps;
}): Promise<{ handled: false } | { handled: true; success: boolean }> {
  const {
    missedMessages,
    isMainGroup,
    groupName,
    triggerPattern,
    timezone,
    deps,
  } = opts;

  const cmdMsg = missedMessages.find(
    (m) => extractSessionCommand(m.content, triggerPattern) !== null,
  );
  const command = cmdMsg
    ? extractSessionCommand(cmdMsg.content, triggerPattern)
    : null;

  if (!command || !cmdMsg) return { handled: false };

  if (!isSessionCommandAllowed(isMainGroup, cmdMsg.is_from_me === true)) {
    // DENIED: send denial if the sender would normally be allowed to interact,
    // then silently consume the command by advancing the cursor past it.
    // Trade-off: other messages in the same batch are also consumed (cursor is
    // a high-water mark). Acceptable for this narrow edge case.
    if (deps.canSenderInteract(cmdMsg)) {
      await deps.sendMessage('Session commands require admin access.');
    }
    deps.advanceCursor(cmdMsg.timestamp);
    return { handled: true, success: true };
  }

  // AUTHORIZED
  logger.info({ group: groupName, command }, 'Session command');

  // /clear is handled entirely host-side: drop the session pointer so the next
  // query() starts fresh. No pre-command processing (those messages would run
  // against the session we're about to wipe). No agent invocation.
  if (command === '/clear') {
    deps.clearSession();
    await deps.sendMessage('Conversation cleared.');
    deps.advanceCursor(cmdMsg.timestamp);
    return { handled: true, success: true };
  }

  // /context is handled host-side: read the last-written snapshot from the
  // agent-runner and reply with a formatted summary. No agent invocation.
  // /context full dumps the detailed breakdown.
  if (command === '/context' || command === '/context full') {
    const result = deps.getContextSnapshot();
    if (!result.ok) {
      const msg =
        result.reason === 'missing'
          ? 'No context snapshot yet — send a message first.'
          : 'Context snapshot is unreadable. Try again after the next turn.';
      await deps.sendMessage(msg);
    } else {
      const text =
        command === '/context full'
          ? formatContextSnapshotFull(result.snapshot)
          : formatContextSnapshot(result.snapshot);
      await deps.sendMessage(text);
    }
    deps.advanceCursor(cmdMsg.timestamp);
    return { handled: true, success: true };
  }

  const cmdIndex = missedMessages.indexOf(cmdMsg);
  const preCompactMsgs = missedMessages.slice(0, cmdIndex);

  // Send pre-compact messages to the agent so they're in the session context.
  if (preCompactMsgs.length > 0) {
    const prePrompt = deps.formatMessages(preCompactMsgs, timezone);
    let hadPreError = false;
    let preOutputSent = false;

    const preResult = await deps.runAgent(prePrompt, async (result) => {
      if (result.status === 'error') hadPreError = true;
      const text = resultToText(result.result);
      if (text) {
        await deps.sendMessage(text);
        preOutputSent = true;
      }
      // Close stdin on session-update marker — emitted after query completes,
      // so all results (including multi-result runs) are already written.
      if (result.status === 'success' && result.result === null) {
        deps.closeStdin();
      }
    });

    if (preResult === 'error' || hadPreError) {
      logger.warn(
        { group: groupName },
        'Pre-compact processing failed, aborting session command',
      );
      await deps.sendMessage(
        `Failed to process messages before ${command}. Try again.`,
      );
      if (preOutputSent) {
        // Output was already sent — don't retry or it will duplicate.
        // Advance cursor past pre-compact messages, leave command pending.
        deps.advanceCursor(preCompactMsgs[preCompactMsgs.length - 1].timestamp);
        return { handled: true, success: true };
      }
      return { handled: true, success: false };
    }
  }

  // Forward the literal slash command as the prompt (no XML formatting)
  await deps.setTyping(true);

  let hadCmdError = false;
  const cmdOutput = await deps.runAgent(command, async (result) => {
    if (result.status === 'error') hadCmdError = true;
    const text = resultToText(result.result);
    if (text) await deps.sendMessage(text);
  });

  // Advance cursor to the command — messages AFTER it remain pending for next poll.
  deps.advanceCursor(cmdMsg.timestamp);
  await deps.setTyping(false);

  if (cmdOutput === 'error' || hadCmdError) {
    await deps.sendMessage(`${command} failed. The session is unchanged.`);
  }

  return { handled: true, success: true };
}
