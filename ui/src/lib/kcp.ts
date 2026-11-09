/*
 * KCP GraphQL client. The portal's kubernetes-graphql-gateway exposes a
 * workspace-scoped schema; we query it with a Bearer token from Luigi context.
 *
 * The gateway URL handed to us by the portal is rooted at ".../root/graphql".
 * To hit a non-root workspace we swap the path segment before "/graphql".
 */

import type { DataEncryptionKey, DomainKey, DomainKeyScope, KeyTier, RootKey, ServiceKey, Tenant } from '../types';
import { createClient } from 'graphql-sse';
import {
  fixtureDataEncryptionKeys,
  fixtureDomainKeys,
  fixtureRootKeys,
  fixtureServiceKeys,
  fixtureTenants,
  fixturesEnabled
} from './fixtures';

export interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface KcpClientOptions {
  graphqlUrl: string;
  token: string | null;
  workspacePath?: string | null;
  signal?: AbortSignal;
  onL1PermissionDenied?: () => void;
}

export interface ResourceListSnapshot<T> {
  items: T[];
  resourceVersion: string | null;
}

const buildWorkspaceUrl = (graphqlUrl: string, workspacePath: string | null | undefined): string => {
  if (!workspacePath) return graphqlUrl;
  const marker = '/graphql';
  const idx = graphqlUrl.indexOf(marker);
  if (idx === -1) return graphqlUrl;
  const head = graphqlUrl.slice(0, idx);
  const lastSlash = head.lastIndexOf('/');
  if (lastSlash === -1) return graphqlUrl;
  return `${head.slice(0, lastSlash)}/${workspacePath}${marker}${graphqlUrl.slice(idx + marker.length)}`;
};

const subscriptionClient = (opts: KcpClientOptions) =>
  createClient({
    url: buildWorkspaceUrl(opts.graphqlUrl, opts.workspacePath),
    headers: () => {
      const headers: Record<string, string> = {};
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      return headers;
    }
  });

const graphqlFetch = async <T>(
  opts: KcpClientOptions,
  body: { query?: string; mutation?: string; variables?: Record<string, unknown> }
): Promise<T> => {
  opts.signal?.throwIfAborted();
  if (!opts.workspacePath) throw new Error("The account workspace is unavailable.");
  const url = buildWorkspaceUrl(opts.graphqlUrl, opts.workspacePath);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const resp = await fetch(url, {
    method: 'POST',
    signal: opts.signal,
    headers,
    body: JSON.stringify(body)
  });
  opts.signal?.throwIfAborted();
  if (!resp.ok) {
    if (resp.status === 403 && /^\s*mutation\b/.test(body.query ?? body.mutation ?? '')) {
      opts.onL1PermissionDenied?.();
    }
    throw new Error(`GraphQL HTTP ${resp.status} ${resp.statusText}`);
  }
  const envelope = (await resp.json()) as GraphqlEnvelope<T>;
  opts.signal?.throwIfAborted();
  if (envelope.errors?.length) {
    if (/^\s*mutation\b/.test(body.query ?? body.mutation ?? '') &&
        envelope.errors.some((error) => error.message.includes('L1 Key Manager role is required'))) {
      opts.onL1PermissionDenied?.();
    }
    throw new Error(envelope.errors.map((e) => e.message).join('; '));
  }
  if (!envelope.data) {
    throw new Error('GraphQL response missing data');
  }
  return envelope.data;
};

/* ------------------------------- Tenant ------------------------------------- */

const TENANT_QUERY = `
  query Tenants($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        Tenants(namespace: $ns) {
          items {
            metadata { name creationTimestamp }
            spec { region oidcProvider { issuer } }
            status {
              conditions { type status reason message lastTransitionTime }
              operationId
              reconciliationStatus { success message internalKeyId errors }
            }
          }
        }
      }
    }
  }
`;

interface TenantListResponse {
  operations_openkcm_io: {
    v1alpha1: { Tenants: { items: Tenant[] } };
  };
}

export const listTenants = async (opts: KcpClientOptions, namespace: string): Promise<Tenant[]> => {
  if (fixturesEnabled()) return fixtureTenants();
  const data = await graphqlFetch<TenantListResponse>(opts, {
    query: TENANT_QUERY,
    variables: { ns: namespace }
  });
  return data.operations_openkcm_io?.v1alpha1?.Tenants?.items ?? [];
};

