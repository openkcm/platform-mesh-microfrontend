import { describe, expect, it } from 'vitest';

import type { DomainKey, DomainKeyScope, ServiceKey } from '../types';
import {
  domainKeyScope,
  instanceDomainKeys,
  linkedRootKeyRef,
  mintableDomainKeys,
  namespaceDomainKey,
  orderedDomainKeys,
  scopeLabel,
  serviceKeyOn
} from './domainKeys';

const domainKey = (
  name: string,
  scope: DomainKeyScope | undefined,
  created: string,
  lifecycleState = 'Active'
): DomainKey => ({
  metadata: { name, namespace: 'team-a', creationTimestamp: created },
  spec: { tenantNameRef: 'acme', ...(scope ? { scope } : {}) },
  status: { cryptoState: { id: `${name}-id`, lifecycleState } }
});

const serviceKey = (
  name: string,
  domainKeyRef: string,
  created?: string,
  keyId?: string,
  namespace = 'team-a'
): ServiceKey => ({
  metadata: { name, namespace, creationTimestamp: created },
  spec: { tenantNameRef: 'acme', domainKeyRef },
  ...(keyId ? { status: { cryptoState: { id: keyId } } } : {})
});

describe('domainKeyScope', () => {
  it('reads a DomainKey without a scope as Namespace', () => {
    // given
    const legacy = domainKey('team-a', undefined, '2026-09-01T00:00:00Z');

    // when
    const scope = domainKeyScope(legacy);

    // then
    expect(scope).toBe('Namespace');
  });

  it('keeps an explicit scope', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');

    // when
    const scope = domainKeyScope(instance);

    // then
    expect(scope).toBe('Instance');
  });
});

describe('scopeLabel', () => {
  it('labels every scope the same way', () => {
    // given
    const legacy = domainKey('team-a', undefined, '2026-09-01T00:00:00Z');
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');

    // when
    const labels = [legacy, instance].map(scopeLabel);

    // then
    expect(labels).toEqual(['Scope: Namespace', 'Scope: Instance']);
  });
});

describe('linkedRootKeyRef', () => {
  const root = { apiGroup: 'operations.openkcm.io', kind: 'OpenBaoRootKey', name: 'ig-9-root' };

  it('returns the root key a DomainKey links to', () => {
    // given
    const linked = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z');
    linked.spec.primaryRootKeyRef = root;

    // when
    const ref = linkedRootKeyRef(linked);

    // then
    expect(ref?.name).toBe('ig-9-root');
  });

  it('treats a missing link and a cleared link the same', () => {
    // given
    const missing = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z');
    const cleared = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');
    cleared.spec.primaryRootKeyRef = { ...root, name: '' };

    // when
    const refs = [missing, cleared].map(linkedRootKeyRef);

    // then
    expect(refs).toEqual([undefined, undefined]);
  });
});

describe('namespaceDomainKey', () => {
  it('picks the oldest Namespace DomainKey and never an Instance one', () => {
    // given
    const olderInstance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');
    const rejected = domainKey('second', 'Namespace', '2026-09-03T00:00:00Z');
    const kept = domainKey('team-a', undefined, '2026-09-02T00:00:00Z');

    // when
    const picked = namespaceDomainKey([olderInstance, rejected, kept]);

    // then
    expect(picked?.metadata.name).toBe('team-a');
  });

  it('finds none when the namespace only holds Instance DomainKeys', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');

    // when
    const picked = namespaceDomainKey([instance]);

    // then
    expect(picked).toBeUndefined();
  });
});

describe('orderedDomainKeys', () => {
  it('puts the Namespace DomainKey first and the rest oldest first', () => {
    // given
    const newer = domainKey('billing-db', 'Instance', '2026-09-05T00:00:00Z');
    const older = domainKey('orders-db', 'Instance', '2026-09-02T00:00:00Z');
    const namespaced = domainKey('team-a', undefined, '2026-09-03T00:00:00Z');

    // when
    const ordered = orderedDomainKeys([newer, namespaced, older]);

    // then
    expect(ordered.map((dk) => dk.metadata.name)).toEqual(['team-a', 'orders-db', 'billing-db']);
  });

  it('keeps a rejected Namespace DomainKey and a System one in the list', () => {
    // given
    const kept = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z');
    const rejected = domainKey('second', 'Namespace', '2026-09-02T00:00:00Z');
    const system = domainKey('platform', 'System', '2026-09-03T00:00:00Z');

    // when
    const ordered = orderedDomainKeys([system, rejected, kept]);

    // then
    expect(ordered.map((dk) => dk.metadata.name)).toEqual(['team-a', 'second', 'platform']);
  });
});

