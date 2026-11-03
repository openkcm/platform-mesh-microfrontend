// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { allowsL1, checkL1Permission, L1_MARKER, useL1Permission } from './l1Permission';
import { emptyRuntimeContext, type RuntimeContext } from './luigi';

const grant = [{resource: L1_MARKER.resource, name:'account-l1', actions:['manage_l1']}];
const context = (): RuntimeContext => ({...emptyRuntimeContext(), source:'luigi', token:'user-a', workspacePath:'root:orgs:org:parent:account', graphqlUrl:'https://portal.test/gateway/graphql'});
const request = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', request); request.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('checks the concrete marker in the full account path', async () => {
  request.mockResolvedValue({ok:true,json:async()=>grant});
  const signal = new AbortController().signal;
  expect(await checkL1Permission(context(), signal)).toBe(true);
  const [url, options] = request.mock.calls[0];
  expect(url.toString()).toBe('https://portal.test/rest/permissions/resource-check');
  expect(options.headers.Authorization).toBe('Bearer user-a');
  expect(options.signal).toBe(signal);
  expect(JSON.parse(options.body)).toEqual({organization:'org', accountPath:'parent:account',checks:[L1_MARKER]});
});

it.each([null, undefined, {}, [], [{resource:L1_MARKER.resource,actions:['manage_l1']}],
  [{...grant[0],namespace:'default'}], [{...grant[0],namespace:null}], [{...grant[0],namespace:42}],
  [{...grant[0],namespace:'other'}], [{...grant[0],name:'other'}],
  [{...grant[0],actions:'manage_l1'}], [{...grant[0],actions:['update']}], [...grant, null]])('denies malformed or absent permission data: %j', (value) => {
  expect(allowsL1(value)).toBe(false);
});

it.each(['deny','http','json','network'])('keeps L1 read-only after %s failure', async (failure) => {
  request.mockImplementation(async () => {
    if (failure==='network') throw new Error('offline');
    return {ok:failure!=='http',json:async()=>{if(failure==='json') throw new Error('bad json');return [];}};
  });
  const ctx=context();
  const {result} = renderHook(()=>useL1Permission(ctx));
  await act(async()=>{});
  expect(result.current).toBe(false);
});

it('denies pending checks and ignores a late account grant', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  request.mockResolvedValue({ok:true,json:async()=>[]});
  const first = context();
  const {result,rerender} = renderHook(({ctx})=>useL1Permission(ctx),{initialProps:{ctx:first}});
  expect(result.current).toBe(false);
  const oldSignal=request.mock.calls[0][1].signal;
  rerender({ctx:{...first,workspacePath:'root:orgs:org:other'}});
  expect(oldSignal.aborted).toBe(true);
  await act(async()=>finish({ok:true,json:async()=>grant}));
  expect(result.current).toBe(false);
});

it.each(['account','user','permission'])('clears an existing grant on %s context change', async (change) => {
  request.mockResolvedValueOnce({ok:true,json:async()=>grant});
  request.mockImplementation(()=>new Promise(()=>{}));
  const first=context();
  const {result,rerender}=renderHook(({ctx})=>useL1Permission(ctx),{initialProps:{ctx:first}});
  await waitFor(()=>expect(result.current).toBe(true));
  const next={...first};
  if(change==='account') next.workspacePath='root:orgs:org:other';
  if(change==='user') next.token='user-b';
  rerender({ctx:next});
  expect(result.current).toBe(false);
});

it('does not grant access from the dev mock or missing identity', async()=>{
  for(const ctx of [emptyRuntimeContext(),{...context(),source:'mock' as const},{...context(),token:null}]) {
    expect(await checkL1Permission(ctx,new AbortController().signal)).toBe(false);
  }
  expect(request).not.toHaveBeenCalled();
});


it('omits the marker namespace even when slots use a custom namespace', async()=>{
  const ctx={...context(),accountNamespace:'account-keys'};
  request.mockResolvedValue({ok:true,json:async()=>grant});
  expect(await checkL1Permission(ctx,new AbortController().signal)).toBe(true);
  expect(JSON.parse(request.mock.calls[0][1].body).checks[0]).not.toHaveProperty('namespace');
});

