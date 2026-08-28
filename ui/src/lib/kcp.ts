/*
 * KCP GraphQL client. The portal's kubernetes-graphql-gateway exposes a
 * workspace-scoped schema — we query it with a Bearer token from Luigi context.
 *
 * The gateway URL handed to us by the portal is rooted at ".../root/graphql".
 * To hit a non-root workspace we swap the path segment before "/graphql".
 */

import type { DataEncryptionKey, DomainKey, KeyTier, RootKey, ServiceKey, Tenant } from '../types';
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
  const url = buildWorkspaceUrl(opts.graphqlUrl, opts.workspacePath);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    throw new Error(`GraphQL HTTP ${resp.status} ${resp.statusText}`);
  }
  const envelope = (await resp.json()) as GraphqlEnvelope<T>;
  if (envelope.errors?.length) {
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

/* ---------------------------- DomainKey (L2) -------------------------------- */

const DOMAINKEY_QUERY = `
  query DomainKeys($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        DomainKeys(namespace: $ns) {
          items {
            metadata { name namespace creationTimestamp }
            spec { type tenantNameRef primaryRootKeyRef { apiGroup kind namespace name } fallbackRootKeyRefs { apiGroup kind namespace name } lifecycle }
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
  const data = await graphqlFetch<DomainKeyListResponse>(opts, {
    query: DOMAINKEY_QUERY,
    variables: { ns: namespace }
  });
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
            metadata { name namespace creationTimestamp }
            spec { tenantNameRef domainKeyRef lifecycle }
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

/* ---------------------------- Mutations ------------------------------------- */

const OPENKCM_INPUT_TYPE_PREFIX = 'OperationsOpenkcmIoV1alpha1';
const openKcmInputType = (kind: string): string => `${OPENKCM_INPUT_TYPE_PREFIX}${kind}_Input`;

export interface CreateServiceKeyInput {
  namespace: string;
  name: string;
  tenantNameRef: string;
  domainKeyName: string;
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
      domainKeyRef: input.domainKeyName
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

export interface CreateDomainKeyInput {
  namespace: string;
  name: string;
  type: 'Team' | 'BusinessUnit';
  tenantNameRef: string;
  primaryRootKey: RootKeyRef;
  fallbackRootKeys?: RootKeyRef[];
}

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
  const typedRef = (r: RootKeyRef) => ({
    apiGroup: 'operations.openkcm.io',
    kind: r.kind,
    ...(r.namespace ? { namespace: r.namespace } : {}),
    name: r.name
  });
  const object: Record<string, unknown> = {
    metadata: { name: input.name, namespace: input.namespace },
    spec: {
      type: input.type,
      tenantNameRef: input.tenantNameRef,
      primaryRootKeyRef: typedRef(input.primaryRootKey),
      ...(input.fallbackRootKeys && input.fallbackRootKeys.length > 0
        ? { fallbackRootKeyRefs: input.fallbackRootKeys.map(typedRef) }
        : {})
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

const ROOTKEY_QUERY = `
  query RootKeys($ns: String!) {
    operations_openkcm_io {
      v1alpha1 {
        AWSRootKeys(namespace: $ns) {
          items { metadata { name namespace creationTimestamp } spec { tenantNameRef region keyUri endpointUrl lifecycle } status { conditions { type status reason message lastTransitionTime } cryptoState { id version lifecycleState lastRotatedAt } reconciliationStatus { success message internalKeyId errors identityInfo { subject } } } }
        }
        AzureRootKeys(namespace: $ns) {
          items { metadata { name namespace creationTimestamp } spec { tenantNameRef vaultUrl keyName keyVersion lifecycle } status { conditions { type status reason message lastTransitionTime } cryptoState { id version lifecycleState lastRotatedAt } reconciliationStatus { success message internalKeyId errors identityInfo { subject } } } }
        }
        OpenBaoRootKeys(namespace: $ns) {
          items { metadata { name namespace creationTimestamp } spec { tenantNameRef enginePath keyName serverAddress lifecycle } status { conditions { type status reason message lastTransitionTime } cryptoState { id version lifecycleState lastRotatedAt } reconciliationStatus { success message internalKeyId errors identityInfo { subject } } } }
        }
        GCPRootKeys(namespace: $ns) {
          items { metadata { name namespace creationTimestamp } spec { tenantNameRef } status { conditions { type status reason message lastTransitionTime } cryptoState { id version lifecycleState lastRotatedAt } reconciliationStatus { success message internalKeyId errors } } }
        }
        VaultRootKeys(namespace: $ns) {
          items { metadata { name namespace creationTimestamp } spec { tenantNameRef } status { conditions { type status reason message lastTransitionTime } cryptoState { id version lifecycleState lastRotatedAt } reconciliationStatus { success message internalKeyId errors } } }
        }
        HSMRootKeys(namespace: $ns) {
          items { metadata { name namespace creationTimestamp } spec { tenantNameRef } status { conditions { type status reason message lastTransitionTime } cryptoState { id version lifecycleState lastRotatedAt } reconciliationStatus { success message internalKeyId errors } } }
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
            metadata { name namespace creationTimestamp }
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
  // Gateway updateXXX is a JSON merge patch — we only need to send the
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

export interface UpdateOpenBaoRootKeyInput {
  namespace: string;
  name: string;
  serverAddress: string;
  enginePath: string;
  keyName: string;
  certAuthMountPath: string;
  certAuthRoleName: string;
}

export const updateOpenBaoRootKey = (opts: KcpClientOptions, input: UpdateOpenBaoRootKeyInput) =>
  sendSpecPatch(opts, UPDATE_OPENBAO_MUTATION, input.namespace, input.name, {
    serverAddress: input.serverAddress,
    enginePath: input.enginePath,
    keyName: input.keyName,
    certAuth: {
      authMountPath: input.certAuthMountPath,
      roleName: input.certAuthRoleName
    }
  });

export interface UpdateAWSRootKeyInput {
  namespace: string;
  name: string;
  region: string;
  keyUri: string;
  trustAnchorArn: string;
  profileArn: string;
  roleArn: string;
}

export const updateAWSRootKey = (opts: KcpClientOptions, input: UpdateAWSRootKeyInput) =>
  sendSpecPatch(opts, UPDATE_AWS_MUTATION, input.namespace, input.name, {
    region: input.region,
    keyUri: input.keyUri,
    rolesAnywhere: {
      trustAnchorArn: input.trustAnchorArn,
      profileArn: input.profileArn,
      roleArn: input.roleArn
    }
  });

export interface UpdateAzureRootKeyInput {
  namespace: string;
  name: string;
  vaultUrl: string;
  keyName: string;
  azureTenantId: string;
  clientId: string;
}

export const updateAzureRootKey = (opts: KcpClientOptions, input: UpdateAzureRootKeyInput) =>
  sendSpecPatch(opts, UPDATE_AZURE_MUTATION, input.namespace, input.name, {
    vaultUrl: input.vaultUrl,
    keyName: input.keyName,
    federatedIdentity: {
      tenantId: input.azureTenantId,
      clientId: input.clientId
    }
  });

export interface UpdateDomainKeyRefsInput {
  namespace: string;
  name: string;
  primaryRootKey: RootKeyRef;
  fallbackRootKeys: RootKeyRef[];
}

export const updateDomainKeyRefs = (opts: KcpClientOptions, input: UpdateDomainKeyRefsInput) => {
  const typedRef = (r: RootKeyRef) => ({
    apiGroup: 'operations.openkcm.io',
    kind: r.kind,
    ...(r.namespace ? { namespace: r.namespace } : {}),
    name: r.name
  });
  return sendSpecPatch(opts, UPDATE_DOMAINKEY_MUTATION, input.namespace, input.name, {
    primaryRootKeyRef: typedRef(input.primaryRootKey),
    // Always send the array — empty [] removes any existing fallbacks via
    // JSON merge-patch (the gateway forwards merge-patch semantics).
    fallbackRootKeyRefs: input.fallbackRootKeys.map(typedRef)
  });
};

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
  subscription ServiceKeys($ns: String!, $resourceVersion: String) {
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
  subscription DomainKeys($ns: String!, $resourceVersion: String) {
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
  namespace: string,
  resourceVersion: string | null,
  onEvent: () => void
): SubscriptionHandle =>
  subscribe(opts, SERVICEKEY_SUBSCRIPTION, { ns: namespace, resourceVersion }, onEvent);

export const subscribeDomainKeys = (
  opts: KcpClientOptions,
  namespace: string,
  resourceVersion: string | null,
  onEvent: () => void
): SubscriptionHandle =>
  subscribe(opts, DOMAINKEY_SUBSCRIPTION, { ns: namespace, resourceVersion }, onEvent);

const buildSubscription = (resource: string) => `
  subscription Watch${resource}($ns: String!) {
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
  namespace: string,
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
  namespace: string,
  onEvent: () => void
): SubscriptionHandle => subscribe(opts, DEK_SUBSCRIPTION, { ns: namespace }, onEvent);
