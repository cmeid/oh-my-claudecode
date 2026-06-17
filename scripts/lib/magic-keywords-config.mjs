/**
 * Runtime resolver for user-configurable magic-keyword triggers.
 *
 * Reads `magicKeywords.<mode>` from the OMC user/project config (the same
 * JSONC files src/config/loader.ts loads) so the keyword-detector hook can
 * honor per-mode trigger overrides instead of its hardcoded defaults. This
 * lets a user retrigger a mode under a different word (e.g. set
 * `magicKeywords.ultrawork` to `["raging"]`) — useful for avoiding keyword
 * collisions with other plugins.
 *
 * Inlined (no dist/ import) so the hook stays build-independent, mirroring
 * scripts/lib/agent-model-config.mjs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stripJsoncComments } from './agent-model-config.mjs';

// Mirrors src/utils/paths.ts:getConfigDir
function getConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  }
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

// Mirrors src/config/loader.ts:getConfigPaths
function getConfigPaths(cwd) {
  return {
    user: join(getConfigDir(), 'claude-omc', 'config.jsonc'),
    project: join(cwd || process.cwd(), '.claude', 'omc.jsonc'),
  };
}

function loadJsoncFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(stripJsoncComments(readFileSync(path, 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * Resolve configured trigger words for a keyword-detector mode.
 *
 * Returns a non-empty `string[]` when the user configured an override
 * (project config wins over user config, matching loadConfig()'s merge
 * order), or `null` to signal "use the built-in default". Override
 * semantics are REPLACE, not append — `["raging"]` means only `raging`
 * triggers the mode.
 *
 * @param {string} mode  keyword-detector mode name (e.g. "ultrawork")
 * @param {string} [cwd] project directory (for `.claude/omc.jsonc`)
 * @returns {string[] | null}
 */
export function resolveModeTriggerWords(mode, cwd) {
  if (typeof mode !== 'string' || !mode) return null;
  const paths = getConfigPaths(cwd);
  // Project config takes precedence over user config (loadConfig merge order).
  for (const path of [paths.project, paths.user]) {
    const config = loadJsoncFile(path);
    const words = config?.magicKeywords?.[mode];
    if (Array.isArray(words) && words.length > 0 &&
        words.every((w) => typeof w === 'string' && w.trim().length > 0)) {
      return words.map((w) => w.trim());
    }
  }
  return null;
}

/**
 * Build a case-insensitive whole-word alternation regex from trigger words.
 * Each word is regex-escaped. Returns e.g. /\b(raging|raging-parallelism)\b/i.
 *
 * @param {string[]} words
 * @returns {RegExp}
 */
export function buildTriggerRegex(words) {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

/**
 * Resolve a mode's trigger regex: the user override (if configured) or the
 * provided built-in default. Centralizes the "config-or-default" decision so
 * detection sites stay one-liners.
 *
 * @param {string} mode
 * @param {RegExp} defaultRegex  built-in pattern used when no override exists
 * @param {string} [cwd]
 * @returns {RegExp}
 */
export function resolveTriggerRegex(mode, defaultRegex, cwd) {
  const override = resolveModeTriggerWords(mode, cwd);
  return override ? buildTriggerRegex(override) : defaultRegex;
}
