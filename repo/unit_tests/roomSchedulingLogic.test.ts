import { describe, it, expect } from 'vitest';

// ============================================================
// Pure logic extracted from roomSchedulingService
// ============================================================

function timeOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function extractDigits(code: string): number {
  const match = code.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function capacityFitScore(roomCapacity: number, requestedCapacity: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(roomCapacity - requestedCapacity) / requestedCapacity));
}

function equipmentMatchScore(roomEquipment: string[], requestedEquipment: string[]): number {
  if (requestedEquipment.length === 0) return 1;
  const matchCount = requestedEquipment.filter(eq => roomEquipment.includes(eq)).length;
  return matchCount / requestedEquipment.length;
}

function distanceScore(
  reqBuilding: number, reqFloor: number,
  roomBuilding: number, roomFloor: number,
  maxDistance: number,
): number {
  if (maxDistance === 0) return 1;
  const distance = Math.abs(reqBuilding - roomBuilding) + Math.abs(reqFloor - roomFloor);
  return 1 - distance / maxDistance;
}

function totalScore(
  capacityFit: number,
  equipmentMatch: number,
  availability: number,
  distance: number,
): number {
  return capacityFit * 0.4 + equipmentMatch * 0.3 + availability * 0.2 + distance * 0.1;
}

// ============================================================
// Tests
// ============================================================

describe('room scheduling logic', () => {
  // ----------------------------------------------------------
  // Time overlap detection
  // ----------------------------------------------------------

  describe('timeOverlaps', () => {
    it('detects overlapping intervals', () => {
      expect(timeOverlaps(100, 200, 150, 250)).toBe(true);
    });

    it('detects containment (a inside b)', () => {
      expect(timeOverlaps(120, 180, 100, 200)).toBe(true);
    });

    it('detects containment (b inside a)', () => {
      expect(timeOverlaps(100, 200, 120, 180)).toBe(true);
    });

    it('detects exact overlap', () => {
      expect(timeOverlaps(100, 200, 100, 200)).toBe(true);
    });

    it('returns false for adjacent non-overlapping (a before b)', () => {
      expect(timeOverlaps(100, 200, 200, 300)).toBe(false);
    });

    it('returns false for adjacent non-overlapping (b before a)', () => {
      expect(timeOverlaps(200, 300, 100, 200)).toBe(false);
    });

    it('returns false for disjoint intervals', () => {
      expect(timeOverlaps(100, 200, 300, 400)).toBe(false);
    });

    it('handles single-point intervals', () => {
      // A zero-length interval [100,100) shouldn't overlap anything
      expect(timeOverlaps(100, 100, 100, 200)).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // Building/floor digit extraction
  // ----------------------------------------------------------

  describe('extractDigits', () => {
    it('extracts number from building code', () => {
      expect(extractDigits('B1')).toBe(1);
      expect(extractDigits('B12')).toBe(12);
      expect(extractDigits('Building3')).toBe(3);
    });

    it('returns 0 for codes with no digits', () => {
      expect(extractDigits('Main')).toBe(0);
      expect(extractDigits('')).toBe(0);
    });

    it('extracts first number only', () => {
      expect(extractDigits('B1F2')).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // Scoring functions
  // ----------------------------------------------------------

  describe('capacityFitScore', () => {
    it('returns 1.0 for exact capacity match', () => {
      expect(capacityFitScore(30, 30)).toBe(1.0);
    });

    it('returns value between 0 and 1 for close match', () => {
      const score = capacityFitScore(35, 30);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('returns 0 when capacity difference equals requested', () => {
      // |60 - 30| / 30 = 1.0, so score = 0
      expect(capacityFitScore(60, 30)).toBe(0);
    });

    it('clamps to 0 when capacity difference exceeds requested', () => {
      expect(capacityFitScore(100, 30)).toBe(0);
    });

    it('handles undersized rooms', () => {
      const score = capacityFitScore(25, 30);
      expect(score).toBeCloseTo(5 / 6, 5); // 1 - 5/30
    });
  });

  describe('equipmentMatchScore', () => {
    it('returns 1.0 when all equipment matches', () => {
      expect(equipmentMatchScore(['projector', 'whiteboard'], ['projector', 'whiteboard'])).toBe(1.0);
    });

    it('returns 1.0 when no equipment requested', () => {
      expect(equipmentMatchScore(['projector'], [])).toBe(1.0);
    });

    it('returns 0 when no equipment matches', () => {
      expect(equipmentMatchScore(['projector'], ['microscope'])).toBe(0);
    });

    it('returns partial score for partial match', () => {
      expect(equipmentMatchScore(['projector'], ['projector', 'microscope'])).toBe(0.5);
    });

    it('handles superset (room has more than requested)', () => {
      expect(equipmentMatchScore(
        ['projector', 'whiteboard', 'microscope'],
        ['projector', 'whiteboard'],
      )).toBe(1.0);
    });
  });

  describe('distanceScore', () => {
    it('returns 1.0 when rooms are in same location', () => {
      expect(distanceScore(1, 2, 1, 2, 5)).toBe(1.0);
    });

    it('returns 0 when at max distance', () => {
      expect(distanceScore(1, 1, 6, 1, 5)).toBe(0);
    });

    it('returns 1.0 when maxDistance is 0 (all same location)', () => {
      expect(distanceScore(1, 1, 1, 1, 0)).toBe(1.0);
    });

    it('computes intermediate distance correctly', () => {
      // distance = |1-3| + |1-1| = 2, maxDist = 4, score = 1 - 2/4 = 0.5
      expect(distanceScore(1, 1, 3, 1, 4)).toBe(0.5);
    });
  });

  describe('totalScore', () => {
    it('applies correct weights (40/30/20/10)', () => {
      // All perfect scores
      expect(totalScore(1.0, 1.0, 1.0, 1.0)).toBeCloseTo(1.0);
    });

    it('returns 0 when all scores are 0', () => {
      expect(totalScore(0, 0, 0, 0)).toBe(0);
    });

    it('weights capacity highest', () => {
      // Only capacity = 1, rest = 0
      expect(totalScore(1, 0, 0, 0)).toBeCloseTo(0.4);
    });

    it('weights distance lowest', () => {
      // Only distance = 1, rest = 0
      expect(totalScore(0, 0, 0, 1)).toBeCloseTo(0.1);
    });

    it('computes weighted average correctly', () => {
      expect(totalScore(0.8, 0.6, 1.0, 0.5)).toBeCloseTo(
        0.8 * 0.4 + 0.6 * 0.3 + 1.0 * 0.2 + 0.5 * 0.1,
      );
    });
  });
});
