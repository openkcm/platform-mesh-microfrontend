import { Kind, parse, print, visit, type OperationDefinitionNode } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAWSRootKey,
  createAzureRootKey,
  createDataEncryptionKey,
  createDomainKey,
  createOpenBaoRootKey,
  createServiceKey,
  deleteAWSRootKey,
  deleteAzureRootKey,
  deleteDataEncryptionKey,
  deleteDomainKey,
  deleteOpenBaoRootKey,
  deleteServiceKey,
  setDataEncryptionKeyLifecycle,
  setDomainKeyLifecycle,
  setRootKeyLifecycle,
  setServiceKeyLifecycle,
  type KcpClientOptions
} from './kcp';

const client: KcpClientOptions = {
  graphqlUrl: 'https://portal.example.test/api/kubernetes-graphql-gateway/root/graphql',
  token: 'test-token',
  workspacePath: 'root:orgs:showroom:test-account'
};

const fetchMock = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    new Response(JSON.stringify({ data: { accepted: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
);

const lastRequest = (): { query: string; variables: Record<string, unknown> } => {
  const call = fetchMock.mock.calls.at(-1);
  expect(call).toBeDefined();
  const init = call?.[1];
  expect(init?.body).toBeTypeOf('string');
  return JSON.parse(String(init?.body));
};

const mutationDefinition = (query: string): OperationDefinitionNode => {
  const definition = parse(query).definitions.find(
    (candidate): candidate is OperationDefinitionNode =>
      candidate.kind === Kind.OPERATION_DEFINITION && candidate.operation === 'mutation'
  );
  expect(definition).toBeDefined();
  return definition!;
};

const objectInputType = (query: string): string | undefined => {
  const objectVariable = mutationDefinition(query).variableDefinitions?.find(
    (definition) => definition.variable.name.value === 'object'
  );
  return objectVariable ? print(objectVariable.type) : undefined;
};

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenKCM GraphQL mutation schema contract', () => {
  const mutationCases: Array<{
    operation: string;
    inputType: string;
    invoke: () => Promise<void>;
  }> = [
    {
      operation: 'createServiceKey',
      inputType: 'OperationsOpenkcmIoV1alpha1ServiceKey_Input!',
      invoke: () =>
        createServiceKey(client, {
          namespace: 'default',
          name: 'service-key',
          tenantNameRef: 'test-account',
          domainKeyName: 'domain-key'
        })
    },
    {
      operation: 'createOpenBaoRootKey',
      inputType: 'OperationsOpenkcmIoV1alpha1OpenBaoRootKey_Input!',
      invoke: () =>
        createOpenBaoRootKey(client, {
          namespace: 'default',
          name: 'openbao-root',
          tenantNameRef: 'test-account',
          serverAddress: 'https://openbao.example.test',
          enginePath: 'transit',
          keyName: 'root-key',
          certAuthMountPath: 'cert',
          certAuthRoleName: 'openkcm'
        })
    },
    {
      operation: 'createAWSRootKey',
      inputType: 'OperationsOpenkcmIoV1alpha1AWSRootKey_Input!',
      invoke: () =>
        createAWSRootKey(client, {
          namespace: 'default',
          name: 'aws-root',
          tenantNameRef: 'test-account',
          region: 'eu-central-1',
          keyUri: 'arn:aws:kms:eu-central-1:123456789012:key/test',
          trustAnchorArn: 'arn:aws:rolesanywhere:eu-central-1:123456789012:trust-anchor/test',
          profileArn: 'arn:aws:rolesanywhere:eu-central-1:123456789012:profile/test',
          roleArn: 'arn:aws:iam::123456789012:role/test'
        })
    },
    {
      operation: 'createAzureRootKey',
      inputType: 'OperationsOpenkcmIoV1alpha1AzureRootKey_Input!',
      invoke: () =>
        createAzureRootKey(client, {
          namespace: 'default',
          name: 'azure-root',
          tenantNameRef: 'test-account',
          vaultUrl: 'https://vault.example.test',
          keyName: 'root-key',
          azureTenantId: 'tenant-id',
          clientId: 'client-id'
        })
    },
    {
      operation: 'createDomainKey',
      inputType: 'OperationsOpenkcmIoV1alpha1DomainKey_Input!',
      invoke: () =>
        createDomainKey(client, {
          namespace: 'default',
          name: 'domain-key',
          type: 'Team',
          tenantNameRef: 'test-account',
          primaryRootKey: { kind: 'OpenBaoRootKey', name: 'openbao-root' }
        })
    },
    {
      operation: 'createDataEncryptionKey',
      inputType: 'OperationsOpenkcmIoV1alpha1DataEncryptionKey_Input!',
      invoke: () =>
        createDataEncryptionKey(client, {
          namespace: 'default',
          name: 'data-key',
          tenantNameRef: 'test-account',
          serviceKeyRef: 'service-key'
        })
    },
    {
      operation: 'updateOpenBaoRootKey',
      inputType: 'OperationsOpenkcmIoV1alpha1OpenBaoRootKey_Input!',
      invoke: () => setRootKeyLifecycle(client, 'OpenBaoRootKey', 'default', 'openbao-root', 'Deactivated')
    },
    {
      operation: 'updateAWSRootKey',
      inputType: 'OperationsOpenkcmIoV1alpha1AWSRootKey_Input!',
      invoke: () => setRootKeyLifecycle(client, 'AWSRootKey', 'default', 'aws-root', 'Deactivated')
    },
    {
      operation: 'updateAzureRootKey',
      inputType: 'OperationsOpenkcmIoV1alpha1AzureRootKey_Input!',
      invoke: () => setRootKeyLifecycle(client, 'AzureRootKey', 'default', 'azure-root', 'Deactivated')
    },
    {
      operation: 'updateDomainKey',
      inputType: 'OperationsOpenkcmIoV1alpha1DomainKey_Input!',
      invoke: () => setDomainKeyLifecycle(client, 'default', 'domain-key', 'Deactivated')
    },
    {
      operation: 'updateServiceKey',
      inputType: 'OperationsOpenkcmIoV1alpha1ServiceKey_Input!',
      invoke: () => setServiceKeyLifecycle(client, 'default', 'service-key', 'Deactivated')
    },
    {
      operation: 'updateDataEncryptionKey',
      inputType: 'OperationsOpenkcmIoV1alpha1DataEncryptionKey_Input!',
      invoke: () => setDataEncryptionKeyLifecycle(client, 'default', 'data-key', 'Deactivated')
    }
  ];

  it.each(mutationCases)('$operation uses the current gateway object input type', async ({ inputType, invoke }) => {
    await invoke();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(objectInputType(lastRequest().query)).toBe(inputType);
  });

  const deleteCases: Array<{
    operation: string;
    field: string;
    name: string;
    invoke: () => Promise<void>;
  }> = [
    {
      operation: 'DeleteOpenBaoRootKey',
      field: 'deleteOpenBaoRootKey',
      name: 'openbao-root',
      invoke: () => deleteOpenBaoRootKey(client, 'default', 'openbao-root')
    },
    {
      operation: 'DeleteAWSRootKey',
      field: 'deleteAWSRootKey',
      name: 'aws-root',
      invoke: () => deleteAWSRootKey(client, 'default', 'aws-root')
    },
    {
      operation: 'DeleteAzureRootKey',
      field: 'deleteAzureRootKey',
      name: 'azure-root',
      invoke: () => deleteAzureRootKey(client, 'default', 'azure-root')
    },
    {
      operation: 'DeleteDomainKey',
      field: 'deleteDomainKey',
      name: 'domain-key',
      invoke: () => deleteDomainKey(client, 'default', 'domain-key')
    },
    {
      operation: 'DeleteServiceKey',
      field: 'deleteServiceKey',
      name: 'service-key',
      invoke: () => deleteServiceKey(client, 'default', 'service-key')
    },
    {
      operation: 'DeleteDataEncryptionKey',
      field: 'deleteDataEncryptionKey',
      name: 'data-key',
      invoke: () => deleteDataEncryptionKey(client, 'default', 'data-key')
    }
  ];

  it.each(deleteCases)(
    '$operation preserves delete variables without an object input',
    async ({ operation, field, name, invoke }) => {
      await invoke();

      const request = lastRequest();
      const mutation = mutationDefinition(request.query);
      const variables = Object.fromEntries(
        (mutation.variableDefinitions ?? []).map((definition) => [
          definition.variable.name.value,
          print(definition.type)
        ])
      );
      const fieldNames: string[] = [];
      visit(mutation, {
        Field(node) {
          fieldNames.push(node.name.value);
        }
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(mutation.name?.value).toBe(operation);
      expect(fieldNames).toContain(field);
      expect(variables).toEqual({ ns: 'String!', name: 'String!' });
      expect(request.variables).toEqual({ ns: 'default', name });
      expect(objectInputType(request.query)).toBeUndefined();
    }
  );
});
