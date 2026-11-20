import { describe, expect, it } from 'vitest';

import type { Condition } from '../types';
import { readyProblem, rootKeyChangeProblem } from './conditions';

const LEAK = 'dial tcp 10.0.3.7:8080: connect: connection refused arn:aws:kms:eu-central-1:123456789012:key/abc';

const ready = (reason: string | undefined, status = 'False'): Condition =>
  ({ type: 'Ready', status, reason, message: LEAK });
const domainKey = { kind: 'Domain Key' };

describe('readyProblem', () => {
  it('reports nothing for a Ready condition that is True or missing', () => {
    // when / then
    expect(readyProblem(ready('KeyMaterialBound', 'True'), domainKey)).toBeNull();
    expect(readyProblem(undefined, domainKey)).toBeNull();
  });

  it('never shows the controller message or the reason code, whatever the reason', () => {
    // given
    const reasons = [
      'RootKeyCreateFailed',
      'TenantResolutionFailed',
      'Deactivated',
      'DomainKeyNotActive',
      'ServiceKeyNotActive',
      'Unconfigured',
      'AwaitingRootKeyActivation',
      'Activating',
      'LinkFailed',
      'KeyProcessingFailed',
      'RootKeyProcessingFailed',
      'ProviderUnsupported',
      'CredentialsPending',
      'CredentialsInvalid',
      'CredentialsForbidden',
      'InvalidAuth',
      'ProviderBindFailed',
      'NotAKnownReason',
      undefined
    ];

    // when
    const problems = reasons.map((reason) => readyProblem(ready(reason), domainKey));

    // then
    for (const [index, problem] of problems.entries()) {
      expect(JSON.stringify(problem)).not.toMatch(/10\.0\.3\.7|arn:aws|connection refused/);
      if (reasons[index]) expect(JSON.stringify(problem)).not.toContain(reasons[index]);
    }
  });

  it('words a failure for the kind and tells what to do', () => {
    // when
    const problem = readyProblem(ready('KeyCreateFailed'), domainKey);

    // then
    expect(problem).toEqual({
      design: 'Negative',
      text: 'This Domain Key could not be created because the key service did not accept the request. ' +
        'Try again in a few minutes. If it keeps failing, contact your administrator.'
    });
  });

  it('shows a waiting state as a notice without a retry hint', () => {
    // when
    const problem = readyProblem(ready('DomainKeyNotActive'), { kind: 'Service Key' });

    // then
    expect(problem).toEqual({
      design: 'Critical',
      text: 'Waiting for the Domain Key it uses to become active. ' +
        'This Service Key is activated automatically after that.'
    });
  });

  it('tells a Data Key that it waits for its Service Key', () => {
    // when
    const problem = readyProblem(ready('ServiceKeyNotActive'), { kind: 'Data Key' });

    // then
    expect(problem).toEqual({
      design: 'Critical',
      text: 'Waiting for the Service Key it uses to become active. ' +
        'This Data Key is activated automatically after that.'
    });
  });

  it('tells whether an unconfigured key still needs a link or is being activated', () => {
    // when
    const unlinked = readyProblem(ready('Unconfigured'), { ...domainKey, linked: false });
    const linked = readyProblem(ready('Unconfigured'), { ...domainKey, linked: true });
    const unknown = readyProblem(ready('Unconfigured'), domainKey);

    // then
    expect(unlinked).toEqual({
      design: 'Critical',
      text: 'This Domain Key is not linked to a Root Key yet. Link one with Edit to activate it.'
    });
    expect(linked).toEqual({
      design: 'Critical',
      text: 'This Domain Key is linked to its Root Key and is being activated. This usually takes a few moments.'
    });
    expect(unknown?.text).toBe('This Domain Key is not connected to a key provider yet.');
  });

  it('shows the activation after a link as a notice, not as an error', () => {
    // when
    const problems = ['AwaitingRootKeyActivation', 'Activating'].map((reason) => readyProblem(ready(reason), domainKey));

    // then
    for (const problem of problems) {
      expect(problem).toEqual({
        design: 'Critical',
        text: 'This Domain Key is linked to its Root Key and is being activated. This usually takes a few moments.'
      });
    }
  });

  it('has its own wording for every reason the controller sets on a key that is not ready', () => {
    // given
    const reasons = [
      'Processing', 'AwaitingTenant', 'Unconfigured', 'AwaitingRootKeyActivation', 'Activating', 'Deactivated',
      'DomainKeyNotActive', 'DomainKeyNotFound', 'DomainKeyInUse', 'DomainKeyNamespaceNotAllowed',
      'DomainKeyNotShared', 'DomainKeyLimitExceeded', 'ServiceKeyNotActive', 'ServiceKeyNotFound',
      'RootKeyResolutionFailed', 'CredentialsPending', 'CredentialsInvalid', 'CredentialsForbidden',
      'ProviderUnsupported', 'LinkFailed', 'TenantResolutionFailed', 'KeyCreateFailed', 'DEKCreateFailed',
      'DomainKeyCreateFailed', 'ServiceKeyCreateFailed', 'KeyProcessingFailed', 'RootKeyProcessingFailed',
      'LifecycleTransitionFailed'
    ];

    // when
    const generic = reasons.filter((reason) => readyProblem(ready(reason), domainKey)?.text.startsWith('Something went wrong'));

    // then
    expect(generic).toEqual([]);
  });

  it('words a failed link as a failure with a retry hint', () => {
    // when
    const problem = readyProblem(ready('LinkFailed'), domainKey);

    // then
    expect(problem).toEqual({
      design: 'Negative',
      text: 'This Domain Key could not be linked to its Root Key. ' +
        'Try again in a few minutes. If it keeps failing, contact your administrator.'
    });
  });

  it('says a key is deactivated, and why when its parent is not active', () => {
    // when
    const own = readyProblem(ready('Deactivated'), domainKey);
    const clamped = readyProblem(ready('Deactivated'), { ...domainKey, inactiveParent: 'Root Key' });

    // then
    expect(own).toEqual({ design: 'Critical', text: 'This Domain Key is deactivated and cannot be used.' });
    expect(clamped?.text).toBe('This Domain Key was deactivated because the Root Key it depends on is not active.');
  });

  it('falls back to a generic text for a reason it has no wording for', () => {
    // when
    const unknown = readyProblem(ready('SomethingNew'), { kind: 'Root Key' });
    const missing = readyProblem(ready(undefined), { kind: 'Root Key' });
    const inherited = readyProblem(ready('constructor'), { kind: 'Root Key' });

    // then
    const generic = {
      design: 'Critical',
      text: 'Something went wrong with this Root Key. ' +
        'Try again in a few minutes. If it keeps failing, contact your administrator.'
    };
    expect(unknown).toEqual(generic);
    expect(missing).toEqual(generic);
    expect(inherited).toEqual(generic);
  });
});

describe('rootKeyChangeProblem', () => {
  it('explains a refused root key change as a notice', () => {
    // when
    const problem = rootKeyChangeProblem({ status: 'False', reason: 'Unsupported' });

    // then
    expect(problem).toEqual({
      design: 'Critical',
      text: 'The root key of a linked Domain Key cannot be changed yet. It still uses the Root Key it was linked to.'
    });
  });

  it('reports nothing when the change is not refused', () => {
    // when / then
    expect(rootKeyChangeProblem(undefined)).toBeNull();
    expect(rootKeyChangeProblem({ status: 'True', reason: 'Supported' })).toBeNull();
  });
});
