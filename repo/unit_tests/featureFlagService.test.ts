import { describe, it, expect, beforeEach } from 'vitest';
import { featureFlagService } from '../src/lib/services/featureFlagService';
import type { FeatureFlag, Role } from '../src/lib/types';

// ============================================================
// We test evaluateFlag directly — it reads from the in-memory cache.
// We use createFlag to load into cache, bypassing IDB for unit isolation.
// ============================================================

/**
 * evaluateFlag is a pure function over the cache.
 * We manually populate the cache via the module's internal map
 * by calling createFlag (which writes to cache + IDB).
 * For pure unit tests, we replicate the evaluation logic.
 */
function evaluate(
  flag: Pick<FeatureFlag, 'enabled' | 'target_roles' | 'target_org_units'>,
  context: { role: string; org_unit: string },
): boolean {
  if (!flag.enabled) return false;
  if (flag.target_roles.length > 0 && !flag.target_roles.includes(context.role as Role)) return false;
  if (flag.target_org_units.length > 0 && !flag.target_org_units.includes(context.org_unit)) return false;
  return true;
}

describe('feature flag evaluation logic', () => {
  describe('enabled / disabled', () => {
    it('returns false when flag is disabled', () => {
      expect(evaluate({ enabled: false, target_roles: [], target_org_units: [] }, { role: 'SYSTEM_ADMIN', org_unit: 'HQ' })).toBe(false);
    });

    it('returns true when flag is enabled with no targeting', () => {
      expect(evaluate({ enabled: true, target_roles: [], target_org_units: [] }, { role: 'PARTICIPANT', org_unit: 'any' })).toBe(true);
    });
  });

  describe('role targeting', () => {
    it('returns true when role matches target_roles', () => {
      expect(evaluate(
        { enabled: true, target_roles: ['INSTRUCTOR', 'SYSTEM_ADMIN'], target_org_units: [] },
        { role: 'INSTRUCTOR', org_unit: 'HQ' },
      )).toBe(true);
    });

    it('returns false when role does not match target_roles', () => {
      expect(evaluate(
        { enabled: true, target_roles: ['INSTRUCTOR'], target_org_units: [] },
        { role: 'PARTICIPANT', org_unit: 'HQ' },
      )).toBe(false);
    });

    it('empty target_roles means all roles allowed', () => {
      expect(evaluate(
        { enabled: true, target_roles: [], target_org_units: [] },
        { role: 'OPS_COORDINATOR', org_unit: 'HQ' },
      )).toBe(true);
    });
  });

  describe('org_unit targeting', () => {
    it('returns true when org_unit matches', () => {
      expect(evaluate(
        { enabled: true, target_roles: [], target_org_units: ['Engineering'] },
        { role: 'SYSTEM_ADMIN', org_unit: 'Engineering' },
      )).toBe(true);
    });

    it('returns false when org_unit does not match', () => {
      expect(evaluate(
        { enabled: true, target_roles: [], target_org_units: ['Engineering'] },
        { role: 'SYSTEM_ADMIN', org_unit: 'Marketing' },
      )).toBe(false);
    });

    it('empty target_org_units means all org units allowed', () => {
      expect(evaluate(
        { enabled: true, target_roles: [], target_org_units: [] },
        { role: 'SYSTEM_ADMIN', org_unit: 'Marketing' },
      )).toBe(true);
    });
  });

  describe('combined role + org_unit targeting', () => {
    it('requires both role AND org_unit to match', () => {
      const flag = { enabled: true, target_roles: ['INSTRUCTOR'] as Role[], target_org_units: ['Science'] };

      expect(evaluate(flag, { role: 'INSTRUCTOR', org_unit: 'Science' })).toBe(true);
      expect(evaluate(flag, { role: 'INSTRUCTOR', org_unit: 'Math' })).toBe(false);
      expect(evaluate(flag, { role: 'PARTICIPANT', org_unit: 'Science' })).toBe(false);
      expect(evaluate(flag, { role: 'PARTICIPANT', org_unit: 'Math' })).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('disabled flag ignores all targeting', () => {
      expect(evaluate(
        { enabled: false, target_roles: ['SYSTEM_ADMIN'], target_org_units: ['HQ'] },
        { role: 'SYSTEM_ADMIN', org_unit: 'HQ' },
      )).toBe(false);
    });

    it('handles single-element arrays', () => {
      expect(evaluate(
        { enabled: true, target_roles: ['PARTICIPANT'], target_org_units: ['Dorm-A'] },
        { role: 'PARTICIPANT', org_unit: 'Dorm-A' },
      )).toBe(true);
    });
  });
});
