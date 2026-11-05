import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Extension scripts are classic scripts sharing one global scope, so that's how they're
// loaded here. `get` reads any of their top-level names, consts included.
export function loadScripts(paths, globals = {}) {
  const context = vm.createContext({ console, URL, ...globals });
  for (const path of paths) {
    vm.runInContext(readFileSync(join(ROOT, path), 'utf8'), context, { filename: path });
  }
  return { context, get: name => vm.runInContext(name, context) };
}

// Round-trips through JSON: objects made in a vm context have foreign prototypes,
// which strict deep equality rejects.
export const plain = value => JSON.parse(JSON.stringify(value));
