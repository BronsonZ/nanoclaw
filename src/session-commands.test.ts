import { describe, it, expect, vi } from 'vitest';
import {
  extractSessionCommand,
  formatContextSnapshot,
  formatContextSnapshotFull,
  handleSessionCommand,
  isSessionCommandAllowed,
} from './session-commands.js';
import type { NewMessage } from './types.js';
import type {
  ContextSnapshot,
  SessionCommandDeps,
} from './session-commands.js';

describe('extractSessionCommand', () => {
  const trigger = /^@Andy\b/i;

  it('detects bare /compact', () => {
    expect(extractSessionCommand('/compact', trigger)).toBe('/compact');
  });

  it('detects /compact with trigger prefix', () => {
    expect(extractSessionCommand('@Andy /compact', trigger)).toBe('/compact');
  });

  it('rejects /compact with extra text', () => {
    expect(extractSessionCommand('/compact now please', trigger)).toBeNull();
  });

  it('rejects partial matches', () => {
    expect(extractSessionCommand('/compaction', trigger)).toBeNull();
  });

  it('rejects regular messages', () => {
    expect(
      extractSessionCommand('please compact the conversation', trigger),
    ).toBeNull();
  });

  it('handles whitespace', () => {
    expect(extractSessionCommand('  /compact  ', trigger)).toBe('/compact');
  });

  it('is case-sensitive for the command', () => {
    expect(extractSessionCommand('/Compact', trigger)).toBeNull();
  });

  it('detects bare /clear', () => {
    expect(extractSessionCommand('/clear', trigger)).toBe('/clear');
  });

  it('detects /clear with trigger prefix', () => {
    expect(extractSessionCommand('@Andy /clear', trigger)).toBe('/clear');
  });

  it('rejects /clear with extra text', () => {
    expect(extractSessionCommand('/clear everything', trigger)).toBeNull();
  });

  it('rejects partial /clear matches', () => {
    expect(extractSessionCommand('/clearall', trigger)).toBeNull();
  });

  it('handles whitespace around /clear', () => {
    expect(extractSessionCommand('  /clear  ', trigger)).toBe('/clear');
  });

  it('is case-sensitive for /clear', () => {
    expect(extractSessionCommand('/Clear', trigger)).toBeNull();
  });

  it('detects bare /context', () => {
    expect(extractSessionCommand('/context', trigger)).toBe('/context');
  });

  it('detects /context with trigger prefix', () => {
    expect(extractSessionCommand('@Andy /context', trigger)).toBe('/context');
  });

  it('rejects /context with extra text', () => {
    expect(extractSessionCommand('/context please', trigger)).toBeNull();
  });

  it('rejects partial /context matches', () => {
    expect(extractSessionCommand('/contextual', trigger)).toBeNull();
  });

  it('detects /context full', () => {
    expect(extractSessionCommand('/context full', trigger)).toBe(
      '/context full',
    );
  });

  it('detects /context full with trigger prefix', () => {
    expect(extractSessionCommand('@Andy /context full', trigger)).toBe(
      '/context full',
    );
  });

  it('rejects unknown /context subcommand', () => {
    expect(extractSessionCommand('/context verbose', trigger)).toBeNull();
  });
});

describe('isSessionCommandAllowed', () => {
  it('allows main group regardless of sender', () => {
    expect(isSessionCommandAllowed(true, false)).toBe(true);
  });

  it('allows trusted/admin sender (is_from_me) in non-main group', () => {
    expect(isSessionCommandAllowed(false, true)).toBe(true);
  });

  it('denies untrusted sender in non-main group', () => {
    expect(isSessionCommandAllowed(false, false)).toBe(false);
  });

  it('allows trusted sender in main group', () => {
    expect(isSessionCommandAllowed(true, true)).toBe(true);
  });
});

