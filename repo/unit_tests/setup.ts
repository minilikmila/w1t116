import 'fake-indexeddb/auto';

// Provide localStorage and crypto for Node/jsdom environment
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  } as Storage;
}

// Provide crypto.randomUUID if not available
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  const nodeCrypto = await import('node:crypto');
  if (!globalThis.crypto) {
    // @ts-ignore
    globalThis.crypto = nodeCrypto.webcrypto;
  }
}

// Provide BroadcastChannel stub (not available in Node)
if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class BroadcastChannel {
    name: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    constructor(name: string) { this.name = name; }
    postMessage(_data: unknown) { /* no-op in tests */ }
    close() { /* no-op */ }
    addEventListener() { /* no-op */ }
    removeEventListener() { /* no-op */ }
    dispatchEvent() { return false; }
  } as unknown as typeof BroadcastChannel;
}
