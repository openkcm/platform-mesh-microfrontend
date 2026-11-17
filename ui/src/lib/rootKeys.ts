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

export type ConfigRow = { label: string; value: string; copy?: boolean };
export type ConfigGroup = { title: string; rows: ConfigRow[] };

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const required = (label: string, value: unknown, copy = false): ConfigRow => {
  const shown = text(value);
  return { label, value: shown ?? '-', copy: copy && Boolean(shown) };
};

const optional = (label: string, value: unknown, copy = false): ConfigRow[] =>
  text(value) ? [required(label, value, copy)] : [];

export const rootKeyConfig = (root: RootKey): ConfigGroup[] => {
  const spec = root.spec as Record<string, any>;
  if (root.kind === 'AWSRootKey') {
    const accessKey = spec.auth?.accessKey;
    const secret = text(accessKey?.secretRef?.name);
    return [
      {
        title: 'KMS',
        rows: [
          required('Region', spec.region),
          required('Key URI', spec.keyUri, true),
          ...optional('Endpoint URL', spec.endpointUrl, true)
        ]
      },
      {
        title: 'Access key',
        rows: [
          required('Auth method', spec.auth?.method),
          required('Role ARN', accessKey?.roleArn, true),
          { label: 'Credentials', value: secret ? `Stored in Secret ${secret}` : '-' }
        ]
      }
    ];
  }
  if (root.kind === 'AzureRootKey') {
    return [
      {
        title: 'Key Vault',
        rows: [
          required('Vault URL', spec.vaultUrl, true),
          required('Key name', spec.keyName),
          ...optional('Key version', spec.keyVersion)
        ]
      },
      {
        title: 'Federated Identity',
        rows: [
          required('Azure tenant ID', spec.federatedIdentity?.tenantId, true),
          required('Client ID', spec.federatedIdentity?.clientId, true)
        ]
      }
    ];
  }
  if (root.kind === 'OpenBaoRootKey') {
    return [
      {
        title: 'Transit Engine',
        rows: [
          required('Server address', spec.serverAddress, true),
          required('Engine path', spec.enginePath),
          required('Key name', spec.keyName)
        ]
      },
      {
        title: 'mTLS Cert Auth',
        rows: [
          required('Auth mount path', spec.certAuth?.authMountPath),
          required('Role name', spec.certAuth?.roleName)
        ]
      }
    ];
  }
  return [];
};
