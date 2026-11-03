import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractRuntimeContext, navigateToDomainKey } from './luigi';

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


it.each(['team-a', 'team-b'])('puts row namespace %s in the detail path despite the all-namespaces filter', async (namespace) => {
  vi.stubGlobal('window', {location: {origin:'https://portal.test'}});
  routing.getCurrentRoute.mockResolvedValue('/home/accounts/a/openkcm?namespace=-all-');
  await navigateToDomainKey('same-name', namespace);
  expect(routing.navigate.mock.calls).toEqual([
    [`/home/accounts/a/openkcm/domain-keys/${namespace}/same-name?namespace=-all-`]
  ]);
});


it('reads the IAM API and manager view from the portal context',()=>{
  const ctx=extractRuntimeContext({...namespaceContext,openkcmPage:'l1-key-managers',portalContext:{iamServiceApiUrl:'https://portal.test/iam/graphql'}},'luigi');
  expect(ctx.iamServiceApiUrl).toBe('https://portal.test/iam/graphql');
  expect(ctx.openkcmPage).toBe('l1-key-managers');
});
