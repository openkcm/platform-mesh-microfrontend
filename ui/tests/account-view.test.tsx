// @vitest-environment jsdom
import { Children, StrictMode, cloneElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RuntimeContext } from '../src/lib/luigi';
const api = vi.hoisted(() => ({
  initialContext: null as RuntimeContext | null,
  context: undefined as undefined | ((context: RuntimeContext) => void),
  rootEvent: undefined as undefined | (() => void),
  configureRoot: vi.fn(), resetRoot: vi.fn(), lifecycleRoot: vi.fn(),
  services: vi.fn(), all: vi.fn(), list: vi.fn(), roots: vi.fn(), tenants: vi.fn(), remove: vi.fn(), createDomain: vi.fn(), createService: vi.fn(), createData: vi.fn(), navigate: vi.fn(), stop: vi.fn()
}));
vi.mock('../src/lib/luigi', async (original) => ({
  ...await original<typeof import('../src/lib/luigi')>(),
  emptyRuntimeContext: () => api.initialContext ?? {source:'pending',graphqlUrl:null,token:null,workspacePath:null,namespace:null,accountNamespace:'default',viewLevel:'account'},
  subscribeToLuigi: (listener: typeof api.context) => { api.context = listener; return () => {}; },
  navigateToDomainKey: api.navigate
}));
vi.mock('../src/lib/kcp', async (original) => ({
  ...await original<typeof import('../src/lib/kcp')>(),
  listTenants: api.tenants, listRootKeys: api.roots,
  listAllDomainKeys: api.all, listDomainKeys: api.list,
  listAllServiceKeys: api.services,
  listAllDataEncryptionKeys: async () => [],
  listServiceKeys: async () => ({items:[], resourceVersion:null}), listDataEncryptionKeys: async () => [],
  subscribeDomainKeys: () => api.stop, subscribeServiceKeys: () => api.stop,
  subscribeRootKeys: (_client:unknown,_namespace:unknown,onEvent:()=>void) => { api.rootEvent=onEvent; return api.stop; },
  updateAWSRootKey: api.configureRoot, requestRootKeyReset: api.resetRoot, setRootKeyLifecycle: api.lifecycleRoot, subscribeDataEncryptionKeys: () => api.stop,
  deleteDomainKey: api.remove, createDomainKey: api.createDomain, createServiceKey: api.createService, createDataEncryptionKey: api.createData
}));
vi.mock('@ui5/webcomponents-base/dist/asset-registries/Icons.js', () => ({ registerIcon: () => {} }));
vi.mock('@ui5/webcomponents-react', () => {
  const box = ({children}: any) => <div>{children}</div>;
  return {
    FlexBox:box, Card:box, Bar:({children,endContent}:any)=><div>{children}{endContent}</div>,
    Button:({children,onClick,disabled,tooltip}:any)=><button disabled={disabled} onClick={onClick} aria-label={tooltip}>{children || tooltip}</button>,
    Dialog:({open,children,footer,headerText}:any)=>open?<div role="dialog"><h2>{headerText}</h2>{children}{footer}</div>:null,
    CardHeader:({titleText}:any)=><h3>{titleText}</h3>, Title:box, Label:({children,for:id}:any)=><label htmlFor={id}>{children}</label>,
    MessageStrip:box, ObjectStatus:box, Toast:({open,children}:any)=>open?<div>{children}</div>:null,
    Popover:()=>null, Icon:()=>null, BusyIndicator:()=>null,
    IllustratedMessage:({titleText}:any)=><div>{titleText}</div>,
    Input:({value,onInput,id,readonly}:any)=><input id={id} value={value} readOnly={readonly} onChange={onInput}/>,
    Select:({children,onChange}:any)=><select value={(Children.toArray(children).find((child:any)=>child.props.selected) as any)?.props['data-value'] ?? ''} onChange={event=>onChange?.({detail:{selectedOption:event.target.selectedOptions[0]}})}>{children}</select>,
    Option:({children,...props}:any)=><option value={props['data-value']} data-value={props['data-value']}>{children}</option>,
    SegmentedButton:({children,onSelectionChange}:any)=><div role="group">{Children.map(children,(child:any)=>cloneElement(child,{onPick:(item:HTMLElement)=>onSelectionChange?.({detail:{selectedItems:[item]}})}))}</div>,
    SegmentedButtonItem:({children,selected,disabled,onPick,...props}:any)=><button type="button" data-value={props['data-value']} aria-pressed={Boolean(selected)} disabled={disabled} onClick={event=>onPick?.(event.currentTarget)}>{children}</button>,
    FlexBoxAlignItems:{}, FlexBoxDirection:{}, FlexBoxJustifyContent:{}
  };
});
import App from '../src/App';
import { extractRuntimeContext } from '../src/lib/luigi';
const context = (account: string, namespace: string | null = null): RuntimeContext => ({
  source:'luigi', graphqlUrl:'https://portal.test/gateway/api/clusters/root:orgs:showroom/graphql',
  token:'test-user', workspacePath:`root:orgs:showroom:${account}`, namespace, accountNamespace:'default', viewLevel:'namespace'
});
const key = (namespace: string, name = 'equal-name') => ({metadata:{name,namespace},spec:{tenantNameRef:'a',scope:'Instance',lifecycle:'Active'},status:{cryptoState:{lifecycleState:'Active'}}});
const snapshot = (items: any[]) => ({items,resourceVersion:null});
const change = (next: RuntimeContext) => act(() => api.context?.(next));
// The Domain Key dialog has two segmented controls: Where (0) and Scope (1).
const level = (dialog: HTMLElement, index: number) => within(within(dialog).getAllByRole('group')[index]);
const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed') === 'true';
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>[{resource:'l1keyaccesses',name:'account-l1',actions:['manage_l1']}]}));
  api.resetRoot.mockReset(); api.configureRoot.mockReset(); api.lifecycleRoot.mockReset();
  vi.clearAllMocks(); api.initialContext = null; api.all.mockResolvedValue(snapshot([])); api.list.mockResolvedValue(snapshot([]));
  api.services.mockResolvedValue(snapshot([])); api.roots.mockResolvedValue([]); api.tenants.mockResolvedValue([]); api.remove.mockResolvedValue(undefined); api.createDomain.mockResolvedValue(undefined); api.createService.mockResolvedValue(undefined); api.createData.mockResolvedValue(undefined); api.navigate.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lists all namespaces and keeps native namespace filters', async () => {
  render(<App/>); change(context('a'));
  await waitFor(() => expect(api.all).toHaveBeenCalled());
  expect(screen.getAllByText('Create Domain Key').every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  change(context('a','team-a'));
  await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({workspacePath:'root:orgs:showroom:a'}),'team-a'));
  expect(screen.getAllByText('Create Domain Key').every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
});

