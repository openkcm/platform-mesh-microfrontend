import { useEffect, useState } from 'react';
import type { RuntimeContext } from './luigi';

export const L1_MARKER = {
  group: 'operations.openkcm.io',
  resource: 'l1keyaccesses',
  name: 'account-l1',
  actions: ['manage_l1']
};

// Startup portalPermissions omit the instance identity. Only this concrete check grants L1 access.
export type MarkerAction = 'manage_l1' | 'manage_iam_roles';

export const allowsL1 = (value: unknown, action: MarkerAction = 'manage_l1'): boolean => {
  if (!Array.isArray(value)) return false;
  return value.length === 1 && value.every((entry) =>
    entry !== null && typeof entry === 'object' &&
    entry.resource === L1_MARKER.resource && (entry.namespace === undefined || entry.namespace === '') &&
    entry.name === L1_MARKER.name && Array.isArray(entry.actions) &&
    entry.actions.length === 1 && entry.actions[0] === action
  );
};

export const checkL1Permission = async (ctx: RuntimeContext, signal: AbortSignal, action: MarkerAction = 'manage_l1'): Promise<boolean> => {
  const path = ctx.workspacePath?.match(/^root:orgs:([^:]+):(.+)$/);
  if (!path || !ctx.token || !ctx.graphqlUrl || ctx.source !== 'luigi') return false;
  const response = await fetch(new URL('/rest/permissions/resource-check', ctx.graphqlUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
    body: JSON.stringify({ organization: path[1], accountPath: path[2], checks: [{ ...L1_MARKER, actions: [action] }] }),
    signal
  });
  if (!response.ok) return false;
  return allowsL1(await response.json(), action);
};

export const useL1Permission = (ctx: RuntimeContext, action: MarkerAction = 'manage_l1', revision = 0): boolean => {
  const [result, setResult] = useState<{ context: RuntimeContext; action: MarkerAction; revision: number; allowed: boolean } | null>(null);
  useEffect(() => {
    let controller: AbortController;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      void checkL1Permission(ctx, signal, action).then((allowed) => {
        if (!signal.aborted) setResult({ context: ctx, action, revision, allowed });
      }).catch(() => {
        if (!signal.aborted) setResult({ context: ctx, action, revision, allowed: false });
      });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ctx, action, revision]);
  // A new context cannot use a grant from the previous render, even before effect cleanup.
  return result?.context === ctx && result.action === action && result.revision === revision && result.allowed;
};