const KEY_METADATA = 'metadata { name namespace creationTimestamp deletionTimestamp }';

/* ---------------------------- DomainKey (L2) -------------------------------- */

const domainKeyItems = (withScope: boolean) => `
          items {
            ${KEY_METADATA}
            spec {
              ${withScope ? 'scope ' : ''}tenantNameRef
              primaryRootKeyRef { apiGroup kind namespace name }
              fallbackRootKeyRefs { apiGroup kind namespace name }
              lifecycle
            }
            status {
              conditions { type status reason message lastTransitionTime }
              operationId
              reconciliationStatus { success message internalKeyId errors }
              cryptoState { id version lifecycleState lastRotatedAt }
            }
          }`;

const domainKeyQuery = (withScope: boolean) => `
  query DomainKeys($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        DomainKeys(namespace: $ns) {${domainKeyItems(withScope)}
        }
      }
    }
  }
`;

interface DomainKeyListResponse {
  operations_openkcm_io: {
    v1alpha1: { DomainKeys: { items: DomainKey[] } };
  };
}

export const listDomainKeys = async (
  opts: KcpClientOptions,
  namespace: string
): Promise<ResourceListSnapshot<DomainKey>> => {
  if (fixturesEnabled()) return { items: fixtureDomainKeys(), resourceVersion: null };
  const data = await fetchDomainKeys(opts, (withScope) => ({
    query: domainKeyQuery(withScope),
    variables: { ns: namespace }
  }));
  return {
    items: data.operations_openkcm_io?.v1alpha1?.DomainKeys?.items ?? [],
    resourceVersion: null
  };
};

// A gateway still serving the schema from before DomainKey.spec.scope rejects the field.
const fetchDomainKeys = async (
  opts: KcpClientOptions,
  request: (withScope: boolean) => { query: string; variables?: Record<string, unknown> }
): Promise<DomainKeyListResponse> => {
  try {
    return await graphqlFetch<DomainKeyListResponse>(opts, request(true));
  } catch (err) {
    if (!(err instanceof Error) || !/Cannot query field "scope"/.test(err.message)) throw err;
    return graphqlFetch<DomainKeyListResponse>(opts, request(false));
  }
};

const allDomainKeysQuery = (withScope: boolean) => `
  query AllDomainKeys {
    operations_openkcm_io {
      v1alpha1 {
        DomainKeys {${domainKeyItems(withScope)}
        }
      }
    }
  }
`;

export const listAllDomainKeys = async (
  opts: KcpClientOptions
): Promise<ResourceListSnapshot<DomainKey>> => {
  if (fixturesEnabled()) return { items: fixtureDomainKeys(), resourceVersion: null };
  const data = await fetchDomainKeys(opts, (withScope) => ({ query: allDomainKeysQuery(withScope) }));
  return {
    items: data.operations_openkcm_io?.v1alpha1?.DomainKeys?.items ?? [],
    resourceVersion: null
  };
};

/* ---------------------------- ServiceKey (L3) ------------------------------- */

const SERVICEKEY_QUERY = `
  query ServiceKeys($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        ServiceKeys(namespace: $ns) {
          items {
            ${KEY_METADATA}
            spec { tenantNameRef domainKeyRef domainKeyNamespace lifecycle }
            status {
              conditions { type status reason message lastTransitionTime }
              operationId
              reconciliationStatus { success message internalKeyId errors }
              cryptoState { id version lifecycleState lastRotatedAt }
            }
          }
        }
      }
    }
  }
`;

interface ServiceKeyListResponse {
  operations_openkcm_io: {
    v1alpha1: { ServiceKeys: { items: ServiceKey[] } };
  };
}

export const listServiceKeys = async (
  opts: KcpClientOptions,
  namespace: string
): Promise<ResourceListSnapshot<ServiceKey>> => {
  if (fixturesEnabled()) return { items: fixtureServiceKeys(), resourceVersion: null };
  const data = await graphqlFetch<ServiceKeyListResponse>(opts, {
    query: SERVICEKEY_QUERY,
    variables: { ns: namespace }
  });
  return {
    items: data.operations_openkcm_io?.v1alpha1?.ServiceKeys?.items ?? [],
    resourceVersion: null
  };
};

