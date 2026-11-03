/*
 * Luigi bootstrap. Pulls graphqlUrl + token + workspacePath from the portal
 * context, with a dev-mode mock so the SPA runs offline.
 */

export type ConfigSource = 'pending' | 'luigi' | 'mock';
export type OpenKCMViewLevel = 'account' | 'namespace';

export interface RuntimeContext {
  source: ConfigSource;
  iamServiceApiUrl?: string | null;
  openkcmPage?: 'keys' | 'l1-key-managers';
  graphqlUrl: string | null;
  token: string | null;
  workspacePath: string | null;
  namespace: string | null;
  accountNamespace: string;
  viewLevel: OpenKCMViewLevel;
}

const normaliseString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.startsWith(':')) return null;
  return trimmed;
};

const absolutizeAgainstPortal = (url: string): string => {
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    (typeof document !== 'undefined' && document.referrer) ||
    (typeof window !== 'undefined' ? window.location.href : '');
  if (!base) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
};

/**
 * Substitute Luigi path parameters (`:accountId`, `:namespaceId`, etc.) that
 * can slip through unresolved when a context is delivered to an iframe on a
 * foreign origin. The portal resolves these for same-origin React components
 * automatically; for external iframes we must do it ourselves.
 */
const substituteLuigiPlaceholders = (url: string, context: any): string => {
  const accountPath = normaliseString(
    context?.kcpPath ??
      context?.portalContext?.kcpPath
  );
  const namespace = normaliseString(
    context?.namespaceId ?? context?.namespace ?? context?.portalContext?.namespace
  );
  // Use the account workspace path for gateway placeholders.
  let out = url;
  if (accountPath) out = out.replace(':accountId', accountPath);
  if (namespace) out = out.replace(':namespaceId', namespace);
  return out;
};

const resolveGraphqlUrl = (context: any): string | null => {
  const candidates = [
    // Prefer already-resolved URLs over template-style ones.
    context?.portalContext?.crdGatewayApiUrl,
    context?.crdGatewayApiUrl,
    context?.portalContext?.graphqlUrl,
    context?.graphqlUrl
  ];
  for (const c of candidates) {
    const v = normaliseString(c);
    if (v) return absolutizeAgainstPortal(substituteLuigiPlaceholders(v, context));
  }
  return null;
};

const workspaceFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  const m =
    url.match(/\/kubernetes-graphql-gateway\/([^/]+)\/graphql/) ??
    url.match(/\/gateway\/api\/clusters\/([^/]+)\/graphql/);
  if (!m) return null;
  const path = decodeURIComponent(m[1]);
  return path.startsWith(':') || path.includes('::') ? null : path;
};

const resolveWorkspacePath = (context: any, graphqlUrl: string | null): string | null =>
  normaliseString(context?.kcpPath) ??
  normaliseString(context?.portalContext?.kcpPath) ??
  workspaceFromUrl(graphqlUrl);

const resolveNamespace = (context: any, search?: Record<string, string>): string | null => {
  const value = search && Object.prototype.hasOwnProperty.call(search, 'namespace')
    ? search.namespace : context?.namespaceId ?? context?.namespace;
  return value === '-all-' ? null : normaliseString(value);
};

const resolveAccountNamespace = (context: any): string =>
  normaliseString(context?.accountNamespace ?? context?.portalContext?.accountNamespace) ?? 'default';

const navigationContexts = (context: any): string[] => {
  const values = [
    context?.navigationContext,
    context?.parentNavigationContext,
    context?.portalContext?.navigationContext,
    context?.portalContext?.parentNavigationContext,
    ...(Array.isArray(context?.parentNavigationContexts) ? context.parentNavigationContexts : []),
    ...(Array.isArray(context?.portalContext?.parentNavigationContexts)
      ? context.portalContext.parentNavigationContexts
      : [])
  ];
  return values.map(normaliseString).filter((value): value is string => Boolean(value));
};

const resolveViewLevel = (context: any, namespace: string | null): OpenKCMViewLevel => {
  const configured = normaliseString(context?.openkcmLevel ?? context?.portalContext?.openkcmLevel);
  if (configured === 'account' || configured === 'namespace') return configured;
  const navContexts = navigationContexts(context);
  if (navContexts.includes('openkcm-namespace')) return 'namespace';
  if (navContexts.includes('openkcm-account')) return 'account';
  return namespace ? 'namespace' : 'account';
};

export const extractRuntimeContext = (context: any, source: ConfigSource, search?: Record<string, string>): RuntimeContext => {
  const graphqlUrl = resolveGraphqlUrl(context);
  const namespace = resolveNamespace(context, search);
  return {
    source,
    graphqlUrl,
    iamServiceApiUrl: normaliseString(context?.portalContext?.iamServiceApiUrl) ? absolutizeAgainstPortal(context.portalContext.iamServiceApiUrl) : null,
    openkcmPage: context?.openkcmPage === 'l1-key-managers' ? 'l1-key-managers' : 'keys',
    token: normaliseString(context?.token ?? context?.portalContext?.token),
    workspacePath: resolveWorkspacePath(context, graphqlUrl),
    namespace,
    accountNamespace: resolveAccountNamespace(context),
    viewLevel: resolveViewLevel(context, namespace)
  };
};

