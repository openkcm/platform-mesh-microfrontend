// This dev-only page runs the actual App and UI5 buttons against local responses.
let allowed = new URLSearchParams(location.search).get('allowed') !== 'false';
const configuredCount = Number(new URLSearchParams(location.search).get('configured') ?? 2);
const providerNames = ['aws', 'azure', 'gcp', 'hsm', 'vault', 'openbao'];
let denyNextWrite = false;
let permissionChecks = 0;
let page = 'keys';
const listeners = new Set<(context: unknown) => void>();
const context = () => ({
  kcpPath: 'root:orgs:fixture:account',
  openkcmPage: page,
  openkcmLevel: 'account',
  token: 'local-fixture',
  portalContext: {
    graphqlUrl: `${location.origin}/gateway/api/clusters/root:orgs:fixture:account/graphql`,
    iamServiceApiUrl: `${location.origin}/fixture/iam`
  }
});
Object.assign(window, {LuigiClient: {
  addInitListener: (listener: (context: unknown) => void) => { queueMicrotask(() => listener(context())); return 'init'; },
  addContextUpdateListener: (listener: (context: unknown) => void) => { listeners.add(listener); return listener; },
  removeInitListener: () => {},
  removeContextUpdateListener: (listener: (context: unknown) => void) => listeners.delete(listener)
}});
const result = document.querySelector<HTMLOutputElement>('#result')!;
const root = (name: string, lifecycle: string, configured = providerNames.indexOf(name) < configuredCount) => ({
  metadata: {name, namespace:'default'},
  spec: {tenantNameRef:'account', configured, lifecycle},
  status: {slotState:configured ? 'Configured' : 'Unconfigured', cryptoState:{lifecycleState:lifecycle},
    conditions: configured ? [] : [{type:'Ready',status:'False',reason:'Unconfigured',message:'The slot has no provider configuration.'}]}
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
window.fetch = async (input, init) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.endsWith('/rest/permissions/resource-check')) {
    permissionChecks += 1;
    const action = body.checks[0].actions[0];
    result.textContent = `Permission checks: ${permissionChecks}. L1 role: ${allowed ? 'granted' : 'revoked'}.`;
    return json(allowed || action === 'manage_iam_roles' ? [{resource:'l1keyaccesses',name:'account-l1',actions:[action]}] : []);
  }
  if (url.endsWith('/fixture/iam')) {
    if (body.query.includes('mutation RevokeL1KeyManager')) {
      allowed = false;
      return json({data:{removeRole:{success:true,error:null,wasAssigned:true}}});
    }
    return json({data:{users:{users:allowed ? [{user:{userId:'self',email:'self@example.test'},roles:[{id:'l1_key_manager'}]}] : [],pageInfo:{hasNextPage:false}}}});
  }
  if (url !== `${location.origin}/gateway/api/clusters/root:orgs:fixture:account/graphql`) throw new Error(`Unexpected fixture request: ${url}`);
  if (init?.headers && new Headers(init.headers).get('Accept') === 'text/event-stream') {
    return new Response('', {headers:{'Content-Type':'text/event-stream'}});
  }
  if (/^\s*mutation\b/.test(body.query ?? '')) {
    if (denyNextWrite) {
      allowed = false;
      denyNextWrite = false;
      return json({errors:[{message:'The L1 Key Manager role is required.'}]}, 403);
    }
    throw new Error('Fixture writes must be denied.');
  }
  return json({data:{operations_openkcm_io:{v1alpha1:{
    Tenants:{items:[{metadata:{name:'account'},spec:{}}]},
    AWSRootKeys:{items:[root('aws','Active')]},
    AzureRootKeys:{items:[root('azure','Deactivated')]},
    OpenBaoRootKeys:{items:[root('openbao','PreActive')]},
    GCPRootKeys:{items:[root('gcp','PreActive')]},
    VaultRootKeys:{items:[root('vault','PreActive')]},
    HSMRootKeys:{items:[root('hsm','PreActive')]},
    DomainKeys:{items:[]},ServiceKeys:{items:[]},DataEncryptionKeys:{items:[]}
  }}}});
};
document.querySelector('#revoke')!.addEventListener('click', () => {
  allowed = false;
  result.textContent = 'Role revoked. Select Refresh window focus to check the focus event.';
});
document.querySelector('#focus')!.addEventListener('click', () => window.dispatchEvent(new Event('focus')));
document.querySelector('#restore')!.addEventListener('click', () => {
  allowed = true;
  window.dispatchEvent(new Event('focus'));
});
document.querySelector('#deny')!.addEventListener('click', () => {
  denyNextWrite = true;
  result.textContent = 'The next write returns HTTP 403. Use Delete on AWS and confirm.';
});
for (const [id, next] of [['keys','keys'], ['managers','l1-key-managers']]) {
  document.querySelector(`#${id}`)!.addEventListener('click', () => {
    page = next;
    listeners.forEach(listener => listener(context()));
  });
}
document.querySelector('#check')!.addEventListener('click', () => {
  const buttons = [...document.querySelectorAll<HTMLElement>('[data-tier="L1"] .key-actions > ui5-button, .l1-empty-slot > ui5-button')];
  const labels = buttons.filter(button => button.textContent?.trim());
  const clipped = labels.filter(button => {
    const label = button.shadowRoot?.querySelector<HTMLElement>('.ui5-button-text bdi');
    const row = button.parentElement!.getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return !label || label.scrollWidth > label.clientWidth || bounds.left < row.left || bounds.right > row.right + 1;
  });
  result.textContent = labels.length === 6 + ['aws', 'azure'].filter(name => providerNames.indexOf(name) < configuredCount).length && !clipped.length
    ? `PASS: ${labels.length} full L1 labels at ${innerWidth}px.`
    : `FAIL: ${clipped.length} clipped labels; ${labels.length} labels found.`;
});