const ALL_SERVICEKEYS_QUERY = `
  query AllServiceKeys {
    operations_openkcm_io {
      v1alpha1 {
        ServiceKeys {
          items {
            ${KEY_METADATA}
            spec { tenantNameRef domainKeyRef domainKeyNamespace lifecycle }
            status {
              conditions { type status reason message lastTransitionTime }
              operationId
              reconciliationStatus { success message internalKeyId errors }
              cryptoState { id version lifecycleState lastRotatedAt }
            }
          }
        }
      }
    }
  }
`;

export const listAllServiceKeys = async (
  opts: KcpClientOptions
): Promise<ResourceListSnapshot<ServiceKey>> => {
  if (fixturesEnabled()) return { items: fixtureServiceKeys(), resourceVersion: null };
  const data = await graphqlFetch<ServiceKeyListResponse>(opts, { query: ALL_SERVICEKEYS_QUERY });
  return {
    items: data.operations_openkcm_io?.v1alpha1?.ServiceKeys?.items ?? [],
    resourceVersion: null
  };
};

/* ---------------------------- Mutations ------------------------------------- */

const OPENKCM_INPUT_TYPE_PREFIX = 'OperationsOpenkcmIoV1alpha1';
const openKcmInputType = (kind: string): string => `${OPENKCM_INPUT_TYPE_PREFIX}${kind}_Input`;

export interface CreateServiceKeyInput {
  namespace: string;
  name: string;
  tenantNameRef: string;
  domainKeyName: string;
  domainKeyNamespace?: string;
}

const CREATE_SERVICEKEY_MUTATION = `
  mutation CreateServiceKey($ns: String!, $object: ${openKcmInputType('ServiceKey')}!) {
    operations_openkcm_io {
      v1alpha1 {
        createServiceKey(namespace: $ns, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

export const createServiceKey = async (
  opts: KcpClientOptions,
  input: CreateServiceKeyInput
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  const object = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      tenantNameRef: input.tenantNameRef,
      domainKeyRef: input.domainKeyName,
      ...(input.domainKeyNamespace ? { domainKeyNamespace: input.domainKeyNamespace } : {})
    }
  };
  await graphqlFetch(opts, {
    query: CREATE_SERVICEKEY_MUTATION,
    variables: { ns: input.namespace, object }
  });
};

const DELETE_SERVICEKEY_MUTATION = `
  mutation DeleteServiceKey($ns: String!, $name: String!) {
    operations_openkcm_io {
      v1alpha1 {
        deleteServiceKey(namespace: $ns, name: $name)
      }
    }
  }
