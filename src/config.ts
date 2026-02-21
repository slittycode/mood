import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  CLI_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  MAX_FILES_TO_SCAN,
  MAX_CONCURRENT_FILES,
} from './constants.js';

/** Configuration options for mood CLI. */
export interface MoodConfig {
  /** Anthropic model to use (default: claude-3-5-sonnet-20241022) */
  model?: string;
  /** CLI timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Git operations timeout in milliseconds (default: 5000) */
  gitTimeout?: number;
  /** Maximum files to scan for TODOs (default: 1000) */
  maxFiles?: number;
  /** Maximum concurrent file reads (default: 50) */
  maxConcurrent?: number;
  /** Additional patterns to exclude from scanning */
  excludePatterns?: string[];
}

const DEFAULT_CONFIG: Required<MoodConfig> = {
  model: 'claude-3-5-sonnet-20241022',
  timeout: CLI_TIMEOUT_MS,
  gitTimeout: GIT_TIMEOUT_MS,
  maxFiles: MAX_FILES_TO_SCAN,
  maxConcurrent: MAX_CONCURRENT_FILES,
  excludePatterns: [],
};

const CONFIG_FILENAMES = ['.moodrc', '.moodrc.json', '.moodrc.yaml', '.moodrc.yml'];

/**
 * Searches for a config file from cwd up to home directory.
 * @param cwd - The current working directory to start searching from.
 * @returns The path to the config file, or null if not found.
 */
function findConfigFile(cwd: string): string | null {
  let currentDir = path.resolve(cwd);
  const homeDir = process.env.HOME || process.env.USERPROFILE;

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const configPath = path.join(currentDir, filename);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || (homeDir && currentDir === homeDir)) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Loads configuration from a file.
 * @param configPath - Path to the config file.
 * @returns Parsed configuration object.
 * @throws Error if the file cannot be read or parsed.
 */
function loadConfigFile(configPath: string): Partial<MoodConfig> {
  const content = fs.readFileSync(configPath, 'utf8');
  const ext = path.extname(configPath).toLowerCase();

  if (ext === '.json' || ext === '') {
    return JSON.parse(content) as Partial<MoodConfig>;
  }

  if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(content) as Partial<MoodConfig>;
  }

  throw new Error(`Unsupported config file format: ${ext}`);
}

/**
 * Loads configuration with priority: defaults < config file < env vars.
 * @param cwd - The current working directory.
 * @param configPath - Optional explicit config file path.
 * @returns Merged configuration object.
 */
export function loadConfig(cwd: string, configPath?: string): Required<MoodConfig> {
  let fileConfig: Partial<MoodConfig> = {};

  const resolvedConfigPath = configPath || findConfigFile(cwd);
  if (resolvedConfigPath) {
    try {
      fileConfig = loadConfigFile(resolvedConfigPath);
    } catch (e) {
      console.warn(`mood: failed to load config from ${resolvedConfigPath}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    model: process.env.MOOD_MODEL || fileConfig.model || DEFAULT_CONFIG.model,
    timeout: parseInt(process.env.MOOD_TIMEOUT || '', 10) || fileConfig.timeout || DEFAULT_CONFIG.timeout,
    gitTimeout: parseInt(process.env.MOOD_GIT_TIMEOUT || '', 10) || fileConfig.gitTimeout || DEFAULT_CONFIG.gitTimeout,
    maxFiles: fileConfig.maxFiles || DEFAULT_CONFIG.maxFiles,
    maxConcurrent: fileConfig.maxConcurrent || DEFAULT_CONFIG.maxConcurrent,
    excludePatterns: fileConfig.excludePatterns || DEFAULT_CONFIG.excludePatterns,
  };
}
