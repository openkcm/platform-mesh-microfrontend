import { describe, expect, it } from 'vitest';

import type { Condition } from '../types';
import { readyProblem } from './conditions';

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
    expect(problem).toEqual({ design: 'Critical', text: 'Waiting for the Domain Key it uses to become active.' });
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
