import type { Condition } from '../types';

// The controller's message can carry backend details (addresses, ARNs, RPC errors), so only the reason is worded.
export type ReadyCondition = Pick<Condition, 'status' | 'reason'>;

export type ProblemDesign = 'Critical' | 'Negative';

export interface Problem {
  design: ProblemDesign;
  text: string;
}

export interface ProblemContext {
  kind: string;
  inactiveParent?: string;
}

const RETRY = 'Try again in a few minutes. If it keeps failing, contact your administrator.';

type Wording = { design: ProblemDesign; text: (context: ProblemContext) => string };

const notice = (text: Wording['text']): Wording => ({ design: 'Critical', text });
const failure = (text: Wording['text']): Wording => ({ design: 'Negative', text });

const created = ({ kind }: ProblemContext) =>
  `This ${kind} could not be created because the key service did not accept the request. ${RETRY}`;

const WORDING: Record<string, Wording> = {
  Processing: notice(({ kind }) => `This ${kind} is still being set up. This usually takes a few moments.`),
  AwaitingTenant: notice(() =>
    'Your account is still being registered. This key is created as soon as that is done.'),
  Unconfigured: notice(({ kind }) => `This ${kind} is not connected to a key provider yet.`),
  Deactivated: notice(({ kind, inactiveParent }) =>
    inactiveParent
      ? `This ${kind} was deactivated because the ${inactiveParent} it depends on is not active.`
      : `This ${kind} is deactivated and cannot be used.`),

  DomainKeyNotActive: notice(() => 'Waiting for the Domain Key it uses to become active.'),
  DomainKeyNotFound: notice(() => 'The Domain Key it uses could not be found. It may have been deleted.'),
  DomainKeyInUse: notice(() => 'The Domain Key it uses is already taken by another Service Key.'),
  DomainKeyNamespaceNotAllowed: notice(() =>
    'The Domain Key it uses is in a namespace this Service Key is not allowed to use.'),
  DomainKeyNotShared: notice(() =>
    'The Domain Key it uses belongs to another namespace and is not shared with this one.'),
  DomainKeyLimitExceeded: notice(() =>
    'A namespace can have only one Namespace-scoped Domain Key, and another one already exists, ' +
    'so this one is not used.'),
  RootKeyResolutionFailed: notice(() =>
    'The Root Key it is linked to cannot be used. It may be missing, not active or not allowed here.'),

  TenantResolutionFailed: failure(({ kind }) =>
    `This ${kind} could not be set up because your account details could not be read. ${RETRY}`),
  RootKeyCreateFailed: failure(created),
  KeyCreateFailed: failure(created),
  DomainKeyCreateFailed: failure(() => `The Domain Key this Service Key needs could not be created. ${RETRY}`),
  LifecycleTransitionFailed: failure(({ kind }) => `This ${kind} could not be activated or deactivated. ${RETRY}`),
  ResetFailed: failure(({ kind }) => `This ${kind} could not be reset. ${RETRY}`)
};

const fallback = ({ kind }: ProblemContext) => `Something went wrong with this ${kind}. ${RETRY}`;

export const readyProblem = (ready: ReadyCondition | undefined, context: ProblemContext): Problem | null => {
  if (!ready || ready.status === 'True') return null;
  const wording = ready.reason && Object.hasOwn(WORDING, ready.reason) ? WORDING[ready.reason] : undefined;
  return wording
    ? { design: wording.design, text: wording.text(context) }
    : { design: 'Critical', text: fallback(context) };
};
