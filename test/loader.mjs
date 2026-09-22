// Test-only module resolver: lets the unit tests import the app's TypeScript
// sources with the extensionless / "@/..." specifiers that Next.js uses.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = pathToFileURL(path.join(process.cwd(), 'src') + path.sep);

export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const isAlias = specifier.startsWith('@/');
  if ((isRelative || isAlias) && !/\.[a-zA-Z]+$/.test(specifier)) {
    const base = isAlias ? SRC : context.parentURL;
    const rel = isAlias ? `./${specifier.slice(2)}` : specifier;
    const url = new URL(rel, base);
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      const candidate = `${url.href}${suffix}`;
      if (existsSync(fileURLToPath(candidate))) return next(candidate, context);
    }
  }
  return next(specifier, context);
}
