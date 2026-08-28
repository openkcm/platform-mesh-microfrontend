/*
 * Fixture data for design-review and offline development.
 * Activated when VITE_FIXTURES=true (the kcp client short-circuits to these).
 */

import type { DataEncryptionKey, DomainKey, RootKey, ServiceKey, Tenant } from '../types';

export const fixturesEnabled = (): boolean => {
  const env = (import.meta as any).env ?? {};
  return env.VITE_FIXTURES === 'true';
};

export const fixtureTenants = (): Tenant[] => [
  {
    metadata: { name: 'ig-9', creationTimestamp: new Date(Date.now() - 36 * 3600_000).toISOString() },
    spec: {
      region: 'eu-central',
      oidcProvider: {
        issuer: 'https://portal.cc-d2.showroom.apeirora.eu/keycloak/realms/showroom'
      }
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          reason: 'TenantRegistered',
          message: 'Tenant registered with OpenKCM key registry.',
          lastTransitionTime: new Date(Date.now() - 35 * 3600_000).toISOString()
        },
        {
          type: 'ProviderSynced',
          status: 'True',
          reason: 'SyncSuccessful',
          message: 'OIDC provider accepted and mirrored to Krypton.',
          lastTransitionTime: new Date(Date.now() - 35 * 3600_000).toISOString()
        }
      ]
    }
  }
];

export const fixtureDomainKeys = (): DomainKey[] => [
  {
    metadata: {
      name: 'ig-9',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 12 * 3600_000).toISOString()
    },
    spec: {
      type: 'Team',
      tenantNameRef: 'ig-9',
      lifecycle: 'Active',
      primaryRootKeyRef: {
        apiGroup: 'operations.openkcm.io',
        kind: 'OpenBaoRootKey',
        name: 'ig-9-root'
      },
      fallbackRootKeyRefs: [
        {
          apiGroup: 'operations.openkcm.io',
          kind: 'AWSRootKey',
          name: 'ig-9-aws-dr'
        }
      ]
    },
    status: {
      conditions: [
        { type: 'Ready', status: 'True', reason: 'KeyMaterialBound', message: 'DomainKey material bound in Krypton.' },
        { type: 'ProviderSynced', status: 'True', reason: 'SyncSuccessful' }
      ],
      cryptoState: {
        id: '8a1f4e2b-7bc6-4f1d-9e0a-1d2c9b3a7f8e',
        version: 1,
        lifecycleState: 'Active',
        lastRotatedAt: new Date(Date.now() - 10 * 3600_000).toISOString()
      }
    }
  }
];

export const fixtureServiceKeys = (): ServiceKey[] => [
  {
    metadata: {
      name: 'mongodb-primary',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 2 * 3600_000).toISOString()
    },
    spec: { tenantNameRef: 'ig-9', domainKeyRef: 'ig-9' },
    status: {
      conditions: [
        { type: 'Ready', status: 'True', reason: 'KeyMaterialBound', message: 'ServiceKey generated natively.' }
      ],
      cryptoState: {
        id: '59936725-aa7c-4abd-b9c1-3f0e2c1a44e2',
        version: 1,
        lifecycleState: 'Active'
      }
    }
  },
  {
    metadata: {
      name: 'postgres-telemetry',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 8 * 60_000).toISOString()
    },
    spec: { tenantNameRef: 'ig-9', domainKeyRef: 'ig-9' },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'PendingActivation',
          message: 'Key is waiting for OpenKCM activation.'
        }
      ],
      cryptoState: {
        id: '11ab44d3-1234-4fa2-85bb-a3c2d5f77781',
        version: 1,
        lifecycleState: 'PreActive'
      }
    }
  }
];

export const fixtureRootKeys = (): RootKey[] => [
  {
    kind: 'OpenBaoRootKey',
    provider: 'OpenBao',
    metadata: {
      name: 'ig-9-root',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 13 * 3600_000).toISOString()
    },
    spec: {
      tenantNameRef: 'ig-9',
      enginePath: 'transit',
      keyName: 'ig-9-root',
      serverAddress: 'https://openbao.internal.acme.corp:8200',
      lifecycle: 'Active'
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'UpstreamAuthenticated' }],
      cryptoState: {
        id: 'd5f08c7a-7bd4-4f2d-9e33-1832c07e9a11',
        version: 1,
        lifecycleState: 'Active'
      }
    }
  },
  {
    kind: 'AWSRootKey',
    provider: 'AWS',
    metadata: {
      name: 'ig-9-aws-dr',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 6 * 3600_000).toISOString()
    },
    spec: {
      tenantNameRef: 'ig-9',
      region: 'us-east-1',
      keyUri: 'arn:aws:kms:us-east-1:123456789012:key/mrk-8eb8379z0abcd',
      lifecycle: 'Active'
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'UpstreamAuthenticated', message: 'AWS KMS bound via Roles Anywhere.' }],
      cryptoState: {
        id: '7b6e112f-aa11-4f1d-9e3a-9c2d9b3a7bcc4',
        version: 1,
        lifecycleState: 'Active'
      }
    }
  },
  {
    kind: 'OpenBaoRootKey',
    provider: 'OpenBao',
    metadata: {
      name: 'ig-9-staging-root',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 45 * 60_000).toISOString()
    },
    spec: {
      tenantNameRef: 'ig-9',
      enginePath: 'transit',
      keyName: 'krypton-staging',
      serverAddress: 'https://openbao-staging.internal.acme.corp:8200',
      lifecycle: 'Active'
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'UpstreamAuthenticated' }],
      cryptoState: {
        id: 'aa11bb22-cc33-4dd4-aa11-bb22cc33dd44',
        version: 1,
        lifecycleState: 'Active'
      }
    }
  }
];

export const fixtureDataEncryptionKeys = (): DataEncryptionKey[] => [
  {
    metadata: {
      name: 'mongodb-primary-dek',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 90 * 60_000).toISOString()
    },
    spec: {
      tenantNameRef: 'ig-9',
      serviceKeyRef: 'mongodb-primary',
      kmip: { attributes: { workload: 'mongodb-primary' } },
      lifecycle: 'Active'
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'KeyMaterialBound' }],
      cryptoState: {
        id: 'f9af7a7d-8e68-447f-a75f-e57c61cd9f38',
        version: 1,
        lifecycleState: 'Active'
      }
    }
  },
  {
    metadata: {
      name: 'mongodb-primary-audit-dek',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 30 * 60_000).toISOString()
    },
    spec: {
      tenantNameRef: 'ig-9',
      serviceKeyRef: 'mongodb-primary',
      kmip: { attributes: { workload: 'mongodb-primary', purpose: 'audit-log' } },
      lifecycle: 'Active'
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'KeyMaterialBound' }],
      cryptoState: {
        id: '11aa22bb-33cc-44dd-55ee-66ff77001188',
        version: 1,
        lifecycleState: 'Active'
      }
    }
  },
  {
    metadata: {
      name: 'mongodb-primary-staging-dek',
      namespace: 'default',
      creationTimestamp: new Date(Date.now() - 5 * 60_000).toISOString()
    },
    spec: {
      tenantNameRef: 'ig-9',
      serviceKeyRef: 'mongodb-primary',
      kmip: { attributes: { workload: 'mongodb-primary', env: 'staging' } },
      lifecycle: 'Active'
    },
    status: {
      conditions: [{ type: 'Ready', status: 'False', reason: 'PendingActivation' }],
      cryptoState: {
        id: 'aabbccdd-eeff-1122-3344-556677889900',
        version: 1,
        lifecycleState: 'PreActive'
      }
    }
  }
];
