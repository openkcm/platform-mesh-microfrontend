import type { RootKey } from '../types';
import type { RootKeyProvider } from './kcp';

export const ROOT_KEY_PROVIDERS: { provider: RootKeyProvider; kind: RootKey['kind'] }[] = [
  { provider: 'AWS', kind: 'AWSRootKey' },
  { provider: 'Azure', kind: 'AzureRootKey' },
  { provider: 'OpenBao', kind: 'OpenBaoRootKey' }
];

export const rootKeyKind = (provider: RootKeyProvider): RootKey['kind'] =>
  ROOT_KEY_PROVIDERS.find((entry) => entry.provider === provider)?.kind ?? 'AWSRootKey';

export const emptyRootKey = (root: RootKey): boolean =>
  root.spec.configured === false && !root.status?.cryptoState;
