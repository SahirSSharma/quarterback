// Preload for running this repo's .ts scripts with plain Node: Node strips types but does not add
// extensions to relative import specifiers, and the repo's imports are extensionless (Vitest and Next
// resolve them). Usage:  node --import ./scripts/node-ts.ts scripts/<script>.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // Not a .ts file: fall through to the default resolution and its error.
      }
    }
    return next(specifier, context);
  },
});