describe('instanceDomainKeys', () => {
  it('lists only Instance DomainKeys, oldest first', () => {
    // given
    const newer = domainKey('billing-db', 'Instance', '2026-09-05T00:00:00Z');
    const namespaced = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z');
    const older = domainKey('orders-db', 'Instance', '2026-09-02T00:00:00Z');

    // when
    const instances = instanceDomainKeys([newer, namespaced, older]);

    // then
    expect(instances.map((dk) => dk.metadata.name)).toEqual(['orders-db', 'billing-db']);
  });
});

describe('serviceKeyOn', () => {
  it('finds the ServiceKey that uses a DomainKey', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');

    // when
    const user = serviceKeyOn(instance, [serviceKey('billing', 'team-a'), serviceKey('orders', 'orders-db')]);

    // then
    expect(user?.metadata.name).toBe('orders');
  });

  it('names the ServiceKey that already holds its key when two ask for one Instance DomainKey', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');
    const blocked = serviceKey('billing', 'orders-db', '2026-09-02T00:00:00Z');
    const holder = serviceKey('orders', 'orders-db', '2026-09-03T00:00:00Z', 'orders-key');

    // when
    const user = serviceKeyOn(instance, [blocked, holder]);

    // then
    expect(user?.metadata.name).toBe('orders');
  });

  it('names the oldest ServiceKey while none holds a key yet', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');
    const newer = serviceKey('api', 'orders-db', '2026-09-03T00:00:00Z');
    const older = serviceKey('worker', 'orders-db', '2026-09-02T00:00:00Z');

    // when
    const user = serviceKeyOn(instance, [newer, older]);

    // then
    expect(user?.metadata.name).toBe('worker');
  });

  it('ignores a ServiceKey in another namespace that names a DomainKey of the same name', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-01T00:00:00Z');
    const elsewhere = serviceKey('orders', 'orders-db', '2026-09-02T00:00:00Z', 'orders-key', 'team-b');

    // when
    const user = serviceKeyOn(instance, [elsewhere]);

    // then
    expect(user).toBeUndefined();
  });
});

describe('mintableDomainKeys', () => {
  it('offers the Namespace DomainKey and the Instance DomainKeys no ServiceKey uses yet', () => {
    // given
    const namespaced = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z');
    const taken = domainKey('orders-db', 'Instance', '2026-09-02T00:00:00Z');
    const free = domainKey('billing-db', 'Instance', '2026-09-03T00:00:00Z');
    const serviceKeys = [serviceKey('api', 'team-a'), serviceKey('orders', 'orders-db')];

    // when
    const offered = mintableDomainKeys([free, taken, namespaced], serviceKeys);

    // then
    expect(offered.map((dk) => dk.metadata.name)).toEqual(['team-a', 'billing-db']);
  });

  it('offers an Instance DomainKey again once its ServiceKey is gone', () => {
    // given
    const instance = domainKey('orders-db', 'Instance', '2026-09-02T00:00:00Z');

    // when
    const offered = mintableDomainKeys([instance], []);

    // then
    expect(offered.map((dk) => dk.metadata.name)).toEqual(['orders-db']);
  });

  it('skips DomainKeys that are not Active and offers System DomainKeys', () => {
    // given
    const pending = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z', 'PreActive');
    const deactivated = domainKey('orders-db', 'Instance', '2026-09-02T00:00:00Z', 'Deactivated');
    const system = domainKey('platform', 'System', '2026-09-03T00:00:00Z');

    // when
    const offered = mintableDomainKeys([pending, deactivated, system], []);

    // then
    expect(offered).toEqual([system]);
  });

  it('skips a DomainKey that is being deleted', () => {
    // given
    const active = domainKey('team-a', 'Namespace', '2026-09-01T00:00:00Z');
    const deleting = { ...active, metadata: { ...active.metadata, deletionTimestamp: '2026-10-05T15:20:50Z' } };

    // when
    const offered = mintableDomainKeys([deleting], []);

    // then
    expect(offered).toEqual([]);
  });
});


it('offers one Namespace DomainKey per namespace for the account page', () => {
  const first=domainKey('equal-name','Namespace','2026-09-01T00:00:00Z');
  const second={...first,metadata:{...first.metadata,namespace:'team-b'}};
  const duplicate=domainKey('duplicate','Namespace','2026-09-02T00:00:00Z');
  expect(mintableDomainKeys([first,second,duplicate],[])).toEqual([first,second]);
});
