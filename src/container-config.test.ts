import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Temp directory for config file and mount paths
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'container-config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Point CONTAINER_CONFIG_PATH to the temp directory
vi.mock('./config.js', () => ({
  CONTAINER_CONFIG_PATH: '',
  MOUNT_ALLOWLIST_PATH: '',
}));

// Suppress log output during tests
vi.mock('pino', () => {
  const noop = vi.fn();
  const logger = { debug: noop, info: noop, warn: noop, error: noop };
  return { default: () => logger };
});

// We need to set CONTAINER_CONFIG_PATH dynamically per test.
// Import after mocks are set up.
import * as config from './config.js';
import { loadContainerConfig, getConfigMounts } from './mount-security.js';
import type { ContainerConfigFile } from './types.js';

function configPath(): string {
  return path.join(tmpDir, 'container-config.json');
}

function setConfigPath(): void {
  // Overwrite the mocked constant
  (config as Record<string, unknown>).CONTAINER_CONFIG_PATH = configPath();
}

function writeConfig(cfg: unknown): void {
  setConfigPath();
  fs.writeFileSync(configPath(), JSON.stringify(cfg));
}

function validConfig(
  overrides?: Partial<ContainerConfigFile>,
): ContainerConfigFile {
  return {
    version: 1,
    mounts: [],
    security: {
      extraBlockedPatterns: [],
      nonMainReadOnly: true,
    },
    ...overrides,
  };
}

