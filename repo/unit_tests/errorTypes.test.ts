import { describe, it, expect } from 'vitest';
import {
  AccessError,
  VersionConflictError,
  ConcurrencyError,
  FeatureDisabledError,
  RateLimitError,
} from '../src/lib/types';

describe('custom error types', () => {
  it('AccessError has correct name and default message', () => {
    const err = new AccessError();
    expect(err.name).toBe('AccessError');
    expect(err.message).toBe('Access denied');
    expect(err).toBeInstanceOf(Error);
  });

  it('AccessError accepts custom message', () => {
    const err = new AccessError('No soup for you');
    expect(err.message).toBe('No soup for you');
  });

  it('VersionConflictError has correct name', () => {
    const err = new VersionConflictError();
    expect(err.name).toBe('VersionConflictError');
    expect(err.message).toContain('modified');
  });

  it('ConcurrencyError has correct name', () => {
    const err = new ConcurrencyError();
    expect(err.name).toBe('ConcurrencyError');
    expect(err.message).toContain('in progress');
  });

  it('FeatureDisabledError has correct name', () => {
    const err = new FeatureDisabledError();
    expect(err.name).toBe('FeatureDisabledError');
    expect(err.message).toContain('disabled');
  });

  it('RateLimitError stores retryAfter', () => {
    const err = new RateLimitError(5000);
    expect(err.name).toBe('RateLimitError');
    expect(err.retryAfter).toBe(5000);
    expect(err.message).toContain('Rate limit');
  });

  it('RateLimitError accepts custom message', () => {
    const err = new RateLimitError(3000, 'Slow down');
    expect(err.message).toBe('Slow down');
    expect(err.retryAfter).toBe(3000);
  });

  it('all errors are instanceof Error', () => {
    expect(new AccessError()).toBeInstanceOf(Error);
    expect(new VersionConflictError()).toBeInstanceOf(Error);
    expect(new ConcurrencyError()).toBeInstanceOf(Error);
    expect(new FeatureDisabledError()).toBeInstanceOf(Error);
    expect(new RateLimitError(0)).toBeInstanceOf(Error);
  });
});