it.each([undefined, ''])('accepts the cluster-scoped namespace form %j', namespace=>{
  expect(allowsL1([{...grant[0],namespace}])).toBe(true);
});

it('checks IAM management independently from L1 management',async()=>{
  request.mockResolvedValue({ok:true,json:async()=>[{...grant[0],actions:['manage_iam_roles']}]});
  expect(await checkL1Permission(context(),new AbortController().signal,'manage_iam_roles')).toBe(true);
  expect(JSON.parse(request.mock.calls[0][1].body).checks[0].actions).toEqual(['manage_iam_roles']);
  expect(allowsL1(grant,'manage_iam_roles')).toBe(false);
  expect(allowsL1([{...grant[0],namespace:'default',actions:['manage_iam_roles']}],'manage_iam_roles')).toBe(false);
});


it('does not reuse an L1 grant for an IAM check while the new check is pending',async()=>{
  request.mockResolvedValueOnce({ok:true,json:async()=>grant});
  request.mockImplementation(()=>new Promise(()=>{}));
  const ctx=context();
  const {result,rerender}=renderHook(({action})=>useL1Permission(ctx,action),{initialProps:{action:'manage_l1' as 'manage_l1'|'manage_iam_roles'}});
  await waitFor(()=>expect(result.current).toBe(true));
  rerender({action:'manage_iam_roles'});
  expect(result.current).toBe(false);
});

it.each(['focus', 'pageshow', 'visibilitychange'])('keeps the current grant during a %s check, then applies a denial', async (event) => {
  request.mockResolvedValueOnce({ok:true,json:async()=>grant});
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const ctx = context();
  const {result} = renderHook(() => useL1Permission(ctx));
  await waitFor(() => expect(result.current).toBe(true));
  const initialSignal = request.mock.calls[0][1].signal;
  act(() => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)));
  expect(initialSignal.aborted).toBe(true);
  expect(result.current).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => finish({ok:true,json:async()=>[]}));
  expect(result.current).toBe(false);
});

it('ignores a late grant from an earlier refresh', async () => {
  const pending: Array<(value: unknown) => void> = [];
  request.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
  const ctx = context();
  const {result} = renderHook(() => useL1Permission(ctx));
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => pending[1]({ok:true,json:async()=>[]}));
  await act(async () => pending[0]({ok:true,json:async()=>grant}));
  expect(result.current).toBe(false);
});

it.each(['http', 'json', 'network'])('removes an existing grant when a focus refresh has a %s failure', async (failure) => {
  request.mockResolvedValueOnce({ok:true,json:async()=>grant});
  const ctx = context();
  const {result} = renderHook(() => useL1Permission(ctx));
  await waitFor(() => expect(result.current).toBe(true));
  request.mockImplementation(async () => {
    if (failure === 'network') throw new Error('offline');
    return {ok:failure !== 'http',json:async()=>{ throw new Error('bad json'); }};
  });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(result.current).toBe(false);
});

it('restores a grant after a fresh successful focus check', async () => {
  request.mockResolvedValueOnce({ok:true,json:async()=>[]});
  const ctx = context();
  const {result} = renderHook(() => useL1Permission(ctx));
  await act(async()=>{});
  expect(result.current).toBe(false);
  request.mockResolvedValueOnce({ok:true,json:async()=>grant});
  await act(async()=>{ window.dispatchEvent(new Event('focus')); });
  expect(result.current).toBe(true);
});

it('clears a grant immediately when a write invalidates it', async () => {
  request.mockResolvedValueOnce({ok:true,json:async()=>grant});
  request.mockImplementation(() => new Promise(() => {}));
  const ctx = context();
  const {result, rerender} = renderHook(({revision}) => useL1Permission(ctx, 'manage_l1', revision), {initialProps:{revision:0}});
  await waitFor(() => expect(result.current).toBe(true));
  rerender({revision:1});
  expect(result.current).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});

it('removes refresh listeners and aborts the pending check on unmount', () => {
  request.mockImplementation(() => new Promise(() => {}));
  const ctx = context();
  const {unmount} = renderHook(() => useL1Permission(ctx));
  unmount();
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(request).toHaveBeenCalledTimes(1);
});
