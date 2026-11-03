import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assignL1KeyManager, listL1KeyManagers, lookupL1Candidate, revokeL1KeyManager } from './iam';
import { emptyRuntimeContext } from './luigi';

const ctx={...emptyRuntimeContext(),source:'luigi' as const,token:'test-token',workspacePath:'root:orgs:org:parent:account',graphqlUrl:'https://portal.test/gateway/graphql',iamServiceApiUrl:'https://portal.test/iam/graphql'};
const member={user:{userId:'manager-id',email:'manager@example.test'},roles:[{id:'l1_key_manager'}]};
const request=vi.fn();
const result=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
const permission=()=>new Response(JSON.stringify([{resource:'l1keyaccesses',name:'account-l1',actions:['manage_iam_roles']}]),{status:200});
beforeEach(()=>{vi.stubGlobal('fetch',request);request.mockReset();});
afterEach(()=>vi.unstubAllGlobals());

it('lists only L1 Key Manager assignees on the cluster marker with pagination',async()=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({users:{users:[member,{user:{userId:'other',email:'other@example.test'},roles:[{id:'member'}]}],pageInfo:{hasNextPage:true,totalCount:2}}}));
  expect(await listL1KeyManagers(ctx,2,new AbortController().signal)).toEqual({users:[member.user],hasNextPage:true,totalCount:2});
  const [url,options]=request.mock.calls[1];const body=JSON.parse(options.body);
  expect(url).toBe(ctx.iamServiceApiUrl);
  expect(options.headers.Authorization).toBe('Bearer test-token');
  expect(body.variables).toEqual({context:{group:'operations.openkcm.io',kind:'L1KeyAccess',resource:{name:'account-l1'},accountPath:ctx.workspacePath},roleFilters:['l1_key_manager'],page:{limit:10,page:2}});
});

it('revokes exactly l1_key_manager through the existing removeRole mutation',async()=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({removeRole:{success:true,error:null,wasAssigned:true}}));
  await revokeL1KeyManager(ctx,'manager-id',new AbortController().signal);
  const body=JSON.parse(request.mock.calls[1][1].body);
  expect(body.query).toContain('removeRole(context: $context, input: $input)');
  expect(body.variables.input).toEqual({userId:'manager-id',role:'l1_key_manager'});
  expect(body.variables.context.resource).toEqual({name:'account-l1'});
});

it.each(['list','revoke'])('does not call IAM %s while permission is denied',async(operation)=>{
  request.mockResolvedValueOnce(new Response('[]',{status:200}));
  const signal=new AbortController().signal;
  await expect(operation==='list'?listL1KeyManagers(ctx,1,signal):revokeL1KeyManager(ctx,'manager-id',signal)).rejects.toThrow('permission');
  expect(request).toHaveBeenCalledOnce();
});

it.each([
  {errors:[{message:'forbidden'}]},
  {data:{removeRole:{success:false,error:'denied',wasAssigned:false}}},
  {data:{removeRole:{success:true}}}
])('does not report success for a failed or malformed revoke response',async(envelope)=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(new Response(JSON.stringify(envelope),{status:200}));
  await expect(revokeL1KeyManager(ctx,'manager-id',new AbortController().signal)).rejects.toThrow();
});

it('rejects a malformed member list and HTTP failures',async()=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({users:{users:[{user:{email:'missing-id'}}],pageInfo:{hasNextPage:false,totalCount:1}}}));
  await expect(listL1KeyManagers(ctx,1,new AbortController().signal)).rejects.toThrow('invalid');
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(new Response('unavailable',{status:503}));
  await expect(listL1KeyManagers(ctx,1,new AbortController().signal)).rejects.toThrow('503');
});

it('looks up the exact email with the deployed user query',async()=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({user:member.user}));
  expect(await lookupL1Candidate(ctx,' manager@example.test ',new AbortController().signal)).toEqual(member.user);
  const body=JSON.parse(request.mock.calls[1][1].body);
  expect(body.query).toContain('user(userId: $userId)');
  expect(body.variables).toEqual({userId:'manager@example.test'});
});

it('returns null for a user absent from the organization realm',async()=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({user:null}));
  expect(await lookupL1Candidate(ctx,'missing@example.test',new AbortController().signal)).toBeNull();
});