it('uses the row namespace for detail and delete with equal names across namespaces', async () => {
  api.all.mockResolvedValue(snapshot([key('team-a'),key('team-b')]));
  render(<App/>); change(context('a'));
  await screen.findByText('Namespace: team-b');
  fireEvent.click(screen.getAllByText('Details')[1]);
  expect(api.navigate).toHaveBeenCalledWith('equal-name','team-b',expect.any(AbortSignal));
  fireEvent.click(screen.getAllByLabelText('Delete Domain Key')[1]);
  fireEvent.click(screen.getByText('Delete', {selector:'button'}));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith(expect.objectContaining({workspacePath:'root:orgs:showroom:a'}),'team-b','equal-name'));
});

it('prefers the account kcpPath and raw native namespace instead of the account display name', () => {
  const ctx = extractRuntimeContext({kcpPath:'root:orgs:showroom:new-account', entityName:'account-display', openkcmLevel:'namespace', namespaceId:'old',portalContext:{crdGatewayApiUrl:'https://portal.test/gateway/api/clusters/root:orgs:showroom:old-account/graphql'}}, 'luigi', {namespace:'-all-'});
  expect(ctx.workspacePath).toBe('root:orgs:showroom:new-account');
  expect(ctx.namespace).toBeNull();
});

it('aborts the old account and rejects a late list response after an account switch', async () => {
  let finish!: (rows:any) => void;
  api.all.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  render(<App/>); change({...context('a'), viewLevel:'account'});
  await waitFor(() => expect(api.all).toHaveBeenCalledTimes(1));
  const oldClient=api.all.mock.calls[0][0];
  api.all.mockResolvedValue(snapshot([key('team-b','new-account-key')]));
  change({...context('b'), viewLevel:'account'});
  await screen.findByText('new-account-key');
  expect(oldClient.signal.aborted).toBe(true); expect(api.stop).toHaveBeenCalled();
  await act(async () => finish(snapshot([key('team-a','old-account-key')])));
  expect(screen.queryByText('old-account-key')).toBeNull();
});

it('closes old account dialogs and ignores a late delete error', async () => {
  let fail!: (error:Error) => void;
  api.remove.mockImplementationOnce(() => new Promise((_resolve,reject) => {fail=reject;}));
  api.all.mockResolvedValue(snapshot([key('team-a')]));
  render(<App/>); change({...context('a'), viewLevel:'account'});
  await screen.findByText('Namespace: team-a');
  fireEvent.click(screen.getByLabelText('Delete Domain Key'));
  fireEvent.click(screen.getByText('Delete', {selector:'button'}));
  await waitFor(() => expect(api.remove).toHaveBeenCalled());
  api.all.mockResolvedValue(snapshot([])); change({...context('b'), viewLevel:'account'});
  await act(async () => fail(new Error('old-account-error')));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText(/old-account-error/)).toBeNull();
});

it('rejects an unresolved gateway account placeholder without any resource request', async () => {
  const ctx = extractRuntimeContext({accountId:'Display name',openkcmLevel:'namespace',portalContext:{crdGatewayApiUrl:'https://portal.test/gateway/api/clusters/:accountId/graphql'}}, 'luigi');
  expect(ctx.workspacePath).toBeNull();
  render(<App/>); change(ctx);
  await screen.findByText('No GraphQL gateway');
  expect(api.all).not.toHaveBeenCalled(); expect(api.tenants).not.toHaveBeenCalled();
});

