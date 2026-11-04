import type { DomainKey, DomainKeyScope, ServiceKey, TypedReference } from '../types';
import { keyLifecycle } from './lifecycle';

export const domainKeyScope = (dk: DomainKey): DomainKeyScope => dk.spec.scope ?? 'Namespace';

export const scopeLabel = (dk: DomainKey): string => `Scope: ${domainKeyScope(dk)}`;

// An empty name is how a link is cleared through the gateway.
export const linkedRootKeyRef = (dk: DomainKey): TypedReference | undefined =>
  dk.spec.primaryRootKeyRef?.name ? dk.spec.primaryRootKeyRef : undefined;

const isActive = (dk: DomainKey) => keyLifecycle(dk) === 'Active';

type Named = { metadata: { name: string; creationTimestamp?: string } };

const olderFirst = (a: Named, b: Named) =>
  (a.metadata.creationTimestamp ?? '').localeCompare(b.metadata.creationTimestamp ?? '') ||
  a.metadata.name.localeCompare(b.metadata.name);

const hasKey = (sk: ServiceKey) => Boolean(sk.status?.cryptoState?.id);

// Same order the controller uses to pick the one ServiceKey an Instance DomainKey serves.
const servesFirst = (a: ServiceKey, b: ServiceKey) => Number(hasKey(b)) - Number(hasKey(a)) || olderFirst(a, b);

// The controller keeps the oldest Namespace DomainKey and rejects the rest.
export const namespaceDomainKey = (domainKeys: DomainKey[]): DomainKey | undefined =>
  domainKeys.filter((dk) => domainKeyScope(dk) === 'Namespace').sort(olderFirst)[0];

export const orderedDomainKeys = (domainKeys: DomainKey[]): DomainKey[] => {
  const namespaceKey = namespaceDomainKey(domainKeys);
  const others = domainKeys.filter((dk) => dk !== namespaceKey).sort(olderFirst);
  return namespaceKey ? [namespaceKey, ...others] : others;
};

export const instanceDomainKeys = (domainKeys: DomainKey[]): DomainKey[] =>
  domainKeys.filter((dk) => domainKeyScope(dk) === 'Instance').sort(olderFirst);

export const parentNamespace = (sk: ServiceKey): string | undefined =>
  sk.spec.domainKeyNamespace || sk.metadata.namespace;

export const serviceKeyOn = (dk: DomainKey, serviceKeys: ServiceKey[]): ServiceKey | undefined =>
  serviceKeys
    .filter((sk) => sk.spec.domainKeyRef === dk.metadata.name && parentNamespace(sk) === dk.metadata.namespace)
    .sort(servesFirst)[0];

export const mintableDomainKeys = (domainKeys: DomainKey[], serviceKeys: ServiceKey[]): DomainKey[] => {
  const namespaces = [...new Set(domainKeys.map((dk) => dk.metadata.namespace))];
  const namespaceKeys = namespaces.flatMap((namespace) => {
    const key = namespaceDomainKey(domainKeys.filter((dk) => dk.metadata.namespace === namespace));
    return key ? [key] : [];
  });
  const freeInstanceKeys = instanceDomainKeys(domainKeys).filter((dk) => !serviceKeyOn(dk, serviceKeys));
  const systemKeys = domainKeys.filter((dk) => domainKeyScope(dk) === 'System').sort(olderFirst);
  return [...namespaceKeys, ...freeInstanceKeys, ...systemKeys].filter(isActive);
};
