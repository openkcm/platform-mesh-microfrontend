export type KeyTier = 'L1' | 'L2' | 'L3' | 'L4';

export type LifecycleState =
  | 'PreActive'
  | 'Active'
  | 'Suspended'
  | 'Deactivated'
  | 'Compromised'
  | 'Destroyed'
  | string;

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface CryptoState {
  id?: string;
  version?: number;
  lifecycleState?: LifecycleState;
  lastRotatedAt?: string;
}

export interface TypedReference {
  apiGroup: string;
  kind: string;
  namespace?: string;
  name: string;
}

export interface ReconciliationStatus {
  success?: boolean;
  message?: string;
  internalKeyId?: string;
  errors?: string[];
  identityInfo?: {
    subject?: string;
    certificateSecretRef?: { name: string; namespace: string; key: string };
  };
}

export interface KeyMetadata {
  name: string;
  namespace?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  resourceVersion?: string;
}

export interface Tenant {
  metadata: { name: string; creationTimestamp?: string; resourceVersion?: string };
  spec: { region?: string; oidcProvider?: { issuer?: string } };
  status?: { conditions?: Condition[]; operationId?: string; reconciliationStatus?: ReconciliationStatus };
}

export type DomainKeyScope = 'Instance' | 'Namespace' | 'System';

export interface DomainKey {
  metadata: KeyMetadata;
  spec: {
    scope?: DomainKeyScope;
    tenantNameRef: string;
    primaryRootKeyRef?: TypedReference;
    fallbackRootKeyRefs?: TypedReference[];
    lifecycle?: string;
  };
  status?: { conditions?: Condition[]; operationId?: string; reconciliationStatus?: ReconciliationStatus; cryptoState?: CryptoState };
}

export interface ServiceKey {
  metadata: KeyMetadata;
  spec: { tenantNameRef: string; domainKeyRef: string; domainKeyNamespace?: string; lifecycle?: string };
  status?: { conditions?: Condition[]; operationId?: string; reconciliationStatus?: ReconciliationStatus; cryptoState?: CryptoState };
}

export interface RootKey {
  kind: 'AWSRootKey' | 'AzureRootKey' | 'OpenBaoRootKey' | 'GCPRootKey' | 'VaultRootKey' | 'HSMRootKey';
  provider: string;
  metadata: KeyMetadata;
  spec: { tenantNameRef: string; configured?: boolean; resetRequest?: string; lifecycle?: string; [key: string]: unknown };
  status?: { slotState?: 'Unconfigured' | 'Configuring' | 'Configured' | 'Resetting' | 'ResetFailed'; lastResetRequest?: string; conditions?: Condition[]; operationId?: string; reconciliationStatus?: ReconciliationStatus; cryptoState?: CryptoState };
}

export interface DataEncryptionKey {
  metadata: KeyMetadata;
  spec: { tenantNameRef: string; serviceKeyRef: string; kmip?: { attributes?: Record<string, string> }; lifecycle?: string };
  status?: { conditions?: Condition[]; operationId?: string; reconciliationStatus?: ReconciliationStatus; cryptoState?: CryptoState };
}