it('ignores a late delete success after an account switch', async () => {
  let finish!: () => void;
  api.remove.mockImplementationOnce(() => new Promise<void>(resolve => {finish=resolve;}));
  api.all.mockResolvedValue(snapshot([key('team-a')]));
  render(<App/>); change({...context('a'),viewLevel:'account'});
  await screen.findByText('Namespace: team-a');
  fireEvent.click(screen.getByLabelText('Delete Domain Key'));
  fireEvent.click(screen.getByText('Delete', {selector:'button'}));
  await waitFor(() => expect(api.remove).toHaveBeenCalled());
  api.all.mockResolvedValue(snapshot([])); change({...context('b'),viewLevel:'account'});
  await act(async () => finish());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText(/is being deleted/)).toBeNull();
});


it('creates a live account client for each StrictMode effect setup', async () => {
  api.initialContext = context('a');
  api.all.mockResolvedValue(snapshot([key('team-a', 'strict-mode-key')]));
  render(<StrictMode><App/></StrictMode>);
  await screen.findByText('strict-mode-key');
  const client = api.all.mock.calls.at(-1)![0];
  expect(client.signal.aborted).toBe(false);
  expect(client.workspacePath).toBe('root:orgs:showroom:a');
  cleanup();
  expect(client.signal.aborted).toBe(true);
});


it('shows each ServiceKey namespace when names and parent names match at all namespaces', async () => {
  api.all.mockResolvedValue(snapshot([key('team-a', 'equal-parent'), key('team-b', 'equal-parent')]));
  api.services.mockResolvedValue(snapshot(['team-a', 'team-b'].map(namespace => ({
    metadata: {name: 'equal-service', namespace},
    spec: {domainKeyRef: 'equal-parent', lifecycle: 'Active'}
  }))));
  render(<App/>); change(context('a'));
  const names = await screen.findAllByText('equal-service', {selector: '.key-name'});
  expect(names).toHaveLength(2);
  for (const [index, namespace] of ['team-a', 'team-b'].entries()) {
    const card = names[index].closest('.key-card-header')!.parentElement!;
    expect(within(card).getByText('Namespace: ' + namespace)).toBeTruthy();
    expect(within(card).getByText('equal-parent')).toBeTruthy();
  }
});


