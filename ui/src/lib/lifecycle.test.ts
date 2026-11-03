import { describe, expect, it } from 'vitest';

import type { ServiceKey } from '../types';
import { isDeleting, keyLifecycle } from './lifecycle';

const DELETED_AT = '2026-10-05T15:20:50Z';

const serviceKey = (lifecycleState?: string, deletionTimestamp?: string): ServiceKey => ({
  metadata: { name: 'mongo', namespace: 'default', deletionTimestamp },
  spec: { tenantNameRef: 'acme', domainKeyRef: 'default' },
  ...(lifecycleState ? { status: { cryptoState: { lifecycleState } } } : {})
});

describe('keyLifecycle', () => {
  it('reports a key with a deletion timestamp as Deleting', () => {
    // given
    const deleting = serviceKey('Active', DELETED_AT);

    // when
    const lifecycle = keyLifecycle(deleting);

    // then
    expect(lifecycle).toBe('Deleting');
  });

  it('reports the crypto state of a key that is not being deleted', () => {
    // given
    const deactivated = serviceKey('Deactivated');

    // when
    const lifecycle = keyLifecycle(deactivated);

    // then
    expect(lifecycle).toBe('Deactivated');
  });

  it('reports a key without crypto state as Unknown', () => {
    // given
    const fresh = serviceKey();

    // when
    const lifecycle = keyLifecycle(fresh);

    // then
    expect(lifecycle).toBe('Unknown');
  });
});

describe('isDeleting', () => {
  it('is true once the key has a deletion timestamp', () => {
    // given
    const deleting = serviceKey('Active', DELETED_AT);

    // when
    const result = isDeleting(deleting);

    // then
    expect(result).toBe(true);
  });

  it('is false for a key without a deletion timestamp', () => {
    // given
    const active = serviceKey('Active');

    // when
    const result = isDeleting(active);

    // then
    expect(result).toBe(false);
  });
});