`;

export const deleteServiceKey = async (
  opts: KcpClientOptions,
  namespace: string,
  name: string
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  await graphqlFetch(opts, {
    query: DELETE_SERVICEKEY_MUTATION,
    variables: { ns: namespace, name }
  });
};

export type RootKeyProvider = 'AWS' | 'Azure' | 'OpenBao';

export interface CreateOpenBaoRootKeyInput {
  namespace: string;
  name: string;
  tenantNameRef: string;
  serverAddress: string;
  enginePath: string;
  keyName: string;
  certAuthMountPath: string;
  certAuthRoleName: string;
}

const CREATE_OPENBAOROOTKEY_MUTATION = `
  mutation CreateOpenBaoRootKey($ns: String!, $object: ${openKcmInputType('OpenBaoRootKey')}!) {
    operations_openkcm_io {
      v1alpha1 {
        createOpenBaoRootKey(namespace: $ns, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

export const createOpenBaoRootKey = async (
  opts: KcpClientOptions,
  input: CreateOpenBaoRootKeyInput
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  const object = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      tenantNameRef: input.tenantNameRef,
      serverAddress: input.serverAddress,
      enginePath: input.enginePath,
      keyName: input.keyName,
      certAuth: {
        authMountPath: input.certAuthMountPath,
        roleName: input.certAuthRoleName
      }
    }
  };
  await graphqlFetch(opts, {
    query: CREATE_OPENBAOROOTKEY_MUTATION,
    variables: { ns: input.namespace, object }
  });
};

export interface CreateAWSRootKeyInput {
  namespace: string;
  name: string;
  tenantNameRef: string;
  region: string;
  keyUri: string;
  trustAnchorArn: string;
  profileArn: string;
  roleArn: string;
}

const CREATE_AWSROOTKEY_MUTATION = `
  mutation CreateAWSRootKey($ns: String!, $object: ${openKcmInputType('AWSRootKey')}!) {
    operations_openkcm_io {
      v1alpha1 {
        createAWSRootKey(namespace: $ns, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

export const createAWSRootKey = async (
  opts: KcpClientOptions,
  input: CreateAWSRootKeyInput
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  const object = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      tenantNameRef: input.tenantNameRef,
      region: input.region,
      keyUri: input.keyUri,
      rolesAnywhere: {
        trustAnchorArn: input.trustAnchorArn,
        profileArn: input.profileArn,
        roleArn: input.roleArn
      }
    }
  };
  await graphqlFetch(opts, {
    query: CREATE_AWSROOTKEY_MUTATION,
    variables: { ns: input.namespace, object }
  });
};

export interface CreateAzureRootKeyInput {
  namespace: string;
  name: string;
  tenantNameRef: string;
  vaultUrl: string;
  keyName: string;
  azureTenantId: string;
  clientId: string;
}

const CREATE_AZUREROOTKEY_MUTATION = `
  mutation CreateAzureRootKey($ns: String!, $object: ${openKcmInputType('AzureRootKey')}!) {
    operations_openkcm_io {
      v1alpha1 {
        createAzureRootKey(namespace: $ns, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

export const createAzureRootKey = async (
  opts: KcpClientOptions,
  input: CreateAzureRootKeyInput
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  const object = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      tenantNameRef: input.tenantNameRef,
      vaultUrl: input.vaultUrl,
      keyName: input.keyName,
      federatedIdentity: {
        tenantId: input.azureTenantId,
        clientId: input.clientId
      }
    }
  };
  await graphqlFetch(opts, {
    query: CREATE_AZUREROOTKEY_MUTATION,
    variables: { ns: input.namespace, object }
  });
};

export interface RootKeyRef {
  kind: string;
  namespace?: string;
  name: string;
}

// The CRD still requires spec.type, but nothing reads it.
const DOMAIN_KEY_TYPE = 'Team';

export interface CreateDomainKeyInput {
  namespace: string;
  name: string;
  scope?: DomainKeyScope;
  tenantNameRef: string;
  primaryRootKey?: RootKeyRef;
}

const typedRootKeyRef = (r: RootKeyRef) => ({
  apiGroup: 'operations.openkcm.io',
  kind: r.kind,
  ...(r.namespace ? { namespace: r.namespace } : {}),
  name: r.name
});

const CREATE_DOMAINKEY_MUTATION = `
  mutation CreateDomainKey($ns: String!, $object: ${openKcmInputType('DomainKey')}!) {
    operations_openkcm_io {
      v1alpha1 {
        createDomainKey(namespace: $ns, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

export const createDomainKey = async (
  opts: KcpClientOptions,
  input: CreateDomainKeyInput
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  const object: Record<string, unknown> = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      type: DOMAIN_KEY_TYPE,
      ...(input.scope ? { scope: input.scope } : {}),
      tenantNameRef: input.tenantNameRef,
      ...(input.primaryRootKey ? { primaryRootKeyRef: typedRootKeyRef(input.primaryRootKey) } : {})
    }
  };
  await graphqlFetch(opts, {
    query: CREATE_DOMAINKEY_MUTATION,
    variables: { ns: input.namespace, object }
  });
};

const deleteMutation = (kind: string, field: string) => `
  mutation Delete${kind}($ns: String!, $name: String!) {
    operations_openkcm_io {
      v1alpha1 {
        ${field}(namespace: $ns, name: $name)
      }
    }
  }
`;

const runDelete = async (
  opts: KcpClientOptions,
  query: string,
  namespace: string,
  name: string
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 250));
    return;
  }
  await graphqlFetch(opts, { query, variables: { ns: namespace, name } });
};

const DELETE_OPENBAO_MUTATION = deleteMutation('OpenBaoRootKey', 'deleteOpenBaoRootKey');
export const deleteOpenBaoRootKey = (opts: KcpClientOptions, namespace: string, name: string) =>
  runDelete(opts, DELETE_OPENBAO_MUTATION, namespace, name);

const DELETE_AWS_MUTATION = deleteMutation('AWSRootKey', 'deleteAWSRootKey');
export const deleteAWSRootKey = (opts: KcpClientOptions, namespace: string, name: string) =>
  runDelete(opts, DELETE_AWS_MUTATION, namespace, name);

const DELETE_AZURE_MUTATION = deleteMutation('AzureRootKey', 'deleteAzureRootKey');
export const deleteAzureRootKey = (opts: KcpClientOptions, namespace: string, name: string) =>
  runDelete(opts, DELETE_AZURE_MUTATION, namespace, name);

const DELETE_DOMAINKEY_MUTATION = deleteMutation('DomainKey', 'deleteDomainKey');
export const deleteDomainKey = (opts: KcpClientOptions, namespace: string, name: string) =>
  runDelete(opts, DELETE_DOMAINKEY_MUTATION, namespace, name);

export const deleteRootKey = (
  opts: KcpClientOptions,
  kind: RootKey['kind'],
  namespace: string,
  name: string
): Promise<void> => {
  if (kind === 'OpenBaoRootKey') return deleteOpenBaoRootKey(opts, namespace, name);
  if (kind === 'AWSRootKey') return deleteAWSRootKey(opts, namespace, name);
  if (kind === 'AzureRootKey') return deleteAzureRootKey(opts, namespace, name);
  return Promise.reject(new Error(`delete not supported for ${kind} (stub kind)`));
};

/* ---------------------------- Root keys (L1) -------------------------------- */

const rootKeyItems = (spec: string, withIdentity = true) => `
          items {
            ${KEY_METADATA}
            spec { ${spec} configured }
            status {
              conditions { type status reason message lastTransitionTime }
              cryptoState { id version lifecycleState lastRotatedAt }
              reconciliationStatus {
                success message internalKeyId errors ${withIdentity ? 'identityInfo { subject }' : ''}
              }
            }
          }`;

const ROOTKEY_QUERY = `
  query RootKeys($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        AWSRootKeys(namespace: $ns) {${rootKeyItems('tenantNameRef region keyUri endpointUrl lifecycle rolesAnywhere { trustAnchorArn profileArn roleArn }')}
        }
        AzureRootKeys(namespace: $ns) {${rootKeyItems('tenantNameRef vaultUrl keyName keyVersion lifecycle federatedIdentity { tenantId clientId }')}
        }
        OpenBaoRootKeys(namespace: $ns) {${rootKeyItems('tenantNameRef enginePath keyName serverAddress lifecycle certAuth { authMountPath roleName }')}
        }
        GCPRootKeys(namespace: $ns) {${rootKeyItems('tenantNameRef', false)}
        }
        VaultRootKeys(namespace: $ns) {${rootKeyItems('tenantNameRef', false)}
        }
        HSMRootKeys(namespace: $ns) {${rootKeyItems('tenantNameRef', false)}
        }
      }
    }
  }
`;

interface RootKeyListResponse {
  operations_openkcm_io: {
    v1alpha1: {
      AWSRootKeys?: { items: Omit<RootKey, 'kind' | 'provider'>[] };
      AzureRootKeys?: { items: Omit<RootKey, 'kind' | 'provider'>[] };
      OpenBaoRootKeys?: { items: Omit<RootKey, 'kind' | 'provider'>[] };
      GCPRootKeys?: { items: Omit<RootKey, 'kind' | 'provider'>[] };
      VaultRootKeys?: { items: Omit<RootKey, 'kind' | 'provider'>[] };
      HSMRootKeys?: { items: Omit<RootKey, 'kind' | 'provider'>[] };
    };
  };
}

const withKind = (
  items: Omit<RootKey, 'kind' | 'provider'>[] | undefined,
  kind: RootKey['kind'],
  provider: string,
  namespace: string
): RootKey[] =>
  (items ?? []).map((item) => ({
    ...item,
    metadata: { ...item.metadata, namespace: item.metadata.namespace ?? namespace },
    kind,
    provider
  }));

export const listRootKeys = async (opts: KcpClientOptions, namespace: string): Promise<RootKey[]> => {
  if (fixturesEnabled()) return fixtureRootKeys();
  const data = await graphqlFetch<RootKeyListResponse>(opts, {
    query: ROOTKEY_QUERY,
    variables: { ns: namespace }
  });
  const v = data.operations_openkcm_io?.v1alpha1 ?? {};
  return [
    ...withKind(v.AWSRootKeys?.items, 'AWSRootKey', 'AWS', namespace),
    ...withKind(v.AzureRootKeys?.items, 'AzureRootKey', 'Azure', namespace),
    ...withKind(v.OpenBaoRootKeys?.items, 'OpenBaoRootKey', 'OpenBao', namespace),
    ...withKind(v.GCPRootKeys?.items, 'GCPRootKey', 'GCP', namespace),
    ...withKind(v.VaultRootKeys?.items, 'VaultRootKey', 'Vault', namespace),
    ...withKind(v.HSMRootKeys?.items, 'HSMRootKey', 'HSM', namespace)
  ];
};

/* ---------------------------- DataEncryptionKey (L4) ----------------------- */

const DATAENCRYPTIONKEY_QUERY = `
  query DataEncryptionKeys($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        DataEncryptionKeys(namespace: $ns) {
          items {
            ${KEY_METADATA}
            spec { tenantNameRef serviceKeyRef kmip { attributes } lifecycle }
            status {
              conditions { type status reason message lastTransitionTime }
              operationId
              reconciliationStatus { success message internalKeyId errors }
              cryptoState { id version lifecycleState lastRotatedAt }
            }
          }
        }
      }
    }
  }
