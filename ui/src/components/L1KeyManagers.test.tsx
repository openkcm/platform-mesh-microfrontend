// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyRuntimeContext } from '../lib/luigi';
const api=vi.hoisted(()=>({list:vi.fn(),revoke:vi.fn(),add:vi.fn(),lookup:vi.fn()}));
vi.mock('../lib/iam',()=>({listL1KeyManagers:api.list,revokeL1KeyManager:api.revoke,assignL1KeyManager:api.add,lookupL1Candidate:api.lookup}));
vi.mock('@ui5/webcomponents-react',()=>({
  Button:({children,onClick,disabled,type}:any)=><button type={type === 'Submit' ? 'submit' : 'button'} onClick={onClick} disabled={disabled}>{children}</button>,
  MessageStrip:({children}:any)=><div>{children}</div>,BusyIndicator:({children}:any)=><div>{children}</div>
}));
import { L1KeyManagers } from './L1KeyManagers';
const ctx={...emptyRuntimeContext(),source:'luigi' as const,workspacePath:'root:orgs:org:a',token:'user'};
const holder={userId:'manager-id',email:'manager@example.test'};
beforeEach(()=>{vi.resetAllMocks();api.list.mockResolvedValue({users:[holder],hasNextPage:false,totalCount:1});api.revoke.mockResolvedValue(undefined);api.add.mockResolvedValue('added');api.lookup.mockResolvedValue({userId:'new-id',email:'new@example.test'});});
afterEach(cleanup);

it('lists holders and revokes only the selected assignment before refreshing',async()=>{
  render(<L1KeyManagers ctx={ctx} allowed/>);
  await screen.findByText(holder.email);
  api.list.mockResolvedValue({users:[],hasNextPage:false,totalCount:0});
  fireEvent.click(screen.getByText('Revoke'));
  await waitFor(()=>expect(api.revoke).toHaveBeenCalledWith(ctx,holder.userId,expect.any(AbortSignal)));
  await screen.findByText('No L1 Key Managers yet.');
});

const findCandidate = async () => {
  fireEvent.change(screen.getByLabelText('Email address'), {target:{value:'new@example.test'}});
  fireEvent.click(screen.getByText('Find user'));
  await screen.findByText('Assign L1 Key Manager');
};

it('shows the inline form and refreshes the holders after assignment',async()=>{
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  await findCandidate();
  expect(api.lookup).toHaveBeenCalledWith(ctx,'new@example.test',expect.any(AbortSignal));
  fireEvent.click(screen.getByText('Assign L1 Key Manager'));
  await screen.findByText('The L1 Key Manager was added.');
  expect(api.add).toHaveBeenCalledWith(ctx,{userId:'new-id',email:'new@example.test'},expect.any(AbortSignal));
  await waitFor(()=>expect(api.list).toHaveBeenCalledTimes(2));
});

it('shows duplicate assignment and refreshes the holders',async()=>{
  api.add.mockResolvedValue('duplicate');
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  await findCandidate();fireEvent.click(screen.getByText('Assign L1 Key Manager'));
  await screen.findByText('This user is already an L1 Key Manager.');
  await waitFor(()=>expect(api.list).toHaveBeenCalledTimes(2));
});

it('directs an unknown user to the org Members page without assignment',async()=>{
  api.lookup.mockResolvedValue(null);
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'missing@example.test'}});
  fireEvent.click(screen.getByText('Find user'));
  await screen.findByText('This user is not in the organization. Add them on the org Members page first.');
  expect(api.add).not.toHaveBeenCalled();expect(screen.queryByText('Assign L1 Key Manager')).toBeNull();
});

it.each(['lookup','add'] as const)('blocks writes after an inline %s error until refresh',async(operation)=>{
  api[operation].mockRejectedValue(new Error('IAM unavailable'));
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  if(operation==='lookup') {
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'new@example.test'}});
    fireEvent.click(screen.getByText('Find user'));
  } else { await findCandidate();fireEvent.click(screen.getByText('Assign L1 Key Manager')); }
  await screen.findByText('IAM unavailable');
  expect((screen.getByText('Find user') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Revoke') as HTMLButtonElement).disabled).toBe(true);
});

it('disables the form and revoke while lookup is pending',async()=>{
  api.lookup.mockImplementation(()=>new Promise(()=>{}));
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'new@example.test'}});
  fireEvent.click(screen.getByText('Find user'));
  expect((screen.getByLabelText('Email address') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByText('Find user') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Revoke') as HTMLButtonElement).disabled).toBe(true);
});

it('clears the selected user when the email changes',async()=>{
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);await findCandidate();
  fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'other@example.test'}});
  expect(screen.queryByText('Assign L1 Key Manager')).toBeNull();expect(api.add).not.toHaveBeenCalled();
});

