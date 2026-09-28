/**
 * Loads an optional Capacitor native-only package via a `Function`-constructed
 * dynamic `import()`. Bundlers analyze static `import()` calls and will try to
 * resolve/bundle the specifier at build time; some Capacitor community plugins
 * aren't installed on every platform (or at all in some app targets), so this
 * indirection hides the specifier from that static analysis and only resolves
 * it at runtime, on the platform that actually has the package.
 *
 * Kept in its own module (rather than inlined per-caller) so it can be
 * `vi.mock`'d directly in tests - Vitest's module sandbox cannot satisfy a
 * dynamic `import()` created via `new Function(...)` (it throws "A dynamic
 * import callback was not specified"), so callers must go through a mockable
 * seam like this one instead of constructing the trick inline.
 */
export const loadOptionalNativeModule = (specifier: string) =>
  new Function("moduleName", "return import(moduleName)")(specifier) as Promise<any>;