`;

interface DataEncryptionKeyListResponse {
  operations_openkcm_io: {
    v1alpha1: { DataEncryptionKeys: { items: DataEncryptionKey[] } };
  };
}

export const listDataEncryptionKeys = async (
  opts: KcpClientOptions,
  namespace: string
): Promise<DataEncryptionKey[]> => {
  if (fixturesEnabled()) return fixtureDataEncryptionKeys();
  const data = await graphqlFetch<DataEncryptionKeyListResponse>(opts, {
    query: DATAENCRYPTIONKEY_QUERY,
    variables: { ns: namespace }
  });
  return data.operations_openkcm_io?.v1alpha1?.DataEncryptionKeys?.items ?? [];
};

const ALL_DATAENCRYPTIONKEYS_QUERY = `
  query AllDataEncryptionKeys {
    operations_openkcm_io {
      v1alpha1 {
        DataEncryptionKeys {
          items {
            ${KEY_METADATA}
            spec { tenantNameRef serviceKeyRef kmip { attributes } lifecycle }
            status {
              conditions { type status reason message lastTransitionTime }
              operationId
              reconciliationStatus { success message internalKeyId errors }
              cryptoState { id version lifecycleState lastRotatedAt }
            }
          }
        }
      }
    }
  }
`;

export const listAllDataEncryptionKeys = async (
  opts: KcpClientOptions
): Promise<DataEncryptionKey[]> => {
  if (fixturesEnabled()) return fixtureDataEncryptionKeys();
  const data = await graphqlFetch<DataEncryptionKeyListResponse>(opts, {
    query: ALL_DATAENCRYPTIONKEYS_QUERY
  });
  return data.operations_openkcm_io?.v1alpha1?.DataEncryptionKeys?.items ?? [];
};

export interface CreateDataEncryptionKeyInput {
  namespace: string;
  name: string;
  tenantNameRef: string;
  serviceKeyRef: string;
}

const CREATE_DEK_MUTATION = `
  mutation CreateDataEncryptionKey($ns: String!, $object: ${openKcmInputType('DataEncryptionKey')}!) {
    operations_openkcm_io {
      v1alpha1 {
        createDataEncryptionKey(namespace: $ns, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

export const createDataEncryptionKey = async (
  opts: KcpClientOptions,
  input: CreateDataEncryptionKeyInput
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 350));
    return;
  }
  const object = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      tenantNameRef: input.tenantNameRef,
      serviceKeyRef: input.serviceKeyRef
    }
  };
  await graphqlFetch(opts, {
    query: CREATE_DEK_MUTATION,
    variables: { ns: input.namespace, object }
  });
};

