import { Kind, parse, print, visit, type OperationDefinitionNode } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listRootKeys,
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
  linkDomainKeyRoot,
  listAllDomainKeys,
  listDomainKeys,
  setDataEncryptionKeyLifecycle,
  setDomainKeyLifecycle,
  setRootKeyLifecycle,
  setServiceKeyLifecycle,
  unlinkDomainKeyRoot,
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

it.each(['http', 'graphql'])('invalidates L1 permission after a %s write denial', async (failure) => {
  const onL1PermissionDenied = vi.fn();
  const message = 'admission webhook denied the request: The L1 Key Manager role is required.';
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({errors:[{message}]}), {status:failure === 'http' ? 403 : 200}));
  await expect(setRootKeyLifecycle({...client, onL1PermissionDenied}, 'AWSRootKey', 'default', 'aws', 'Deactivated')).rejects.toThrow(failure === 'http' ? '403' : message);
  expect(onL1PermissionDenied).toHaveBeenCalledOnce();
});

it.each([403, 503])('does not invalidate permission after a read fails with HTTP %s', async (status) => {
  const onL1PermissionDenied = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response('', {status}));
  await expect(listRootKeys({...client, onL1PermissionDenied}, 'default')).rejects.toThrow(String(status));
  expect(onL1PermissionDenied).not.toHaveBeenCalled();
});

it('does not invalidate permission for an unrelated write error', async () => {
  const onL1PermissionDenied = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({errors:[{message:'Backend unavailable'}]})));
  await expect(setRootKeyLifecycle({...client, onL1PermissionDenied}, 'AWSRootKey', 'default', 'aws', 'Deactivated')).rejects.toThrow('Backend unavailable');
  expect(onL1PermissionDenied).not.toHaveBeenCalled();
});

