import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Label, Option, Select, ThemeProvider } from '@ui5/webcomponents-react';

import { listNamespaces } from '../lib/kcp';
import { emptyRuntimeContext, subscribeToLuigi, type RuntimeContext } from '../lib/luigi';

const ALL_NAMESPACES = '-all-';
const BAR_HEIGHT = '2.75rem';

const fallbackNamespaces = (): string[] => {
  const raw = (import.meta as any).env?.VITE_LUIGI_MOCK_NAMESPACES;
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((name) => name.trim()).filter(Boolean).sort();
};

const luigiClient = (): any => (window as any).LuigiClient;

const currentSelection = (): string => luigiClient()?.getCoreSearchParams?.().namespace || ALL_NAMESPACES;

function DevPortalBar() {
  const [ctx, setCtx] = useState<RuntimeContext>(emptyRuntimeContext);
  const [selected, setSelected] = useState(currentSelection);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToLuigi((next) => {
    setCtx(next);
    setSelected(currentSelection());
  }), []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!ctx.graphqlUrl || !ctx.workspacePath) return;
    try {
      const names = await listNamespaces({
        graphqlUrl: ctx.graphqlUrl,
        token: ctx.token,
        workspacePath: ctx.workspacePath,
        signal
      });
      setNamespaces(names);
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setNamespaces(fallbackNamespaces());
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [ctx.graphqlUrl, ctx.token, ctx.workspacePath]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const options = useMemo(() => {
    const names = new Set(namespaces);
    if (selected !== ALL_NAMESPACES) names.add(selected);
    return [...names].sort();
  }, [namespaces, selected]);

  const choose = (namespace: string) => {
    if (!namespace || namespace === selected) return;
    setSelected(namespace);
    luigiClient()?.__setNamespace?.(namespace);
  };

  return (
    <div
      data-dev-portal-bar
      style={{
        height: BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0 1rem',
        background: 'var(--sapShellColor, #ffffff)',
        borderBottom: '1px solid var(--sapShell_BorderColor, #d9d9d9)'
      }}
    >
      <span
        style={{
          padding: '0.125rem 0.5rem',
          borderRadius: '0.375rem',
          background: 'var(--sapInformativeColor, #0070f2)',
          color: 'var(--sapContent_ContrastTextColor, #ffffff)',
          fontSize: 'var(--sapFontSmallSize, 0.75rem)',
          fontWeight: 'bold'
        }}
      >
        DEV
      </span>
      <Label>Account: {ctx.workspacePath ?? '-'}</Label>
      <span style={{ flex: 1 }} />
      {error && (
        <Label wrappingType="None" title={error}>
          Namespace list unavailable{fallbackNamespaces().length ? ', using VITE_LUIGI_MOCK_NAMESPACES' : ''}
        </Label>
      )}
      <Label>Namespace</Label>
      <Select
        style={{ width: '14rem' }}
        onChange={(e) => choose(e.detail.selectedOption?.dataset?.value ?? '')}
      >
        <Option data-value={ALL_NAMESPACES} selected={selected === ALL_NAMESPACES}>
          All namespaces
        </Option>
        {options.map((name) => (
          <Option key={name} data-value={name} selected={selected === name}>
            {name}
          </Option>
        ))}
      </Select>
      <Button icon="refresh" design="Transparent" tooltip="Reload namespaces" onClick={() => void refresh()} />
    </div>
  );
}

export const mountDevPortalBar = () => {
  const root = document.getElementById('root');
  if (!root || document.getElementById('dev-portal-bar')) return;
  const host = document.createElement('div');
  host.id = 'dev-portal-bar';
  root.before(host);
  root.style.height = `calc(100% - ${BAR_HEIGHT})`;
  createRoot(host).render(
    <ThemeProvider>
      <DevPortalBar />
    </ThemeProvider>
  );
};