const DELETE_DEK_MUTATION = deleteMutation('DataEncryptionKey', 'deleteDataEncryptionKey');
export const deleteDataEncryptionKey = (opts: KcpClientOptions, namespace: string, name: string) =>
  runDelete(opts, DELETE_DEK_MUTATION, namespace, name);

/* ---------------------------- Lifecycle ------------------------------------ */

export type DesiredLifecycle = 'Active' | 'Deactivated';

const updateLifecycleMutation = (kind: string, field: string) => `
  mutation Update${kind}Lifecycle($ns: String!, $name: String!, $object: ${openKcmInputType(kind)}!) {
    operations_openkcm_io {
      v1alpha1 {
        ${field}(namespace: $ns, name: $name, object: $object) {
          metadata { name namespace }
        }
      }
    }
  }
`;

const sendLifecyclePatch = async (
  opts: KcpClientOptions,
  query: string,
  namespace: string,
  name: string,
  lifecycle: DesiredLifecycle
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 250));
    return;
  }
  // Gateway updateXXX is a JSON merge patch, so we only need to send the
  // changed field. Other spec fields stay as-is.
  const object = {
    metadata: { name, namespace },
    spec: { lifecycle }
  };
  await graphqlFetch(opts, { query, variables: { ns: namespace, name, object } });
};

