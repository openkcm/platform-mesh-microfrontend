import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractRuntimeContext,
  navigateToDomainKey,
  navigateToKeys,
  subscribeToLuigi,
  type RuntimeContext
} from './luigi';

const routing = vi.hoisted(() => ({navigate: vi.fn(), getCurrentRoute: vi.fn(), fromParent: vi.fn(), openAsModal: vi.fn()}));
vi.mock('@luigi-project/client', () => ({linkManager: () => routing}));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

// Context as the Platform Mesh portal actually delivers it to the OpenKCM
// namespace micro-frontend (captured on cc-d2, account ykladko, namespace
// kube-system). The namespace arrives only as entityName; the dedicated
// namespace/namespaceId keys are absent for the foreign-origin iframe.
const namespaceContext = {
  organization: 'showroom',
  kcpPath: 'root:orgs:showroom:ykladko',
  entityName: 'kube-system',
  openkcmLevel: 'namespace',
  accountNamespace: 'default',
  portalContext: {
    crdGatewayApiUrl:
      'https://showroom.portal.cc-d2.showroom.apeirora.eu/gateway/api/clusters/root:orgs:showroom:ykladko/graphql'
  }
};

describe('extractRuntimeContext', () => {
  it('does not use the account entityName as a namespace', () => {
    const ctx = extractRuntimeContext(namespaceContext, 'luigi');

    expect(ctx.viewLevel).toBe('namespace');
    expect(ctx.namespace).toBeNull();
    expect(ctx.workspacePath).toBe('root:orgs:showroom:ykladko');
    expect(ctx.graphqlUrl).toContain('/clusters/root:orgs:showroom:ykladko/graphql');
  });

  it('prefers an explicit namespace over entityName', () => {
    const ctx = extractRuntimeContext({ ...namespaceContext, namespace: 'team-a' }, 'luigi');

    expect(ctx.namespace).toBe('team-a');
  });

  it('keeps the account view at account level even though entityName is the account name', () => {
    const ctx = extractRuntimeContext(
      { ...namespaceContext, entityName: 'ykladko', openkcmLevel: 'account' },
      'luigi'
    );

    expect(ctx.viewLevel).toBe('account');
  });
});


it('reads the IAM API and manager view from the portal context',()=>{
  const ctx=extractRuntimeContext({...namespaceContext,openkcmPage:'l1-key-managers',portalContext:{iamServiceApiUrl:'https://portal.test/iam/graphql'}},'luigi');
  expect(ctx.iamServiceApiUrl).toBe('https://portal.test/iam/graphql');
  expect(ctx.openkcmPage).toBe('l1-key-managers');
});

it('reads the Domain Key details page from the portal route context', () => {
  const ctx = extractRuntimeContext(
    { ...namespaceContext, openkcmPage: 'domain-key', domainKeyNamespace: 'team-a', domainKeyName: 'orders' },
    'luigi'
  );
  expect(ctx.openkcmPage).toBe('domain-key');
  expect(ctx.domainKey).toEqual({ namespace: 'team-a', name: 'orders' });
  expect(extractRuntimeContext(
    {
      ...namespaceContext,
      openkcmPage: 'domain-key',
      domainKeyNamespace: ':namespace',
      domainKeyName: ':resourceName'
    },
    'luigi'
  ).domainKey).toBeNull();
});

it.each([
  [
    '/home/accounts/a/openkcm?namespace=-all-',
    'team-a',
    'orders',
    '/home/accounts/a/openkcm/domain-keys/team-a/orders?namespace=-all-'
  ],
  ['/home/accounts/openkcm/openkcm', 'team-b', 'openkcm', '/home/accounts/openkcm/openkcm/domain-keys/team-b/openkcm']
])('opens the details route from %s', async (current, namespace, name, expected) => {
  vi.stubGlobal('window', { location: { origin: 'https://portal.test' } });
  routing.getCurrentRoute.mockResolvedValue(current);
  await navigateToDomainKey(name, namespace);
  expect(routing.navigate.mock.calls).toEqual([[expected]]);
});

it('goes back to the keys route from a details route, keeping the namespace filter', async () => {
  vi.stubGlobal('window', { location: { origin: 'https://portal.test' } });
  routing.getCurrentRoute.mockResolvedValue(
    '/home/accounts/a/openkcm/domain-keys/team-a/openkcm-root?namespace=team-a'
  );
  await navigateToKeys();
  expect(routing.navigate.mock.calls).toEqual([['/home/accounts/a/openkcm?namespace=team-a']]);
});

describe('dev Luigi mock', () => {
  const stubPage = (search: string, hash = '') => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: {
        href: `http://localhost:5174/${search}${hash}`,
        origin: 'http://localhost:5174',
        pathname: '/',
        search,
        hash
      },
      history: { state: null, replaceState, pushState: vi.fn() },
      addEventListener: vi.fn()
    });
    return replaceState;
  };

  it('opens the details page and goes back without a portal', async () => {
    stubPage('?namespace=team-a');
    const seen: RuntimeContext[] = [];
    const stop = subscribeToLuigi((ctx) => seen.push(ctx));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].openkcmPage).toBe('keys');

    await navigateToDomainKey('orders', 'team-a');
    expect(seen.at(-1)?.openkcmPage).toBe('domain-key');
    expect(seen.at(-1)?.domainKey).toEqual({ namespace: 'team-a', name: 'orders' });
    expect(vi.mocked((window as any).history.pushState).mock.calls.at(-1)?.[2])
      .toBe('/?namespace=team-a#/openkcm/domain-keys/team-a/orders');

    await navigateToKeys();
    expect(seen.at(-1)?.openkcmPage).toBe('keys');
    expect(seen.at(-1)?.domainKey).toBeNull();
    expect(routing.navigate).not.toHaveBeenCalled();
    stop();
  });

  it('starts on the details page when the URL names one', async () => {
    stubPage('?namespace=team-a', '#/openkcm/domain-keys/default/shared');
    const seen: RuntimeContext[] = [];
    const stop = subscribeToLuigi((ctx) => seen.push(ctx));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].openkcmPage).toBe('domain-key');
    expect(seen[0].domainKey).toEqual({ namespace: 'default', name: 'shared' });
    stop();
  });

  it('starts from the namespace in the page URL', async () => {
    stubPage('?namespace=team-a');
    const seen: Array<string | null> = [];
    const stop = subscribeToLuigi((ctx) => seen.push(ctx.namespace));

    await vi.waitFor(() => expect(seen).toEqual(['team-a']));
    stop();
  });

  it('pushes a namespace switch to the listeners and the URL like the portal selector', async () => {
    const replaceState = stubPage('');
    const seen: Array<string | null> = [];
    const stop = subscribeToLuigi((ctx) => seen.push(ctx.namespace));
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    (window as any).LuigiClient.__setNamespace('-all-');
    (window as any).LuigiClient.__setNamespace('team-b');

    expect(seen.slice(1)).toEqual([null, 'team-b']);
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toBe('http://localhost:5174/?namespace=team-b');
    expect((window as any).LuigiClient.getCoreSearchParams()).toEqual({ namespace: 'team-b' });
    stop();
  });

  it('stops notifying a listener after unsubscribe', async () => {
    stubPage('');
    const seen: Array<string | null> = [];
    const stop = subscribeToLuigi((ctx) => seen.push(ctx.namespace));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    stop();

    (window as any).LuigiClient.__setNamespace('team-c');

    expect(seen).toHaveLength(1);
  });
});
