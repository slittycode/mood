import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from './config.js';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mood-config-test-'));
}

afterEach(() => {
    vi.unstubAllEnvs();
});

// ─── defaults ─────────────────────────────────────────────────────────────────

describe('loadConfig — defaults', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('returns all defaults when no config file or env vars exist', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', '');
        vi.stubEnv('BEDROCK_MODEL_ID', '');
        vi.stubEnv('MOOD_TIMEOUT', '');
        vi.stubEnv('MOOD_GIT_TIMEOUT', '');

        const config = loadConfig(tmpDir);

        expect(config.awsRegion).toBe('us-east-1');
        expect(config.model).toBe('us.anthropic.claude-3-5-sonnet-20241022-v2:0');
        expect(config.timeout).toBe(10_000);
        expect(config.gitTimeout).toBe(5_000);
        expect(config.maxFiles).toBe(1_000);
        expect(config.maxConcurrent).toBe(50);
        expect(config.excludePatterns).toEqual([]);
    });
});

// ─── config file values ───────────────────────────────────────────────────────

describe('loadConfig — config file (JSON)', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('reads awsRegion from a .moodrc.json file', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', '');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, JSON.stringify({ awsRegion: 'eu-west-1' }));

        const config = loadConfig(tmpDir, configPath);
        expect(config.awsRegion).toBe('eu-west-1');
    });

    it('reads model, timeout and gitTimeout from JSON config', () => {
        vi.stubEnv('BEDROCK_MODEL_ID', '');
        vi.stubEnv('MOOD_TIMEOUT', '');
        vi.stubEnv('MOOD_GIT_TIMEOUT', '');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(
            configPath,
            JSON.stringify({ model: 'my-model', timeout: 20_000, gitTimeout: 3_000 }),
        );
        const config = loadConfig(tmpDir, configPath);
        expect(config.model).toBe('my-model');
        expect(config.timeout).toBe(20_000);
        expect(config.gitTimeout).toBe(3_000);
    });
});

describe('loadConfig — config file (YAML)', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('reads awsRegion from a .moodrc.yaml file', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', '');
        const configPath = path.join(tmpDir, '.moodrc.yaml');
        fs.writeFileSync(configPath, 'awsRegion: ap-southeast-1\n');

        const config = loadConfig(tmpDir, configPath);
        expect(config.awsRegion).toBe('ap-southeast-1');
    });
});

// ─── env var priority ─────────────────────────────────────────────────────────

describe('loadConfig — env var priority', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('env AWS_REGION overrides config file awsRegion', () => {
        vi.stubEnv('AWS_REGION', 'us-west-2');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, JSON.stringify({ awsRegion: 'eu-west-1' }));

        const config = loadConfig(tmpDir, configPath);
        expect(config.awsRegion).toBe('us-west-2');
    });

    it('env AWS_DEFAULT_REGION overrides config file awsRegion when AWS_REGION is absent', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', 'ca-central-1');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, JSON.stringify({ awsRegion: 'eu-west-1' }));

        const config = loadConfig(tmpDir, configPath);
        expect(config.awsRegion).toBe('ca-central-1');
    });

    it('env BEDROCK_MODEL_ID overrides config file model', () => {
        vi.stubEnv('BEDROCK_MODEL_ID', 'env-model');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, JSON.stringify({ model: 'file-model' }));

        const config = loadConfig(tmpDir, configPath);
        expect(config.model).toBe('env-model');
    });

    it('env MOOD_TIMEOUT overrides config file timeout', () => {
        vi.stubEnv('MOOD_TIMEOUT', '15000');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, JSON.stringify({ timeout: 5_000 }));

        const config = loadConfig(tmpDir, configPath);
        expect(config.timeout).toBe(15_000);
    });

    it('env MOOD_GIT_TIMEOUT overrides config file gitTimeout', () => {
        vi.stubEnv('MOOD_GIT_TIMEOUT', '8000');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, JSON.stringify({ gitTimeout: 2_000 }));

        const config = loadConfig(tmpDir, configPath);
        expect(config.gitTimeout).toBe(8_000);
    });
});

// ─── config file discovery ────────────────────────────────────────────────────

describe('loadConfig — config file discovery', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('finds a .moodrc file in the cwd automatically', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', '');
        fs.writeFileSync(
            path.join(tmpDir, '.moodrc.json'),
            JSON.stringify({ awsRegion: 'ap-northeast-1' }),
        );
        const config = loadConfig(tmpDir);
        expect(config.awsRegion).toBe('ap-northeast-1');
    });

    it('finds a .moodrc file in a parent directory', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', '');
        const subDir = path.join(tmpDir, 'packages', 'app');
        fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, '.moodrc.json'),
            JSON.stringify({ awsRegion: 'sa-east-1' }),
        );
        const config = loadConfig(subDir);
        expect(config.awsRegion).toBe('sa-east-1');
    });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe('loadConfig — error handling', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = makeTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('falls back to defaults when the config file contains invalid JSON', () => {
        vi.stubEnv('AWS_REGION', '');
        vi.stubEnv('AWS_DEFAULT_REGION', '');
        const configPath = path.join(tmpDir, '.moodrc.json');
        fs.writeFileSync(configPath, '{ invalid json }');

        // Should not throw; falls back gracefully
        const config = loadConfig(tmpDir, configPath);
        expect(config.awsRegion).toBe('us-east-1');
    });
});