const UPDATE_OPENBAO_MUTATION = updateLifecycleMutation('OpenBaoRootKey', 'updateOpenBaoRootKey');
const UPDATE_AWS_MUTATION = updateLifecycleMutation('AWSRootKey', 'updateAWSRootKey');
const UPDATE_AZURE_MUTATION = updateLifecycleMutation('AzureRootKey', 'updateAzureRootKey');
const UPDATE_DOMAINKEY_MUTATION = updateLifecycleMutation('DomainKey', 'updateDomainKey');
const UPDATE_SERVICEKEY_MUTATION = updateLifecycleMutation('ServiceKey', 'updateServiceKey');
const UPDATE_DEK_MUTATION = updateLifecycleMutation('DataEncryptionKey', 'updateDataEncryptionKey');

export const setRootKeyLifecycle = (
  opts: KcpClientOptions,
  kind: RootKey['kind'],
  namespace: string,
  name: string,
  lifecycle: DesiredLifecycle
): Promise<void> => {
  if (kind === 'OpenBaoRootKey') return sendLifecyclePatch(opts, UPDATE_OPENBAO_MUTATION, namespace, name, lifecycle);
  if (kind === 'AWSRootKey') return sendLifecyclePatch(opts, UPDATE_AWS_MUTATION, namespace, name, lifecycle);
  if (kind === 'AzureRootKey') return sendLifecyclePatch(opts, UPDATE_AZURE_MUTATION, namespace, name, lifecycle);
  return Promise.reject(new Error(`lifecycle not supported for ${kind} (stub kind)`));
};

export const setDomainKeyLifecycle = (
  opts: KcpClientOptions,
  namespace: string,
  name: string,
  lifecycle: DesiredLifecycle
) => sendLifecyclePatch(opts, UPDATE_DOMAINKEY_MUTATION, namespace, name, lifecycle);

export const setServiceKeyLifecycle = (
  opts: KcpClientOptions,
  namespace: string,
  name: string,
  lifecycle: DesiredLifecycle
) => sendLifecyclePatch(opts, UPDATE_SERVICEKEY_MUTATION, namespace, name, lifecycle);

export const setDataEncryptionKeyLifecycle = (
  opts: KcpClientOptions,
  namespace: string,
  name: string,
  lifecycle: DesiredLifecycle
) => sendLifecyclePatch(opts, UPDATE_DEK_MUTATION, namespace, name, lifecycle);

/* ---------------------------- Spec edit mutations -------------------------- */

// Merge-patch spec on an existing resource via the gateway's update<Kind>.
// Caller passes the partial spec; immutable fields (name, tenantNameRef,
// type) are excluded by convention.