function makeMsg(
  content: string,
  overrides: Partial<NewMessage> = {},
): NewMessage {
  return {
    id: 'msg-1',
    chat_jid: 'group@test',
    sender: 'user@test',
    sender_name: 'User',
    content,
    timestamp: '100',
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<SessionCommandDeps> = {},
): SessionCommandDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    setTyping: vi.fn().mockResolvedValue(undefined),
    runAgent: vi.fn().mockResolvedValue('success'),
    closeStdin: vi.fn(),
    advanceCursor: vi.fn(),
    formatMessages: vi.fn().mockReturnValue('<formatted>'),
    canSenderInteract: vi.fn().mockReturnValue(true),
    clearSession: vi.fn(),
    getContextSnapshot: vi
      .fn()
      .mockReturnValue({ ok: false, reason: 'missing' }),
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ContextSnapshot> = {},
): ContextSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sessionId: 'sess-1',
    model: 'claude-opus-4-7[1m]',
    totalTokens: 45231,
    maxTokens: 250000,
    rawMaxTokens: 1000000,
    percentage: 18.09,
    autoCompactThreshold: 250000,
    isAutoCompactEnabled: true,
    categories: [
      { name: 'messages', tokens: 23000 },
      { name: 'mcp tools', tokens: 12500 },
      { name: 'system prompt', tokens: 5100 },
      { name: 'skills', tokens: 2800 },
      { name: 'memory files', tokens: 1700 },
      { name: 'empty', tokens: 0 },
    ],
    mcpTools: [],
    memoryFiles: [],
    ...overrides,
  };
}

const trigger = /^@Andy\b/i;

