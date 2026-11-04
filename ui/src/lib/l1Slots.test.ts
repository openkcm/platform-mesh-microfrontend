import { expect, it } from 'vitest';
import type { RootKey } from '../types';
import { L1_SLOTS, canConfigureSlot, canResetSlot, configuredRoot, managedSlot, resetPending, slotBusy } from './l1Slots';
const root = (state: NonNullable<RootKey['status']>['slotState']): RootKey => ({
  kind:'AWSRootKey',provider:'AWS',metadata:{name:'aws',namespace:'default'},
  spec:{tenantNameRef:'account',configured:state!=='Unconfigured'},status:{slotState:state}
});
it.each(['Unconfigured','Configuring','Configured','Resetting','ResetFailed'] as const)('handles slot state %s',state=>{
  const slot=root(state);
  expect(canConfigureSlot(slot,'default')).toBe(state==='Unconfigured');
  expect(configuredRoot(slot)).toBe(state==='Configured');
  expect(slotBusy(slot)).toBe(state==='Resetting'||state==='ResetFailed');
});
it('recognizes six slots only in the account namespace',()=>{
  expect(L1_SLOTS).toHaveLength(6);
  for(const slot of L1_SLOTS) {
    const key={...root('Unconfigured'),kind:slot.kind,metadata:{name:slot.name,namespace:'default'}};
    expect(managedSlot(key,'default')?.name).toBe(slot.name);
    expect(canConfigureSlot(key,'default')).toBe(slot.implemented);
    expect(managedSlot(key,'other')).toBeUndefined();
  }
  expect(managedSlot({...root('Configured'),metadata:{name:'old-root',namespace:'default'}},'default')).toBeUndefined();
});
it('waits for the exact reset UUID even before the next status event',()=>{
  const slot=root('Configured');
  expect(resetPending(slot,'new')).toBe(true);
  expect(canConfigureSlot(root('Unconfigured'),'default','new')).toBe(false);
  slot.status!.lastResetRequest='old';expect(resetPending(slot,'new')).toBe(true);
  slot.status!.lastResetRequest='new';expect(resetPending(slot,'new')).toBe(false);
  slot.spec.resetRequest='next';expect(resetPending(slot)).toBe(true);
});


it('waits for the operator to clear resetRequest after the completion status',()=>{
  const slot=root('Unconfigured');
  slot.spec.resetRequest='completed';slot.status!.lastResetRequest='completed';
  expect(resetPending(slot)).toBe(false);
  expect(canConfigureSlot(slot,'default')).toBe(false);
  delete slot.spec.resetRequest;
  expect(canConfigureSlot(slot,'default')).toBe(true);
});


it.each(['Unconfigured','Configuring','Configured','Resetting','ResetFailed'] as const)('checks reset permission in %s',state=>{
  expect(canResetSlot(root(state),'default')).toBe(['Configuring','Configured','ResetFailed'].includes(state));
});
it('does not reset stubs, legacy roots, or a Configuring slot with a pending request',()=>{
  expect(canResetSlot({...root('Configured'),metadata:{name:'legacy',namespace:'default'}},'default')).toBe(false);
  expect(canResetSlot({...root('Configured'),kind:'GCPRootKey',metadata:{name:'gcp',namespace:'default'}},'default')).toBe(false);
  const pending=root('Configuring');pending.spec.resetRequest='pending';
  expect(canResetSlot(pending,'default')).toBe(false);
  expect(canResetSlot(root('Configuring'),'default','optimistic')).toBe(false);
});

it('never replaces an existing reset nonce, including ResetFailed',()=>{
  const failed=root('ResetFailed');failed.spec.resetRequest='existing';
  expect(canResetSlot(failed,'default')).toBe(false);
  delete failed.spec.resetRequest;
  expect(canResetSlot(failed,'default')).toBe(true);
});