it.each([{userId:'id'}, {userId:'',email:'manager@example.test'}, {userId:'id',email:'other@example.test'}, undefined])('rejects invalid lookup data',async(user)=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({user}));
  await expect(lookupL1Candidate(ctx,'manager@example.test',new AbortController().signal)).rejects.toThrow('invalid');
});

const holders=(users:unknown[]=[],hasNextPage=false)=>result({users:{users,pageInfo:{hasNextPage,totalCount:users.length}}});
const emptyHolders=()=>{request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(holders());};
const assignment=()=>JSON.parse(request.mock.calls[request.mock.calls.length-1][1].body);
it('assigns only the L1 role with the cluster context and checks permission again',async()=>{
  emptyHolders();
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({assignRolesToUsers:{success:true,errors:null,assignedCount:2}}));
  expect(await assignL1KeyManager(ctx,member.user,new AbortController().signal)).toBe('added');
  const body=assignment();
  expect(body.query).toContain('$changes: [UserRoleChange!]');
  expect(body.query).toContain('assignRolesToUsers(context: $context, changes: $changes)');
  expect(body.variables).toEqual({context:{group:'operations.openkcm.io',kind:'L1KeyAccess',resource:{name:'account-l1'},accountPath:ctx.workspacePath},changes:[{userId:'manager-id',roles:['l1_key_manager']}]});
  expect(body.variables).not.toHaveProperty('invites');
  expect(request.mock.calls.map(([url])=>new URL(url).pathname)).toEqual(['/rest/permissions/resource-check','/iam/graphql','/rest/permissions/resource-check','/iam/graphql']);
});

it('finds duplicate holders beyond the visible page without a mutation',async()=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(holders([{user:{userId:'other',email:'other@example.test'},roles:[{id:'l1_key_manager'}]}],true));
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(holders([member]));
  expect(await assignL1KeyManager(ctx,member.user,new AbortController().signal)).toBe('duplicate');
  expect(JSON.parse(request.mock.calls[3][1].body).variables.page.page).toBe(2);
  expect(request.mock.calls.every(([,options])=>!JSON.parse(options.body).query?.includes('mutation'))).toBe(true);
});

it('handles an assignment that became a duplicate after the preflight',async()=>{
  emptyHolders();
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({assignRolesToUsers:{success:true,errors:[],assignedCount:0}}));
  expect(await assignL1KeyManager(ctx,member.user,new AbortController().signal)).toBe('duplicate');
});

it.each([
  {success:false,errors:['denied'],assignedCount:0},
  {success:true,errors:['partial write'],assignedCount:1},
  {success:true,assignedCount:1},
  {success:true,errors:null,assignedCount:-1},
  {success:true,errors:null,assignedCount:0.5},
  {success:true,errors:null},
  null
])('rejects unsuccessful or malformed assignment results',async(assignRolesToUsers)=>{
  emptyHolders();request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({assignRolesToUsers}));
  await expect(assignL1KeyManager(ctx,member.user,new AbortController().signal)).rejects.toThrow('could not be assigned');
});

it.each(['lookup','assign'])('blocks %s before IAM access when permission is denied',async(operation)=>{
  request.mockResolvedValueOnce(new Response('[]',{status:200}));
  const signal=new AbortController().signal;
  await expect(operation==='lookup'?lookupL1Candidate(ctx,'manager@example.test',signal):assignL1KeyManager(ctx,member.user,signal)).rejects.toThrow('permission');
  expect(request).toHaveBeenCalledOnce();
});

it('blocks assignment if permission is revoked after the holder check',async()=>{
  emptyHolders();request.mockResolvedValueOnce(new Response('[]',{status:200}));
  await expect(assignL1KeyManager(ctx,member.user,new AbortController().signal)).rejects.toThrow('permission');
  expect(request).toHaveBeenCalledTimes(3);
});

it('does not write after cancellation',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(assignL1KeyManager(ctx,member.user,controller.signal)).rejects.toThrow();
  expect(request.mock.calls.some(([,options])=>JSON.parse(options.body).query?.includes('mutation'))).toBe(false);
});

it.each([undefined,-1,0.5,'1'])('rejects a malformed holder count',async(totalCount)=>{
  request.mockResolvedValueOnce(permission()).mockResolvedValueOnce(result({users:{users:[],pageInfo:{hasNextPage:false,totalCount}}}));
  await expect(listL1KeyManagers(ctx,1,new AbortController().signal)).rejects.toThrow('invalid');
});
