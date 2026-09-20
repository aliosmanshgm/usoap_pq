// Faz 8B.2 - lightweight cross-module runtime registry.
// Domain modules use this only for callbacks that would otherwise create circular imports.
export const runtime = Object.create(null);

export function register(name, fn) {
  runtime[name] = fn;
  return fn;
}

export function expose(name, fn) {
  register(name, fn);
  if (typeof window !== "undefined") window[name] = fn;
  return fn;
}