it.each(['lookup','add'] as const)('ignores late %s results after permission loss',async(operation)=>{
  let finish!:(value:unknown)=>void;
  api[operation].mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const {rerender}=render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  if(operation==='lookup') {
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'new@example.test'}});
    fireEvent.click(screen.getByText('Find user'));
  } else { await findCandidate();fireEvent.click(screen.getByText('Assign L1 Key Manager')); }
  const signal=api[operation].mock.calls[0][2];
  rerender(<L1KeyManagers ctx={ctx} allowed={false}/>);expect(signal.aborted).toBe(true);
  await act(async()=>finish(operation==='lookup'?{userId:'new-id',email:'new@example.test'}:'added'));
  expect(screen.queryByText('Assign L1 Key Manager')).toBeNull();
  expect(screen.queryByText('The L1 Key Manager was added.')).toBeNull();
});

it('makes no IAM request for a denied or pending permission',()=>{
  render(<L1KeyManagers ctx={ctx} allowed={false}/>);
  expect(screen.getByText(/Read-only/)).toBeTruthy();
  expect(screen.queryByText('Revoke')).toBeNull();expect(api.list).not.toHaveBeenCalled();
});

it('keeps controls disabled while the list is pending',()=>{
  api.list.mockImplementation(()=>new Promise(()=>{}));
  render(<L1KeyManagers ctx={ctx} allowed/>);
  expect(screen.queryByText('Revoke')).toBeNull();
  expect((screen.getByText('Find user') as HTMLButtonElement).disabled).toBe(true);
});

it('shows list errors without exposing revoke controls',async()=>{
  api.list.mockRejectedValue(new Error('IAM unavailable'));
  render(<L1KeyManagers ctx={ctx} allowed/>);
  await screen.findByText('IAM unavailable');expect(screen.queryByText('Revoke')).toBeNull();
});

it('keeps the holder after a revoke error and blocks writes until refresh',async()=>{
  api.revoke.mockRejectedValue(new Error('Revoke denied'));
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  fireEvent.click(screen.getByText('Revoke'));await screen.findByText('Revoke denied');
  expect(screen.getByText(holder.email)).toBeTruthy();
  expect((screen.getByText('Revoke') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Refresh'));
  await waitFor(()=>expect((screen.getByText('Revoke') as HTMLButtonElement).disabled).toBe(false));
});

it('paginates the role-filtered list',async()=>{
  api.list.mockResolvedValueOnce({users:[holder],hasNextPage:true,totalCount:11}).mockResolvedValue({users:[],hasNextPage:false,totalCount:0});
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  fireEvent.click(screen.getByText('Next'));
  await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith(ctx,2,expect.any(AbortSignal)));
});

it('rejects late list results after account or permission change',async()=>{
  let finish!:(value:unknown)=>void;
  api.list.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const {rerender}=render(<L1KeyManagers ctx={ctx} allowed/>);
  const signal=api.list.mock.calls[0][2];
  rerender(<L1KeyManagers ctx={{...ctx,workspacePath:'root:orgs:org:b'}} allowed={false}/>);
  expect(signal.aborted).toBe(true);
  await act(async()=>finish({users:[holder],hasNextPage:false,totalCount:1}));
  expect(screen.queryByText(holder.email)).toBeNull();expect(screen.queryByText('Revoke')).toBeNull();
});


it('blocks another revoke while pending and ignores its late error after permission loss',async()=>{
  let reject!:(reason:Error)=>void;
  api.revoke.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  const {rerender}=render(<L1KeyManagers ctx={ctx} allowed/>);
  await screen.findByText(holder.email);fireEvent.click(screen.getByText('Revoke'));
  expect((screen.getByText('Revoke') as HTMLButtonElement).disabled).toBe(true);
  const signal=api.revoke.mock.calls[0][2];
  rerender(<L1KeyManagers ctx={ctx} allowed={false}/>);
  expect(signal.aborted).toBe(true);
  await act(async()=>reject(new Error('old revoke error')));
  expect(screen.queryByText('old revoke error')).toBeNull();
  expect(screen.queryByText('Revoke')).toBeNull();
});

it('shows the holder count and hides pagination for a single page',async()=>{
  render(<L1KeyManagers ctx={ctx} allowed/>);await screen.findByText(holder.email);
  expect(screen.getByRole('heading',{name:'Current L1 Key Managers 1'})).toBeTruthy();
  expect(screen.queryByText('Previous')).toBeNull();expect(screen.queryByText('Next')).toBeNull();
  expect(screen.getByText('Refresh')).toBeTruthy();
});

it('shows the empty holder state with a zero count',async()=>{
  api.list.mockResolvedValue({users:[],hasNextPage:false,totalCount:0});
  render(<L1KeyManagers ctx={ctx} allowed/>);
  await screen.findByText('No L1 Key Managers yet.');
  expect(screen.getByRole('heading',{name:'Current L1 Key Managers 0'})).toBeTruthy();
});