it('shows all four tiers together in the account page', async () => {
  api.roots.mockResolvedValue([{kind:'AWSRootKey',provider:'AWS',metadata:{name:'account-root',namespace:'default'},spec:{lifecycle:'Active'},status:{cryptoState:{lifecycleState:'Active'}}}]);
  api.all.mockResolvedValue(snapshot([key('team-a','domain-key')]));
  api.services.mockResolvedValue(snapshot([{metadata:{name:'service-key',namespace:'team-a'},spec:{domainKeyRef:'domain-key',lifecycle:'Active'},status:{cryptoState:{lifecycleState:'Active'}}}]));
  render(<App/>); change({...context('a'),viewLevel:'account'});
  await screen.findByText('service-key',{selector:'.key-name'});
  expect(screen.getByText('account-root',{selector:'.key-name'})).toBeTruthy();
  expect(screen.getByText('domain-key',{selector:'.key-name'})).toBeTruthy();
  expect(screen.queryByText('Register Root Key')).toBeNull();
  expect(screen.getByText('Mint Service Key')).toBeTruthy();
  fireEvent.click(screen.getByText('Add Data Key'));
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('creates a DomainKey in the explicit namespace and rejects an empty namespace', async () => {
  render(<App/>); change({...context('a'),viewLevel:'account'});
  await waitFor(()=>expect(api.all).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Create Domain Key'));
  const dialog=screen.getByRole('dialog');
  fireEvent.click(level(dialog,0).getByText('Namespace'));
  fireEvent.change(within(dialog).getByLabelText('Namespace'),{target:{value:''}});
  expect((within(dialog).getByText('Create',{selector:'button'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('Namespace'),{target:{value:'team-b'}});
  fireEvent.click(within(dialog).getByText('Create',{selector:'button'}));
  await waitFor(()=>expect(api.createDomain).toHaveBeenCalledWith(expect.objectContaining({workspacePath:'root:orgs:showroom:a'}),expect.objectContaining({namespace:'team-b',name:'team-b'})));
});

it('opens Create Domain Key at account level with the System scope when all namespaces are shown', async () => {
  render(<App/>); change({...context('a'),viewLevel:'account'});
  await waitFor(()=>expect(api.all).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Create Domain Key'));
  const dialog=screen.getByRole('dialog');
  expect(pressed(level(dialog,0).getByText('Account'))).toBe(true);
  const namespace=within(dialog).getByLabelText('Namespace') as HTMLInputElement;
  expect([namespace.value,namespace.readOnly]).toEqual(['default',true]);
  const scope=level(dialog,1);
  expect(['System','Namespace','Instance'].map(name=>(scope.getByText(name) as HTMLButtonElement).disabled)).toEqual([false,true,true]);
  expect(pressed(scope.getByText('System'))).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('Name'),{target:{value:'shared'}});
  fireEvent.click(within(dialog).getByText('Create',{selector:'button'}));
  await waitFor(()=>expect(api.createDomain).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({namespace:'default',name:'shared',scope:'System'})));
});

it('opens Create Domain Key at namespace level with the Namespace and Instance scopes', async () => {
  render(<App/>); change({...context('a','team-a'),viewLevel:'account'});
  await waitFor(()=>expect(api.list).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Create Domain Key'));
  const dialog=screen.getByRole('dialog');
  expect(pressed(level(dialog,0).getByText('Namespace'))).toBe(true);
  const namespace=within(dialog).getByLabelText('Namespace') as HTMLInputElement;
  expect([namespace.value,namespace.readOnly]).toEqual(['team-a',false]);
  const scope=level(dialog,1);
  expect(['System','Namespace','Instance'].map(name=>(scope.getByText(name) as HTMLButtonElement).disabled)).toEqual([true,false,false]);
  expect(pressed(scope.getByText('Namespace'))).toBe(true);
  fireEvent.click(scope.getByText('Instance'));
  fireEvent.change(within(dialog).getByLabelText('Name'),{target:{value:'mongodb'}});
  fireEvent.click(within(dialog).getByText('Create',{selector:'button'}));
  await waitFor(()=>expect(api.createDomain).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({namespace:'team-a',name:'mongodb',scope:'Instance'})));
});

it('keeps the Create Domain Key layout when switching between account and namespace level', async () => {
  render(<App/>); change({...context('a'),viewLevel:'account'});
  await waitFor(()=>expect(api.all).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Create Domain Key'));
  const dialog=screen.getByRole('dialog');
  const labels=()=>Array.from(dialog.querySelectorAll('label')).map(label=>label.textContent);
  const account=labels();
  fireEvent.click(level(dialog,0).getByText('Namespace'));
  expect(pressed(level(dialog,1).getByText('Namespace'))).toBe(true);
  expect(labels()).toEqual(account);
  fireEvent.click(level(dialog,0).getByText('Account'));
  expect(pressed(level(dialog,1).getByText('System'))).toBe(true);
  expect(labels()).toEqual(account);
});

it('mints a ServiceKey using the selected namespace when DomainKey names match', async () => {
  api.all.mockResolvedValue(snapshot([key('team-a','same-parent'),key('team-b','same-parent')]));
  render(<App/>); change({...context('a'),viewLevel:'account'});
  await screen.findByText('Namespace: team-b');
  fireEvent.click(screen.getByText('Mint Service Key'));
  const dialog=screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('combobox'),{target:{value:'team-b/same-parent'}});
  fireEvent.change(within(dialog).getByLabelText('Name'),{target:{value:'new-service'}});
  fireEvent.click(within(dialog).getByText('Mint',{selector:'button'}));
  await waitFor(()=>expect(api.createService).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({namespace:'team-b',domainKeyName:'same-parent',name:'new-service'})));
});

it('keeps root operations in the account namespace when the portal filters lower tiers', async () => {
  render(<App/>); change({...context('a','team-b'),viewLevel:'account'});
  await waitFor(()=>expect(api.list).toHaveBeenCalled());
  expect(api.roots.mock.calls.every(([,namespace])=>namespace==='default')).toBe(true);
  expect(screen.queryByText('Register Root Key')).toBeNull();
});


const rootFixture = {kind:'AWSRootKey',provider:'AWS',metadata:{name:'aws',namespace:'default'},spec:{tenantNameRef:'a',configured:false,lifecycle:'Active'},status:{slotState:'Unconfigured',cryptoState:{lifecycleState:'Active'}}};

it.each(['deny','pending','failure','malformed'])('hides L1 actions for %s and preserves lower-tier actions', async (mode) => {
  api.roots.mockResolvedValue([rootFixture]);
  vi.mocked(fetch).mockImplementation(async () => {
    if(mode==='pending') return new Promise(()=>{});
    if(mode==='failure') throw new Error('offline');
    return {ok:true,json:async()=>mode==='malformed'?[{resource:'l1keyaccesses',actions:['manage_l1']}]:[]} as Response;
  });
  render(<App/>); change(context('a'));
  await screen.findByText('AWS',{selector:'.l1-empty-provider'});
  expect(screen.queryByText('Register Root Key')).toBeNull();
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
  expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
  expect(screen.getAllByText('Create Domain Key').every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
});

it('shows L1 actions after allow and closes the dialog when permissions change', async () => {
  api.roots.mockResolvedValue([rootFixture]);
  render(<App/>); change(context('a'));
  fireEvent.click(await screen.findByLabelText('Configure Root Key'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByLabelText('Configure Root Key')).toBeTruthy();
  expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
  vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>[]} as Response);
  change(context('a'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
  await act(async()=>{});
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
});

it('keeps the first L1 action click after focus while the permission check is pending', async () => {
  api.roots.mockResolvedValue([rootFixture]);
  render(<App />); change(context('a'));
  const configure = await screen.findByLabelText('Configure Root Key');
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  fireEvent(window, new Event('focus'));
  expect(screen.getByLabelText('Configure Root Key')).toBe(configure);
  fireEvent.click(configure);
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('hides L1 writes and closes a reset dialog when focus detects a revoked role', async () => {
  api.roots.mockResolvedValue([{...rootFixture,spec:{configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Active'}}}]);
  render(<App/>); change(context('a'));
  fireEvent.click(await screen.findByLabelText('Delete Root Key'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  const pending: Array<(response: Response) => void> = [];
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByLabelText('Delete Root Key')).toBeTruthy();
  await act(async () => pending.forEach(resolve => resolve({ok:true,json:async()=>[]} as Response)));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
  expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
  expect(screen.queryByText('Deactivate',{selector:'button'})).toBeNull();
  expect(screen.getAllByText('Create Domain Key').every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
});

it.each(['http', 'graphql'])('hides L1 writes after a real %s role denial without a context change', async (failure) => {
  const actual = await vi.importActual<typeof import('../src/lib/kcp')>('../src/lib/kcp');
  api.resetRoot.mockImplementation(actual.requestRootKeyReset);
  api.roots.mockResolvedValue([{...rootFixture,spec:{configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Active'}}}]);
  render(<App/>); change(context('a'));
  fireEvent.click(await screen.findByLabelText('Delete Root Key'));
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.checks) return new Promise(() => {});
    return {ok:failure !== 'http',status:403,statusText:'Forbidden',json:async()=>({errors:[{message:'The L1 Key Manager role is required.'}]})} as Response;
  });
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete',{selector:'button'}));
  await screen.findByText(/Delete failed:/);
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
  expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([,init]) => String(init?.body).includes('"checks"'))).toBe(true);
});

it('rechecks manage_l1 when the user returns from L1 Key Managers', async () => {
  api.roots.mockResolvedValue([rootFixture]);
  render(<App/>); change({...context('a'),openkcmPage:'keys'});
  await screen.findByLabelText('Configure Root Key');
  change({...context('a'),openkcmPage:'l1-key-managers'});
  await screen.findByText('Read-only. Only account owners can manage L1 Key Managers.');
  vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>[]} as Response);
  change({...context('a'),openkcmPage:'keys'});
  await screen.findByText('AWS',{selector:'.l1-empty-provider'});
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
  expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
});


it.each(['Unconfigured','Configuring','Configured','Resetting','ResetFailed'])('shows %s with matching L1 actions', async state=>{
  api.roots.mockResolvedValue([{...rootFixture,spec:{...rootFixture.spec,configured:state!=='Unconfigured'},status:{slotState:state,cryptoState:{lifecycleState:'Active'}}}]);
  render(<App/>);change(context('a'));
  await screen.findByText(state === 'Unconfigured' ? 'Not configured' : `Slot state: ${state}`);
  const configure=await screen.findByLabelText('Configure Root Key') as HTMLButtonElement;
  expect(configure.disabled).toBe(state!=='Unconfigured');
  if (state === 'Unconfigured') expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
  else expect((screen.getByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(!['Configured','Configuring','ResetFailed'].includes(state));
  expect(screen.queryByText('Deactivate',{selector:'button'})!==null).toBe(state==='Configured');
  if(state==='ResetFailed') expect(screen.getByText(/ResetFailed. Use Delete to retry the reset./)).toBeTruthy();
});

it('shows all six slots and marks stubs as not implemented',async()=>{
  const slots=[['AWSRootKey','aws'],['AzureRootKey','azure'],['GCPRootKey','gcp'],['HSMRootKey','hsm'],['VaultRootKey','vault'],['OpenBaoRootKey','openbao']];
  api.roots.mockResolvedValue(slots.map(([kind,name])=>({...rootFixture,kind,metadata:{name,namespace:'default'}})));
  render(<App/>);change(context('a'));
  await screen.findByText('0 configured roots / 6 slots');
  const buttons=await screen.findAllByLabelText('Configure Root Key');
  expect(buttons).toHaveLength(6);
  expect(buttons.filter(button=>(button as HTMLButtonElement).disabled)).toHaveLength(3);
  expect(screen.getAllByText('Not implemented')).toHaveLength(3);
  expect(screen.queryByText('Register Root Key')).toBeNull();
});

it('keeps arbitrary-name legacy roots read-only even for a role holder',async()=>{
  api.roots.mockResolvedValue([{...rootFixture,metadata:{name:'legacy-root',namespace:'default'},spec:{configured:true},status:{slotState:'Configured'}}]);
  render(<App/>);change(context('a'));
  await screen.findByText('Legacy (read-only)',{exact:false});
  await act(async()=>{});
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
  expect(screen.queryByLabelText('Delete Root Key')).toBeNull();
});

it('configures a fixed AWS slot without a create operation',async()=>{
  api.configureRoot.mockResolvedValue(undefined);api.roots.mockResolvedValue([rootFixture]);
  render(<App/>);change(context('a'));
  fireEvent.click(await screen.findByLabelText('Configure Root Key'));
  const dialog=screen.getByRole('dialog');
  const fields=within(dialog).getAllByRole('textbox');
  expect((fields[1] as HTMLInputElement).readOnly).toBe(true);
  for(const field of fields.slice(2)) fireEvent.change(field,{target:{value:'config-value'}});
  fireEvent.click(within(dialog).getByText('Configure',{selector:'button'}));
  await waitFor(()=>expect(api.configureRoot).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({name:'aws',namespace:'default',region:'config-value',keyUri:'config-value'})));
});

it('requests Delete as a UUID reset, permits dependencies, and waits for the exact completion',async()=>{
  api.resetRoot.mockResolvedValue(undefined);
  const configured={...rootFixture,spec:{...rootFixture.spec,configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Active'}}};
  api.roots.mockResolvedValue([configured]);
  api.resetRoot.mockImplementation(async (_client,_kind,_namespace,_name,nonce) => {
    api.roots.mockResolvedValue([{...configured,spec:{...configured.spec,resetRequest:nonce}}]);
  });
  api.all.mockResolvedValue(snapshot([{...key('team-a','child'),spec:{tenantNameRef:'a',primaryRootKeyRef:{kind:'AWSRootKey',name:'aws',namespace:'default'}}}]));
  render(<App/>);change({...context('a'),viewLevel:'account'});
  fireEvent.click(await screen.findByLabelText('Delete Root Key'));
  expect(screen.getByText(/The operator deactivates dependent keys/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete',{selector:'button'}));
  await waitFor(()=>expect(api.resetRoot).toHaveBeenCalled());
  const [client,kind,namespace,name,nonce]=api.resetRoot.mock.calls[0];
  expect(client.workspacePath).toBe('root:orgs:showroom:a');
  expect([kind,namespace,name]).toEqual(['AWSRootKey','default','aws']);
  expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await screen.findByText(/Delete in progress/);
  api.roots.mockResolvedValue([{...rootFixture,spec:{...rootFixture.spec,resetRequest:nonce},status:{slotState:'Unconfigured',lastResetRequest:'old'}}]);
  act(()=>api.rootEvent?.());
  await screen.findByText('Slot state: Unconfigured');
  expect(screen.getByText(/Delete in progress/)).toBeTruthy();
  api.roots.mockResolvedValue([{...rootFixture,status:{slotState:'Unconfigured',lastResetRequest:nonce}}]);
  act(()=>api.rootEvent?.());
  await waitFor(()=>expect(screen.queryByText(/Delete in progress/)).toBeNull());
  expect((screen.getByLabelText('Configure Root Key') as HTMLButtonElement).disabled).toBe(false);
});


it('offers only configured Active roots as L2 parents',async()=>{
  api.roots.mockResolvedValue([
    rootFixture,
    {...rootFixture,kind:'AzureRootKey',metadata:{name:'azure',namespace:'default'},spec:{configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Active'}}},
    {...rootFixture,kind:'OpenBaoRootKey',metadata:{name:'openbao',namespace:'default'},spec:{configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Deactivated'}}}
  ]);
  render(<App/>);change(context('a'));
  await screen.findByText('azure',{selector:'.key-name'});
  fireEvent.click(screen.getAllByText('Create Domain Key')[0]);
  const options=within(screen.getByRole('dialog')).getAllByRole('option').map(option=>option.textContent);
  expect(options).toContain('azure');
  expect(options).not.toContain('aws');
  expect(options).not.toContain('openbao');
});


it('keeps Configure disabled between reset acknowledgement and request cleanup',async()=>{
  api.roots.mockResolvedValue([{...rootFixture,spec:{...rootFixture.spec,resetRequest:'completed'},status:{slotState:'Unconfigured',lastResetRequest:'completed'}}]);
  render(<App/>);change(context('a'));
  expect((await screen.findByLabelText('Configure Root Key') as HTMLButtonElement).disabled).toBe(true);
  api.roots.mockResolvedValue([rootFixture]);act(()=>api.rootEvent?.());
  await waitFor(()=>expect((screen.getByLabelText('Configure Root Key') as HTMLButtonElement).disabled).toBe(false));
});

it('unlocks Delete after a rejected reset and a fresh unchanged snapshot',async()=>{
  api.resetRoot.mockRejectedValueOnce(new Error('503 Service Unavailable'));
  const configured={...rootFixture,spec:{...rootFixture.spec,configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Active'}}};
  api.roots.mockResolvedValue([configured]);
  render(<App/>);change(context('a'));
  fireEvent.click(await screen.findByLabelText('Delete Root Key'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete',{selector:'button'}));
  await screen.findByText(/Delete failed: 503/);
  expect((screen.getByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/Delete in progress/)).toBeNull();
  act(()=>api.rootEvent?.());
  await waitFor(()=>expect(api.roots.mock.calls.length).toBeGreaterThan(1));
  await waitFor(()=>expect((screen.getByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText(/Delete in progress/)).toBeNull();
});

it('permits Delete when initial registration is stuck in Configuring',async()=>{
  api.roots.mockResolvedValue([{...rootFixture,spec:{...rootFixture.spec,configured:true},status:{slotState:'Configuring',conditions:[{type:'Ready',status:'False',reason:'RootKeyCreateFailed',message:'Backend registration rejected'}]}}]);
  render(<App/>);change(context('a'));
  await screen.findByText('Slot state: Configuring');
  expect((await screen.findByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByLabelText('Configure Root Key') as HTMLButtonElement).disabled).toBe(true);
});


it('unlocks an accepted optimistic reset when a fresh snapshot has no pending request',async()=>{
  const configured={...rootFixture,spec:{...rootFixture.spec,configured:true},status:{slotState:'Configured',cryptoState:{lifecycleState:'Active'}}};
  api.roots.mockResolvedValue([configured]);api.resetRoot.mockResolvedValue(undefined);
  render(<App/>);change(context('a'));
  fireEvent.click(await screen.findByLabelText('Delete Root Key'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete',{selector:'button'}));
  await waitFor(()=>expect(api.resetRoot).toHaveBeenCalledOnce());
  await waitFor(()=>expect(api.roots.mock.calls.length).toBeGreaterThan(1));
  await waitFor(()=>expect((screen.getByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText(/Delete in progress/)).toBeNull();
});


it('retries an empty ResetFailed request but never replaces a persisted nonce',async()=>{
  const failed={...rootFixture,spec:{...rootFixture.spec,configured:true},status:{slotState:'ResetFailed',conditions:[{type:'Ready',status:'False',reason:'CleanupFailed',message:'Backend cleanup unavailable'}]}};
  api.roots.mockResolvedValue([failed]);
  api.resetRoot.mockImplementation(async(_client,_kind,_ns,_name,nonce)=>{
    api.roots.mockResolvedValue([{...failed,spec:{...failed.spec,resetRequest:nonce}}]);
  });
  render(<App/>);change(context('a'));
  const button=await screen.findByLabelText('Delete Root Key') as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete',{selector:'button'}));
  await screen.findByText(/Retrying automatically.*Backend cleanup unavailable/);
  expect((screen.getByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(true);
  expect(api.resetRoot).toHaveBeenCalledOnce();
  act(()=>api.rootEvent?.());
  await waitFor(()=>expect(api.roots.mock.calls.length).toBeGreaterThan(2));
  expect((screen.getByLabelText('Delete Root Key') as HTMLButtonElement).disabled).toBe(true);
  expect(api.resetRoot).toHaveBeenCalledOnce();
});


const allowMarkerActions = (actions:string[]) => {
  vi.mocked(fetch).mockImplementation(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(body.query) return {ok:true,json:async()=>({data:{users:{users:[],pageInfo:{hasNextPage:false,totalCount:1}}}})} as Response;
    const action=body.checks[0].actions[0];
    return {ok:true,json:async()=>actions.includes(action)?[{resource:'l1keyaccesses',name:'account-l1',actions:[action]}]:[]} as Response;
  });
};

it('keeps the IAM shortcut off Keys for a marker administrator without granting L1 writes',async()=>{
  api.roots.mockResolvedValue([rootFixture]);
  allowMarkerActions(['manage_iam_roles']);
  render(<App/>);change(context('a'));
  await waitFor(()=>expect(api.roots).toHaveBeenCalled());
  expect(screen.queryByText('L1 Key Managers')).toBeNull();
  expect(screen.queryByLabelText('Configure Root Key')).toBeNull();
});

it('does not show IAM management to an L1 manager without manage_iam_roles',async()=>{
  api.roots.mockResolvedValue([rootFixture]);
  allowMarkerActions(['manage_l1']);
  render(<App/>);change(context('a'));
  await screen.findByLabelText('Configure Root Key');
  expect(screen.queryByText('L1 Key Managers')).toBeNull();
});

it.each(['deny','pending','failure','namespaced'])('hides the IAM entry for %s permission data',async(mode)=>{
  vi.mocked(fetch).mockImplementation(async()=>{
    if(mode==='pending')return new Promise(()=>{});
    if(mode==='failure')throw new Error('offline');
    return {ok:true,json:async()=>mode==='namespaced'?[{resource:'l1keyaccesses',name:'account-l1',namespace:'default',actions:['manage_iam_roles']}]:[]} as Response;
  });
  render(<App/>);change(context('a'));
  await waitFor(()=>expect(api.roots).toHaveBeenCalled());
  expect(screen.queryByText('L1 Key Managers')).toBeNull();
});

it.each(['account','user'])('hides the Members form immediately on %s change',async(kind)=>{
  allowMarkerActions(['manage_iam_roles']);
  const members={...context('a'),openkcmPage:'l1-key-managers' as const,iamServiceApiUrl:'https://portal.test/iam/graphql'};
  render(<App/>);change(members);
  await screen.findByRole('form',{name:'Add L1 Key Manager'});
  vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));
  change(kind==='account'?{...members,workspacePath:'root:orgs:showroom:b'}:{...members,token:'new-user'});
  expect(screen.queryByRole('form',{name:'Add L1 Key Manager'})).toBeNull();
});

it('mounts the manager view and revokes through IAM without loading key resources',async()=>{
  let revoked=false;
  const mutations:any[]=[];
  vi.mocked(fetch).mockImplementation(async(url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(String(url)==='https://portal.test/iam/graphql') {
      if(body.query.includes('mutation RevokeL1KeyManager')) {
        mutations.push(body);revoked=true;
        return {ok:true,json:async()=>({data:{removeRole:{success:true,error:null,wasAssigned:true}}})} as Response;
      }
      return {ok:true,json:async()=>({data:{users:{users:revoked?[]:[{user:{userId:'holder',email:'holder@example.test'},roles:[{id:'l1_key_manager'}]}],pageInfo:{hasNextPage:false,totalCount:1}}}})} as Response;
    }
    return {ok:true,json:async()=>[{resource:'l1keyaccesses',name:'account-l1',actions:body.checks[0].actions}]} as Response;
  });
  render(<App/>);change({...context('a'),openkcmPage:'l1-key-managers',iamServiceApiUrl:'https://portal.test/iam/graphql'});
  await screen.findByText('holder@example.test');
  expect(api.roots).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Revoke'));
  await screen.findByText('No L1 Key Managers yet.');
  expect(mutations).toHaveLength(1);
  expect(mutations[0].variables).toEqual({context:{group:'operations.openkcm.io',kind:'L1KeyAccess',resource:{name:'account-l1'},accountPath:'root:orgs:showroom:a'},input:{userId:'holder',role:'l1_key_manager'}});
});


it.each(['deny', 'pending', 'failure', 'namespaced'])('denies the Members page for %s permission data', async (mode) => {
  vi.mocked(fetch).mockImplementation(async () => {
    if (mode === 'pending') return new Promise(() => {});
    if (mode === 'failure') throw new Error('offline');
    return {ok: true, json: async () => mode === 'namespaced'
      ? [{resource: 'l1keyaccesses', name: 'account-l1', namespace: 'default', actions: ['manage_iam_roles']}]
      : []} as Response;
  });
  render(<App />);
  change({...context('a'), openkcmPage: 'l1-key-managers', iamServiceApiUrl: 'https://portal.test/iam/graphql'});
  await act(async () => {});
  await screen.findByText('Read-only. Only account owners can manage L1 Key Managers.');
  expect(screen.queryByText('Add L1 Key Manager')).toBeNull();
  expect(screen.queryByText('Revoke')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === 'https://portal.test/iam/graphql')).toBe(false);
  expect(api.roots).not.toHaveBeenCalled();
});


it.each([0, 2, 6])('shows %i configured cards and compact rows for the remaining slots', async (count) => {
  const { L1_SLOTS } = await import('../src/lib/l1Slots');
  api.roots.mockResolvedValue(L1_SLOTS.map((slot, index) => ({
    ...rootFixture, kind: slot.kind, metadata: {name: slot.name, namespace: 'default'},
    spec: {...rootFixture.spec, configured: index < count},
    status: {slotState: index < count ? 'Configured' : 'Unconfigured', cryptoState: {lifecycleState: 'Active'},
      conditions: index < count ? [] : [{type:'Ready',status:'False',reason:'Unconfigured',message:'The slot has no provider configuration.'}]}
  })));
  const {container} = render(<App/>); change(context('a'));
  await screen.findByText(`${count} configured roots / 6 slots`);
  expect(container.querySelectorAll('.l1-empty-slot')).toHaveLength(6 - count);
  expect(container.querySelectorAll('.key-card-header')).toHaveLength(count);
  expect(screen.queryAllByText('Not configured')).toHaveLength(6 - count);
});

it('places available providers after configured roots and retains their configure action', async () => {
  api.roots.mockResolvedValue([rootFixture, {...rootFixture, kind:'AzureRootKey', metadata:{name:'azure',namespace:'default'}, spec:{configured:true}, status:{slotState:'Configured'}}]);
  render(<App/>); change(context('a'));
  const available = await screen.findByRole('region', {name:'Available providers'});
  expect(screen.getByText('azure', {selector:'.key-name'}).compareDocumentPosition(available) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(available).getByLabelText('Configure Root Key'));
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('keeps compact providers visible without exposing actions to a denied user', async () => {
  api.roots.mockResolvedValue([rootFixture]);
  vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>[]} as Response);
  render(<App/>); change(context('a'));
  const available = await screen.findByRole('region', {name:'Available providers'});
  expect(within(available).getByText('AWS')).toBeTruthy();
  expect(within(available).getByText('Not configured')).toBeTruthy();
  expect(within(available).queryByRole('button')).toBeNull();
});
