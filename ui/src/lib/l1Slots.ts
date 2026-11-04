import type { RootKey } from '../types';

export const L1_SLOTS = [
  { kind: 'AWSRootKey', name: 'aws', provider: 'AWS', implemented: true },
  { kind: 'AzureRootKey', name: 'azure', provider: 'Azure', implemented: true },
  { kind: 'GCPRootKey', name: 'gcp', provider: 'GCP', implemented: false },
  { kind: 'HSMRootKey', name: 'hsm', provider: 'HSM', implemented: false },
  { kind: 'VaultRootKey', name: 'vault', provider: 'Vault', implemented: false },
  { kind: 'OpenBaoRootKey', name: 'openbao', provider: 'OpenBao', implemented: true }
] as const;

export const managedSlot = (root: RootKey, namespace: string) => L1_SLOTS.find((slot) =>
  slot.kind === root.kind && slot.name === root.metadata.name && root.metadata.namespace === namespace
);

export const resetPending = (root: RootKey, requested?: string): boolean => {
  const request = requested ?? root.spec.resetRequest;
  return Boolean(request && root.status?.lastResetRequest !== request);
};

export const slotBusy = (root: RootKey, requested?: string): boolean =>
  resetPending(root, requested) || root.status?.slotState === 'Resetting' || root.status?.slotState === 'ResetFailed';

export const canConfigureSlot = (root: RootKey, namespace: string, requested?: string): boolean =>
  Boolean(managedSlot(root, namespace)?.implemented) && !root.spec.resetRequest && !slotBusy(root, requested) &&
  root.status?.slotState === 'Unconfigured' && root.spec.configured === false;

export const canResetSlot = (root: RootKey, namespace: string, requested?: string): boolean =>
  Boolean(managedSlot(root, namespace)?.implemented) && root.spec.configured === true &&
  !root.spec.resetRequest && !requested &&
  ['Configured', 'Configuring', 'ResetFailed'].includes(root.status?.slotState ?? '');

export const configuredRoot = (root: RootKey): boolean =>
  root.spec.configured !== false && !slotBusy(root) &&
  (root.status?.slotState === undefined || root.status.slotState === 'Configured');
