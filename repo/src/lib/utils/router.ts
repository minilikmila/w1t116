import { writable, derived, get } from 'svelte/store';
import type { Role } from '../types';

// ============================================================
// Route Definition
// ============================================================

export interface RouteDefinition {
  path: string;
  component: () => Promise<{ default: any }>;
  roles: Role[] | 'public';
}

// ============================================================
// Router State
// ============================================================

export const currentPath = writable(getHashPath());
export const currentParams = writable<Record<string, string>>({});
export const currentQuery = writable<Record<string, string>>({});

function getHashPath(): string {
  const hash = window.location.hash.slice(1) || '/login';
  const questionIndex = hash.indexOf('?');
  return questionIndex >= 0 ? hash.slice(0, questionIndex) : hash;
}

function getHashQuery(): Record<string, string> {
  const hash = window.location.hash.slice(1) || '';
  const questionIndex = hash.indexOf('?');
  if (questionIndex < 0) return {};
  const params = new URLSearchParams(hash.slice(questionIndex + 1));
  const result: Record<string, string> = {};
  params.forEach((v, k) => { result[k] = v; });
  return result;
}

// ============================================================
// Route Registry
// ============================================================

const routes: RouteDefinition[] = [];

export function registerRoutes(defs: RouteDefinition[]): void {
  routes.length = 0;
  routes.push(...defs);
}

// ============================================================
// Route Matching
// ============================================================

interface MatchResult {
  route: RouteDefinition;
  params: Record<string, string>;
}

function matchRoute(path: string): MatchResult | null {
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params !== null) {
      return { route, params };
    }
  }
  return null;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const pathPart = pathParts[i];

    if (pp.startsWith(':')) {
      params[pp.slice(1)] = pathPart;
    } else if (pp !== pathPart) {
      return null;
    }
  }

  return params;
}

// ============================================================
// Navigation
// ============================================================

export function navigate(path: string, query?: Record<string, string>): void {
  let hash = path;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    hash += '?' + params.toString();
  }
  window.location.hash = hash;
}

export function replaceRoute(path: string, query?: Record<string, string>): void {
  let hash = '#' + path;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    hash += '?' + params.toString();
  }
  window.history.replaceState(null, '', hash);
  currentPath.set(path);
  currentParams.set({});
  currentQuery.set(query || {});
}

// ============================================================
// Resolve current route
// ============================================================

export interface ResolvedRoute {
  route: RouteDefinition | null;
  params: Record<string, string>;
  component: any | null;
}

export const resolvedRoute = writable<ResolvedRoute>({
  route: null,
  params: {},
  component: null,
});

export async function resolveCurrentRoute(): Promise<ResolvedRoute> {
  const path = get(currentPath);
  const match = matchRoute(path);

  if (!match) {
    const result = { route: null, params: {}, component: null };
    resolvedRoute.set(result);
    return result;
  }

  currentParams.set(match.params);

  try {
    const mod = await match.route.component();
    const result = { route: match.route, params: match.params, component: mod.default };
    resolvedRoute.set(result);
    return result;
  } catch {
    const result = { route: match.route, params: match.params, component: null };
    resolvedRoute.set(result);
    return result;
  }
}

/**
 * Get the permitted roles for a given path.
 */
export function getRouteRoles(path: string): Role[] | 'public' | null {
  const match = matchRoute(path);
  return match ? match.route.roles : null;
}

// ============================================================
// Hash Change Listener
// ============================================================

let listening = false;

export function startRouter(): () => void {
  if (listening) return () => {};

  const handler = () => {
    currentPath.set(getHashPath());
    currentQuery.set(getHashQuery());
    resolveCurrentRoute();
  };

  window.addEventListener('hashchange', handler);
  listening = true;

  // Initial resolve
  handler();

  return () => {
    window.removeEventListener('hashchange', handler);
    listening = false;
  };
}
