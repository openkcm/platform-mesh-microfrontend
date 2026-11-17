import { describe, expect, it } from 'vitest';
import type { RootKey } from '../types';
import { emptyRootKey, rootKeyConfig, rootKeyKind } from './rootKeys';

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

describe('rootKeyConfig', () => {
  const of = (kind: RootKey['kind'], spec: Record<string, unknown>) =>
    rootKeyConfig({ kind, metadata: { name: 'r' }, spec: { tenantNameRef: 'a', ...spec } } as RootKey);
  const flat = (groups: ReturnType<typeof rootKeyConfig>) =>
    groups.map((group) =>
      [group.title, group.rows.map((row) => `${row.label}=${row.value}${row.copy ? ' (copy)' : ''}`)]);

  it('describes an AWS root key and names only the Secret that holds its access key', () => {
    expect(flat(of('AWSRootKey', {
      region: 'eu-central-1',
      keyUri: 'arn:aws:kms:eu-central-1:1:key/k',
      auth: {
        method: 'AccessKey',
        accessKey: { roleArn: 'arn:aws:iam::1:role/r', secretRef: { name: 'awsrootkey-r', namespace: 'default' } }
      }
    }))).toEqual([
      ['KMS', ['Region=eu-central-1', 'Key URI=arn:aws:kms:eu-central-1:1:key/k (copy)']],
      [
        'Access key',
        ['Auth method=AccessKey', 'Role ARN=arn:aws:iam::1:role/r (copy)', 'Credentials=Stored in Secret awsrootkey-r']
      ]
    ]);
  });

  it('describes Azure and OpenBao root keys and marks missing required values', () => {
    const azure = {
      vaultUrl: 'https://v.vault.azure.net',
      keyName: 'k',
      keyVersion: '7',
      federatedIdentity: { tenantId: 't' }
    };
    expect(flat(of('AzureRootKey', azure))).toEqual([
      ['Key Vault', ['Vault URL=https://v.vault.azure.net (copy)', 'Key name=k', 'Key version=7']],
      ['Federated Identity', ['Azure tenant ID=t (copy)', 'Client ID=-']]
    ]);
    const openBao = {
      serverAddress: 'https://bao:8200',
      enginePath: 'transit',
      keyName: 'k',
      certAuth: { authMountPath: 'cert', roleName: 'r' }
    };
    expect(flat(of('OpenBaoRootKey', openBao))).toEqual([
      ['Transit Engine', ['Server address=https://bao:8200 (copy)', 'Engine path=transit', 'Key name=k']],
      ['mTLS Cert Auth', ['Auth mount path=cert', 'Role name=r']]
    ]);
  });

  it('has no provider settings for kinds the UI cannot configure', () => {
    expect(of('GCPRootKey', {})).toEqual([]);
  });
});
