import type { CryptoState, KeyMetadata } from '../types';

type Key = { metadata: KeyMetadata; status?: { cryptoState?: CryptoState } };

export const isDeleting = (key: Key): boolean => Boolean(key.metadata.deletionTimestamp);

// The controller keeps a key until its upstream key is gone, so a deleted key can stay listed for a while.
export const keyLifecycle = (key: Key): string =>
  isDeleting(key) ? 'Deleting' : key.status?.cryptoState?.lifecycleState ?? 'Unknown';