describe('createAWSRootKey', () => {
  const input = {
    namespace: 'default',
    name: 'aws-root',
    tenantNameRef: 'test-account',
    region: 'eu-central-1',
    keyUri: 'arn:aws:kms:eu-central-1:123456789012:key/test',
    roleArn: 'arn:aws:iam::123456789012:role/test',
    accessKeyId: 'AKIATESTKEYID',
    secretAccessKey: 's3cr3t-value'
  };
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  const bodyOf = (call: number) => JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
  const created = json({
    data: { operations_openkcm_io: { v1alpha1: { createAWSRootKey: { metadata: { name: 'aws-root', uid: 'uid-1' } } } } }
  });

  it('writes the complete root key first, then its credentials Secret, owned by the root key', async () => {
    fetchMock
      .mockResolvedValueOnce(created.clone())
      .mockResolvedValueOnce(json({ data: { v1: { createSecret: { metadata: { name: 'awsrootkey-aws-root' } } } } }));

    await createAWSRootKey(client, input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = bodyOf(0);
    expect(first.variables.object.spec).toEqual({
      tenantNameRef: 'test-account',
      region: input.region,
      keyUri: input.keyUri,
      auth: {
        method: 'AccessKey',
        accessKey: { roleArn: input.roleArn, secretRef: { name: 'awsrootkey-aws-root', namespace: 'default' } }
      }
    });
    expect(JSON.stringify(first)).not.toContain(input.secretAccessKey);
    expect(JSON.stringify(first)).not.toContain(input.accessKeyId);

    const second = bodyOf(1);
    expect(objectInputType(second.query)).toBe('V1Secret_Input!');
    expect(second.query).not.toMatch(/\bdata\b/);
    expect(second.variables.object).toEqual({
      metadata: {
        name: 'awsrootkey-aws-root',
        namespace: 'default',
        labels: { 'openkcm.io/root-key-credentials': 'true' },
        ownerReferences: [
          { apiVersion: 'operations.openkcm.io/v1alpha1', kind: 'AWSRootKey', name: 'aws-root', uid: 'uid-1' }
        ]
      },
      type: 'Opaque',
      stringData: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey }
    });
  });

  it('removes the root key again when its Secret cannot be created, and does not leak the credentials', async () => {
    fetchMock
      .mockResolvedValueOnce(created.clone())
      .mockResolvedValueOnce(json({ errors: [{ message: `invalid value ${input.secretAccessKey}` }] }))
      .mockResolvedValueOnce(json({ data: { operations_openkcm_io: { v1alpha1: { deleteAWSRootKey: true } } } }));

    const error = (await createAWSRootKey(client, input).catch((e: Error) => e)) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('awsrootkey-aws-root');
    expect(error.message).toContain('removed again');
    expect(error.message).not.toContain(input.secretAccessKey);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(2).query).toContain('deleteAWSRootKey');
    expect(bodyOf(2).variables).toEqual({ ns: 'default', name: 'aws-root' });
  });
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

const graphqlResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

const domainKeysResponse = graphqlResponse({
  data: { operations_openkcm_io: { v1alpha1: { DomainKeys: { items: [{ metadata: { name: 'team-a' } }] } } } }
});

describe('DomainKey scope', () => {
  it('sends the scope of an Instance DomainKey', async () => {
    // given
    const input = {
      namespace: 'team-a',
      name: 'orders-db',
      scope: 'Instance' as const,
      tenantNameRef: 'test-account',
      primaryRootKey: { kind: 'OpenBaoRootKey', name: 'openbao-root' }
    };

    // when
    await createDomainKey(client, input);

    // then
    const { variables } = lastRequest();
    expect((variables.object as { spec: { scope?: string } }).spec.scope).toBe('Instance');
  });

  it('leaves the scope to the server default when none is given', async () => {
    // given
    const input = {
      namespace: 'team-a',
      name: 'team-a',
      tenantNameRef: 'test-account',
      primaryRootKey: { kind: 'OpenBaoRootKey', name: 'openbao-root' }
    };

    // when
    await createDomainKey(client, input);

    // then
    const { variables } = lastRequest();
    expect((variables.object as { spec: Record<string, unknown> }).spec).not.toHaveProperty('scope');
  });

  it('asks for the scope of every DomainKey', async () => {
    // given
    fetchMock.mockResolvedValueOnce(domainKeysResponse.clone());

    // when
    await listDomainKeys(client, 'team-a');

    // then
    expect(lastRequest().query).toMatch(/scope tenantNameRef/);
  });

  it.each([
    ['one namespace', () => listDomainKeys(client, 'team-a')],
    ['the whole account', () => listAllDomainKeys(client)]
  ])('reads DomainKeys of %s from a gateway whose schema has no scope yet', async (_, list) => {
    // given
    fetchMock
      .mockResolvedValueOnce(
        graphqlResponse({ errors: [{ message: 'Cannot query field "scope" on type "DomainKeySpec".' }] })
      )
      .mockResolvedValueOnce(domainKeysResponse.clone());

    // when
    const snapshot = await list();

    // then
    expect(snapshot.items.map((dk) => dk.metadata.name)).toEqual(['team-a']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastRequest().query).not.toContain('scope');
  });

  it('does not hide other GraphQL errors', async () => {
    // given
    fetchMock.mockResolvedValueOnce(graphqlResponse({ errors: [{ message: 'forbidden' }] }));

    // when
    const listing = listDomainKeys(client, 'team-a');

    // then
    await expect(listing).rejects.toThrow('forbidden');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DomainKey root key link', () => {
  const target = { namespace: 'team-a', name: 'orders-db' };

  it('creates a DomainKey without a root key', async () => {
    // given
    const input = { ...target, tenantNameRef: 'acme' };

    // when
    await createDomainKey(client, input);

    // then
    const { variables } = lastRequest();
    const { spec } = variables.object as { spec: Record<string, unknown> };
    expect(spec).not.toHaveProperty('primaryRootKeyRef');
    expect(spec.type).toBe('Team');
  });

  it('links a root key', async () => {
    // given
    const rootKey = { kind: 'OpenBaoRootKey', namespace: 'default', name: 'ig-9-root' };

    // when
    await linkDomainKeyRoot(client, { ...target, rootKey });

    // then
    const { variables } = lastRequest();
    expect((variables.object as { spec: { primaryRootKeyRef: unknown } }).spec.primaryRootKeyRef).toEqual({
      apiGroup: 'operations.openkcm.io',
      kind: 'OpenBaoRootKey',
      namespace: 'default',
      name: 'ig-9-root'
    });
  });

  it('unlinks by clearing the name, since the gateway drops null fields', async () => {
    // given
    const rootKey = { kind: 'AWSRootKey', name: 'aws-root' };

    // when
    await unlinkDomainKeyRoot(client, { ...target, rootKey });

    // then
    const { variables } = lastRequest();
    expect((variables.object as { spec: { primaryRootKeyRef: unknown } }).spec.primaryRootKeyRef).toEqual({
      apiGroup: 'operations.openkcm.io',
      kind: 'AWSRootKey',
      name: ''
    });
  });
});


it('requests the configured flag and provider fields from every root type',async()=>{
  await listRootKeys(client,'default');
  const request=lastRequest();
  expect(request.query.match(/ configured }/g)).toHaveLength(6);
  expect(request.query).toContain('auth { method accessKey { roleArn secretRef { name namespace } } }');
  expect(request.query).toContain('certAuth { authMountPath roleName }');
  expect(request.query).toContain('federatedIdentity { tenantId clientId }');
});
