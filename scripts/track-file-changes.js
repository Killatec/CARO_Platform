#!/usr/bin/env node

/**
 * File Change Tracker for Code Reviews
 * Tracks file hashes and modification dates for incremental reviews
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, relative, extname } from 'path';
import { createHash } from 'crypto';

const TRACKED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.json'];
const IGNORE_PATTERNS = ['node_modules', '.git', 'dist', 'build', '*.log'];
const STATE_FILE = '.code-review-state.json';

/**
 * Calculate SHA-256 hash of file content
 */
function calculateHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if path should be ignored
 */
function shouldIgnore(path) {
  const relativePath = relative(process.cwd(), path);
  return IGNORE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      return relativePath.includes(pattern.replace('*', ''));
    }
    return relativePath.includes(pattern);
  });
}

/**
 * Recursively scan directory for tracked files
 */
async function scanDirectory(dirPath, results = {}) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDirectory(fullPath, results);
      } else if (entry.isFile() && TRACKED_EXTENSIONS.includes(extname(entry.name))) {
        try {
          const stats = await stat(fullPath);
          const content = await readFile(fullPath, 'utf-8');
          const hash = calculateHash(content);
          const relativePath = relative(process.cwd(), fullPath);

          results[relativePath] = {
            hash,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            lines: content.split('\n').length
          };
        } catch (error) {
          console.warn(`Failed to process ${fullPath}:`, error.message);
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Error scanning ${dirPath}:`, error.message);
    }
  }

  return results;
}

/**
 * Load existing state file
 */
async function loadState() {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { files: {}, lastUpdated: null };
  }
}

/**
 * Save state to file
 */
async function saveState(state) {
  const fs = await import('fs/promises');
  await fs.writeFile(STATE_FILE, JSON.stringify({
    ...state,
    lastUpdated: new Date().toISOString()
  }, null, 2));
}

/**
 * Compare current state with previous state
 */
function compareStates(previous, current) {
  const changes = {
    added: [],
    modified: [],
    deleted: [],
    unchanged: []
  };

  const allFiles = new Set([...Object.keys(previous.files), ...Object.keys(current.files)]);

  for (const file of allFiles) {
    const prev = previous.files[file];
    const curr = current.files[file];

    if (!prev && curr) {
      changes.added.push(file);
    } else if (prev && !curr) {
      changes.deleted.push(file);
    } else if (prev && curr) {
      if (prev.hash !== curr.hash) {
        changes.modified.push({
          file,
          previousModified: prev.modified,
          currentModified: curr.modified,
          sizeDiff: curr.size - prev.size,
          lineDiff: curr.lines - prev.lines
        });
      } else {
        changes.unchanged.push(file);
      }
    }
  }

  return changes;
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'scan':
      console.log('Scanning codebase...');
      const currentState = { files: await scanDirectory(process.cwd()) };
      await saveState(currentState);
      console.log(`Tracked ${Object.keys(currentState.files).length} files`);
      break;

    case 'diff':
      console.log('Comparing with previous state...');
      const previousState = await loadState();
      const newState = { files: await scanDirectory(process.cwd()) };
      const changes = compareStates(previousState, newState);

      console.log('\n📊 Code Review Change Summary:');
      console.log(`Added: ${changes.added.length} files`);
      console.log(`Modified: ${changes.modified.length} files`);
      console.log(`Deleted: ${changes.deleted.length} files`);
      console.log(`Unchanged: ${changes.unchanged.length} files`);

      if (changes.modified.length > 0) {
        console.log('\n📝 Modified Files:');
        changes.modified.forEach(change => {
          console.log(`  ${change.file} (${change.lineDiff > 0 ? '+' : ''}${change.lineDiff} lines)`);
        });
      }

      if (changes.added.length > 0) {
        console.log('\n🆕 Added Files:');
        changes.added.forEach(file => console.log(`  ${file}`));
      }
      break;

    case 'status':
      const state = await loadState();
      console.log(`Last updated: ${state.lastUpdated || 'Never'}`);
      console.log(`Tracked files: ${Object.keys(state.files).length}`);
      break;

    default:
      console.log('Usage:');
      console.log('  node scripts/track-file-changes.js scan    # Scan and save current state');
      console.log('  node scripts/track-file-changes.js diff    # Show changes since last scan');
      console.log('  node scripts/track-file-changes.js status  # Show current tracking status');
  }
}

main().catch(console.error);