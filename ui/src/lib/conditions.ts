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
  linked?: boolean;
}

const RETRY = 'Try again in a few minutes. If it keeps failing, contact your administrator.';

type Wording = { design: ProblemDesign; text: (context: ProblemContext) => string };

const notice = (text: Wording['text']): Wording => ({ design: 'Critical', text });
const failure = (text: Wording['text']): Wording => ({ design: 'Negative', text });

const created = ({ kind }: ProblemContext) =>
  `This ${kind} could not be created because the key service did not accept the request. ${RETRY}`;

const activating = ({ kind }: ProblemContext) =>
  `This ${kind} is linked to its Root Key and is being activated. This usually takes a few moments.`;

const unconfigured = (context: ProblemContext) => {
  if (context.linked === undefined) return `This ${context.kind} is not connected to a key provider yet.`;
  return context.linked
    ? activating(context)
    : `This ${context.kind} is not linked to a Root Key yet. Link one with Edit to activate it.`;
};

const waitingFor = (parent: string) => ({ kind }: ProblemContext) =>
  `Waiting for the ${parent} it uses to become active. This ${kind} is activated automatically after that.`;

const WORDING: Record<string, Wording> = {
  Processing: notice(({ kind }) => `This ${kind} is still being set up. This usually takes a few moments.`),
  AwaitingTenant: notice(() =>
    'Your account is still being registered. This key is created as soon as that is done.'),
  Unconfigured: notice(unconfigured),
  AwaitingRootKeyActivation: notice(activating),
  Activating: notice(activating),
  Deactivated: notice(({ kind, inactiveParent }) =>
    inactiveParent
      ? `This ${kind} was deactivated because the ${inactiveParent} it depends on is not active.`
      : `This ${kind} is deactivated and cannot be used.`),

  DomainKeyNotActive: notice(waitingFor('Domain Key')),
  ServiceKeyNotActive: notice(waitingFor('Service Key')),
  ServiceKeyNotFound: notice(() => 'The Service Key it uses could not be found. It may have been deleted.'),
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

  CredentialsPending: notice(({ kind }) =>
    `Waiting for the access key of this ${kind}. Add it to finish the setup.`),
  ProviderUnsupported: notice(({ kind }) =>
    `This ${kind} cannot be connected to its key provider yet. It keeps trying automatically.`),

  InvalidAuth: failure(({ kind }) =>
    `This ${kind} is missing its authentication details. Edit it and provide the access key.`),
  CredentialsInvalid: failure(({ kind }) =>
    `The access key of this ${kind} is incomplete or malformed. Provide a valid access key ID and secret.`),
  CredentialsForbidden: failure(({ kind }) =>
    `The access key of this ${kind} could not be read. Check that it is shared with the key service.`),
  ProviderBindFailed: failure(({ kind }) =>
    `The key provider did not accept this ${kind}'s credentials. ${RETRY}`),
  LinkFailed: failure(({ kind }) => `This ${kind} could not be linked to its Root Key. ${RETRY}`),

  TenantResolutionFailed: failure(({ kind }) =>
    `This ${kind} could not be set up because your account details could not be read. ${RETRY}`),
  RootKeyCreateFailed: failure(created),
  KeyCreateFailed: failure(created),
  DEKCreateFailed: failure(created),
  DomainKeyCreateFailed: failure(() => `The Domain Key this Service Key needs could not be created. ${RETRY}`),
  ServiceKeyCreateFailed: failure(() => `The Service Key this Data Key needs could not be created. ${RETRY}`),
  KeyProcessingFailed: failure(({ kind }) => `The key service could not finish setting up this ${kind}. ${RETRY}`),
  RootKeyProcessingFailed: failure(({ kind }) =>
    `The key service could not set up the Root Key of this ${kind}. ${RETRY}`),
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