describe('handleSessionCommand', () => {
  it('returns handled:false when no session command found', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('hello')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result.handled).toBe(false);
  });

  it('handles authorized /compact in main group', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/compact')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.runAgent).toHaveBeenCalledWith(
      '/compact',
      expect.any(Function),
    );
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('sends denial to interactable sender in non-main group', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/compact', { is_from_me: false })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'Session commands require admin access.',
    );
    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('silently consumes denied command when sender cannot interact', async () => {
    const deps = makeDeps({
      canSenderInteract: vi.fn().mockReturnValue(false),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/compact', { is_from_me: false })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('processes pre-compact messages before /compact', async () => {
    const deps = makeDeps();
    const msgs = [
      makeMsg('summarize this', { timestamp: '99' }),
      makeMsg('/compact', { timestamp: '100' }),
    ];
    const result = await handleSessionCommand({
      missedMessages: msgs,
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.formatMessages).toHaveBeenCalledWith([msgs[0]], 'UTC');
    // Two runAgent calls: pre-compact + /compact
    expect(deps.runAgent).toHaveBeenCalledTimes(2);
    expect(deps.runAgent).toHaveBeenCalledWith(
      '<formatted>',
      expect.any(Function),
    );
    expect(deps.runAgent).toHaveBeenCalledWith(
      '/compact',
      expect.any(Function),
    );
  });

  it('allows is_from_me sender in non-main group', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/compact', { is_from_me: true })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.runAgent).toHaveBeenCalledWith(
      '/compact',
      expect.any(Function),
    );
  });

  it('reports failure when command-stage runAgent returns error without streamed status', async () => {
    // runAgent resolves 'error' but callback never gets status: 'error'
    const deps = makeDeps({
      runAgent: vi.fn().mockImplementation(async (prompt, onOutput) => {
        await onOutput({ status: 'success', result: null });
        return 'error';
      }),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/compact')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
    );
  });

  it('returns success:false on pre-compact failure with no output', async () => {
    const deps = makeDeps({ runAgent: vi.fn().mockResolvedValue('error') });
    const msgs = [
      makeMsg('summarize this', { timestamp: '99' }),
      makeMsg('/compact', { timestamp: '100' }),
    ];
    const result = await handleSessionCommand({
      missedMessages: msgs,
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: false });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process'),
    );
  });

  it('handles authorized /clear in main group without spawning a container', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/clear')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.clearSession).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledWith('Conversation cleared.');
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
    // Key invariant: /clear is host-side only — it must NOT invoke the agent.
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('discards pre-clear messages without processing them', async () => {
    const deps = makeDeps();
    const msgs = [
      makeMsg('this should be discarded', { timestamp: '99' }),
      makeMsg('/clear', { timestamp: '100' }),
    ];
    const result = await handleSessionCommand({
      missedMessages: msgs,
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    // No agent run, no formatting — pre-clear messages are dropped by design.
    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(deps.formatMessages).not.toHaveBeenCalled();
    expect(deps.clearSession).toHaveBeenCalledTimes(1);
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('denies /clear from untrusted sender in non-main group', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/clear', { is_from_me: false })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'Session commands require admin access.',
    );
    expect(deps.clearSession).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('silently consumes denied /clear when sender cannot interact', async () => {
    const deps = makeDeps({
      canSenderInteract: vi.fn().mockReturnValue(false),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/clear', { is_from_me: false })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.clearSession).not.toHaveBeenCalled();
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('allows is_from_me sender to /clear in non-main group', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/clear', { is_from_me: true })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.clearSession).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledWith('Conversation cleared.');
  });

  it('/context sends formatted snapshot when available', async () => {
    const snapshot = makeSnapshot();
    const deps = makeDeps({
      getContextSnapshot: vi.fn().mockReturnValue({ ok: true, snapshot }),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/context')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    const sent = (deps.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(sent).toContain('Context: 45,231 / 250,000 tokens (18%)');
    expect(sent).toContain('Model: `claude-opus-4-7[1m]`');
    expect(sent).toContain('messages: 23,000');
    expect(deps.advanceCursor).toHaveBeenCalledWith('100');
  });

  it('/context reports missing snapshot', async () => {
    const deps = makeDeps({
      getContextSnapshot: vi
        .fn()
        .mockReturnValue({ ok: false, reason: 'missing' }),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/context')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'No context snapshot yet — send a message first.',
    );
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it('/context reports parse error', async () => {
    const deps = makeDeps({
      getContextSnapshot: vi
        .fn()
        .mockReturnValue({ ok: false, reason: 'parse-error' }),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/context')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'Context snapshot is unreadable. Try again after the next turn.',
    );
  });

  it('denies /context from untrusted sender in non-main group', async () => {
    const deps = makeDeps();
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/context', { is_from_me: false })],
      isMainGroup: false,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'Session commands require admin access.',
    );
    expect(deps.getContextSnapshot).not.toHaveBeenCalled();
  });

  it('/context full sends expanded snapshot', async () => {
    const snapshot = makeSnapshot({
      mcpTools: [
        {
          name: 'mcp__nanoclaw__schedule_task',
          serverName: 'nanoclaw',
          tokens: 1275,
          isLoaded: false,
        },
      ],
      memoryFiles: [
        { path: '/workspace/group/CLAUDE.md', tokens: 2959, type: 'Project' },
      ],
      apiUsage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 80000,
      },
      systemTools: [
        { name: 'Bash', tokens: 4200 },
        { name: 'Read', tokens: 1500 },
      ],
      systemPromptSections: [
        { name: 'Core identity', tokens: 3200 },
        { name: 'Global CLAUDE.md', tokens: 7700 },
      ],
    });
    const deps = makeDeps({
      getContextSnapshot: vi.fn().mockReturnValue({ ok: true, snapshot }),
    });
    const result = await handleSessionCommand({
      missedMessages: [makeMsg('/context full')],
      isMainGroup: true,
      groupName: 'test',
      triggerPattern: trigger,
      timezone: 'UTC',
      deps,
    });
    expect(result).toEqual({ handled: true, success: true });
    const sent = (deps.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(sent).toContain('Top MCP tools:');
    expect(sent).toContain('`mcp__nanoclaw__schedule_task`: 1,275 (deferred)');
    expect(sent).toContain('Memory files:');
    expect(sent).toContain('`/workspace/group/CLAUDE.md`: 2,959');
    expect(sent).toContain('Last-turn API usage:');
    expect(sent).toContain('cache read: 80,000');
    expect(sent).toContain('System tools:');
    expect(sent).toContain('`Bash`: 4,200');
    expect(sent).toContain('System prompt sections:');
    expect(sent).toContain('Global CLAUDE.md: 7,700');
  });
});

describe('formatContextSnapshot', () => {
  it('renders a stable multi-line summary', () => {
    const snap = makeSnapshot({
      capturedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    });
    const text = formatContextSnapshot(snap);
    expect(text).toContain('Context: 45,231 / 250,000 tokens (18%)');
    expect(text).toContain('Model: `claude-opus-4-7[1m]`');
    expect(text).toContain('Auto-compact at: 250,000');
    expect(text).toContain('Top categories:');
    expect(text).toContain('messages: 23,000');
    // Zero-token category is excluded.
    expect(text).not.toContain('empty:');
  });

  it('omits auto-compact line when threshold is absent', () => {
    const snap = makeSnapshot({ autoCompactThreshold: undefined });
    expect(formatContextSnapshot(snap)).not.toContain('Auto-compact at');
  });
});