export const emptyRuntimeContext = (): RuntimeContext => ({
  source: 'pending',
  graphqlUrl: null,
  token: null,
  workspacePath: null,
  namespace: null,
  accountNamespace: 'default',
  viewLevel: 'account'
});

interface LuigiClientLike {
  addInitListener: (cb: (context: any) => void) => string | number;
  removeInitListener?: (id: string | number) => void;
  addContextUpdateListener: (cb: (context: any) => void) => string | number;
  removeContextUpdateListener?: (id: string | number) => void;
  getCoreSearchParams?: () => Record<string, string>;
  __isMock?: boolean;
}

const installDevMock = () => {
  if (typeof window === 'undefined') return;
  const env = (import.meta as any).env ?? {};
  const shouldMock = Boolean(env.DEV) || env.VITE_ENABLE_LUIGI_MOCK === 'true';
  if (!shouldMock) return;
  const globalAny = window as any;
  if (globalAny.LuigiClient) return;

  const mockWorkspace = env.VITE_LUIGI_MOCK_WORKSPACE || 'root:orgs:showroom:ig-9';
  const mockNamespace = env.VITE_LUIGI_MOCK_NAMESPACE || 'default';
  const mockLevel = env.VITE_LUIGI_MOCK_LEVEL || 'namespace';
  const mockGraphql = env.VITE_LUIGI_MOCK_GRAPHQL_URL || '/graphql';
  const mockToken = env.VITE_LUIGI_MOCK_TOKEN ?? null;

  const context = {
    token: mockToken,
    kcpPath: mockWorkspace,
    workspacePath: mockWorkspace,
    namespace: mockNamespace,
    accountNamespace: 'default',
    openkcmLevel: mockLevel,
    portalContext: {
      graphqlUrl: mockGraphql,
      kcpPath: mockWorkspace,
      workspacePath: mockWorkspace,
      namespace: mockNamespace,
      accountNamespace: 'default',
      openkcmLevel: mockLevel
    }
  };

  const client: LuigiClientLike = {
    __isMock: true,
    addInitListener(cb) {
      queueMicrotask(() => cb(context));
      return 'mock-init';
    },
    removeInitListener() {},
    addContextUpdateListener() {
      return 'mock-update';
    },
    removeContextUpdateListener() {}
  };

  globalAny.LuigiClient = client;
};

export const subscribeToLuigi = (
  onContext: (ctx: RuntimeContext) => void
): (() => void) => {
  installDevMock();

  let cancelled = false;
  let client: LuigiClientLike | null = null;
  let initId: string | number | null = null;
  let updateId: string | number | null = null;

  const attach = (c: LuigiClientLike) => {
    if (cancelled || !c) return;
    client = c;
    const source: ConfigSource = c.__isMock ? 'mock' : 'luigi';
    initId = c.addInitListener((context) => {
      onContext(extractRuntimeContext(context, source, c.getCoreSearchParams?.()));
    });
    updateId = c.addContextUpdateListener((context) => {
      onContext(extractRuntimeContext(context, source, c.getCoreSearchParams?.()));
    });
  };

  const boot = async () => {
    const globalAny = typeof window !== 'undefined' ? (window as any) : undefined;
    if (globalAny?.LuigiClient) {
      attach(globalAny.LuigiClient);
      return;
    }
    try {
      const mod: any = await import('@luigi-project/client');
      const resolved: LuigiClientLike = mod?.default ?? mod;
      if (globalAny && !globalAny.LuigiClient) {
        globalAny.LuigiClient = resolved;
      }
      attach(resolved);
    } catch (err) {
      console.warn('[openkcm-ui] Luigi client unavailable', err);
    }
  };

  void boot();

  return () => {
    cancelled = true;
    if (client) {
      if (initId != null && client.removeInitListener) client.removeInitListener(initId);
      if (updateId != null && client.removeContextUpdateListener) client.removeContextUpdateListener(updateId);
    }
  };
};

export const navigateToDomainKey = async (name: string, namespace: string, signal?: AbortSignal): Promise<void> => {
  signal?.throwIfAborted();
  const client = await import('@luigi-project/client');
  const route = await client.linkManager().getCurrentRoute();
  signal?.throwIfAborted();
  const url = new URL(route, window.location.origin);
  const segment = '/openkcm/domain-keys';
  const index = url.pathname.lastIndexOf('/openkcm');
  if (index < 0) throw new Error('The portal provider route is unavailable.');
  url.pathname = url.pathname.slice(0, index) + segment + `/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  client.linkManager().navigate(`${url.pathname}${url.search}`);
};