/** Create a real directory inside tmpDir and return its absolute path */
function createMountDir(name: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── loadContainerConfig ────────────────────────────────────────────

describe('loadContainerConfig', () => {
  it('returns null when file does not exist', () => {
    setConfigPath();
    expect(loadContainerConfig()).toBeNull();
  });

  it('returns valid config', () => {
    const cfg = validConfig({
      mounts: [
        {
          path: '/tmp/test',
          containerPath: 'test',
          readWrite: true,
        },
      ],
    });
    writeConfig(cfg);
    expect(loadContainerConfig()).toEqual(cfg);
  });

  it('returns null for invalid JSON', () => {
    setConfigPath();
    fs.writeFileSync(configPath(), '{ broken json');
    expect(loadContainerConfig()).toBeNull();
  });

  it('returns null for wrong version', () => {
    writeConfig({ ...validConfig(), version: 99 });
    expect(loadContainerConfig()).toBeNull();
  });

  it('returns null when mounts is not an array', () => {
    writeConfig({ ...validConfig(), mounts: 'not-an-array' });
    expect(loadContainerConfig()).toBeNull();
  });

  it('returns null when security section is missing', () => {
    writeConfig({ version: 1, mounts: [] });
    expect(loadContainerConfig()).toBeNull();
  });

  it('returns null when extraBlockedPatterns is not an array', () => {
    writeConfig({
      version: 1,
      mounts: [],
      security: { extraBlockedPatterns: 'bad', nonMainReadOnly: true },
    });
    expect(loadContainerConfig()).toBeNull();
  });

  it('returns null when nonMainReadOnly is not a boolean', () => {
    writeConfig({
      version: 1,
      mounts: [],
      security: { extraBlockedPatterns: [], nonMainReadOnly: 'yes' },
    });
    expect(loadContainerConfig()).toBeNull();
  });
});

// ─── getConfigMounts ────────────────────────────────────────────────

describe('getConfigMounts', () => {
  it('returns null when no config file exists', () => {
    setConfigPath();
    expect(getConfigMounts(true)).toBeNull();
  });

  it('returns empty array when config has no mounts', () => {
    writeConfig(validConfig());
    expect(getConfigMounts(true)).toEqual([]);
  });

  it('returns mounts for main group', () => {
    const dir = createMountDir('vault');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: 'vault', readWrite: true }],
      }),
    );

    const result = getConfigMounts(true);
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({
      hostPath: fs.realpathSync(dir),
      containerPath: '/workspace/extra/vault',
      readonly: false,
      description: undefined,
    });
  });

  it('returns description when provided', () => {
    const dir = createMountDir('vault');
    writeConfig(
      validConfig({
        mounts: [
          {
            path: dir,
            containerPath: 'vault',
            readWrite: true,
            description: 'Test vault',
          },
        ],
      }),
    );

    const result = getConfigMounts(true);
    expect(result![0].description).toBe('Test vault');
  });

  it('filters non-allGroups mounts for non-main group', () => {
    const dir = createMountDir('vault');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: 'vault', readWrite: true }],
      }),
    );

    expect(getConfigMounts(false)).toEqual([]);
  });

  it('includes allGroups mounts for non-main group', () => {
    const dir = createMountDir('shared');
    writeConfig(
      validConfig({
        mounts: [
          {
            path: dir,
            containerPath: 'shared',
            readWrite: true,
            allGroups: true,
          },
        ],
      }),
    );

    const result = getConfigMounts(false);
    expect(result).toHaveLength(1);
    expect(result![0].containerPath).toBe('/workspace/extra/shared');
  });

  it('skips mount with invalid container path', () => {
    const dir = createMountDir('vault');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: '../escape', readWrite: true }],
      }),
    );

    expect(getConfigMounts(true)).toEqual([]);
  });

  it('skips mount when host path does not exist', () => {
    writeConfig(
      validConfig({
        mounts: [
          {
            path: path.join(tmpDir, 'nonexistent'),
            containerPath: 'ghost',
            readWrite: true,
          },
        ],
      }),
    );

    expect(getConfigMounts(true)).toEqual([]);
  });

  it('skips mount matching default blocked pattern', () => {
    const dir = createMountDir('.ssh');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: 'ssh', readWrite: true }],
      }),
    );

    expect(getConfigMounts(true)).toEqual([]);
  });

  it('skips mount matching extraBlockedPatterns', () => {
    const dir = createMountDir('my-secrets');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: 'secrets', readWrite: true }],
        security: {
          extraBlockedPatterns: ['my-secrets'],
          nonMainReadOnly: true,
        },
      }),
    );

    expect(getConfigMounts(true)).toEqual([]);
  });

  it('sets readonly when readWrite is false', () => {
    const dir = createMountDir('docs');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: 'docs', readWrite: false }],
      }),
    );

    const result = getConfigMounts(true);
    expect(result![0].readonly).toBe(true);
  });

  it('forces readonly for non-main when nonMainReadOnly is true', () => {
    const dir = createMountDir('shared');
    writeConfig(
      validConfig({
        mounts: [
          {
            path: dir,
            containerPath: 'shared',
            readWrite: true,
            allGroups: true,
          },
        ],
        security: {
          extraBlockedPatterns: [],
          nonMainReadOnly: true,
        },
      }),
    );

    const result = getConfigMounts(false);
    expect(result![0].readonly).toBe(true);
  });

  it('allows read-write for non-main when nonMainReadOnly is false', () => {
    const dir = createMountDir('shared');
    writeConfig(
      validConfig({
        mounts: [
          {
            path: dir,
            containerPath: 'shared',
            readWrite: true,
            allGroups: true,
          },
        ],
        security: {
          extraBlockedPatterns: [],
          nonMainReadOnly: false,
        },
      }),
    );

    const result = getConfigMounts(false);
    expect(result![0].readonly).toBe(false);
  });

  it('prefixes containerPath with /workspace/extra/', () => {
    const dir = createMountDir('data');
    writeConfig(
      validConfig({
        mounts: [{ path: dir, containerPath: 'data', readWrite: true }],
      }),
    );

    const result = getConfigMounts(true);
    expect(result![0].containerPath).toBe('/workspace/extra/data');
  });

  it('handles multiple mounts with mixed validity', () => {
    const goodDir = createMountDir('good');
    const sshDir = createMountDir('.ssh');
    writeConfig(
      validConfig({
        mounts: [
          { path: goodDir, containerPath: 'good', readWrite: true },
          { path: sshDir, containerPath: 'ssh', readWrite: true },
          {
            path: path.join(tmpDir, 'missing'),
            containerPath: 'gone',
            readWrite: true,
          },
        ],
      }),
    );

    const result = getConfigMounts(true);
    expect(result).toHaveLength(1);
    expect(result![0].containerPath).toBe('/workspace/extra/good');
  });
});