const sendSpecPatch = async (
  opts: KcpClientOptions,
  query: string,
  namespace: string,
  name: string,
  spec: Record<string, unknown>
): Promise<void> => {
  if (fixturesEnabled()) {
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  const object = {
    metadata: { name, namespace },
    spec
  };
  await graphqlFetch(opts, { query, variables: { ns: namespace, name, object } });
};

export interface DomainKeyRootInput {
  namespace: string;
  name: string;
  rootKey: RootKeyRef;
}

export const linkDomainKeyRoot = (opts: KcpClientOptions, input: DomainKeyRootInput) =>
  sendSpecPatch(opts, UPDATE_DOMAINKEY_MUTATION, input.namespace, input.name, {
    primaryRootKeyRef: typedRootKeyRef(input.rootKey)
  });

// The gateway drops null input fields before its merge patch, so an empty name is what clears the link.
export const unlinkDomainKeyRoot = (opts: KcpClientOptions, input: DomainKeyRootInput) =>
  sendSpecPatch(opts, UPDATE_DOMAINKEY_MUTATION, input.namespace, input.name, {
    primaryRootKeyRef: typedRootKeyRef({ kind: input.rootKey.kind, name: '' })
  });

/* ----------------------------- Helpers -------------------------------------- */

export const tierForKey = (kind: 'Tenant' | 'RootKey' | 'DomainKey' | 'ServiceKey' | 'DataEncryptionKey'): KeyTier => {
  if (kind === 'Tenant') return 'L1';
  if (kind === 'RootKey') return 'L1';
  if (kind === 'DomainKey') return 'L2';
  if (kind === 'ServiceKey') return 'L3';
  return 'L4';
};

export const conditionByType = (
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }> | undefined,
  type: string
) => conditions?.find((c) => c.type === type);

type SubscriptionHandle = () => void;

const subscribe = (
  opts: KcpClientOptions,
  query: string,
  variables: Record<string, unknown>,
  onEvent: () => void
): SubscriptionHandle => {
  if (fixturesEnabled()) return () => {};
  const client = subscriptionClient(opts);
  return client.subscribe(
    { query, variables },
    {
      next: () => onEvent(),
      error: (error) => console.warn('[openkcm-ui] subscription error', error),
      complete: () => undefined
    }
  );
};

const SERVICEKEY_SUBSCRIPTION = `
  subscription ServiceKeys($ns: String, $resourceVersion: String) {
    operations_openkcm_io_v1alpha1_servicekeys(
      namespace: $ns
      resourceVersion: $resourceVersion
      subscribeToAll: true
    ) {
      type
      object {
        metadata { name }
      }
    }
  }
`;

const DOMAINKEY_SUBSCRIPTION = `
  subscription DomainKeys($ns: String, $resourceVersion: String) {
    operations_openkcm_io_v1alpha1_domainkeys(
      namespace: $ns
      resourceVersion: $resourceVersion
      subscribeToAll: true
    ) {
      type
      object {
        metadata { name }
      }
    }
  }
`;

export const subscribeServiceKeys = (
  opts: KcpClientOptions,
  namespace: string | null,
  resourceVersion: string | null,
  onEvent: () => void
): SubscriptionHandle =>
  subscribe(opts, SERVICEKEY_SUBSCRIPTION, { ns: namespace, resourceVersion }, onEvent);

export const subscribeDomainKeys = (
  opts: KcpClientOptions,
  namespace: string | null,
  resourceVersion: string | null,
  onEvent: () => void
): SubscriptionHandle =>
  subscribe(opts, DOMAINKEY_SUBSCRIPTION, { ns: namespace, resourceVersion }, onEvent);

const buildSubscription = (resource: string) => `
  subscription Watch${resource}($ns: String) {
    operations_openkcm_io_v1alpha1_${resource}(namespace: $ns, subscribeToAll: true) {
      type
      object {
        metadata { name }
      }
    }
  }
`;

const ROOTKEY_SUBSCRIPTIONS: ReadonlyArray<string> = [
  buildSubscription('openbaorootkeys'),
  buildSubscription('awsrootkeys'),
  buildSubscription('azurerootkeys')
];

export const subscribeRootKeys = (
  opts: KcpClientOptions,
  namespace: string | null,
  onEvent: () => void
): SubscriptionHandle => {
  const handles = ROOTKEY_SUBSCRIPTIONS.map((q) => subscribe(opts, q, { ns: namespace }, onEvent));
  return () => {
    for (const h of handles) h();
  };
};

const DEK_SUBSCRIPTION = buildSubscription('dataencryptionkeys');

export const subscribeDataEncryptionKeys = (
  opts: KcpClientOptions,
  namespace: string | null,
  onEvent: () => void
): SubscriptionHandle => subscribe(opts, DEK_SUBSCRIPTION, { ns: namespace }, onEvent);
