import { describe, expect, it } from 'vitest';
import type { RootKey } from '../types';
import { emptyRootKey, rootKeyKind } from './rootKeys';

const root = (configured: boolean | undefined, registered: boolean): RootKey => ({
  kind: 'AWSRootKey',
  metadata: { name: 'aws-eu-central', namespace: 'default' },
  spec: { tenantNameRef: 'a', configured },
  status: registered ? { cryptoState: { lifecycleState: 'Active' } } : {}
} as RootKey);

describe('emptyRootKey', () => {
  it('hides an unconfigured placeholder without a registered key', () => {
    // when / then
    expect(emptyRootKey(root(false, false))).toBe(true);
  });

  it('keeps configured keys and placeholders that still hold a registered key', () => {
    // when / then
    expect(emptyRootKey(root(true, false))).toBe(false);
    expect(emptyRootKey(root(undefined, false))).toBe(false);
    expect(emptyRootKey(root(false, true))).toBe(false);
  });
});

describe('rootKeyKind', () => {
  it('maps every offered provider to its kind', () => {
    // when / then
    expect(['AWS', 'Azure', 'OpenBao'].map((provider) => rootKeyKind(provider as 'AWS'))).toEqual([
      'AWSRootKey', 'AzureRootKey', 'OpenBaoRootKey'
    ]);
  });
});
