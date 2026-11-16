import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BusyIndicator,
  Button,
  Card,
  CardHeader,
  Dialog,
  FlexBox,
  FlexBoxAlignItems,
  FlexBoxDirection,
  FlexBoxJustifyContent,
  Icon,
  IllustratedMessage,
  Input,
  Label,
  MessageStrip,
  Option,
  Popover,
  SegmentedButton,
  SegmentedButtonItem,
  Select,
  Title,
  Toast,
  type IconDomRef
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-fiori/dist/illustrations/NoData.js';
import '@ui5/webcomponents-fiori/dist/illustrations/UnableToLoad.js';
import '@ui5/webcomponents-icons/dist/shield.js';
import '@ui5/webcomponents-icons/dist/key.js';
import '@ui5/webcomponents-icons/dist/key-user-settings.js';
import '@ui5/webcomponents-icons/dist/chain-link.js';
import '@ui5/webcomponents-icons/dist/hint.js';
import '@ui5/webcomponents-icons/dist/sys-add.js';
import '@ui5/webcomponents-icons/dist/collapse-all.js';
import '@ui5/webcomponents-icons/dist/expand-all.js';
import '@ui5/webcomponents-icons/dist/accept.js';
import '@ui5/webcomponents-icons/dist/decline.js';
import '@ui5/webcomponents-icons/dist/edit.js';
import '@ui5/webcomponents-icons/dist/copy.js';
import '@ui5/webcomponents-icons/dist/broken-link.js';
import '@ui5/webcomponents-icons/dist/slim-arrow-down.js';
import { registerIcon } from '@ui5/webcomponents-base/dist/asset-registries/Icons.js';

import { ROOT_KEY_PROVIDERS, emptyRootKey, rootKeyKind } from './lib/rootKeys';
import { L1KeyManagers } from './components/L1KeyManagers';
import { useL1Permission } from './lib/l1Permission';
import { copyText } from './lib/clipboard';
import {
  navigateToDomainKey,
  emptyRuntimeContext,
  subscribeToLuigi,
  type RuntimeContext
} from './lib/luigi';
import {
  conditionByType,
  createAWSRootKey,
  createAzureRootKey,
  createDataEncryptionKey,
  createDomainKey,
  createOpenBaoRootKey,
  createServiceKey,
  deleteDataEncryptionKey,
  deleteDomainKey,
  deleteRootKey,
  deleteServiceKey,
  listAllDataEncryptionKeys,
  listAllDomainKeys,
  listAllServiceKeys,
  listDataEncryptionKeys,
  listDomainKeys,
  listRootKeys,
  listServiceKeys,
  listTenants,
  setDataEncryptionKeyLifecycle,
  setDomainKeyLifecycle,
  setRootKeyLifecycle,
  setServiceKeyLifecycle,
  subscribeDataEncryptionKeys,
  subscribeDomainKeys,
  subscribeRootKeys,
  subscribeServiceKeys,
  linkDomainKeyRoot,
  unlinkDomainKeyRoot,
  type DesiredLifecycle,
  type KcpClientOptions,
  type RootKeyProvider
} from './lib/kcp';
import {
  domainKeyScope,
  linkedRootKeyRef,
  mintableDomainKeys,
  namespaceDomainKey,
  orderedDomainKeys,
  parentNamespace,
  scopeLabel,
  serviceKeyOn
} from './lib/domainKeys';
import { isDeleting, keyLifecycle } from './lib/lifecycle';
import { readyProblem, type ProblemContext, type ReadyCondition } from './lib/conditions';
import type { DataEncryptionKey, DomainKey, DomainKeyScope, RootKey, ServiceKey, Tenant } from './types';

const RFC_1123 = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const DIALOG_WIDTH = 'min(28rem, 80vw)';
const ROOT_KEY_DIALOG_WIDTH = 'min(30rem, 80vw)';
const ROOT_KEY_FORM_MIN_HEIGHT = '38.75rem';
const CONFIRM_DIALOG_WIDTH = 'min(26rem, 80vw)';
const NAME_HINT = 'Lowercase letters, digits and dashes.';
const EMPTY_OPENBAO_FIELDS = {
  serverAddress: '', enginePath: '', keyName: '', certAuthMountPath: '', certAuthRoleName: ''
};
const EMPTY_AWS_FIELDS = { region: '', keyUri: '', roleArn: '', accessKeyId: '', secretAccessKey: '' };
const EMPTY_AZURE_FIELDS = { vaultUrl: '', keyName: '', tenantId: '', clientId: '' };
const COPY_FEEDBACK_MS = 1500;
type SectionTier = 'L1' | 'L2' | 'L3';
const SECTION_TIERS: SectionTier[] = ['L1', 'L2', 'L3'];
const COLLAPSE_MS = 200;
const NONE_COLLAPSED: Record<SectionTier, boolean> = { L1: false, L2: false, L3: false };
const sectionStorageKey = (tier: SectionTier) => `openkcm.section.${tier}.collapsed`;

const readCollapsedSections = (): Record<SectionTier, boolean> => {
  try {
    return {
      L1: sessionStorage.getItem(sectionStorageKey('L1')) === '1',
      L2: sessionStorage.getItem(sectionStorageKey('L2')) === '1',
      L3: sessionStorage.getItem(sectionStorageKey('L3')) === '1'
    };
  } catch {
    return NONE_COLLAPSED;
  }
};

const writeCollapsedSections = (sections: Record<SectionTier, boolean>) => {
  try {
    for (const tier of SECTION_TIERS) sessionStorage.setItem(sectionStorageKey(tier), sections[tier] ? '1' : '0');
  } catch {
    return;
  }
};
const DOMAIN_KEY_SCOPES: DomainKeyScope[] = ['System', 'Namespace', 'Instance'];
const SCOPE_HINTS: Partial<Record<DomainKeyScope, string>> = {
  System: 'Shared by every namespace in this account.',
  Namespace: 'Shared by every service in this namespace. One per namespace.',
  Instance: 'Dedicated to one service. Serves exactly one Service Key.'
};
const CRITICAL_STATES = ['preactive', 'suspended', 'deactivated', 'initializing', 'processing', 'deleting'];

const lifecycleObjectState = (
  state?: string
): 'Positive' | 'Negative' | 'Critical' | 'None' => {
  const v = (state ?? '').toLowerCase();
  if (v === 'active') return 'Positive';
  if (v.includes('fail') || v.includes('error') || v === 'destroyed' || v === 'compromised') return 'Negative';
  if (CRITICAL_STATES.includes(v)) return 'Critical';
  return 'None';
};

// A state is a soft pill: tinted background, dark text of the same hue, and a dot.
const StatusPill = ({
  state, className, children
}: {
  state: ReturnType<typeof lifecycleObjectState>;
  className?: string;
  children: React.ReactNode;
}) => (
  <span className={`status-pill status-${state.toLowerCase()}${className ? ` ${className}` : ''}`}>{children}</span>
);

const selectedValue = (
  e: { detail: { selectedOption: { dataset: DOMStringMap } | null } }
): string => e.detail.selectedOption?.dataset?.value ?? '';

const inputValue = (e: { target: EventTarget | null }): string =>
  String((e.target as unknown as HTMLInputElement | null)?.value ?? '');

const rootKeyListId = (rk: RootKey): string =>
  `${rk.kind}/${rk.metadata.namespace ?? ''}/${rk.metadata.name}`;

const mergeRootKeys = (roots: RootKey[]): RootKey[] => {
  const seen = new Set<string>();
  const out: RootKey[] = [];
  for (const rk of roots) {
    const id = rootKeyListId(rk);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(rk);
  }
  return out;
};

type Tier = 'L1' | 'L2' | 'L3' | 'L4';

const TIER_LABEL: Record<Tier, string> = {
  L1: 'Root Key',
  L2: 'Domain Key',
  L3: 'Service Key',
  L4: 'Data Key'
};

// A tier is told by a hue, a level glyph (the filled bar is the level) and its name; see .tier-badge.
const TierBadge = ({ tier }: { tier: Tier }) => (
  <span title={`${tier} · ${TIER_LABEL[tier]}`} className={`tier-badge tier-${tier.toLowerCase()}`}>
    {tier}
  </span>
);

const FormField = ({
  id,
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  monospace,
  password
}: {
  id?: string;
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monospace?: boolean;
  password?: boolean;
}) => (
  <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2, minWidth: 0 }}>
    <Label for={id} required={required}>
      {label}
    </Label>
    <Input
      id={id}
      type={password ? 'Password' : undefined}
      value={value}
      placeholder={placeholder}
      onInput={(e) => onChange(inputValue(e))}
      style={monospace ? { fontFamily: 'var(--sapContent_MonospaceFontFamily)' } : undefined}
    />
    {hint && (
      <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>{hint}</span>
    )}
  </FlexBox>
);

const FieldGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.5rem' }}>
    <span
      style={{
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--sapContent_LabelColor)'
      }}
    >
      {title}
    </span>
    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.6rem' }}>
      {children}
    </FlexBox>
  </FlexBox>
);

type BusyActionKind = 'delete' | 'lifecycle' | null;

type DeleteTarget =
  | { kind: 'RootKey'; rootKey: RootKey }
  | { kind: 'DomainKey'; name: string; namespace: string }
  | { kind: 'ServiceKey'; name: string; namespace: string }
  | { kind: 'DEK'; name: string; namespace: string };

type DeactivateTarget = DeleteTarget;

type DependentWarning = { kindLabel: string; names: string[]; unknown?: boolean };

const lifecycleActionLabel = (current?: string): 'Activate' | 'Deactivate' | null => {
  if (current === 'Active') return 'Deactivate';
  if (current === 'Deactivated') return 'Activate';
  return null;
};

// Child cannot be more active than parent. When the parent isn't Active,
// the UI mirrors what the controller enforces by disabling the Activate
// button on the child.
const canActivateUnderParent = (parentLifecycle?: string): boolean =>
  parentLifecycle === 'Active';

// A cascade also writes Deactivated into the child's spec, so only a key that should be Active is held by its parent.
const blockingParent = (key: { spec: { lifecycle?: string } }, parentActive: boolean, parentKind: string) =>
  key.spec.lifecycle !== 'Deactivated' && !parentActive ? parentKind : undefined;

const deleteKindLabel = (kind: DeleteTarget['kind']): string => {
  if (kind === 'RootKey') return 'Root Key';
  if (kind === 'DomainKey') return 'Domain Key';
  if (kind === 'ServiceKey') return 'Service Key';
  return 'Data Key';
};

/* ------------------------------- Account header ----------------------------- */

const TierTile = ({
  tier,
  count,
  activeCount,
  pendingCount
}: {
  tier: Tier;
  count: number;
  activeCount?: number;
  pendingCount?: number;
}) => {
  const dotState = (() => {
    if (count === 0) return 'None';
    if (activeCount !== undefined && activeCount === 0) return 'Critical';
    if (activeCount !== undefined && activeCount < count) return 'Critical';
    return 'Positive';
  })() as 'Positive' | 'Critical' | 'None';

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2, minWidth: 96 }}>
      <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.4rem' }}>
        <TierBadge tier={tier} />
        <Label style={{ color: 'var(--sapContent_LabelColor)' }}>{TIER_LABEL[tier]}</Label>
      </FlexBox>
      <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.5rem' }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>{count}</span>
        {activeCount !== undefined && count > 0 && (
          <StatusPill state={dotState}>
            {activeCount}/{count} active
          </StatusPill>
        )}
        {pendingCount !== undefined && pendingCount > 0 && (
          <StatusPill state="Critical">
            {pendingCount} pending
          </StatusPill>
        )}
      </FlexBox>
    </FlexBox>
  );
};

const TierConnector = () => (
  <Icon
    name="chain-link"
    style={{
      color: 'var(--sapContent_NonInteractiveIconColor)',
      flexShrink: 0,
      width: '0.85rem',
      height: '0.85rem'
    }}
  />
);

const AccountHeader = ({
  tenant,
  path,
  rootKeys,
  domainKeys,
  serviceKeys,
  dataEncryptionKeys
}: {
  tenant?: Tenant;
  path?: string | null;
  rootKeys: RootKey[];
  domainKeys: DomainKey[];
  serviceKeys: ServiceKey[];
  dataEncryptionKeys: DataEncryptionKey[];
}) => {
  const tenantReady = tenant ? conditionByType(tenant.status?.conditions, 'Ready') : undefined;
  const activeRoots = rootKeys.filter((r) => keyLifecycle(r) === 'Active').length;
  const activeDomains = domainKeys.filter((d) => keyLifecycle(d) === 'Active').length;
  const activeServices = serviceKeys.filter((s) => keyLifecycle(s) === 'Active').length;
  const activeDeks = dataEncryptionKeys.filter((d) => keyLifecycle(d) === 'Active').length;

  return (
    <FlexBox
      direction={FlexBoxDirection.Column}
      style={{
        background: 'var(--sapObjectHeader_Background)',
        border: '1px solid var(--sapGroup_ContentBorderColor)',
        boxShadow: '0 1px 2px rgba(34, 53, 72, 0.1)',
        borderRadius: 'var(--sapElement_BorderCornerRadius)',
        padding: '1rem 1.25rem',
        gap: '0.85rem'
      }}
    >
      <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <span className="key-lead" style={{ width: '2rem', flex: 'none' }}>
          <Icon name="shield" style={{ color: 'var(--sapContent_IconColor)' }} />
        </span>
        <FlexBox direction={FlexBoxDirection.Column} style={{ minWidth: 0, gap: 2 }}>
          <Label style={{ color: 'var(--sapContent_LabelColor)' }}>Tenant</Label>
          <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.5rem' }}>
            <Title level="H4" style={{ margin: 0 }}>
              {tenant?.metadata.name ?? '-'}
            </Title>
            {tenantReady && (
              <StatusPill state={tenantReady.status === 'True' ? 'Positive' : 'Critical'}>
                {tenantReady.status === 'True' ? 'Registered' : tenantReady.status}
              </StatusPill>
            )}
            {tenant?.spec.region && (
              <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
                · {tenant.spec.region}
              </span>
            )}
          </FlexBox>
          {path && (
            <span
              style={{
                fontSize: '0.7rem',
                color: 'var(--sapContent_LabelColor)',
                fontFamily: 'var(--sapContent_MonospaceFontFamily)'
              }}
            >
              {path}
            </span>
          )}
        </FlexBox>
      </FlexBox>
      <FlexBox
        alignItems={FlexBoxAlignItems.Center}
        style={{
          gap: '0.85rem',
          flexWrap: 'wrap',
          paddingTop: '0.6rem',
          borderTop: '1px solid var(--sapGroup_ContentBorderColor)'
        }}
      >
        <TierTile tier="L1" count={rootKeys.length} activeCount={activeRoots} />
        <TierConnector />
        <TierTile tier="L2" count={domainKeys.length} activeCount={activeDomains} />
        <TierConnector />
        <TierTile tier="L3" count={serviceKeys.length} activeCount={activeServices} />
        <TierConnector />
        <TierTile tier="L4" count={dataEncryptionKeys.length} activeCount={activeDeks} />
      </FlexBox>
    </FlexBox>
  );
};

/* ------------------------------- Onboarding -------------------------------- */

type StepState = 'pending' | 'next' | 'in-progress' | 'done';

const stepAccent = (state: StepState) => {
  if (state === 'done') return 'var(--sapPositiveColor)';
  if (state === 'next') return 'var(--sapInformativeColor)';
  if (state === 'in-progress') return 'var(--sapCriticalColor)';
  return 'var(--sapNeutralColor)';
};

// The step number reads as a state: tinted ring when finished or running, action colour when it is next.
const stepDot = (state: StepState): React.CSSProperties => {
  if (state === 'done') return { background: 'var(--sapSuccessBackground)', border: '2px solid var(--sapPositiveElementColor)', color: 'var(--sapPositiveTextColor)' };
  if (state === 'next') return { background: 'var(--sapButton_Emphasized_Background)', border: '2px solid var(--sapButton_Emphasized_Background)', color: 'var(--sapButton_Emphasized_TextColor)' };
  if (state === 'in-progress') return { background: 'var(--sapWarningBackground)', border: '2px solid var(--sapCriticalElementColor)', color: 'var(--sapCriticalTextColor)' };
  return { background: 'var(--sapGroup_ContentBackground)', border: '2px solid var(--sapNeutralBorderColor)', color: 'var(--sapContent_LabelColor)' };
};

const OnboardingStep = ({
  n,
  title,
  description,
  state,
  actionLabel,
  actionDisabled,
  onAction,
  pendingHint,
  inProgressHint
}: {
  n: number;
  title: string;
  description: string;
  state: StepState;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  pendingHint?: string;
  inProgressHint?: string;
}) => {
  const accent = stepAccent(state);
  const isDone = state === 'done';
  const isNext = state === 'next';
  const isInProgress = state === 'in-progress';
  const isPending = state === 'pending';
  return (
    <FlexBox
      direction={FlexBoxDirection.Column}
      style={{
        flex: '1 1 240px',
        minWidth: 240,
        padding: '1rem',
        border: `1px solid ${isNext || isInProgress ? accent : 'var(--sapGroup_ContentBorderColor)'}`,
        borderRadius: 'var(--sapElement_BorderCornerRadius)',
        background: isNext
          ? 'var(--sapInfobar_Background)'
          : isInProgress
          ? 'var(--sapWarningBackground)'
          : 'transparent',
        gap: '0.5rem'
      }}
    >
      <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.5rem' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.5rem',
            height: '1.5rem',
            borderRadius: '50%',
            boxSizing: 'border-box',
            fontWeight: 700,
            fontSize: '0.75rem',
            ...stepDot(state)
          }}
        >
          {isDone ? <Icon name="accept" style={{ width: '0.85rem', height: '0.85rem' }} /> : n}
        </span>
        <Title level="H6" style={{ margin: 0 }}>
          {title}
        </Title>
        {isInProgress && <StatusPill state="Critical">in progress</StatusPill>}
        {isDone && <StatusPill state="Positive">done</StatusPill>}
      </FlexBox>
      <span style={{ fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)' }}>
        {description}
      </span>
      {isInProgress && inProgressHint && (
        <span style={{ fontSize: '0.75rem', color: 'var(--sapCriticalTextColor)' }}>
          {inProgressHint}
        </span>
      )}
      {isPending && pendingHint && (
        <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
          {pendingHint}
        </span>
      )}
      {actionLabel && <div style={{ marginTop: 'auto' }}>
        <Button
          design={isNext ? 'Emphasized' : 'Default'}
          disabled={isPending || isDone || Boolean(actionDisabled)}
          onClick={onAction}
        >
          {isDone
            ? 'Done'
            : isInProgress && !actionDisabled
            ? `${actionLabel} (another)`
            : actionLabel}
        </Button>
      </div>}
    </FlexBox>
  );
};

const OnboardingCard = ({
  step1,
  step2,
  step3,
  pendingRootKeyName,
  pendingDomainKeyName,
  pendingServiceKeyName,
  canAddDomainKey,
  canAddServiceKey,
  onAddDomainKey,
  onAddServiceKey
}: {
  step1: StepState;
  step2: StepState;
  step3: StepState;
  pendingRootKeyName?: string;
  pendingDomainKeyName?: string;
  pendingServiceKeyName?: string;
  canAddDomainKey: boolean;
  canAddServiceKey: boolean;
  onAddDomainKey: () => void;
  onAddServiceKey: () => void;
}) => (
  <Card
    header={
      <CardHeader
        avatar={<Icon name="hint" />}
        titleText="Get started with OpenKCM"
        subtitleText="Three steps from an empty tenant to a working key hierarchy."
      />
    }
  >
    <FlexBox style={{ padding: '0.75rem 1rem 1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
      <OnboardingStep
        n={1}
        title="Add a Root Key"
        description={
          'Connect a key from your own KMS (OpenBao, AWS KMS or Azure Key Vault). ' +
          'It is the root of the hierarchy (L1).'
        }
        state={step1}
        inProgressHint={
          pendingRootKeyName
            ? `Waiting for "${pendingRootKeyName}" to reach Active. ` +
              'If the configuration is wrong, delete it and add a new one.'
            : 'Waiting for the Root Key to become Active.'
        }
      />
      <OnboardingStep
        n={2}
        title="Create a Domain Key"
        description="One Namespace key shared by all services here, or an Instance key for a single service."
        state={step2}
        actionLabel="Create Domain Key"
        actionDisabled={!canAddDomainKey}
        onAction={onAddDomainKey}
        pendingHint="Available once an L1 Root Key is Active."
        inProgressHint={
          pendingDomainKeyName
            ? `Waiting for "${pendingDomainKeyName}" to reach Active.`
            : 'Waiting for the Domain Key to become Active.'
        }
      />
      <OnboardingStep
        n={3}
        title="Mint a Service Key"
        description="A key for one workload, under an Active Domain Key. Data Keys (L4) are created under it."
        state={step3}
        actionLabel="Mint Service Key"
        actionDisabled={!canAddServiceKey}
        onAction={onAddServiceKey}
        pendingHint="Available once an L2 Domain Key is Active."
        inProgressHint={
          pendingServiceKeyName
            ? `Waiting for "${pendingServiceKeyName}" to reach Active.`
            : 'Waiting for the Service Key to become Active.'
        }
      />
    </FlexBox>
  </Card>
);

/* ----------------------------------- Cards --------------------------------- */

const keyCount = (count: number) => `${count} ${count === 1 ? 'key' : 'keys'}`;

const Truncate = ({
  text,
  title,
  className,
  style
}: {
  text: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <span title={title ?? text} className={className ? `ellipsis ${className}` : 'ellipsis'} style={style}>
    {text}
  </span>
);

const CopyableId = ({ id }: { id?: string }) => {
  const icon = useRef<IconDomRef>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!id) return <span>-</span>;
  return (
    <div className="copyable">
      <Truncate text={id} className="mono" />
      <Icon
        ref={icon}
        name="copy"
        mode="Interactive"
        accessibleName="Copy"
        showTooltip
        onClick={async () => setCopied(await copyText(id))}
      />
      {copied !== null && (
        <Popover opener={icon.current ?? undefined} open placement="Top" onClose={() => setCopied(null)}>
          <span className="copied">
            <Icon
              name={copied ? 'accept' : 'decline'}
              style={{ color: copied ? 'var(--sapPositiveColor)' : 'var(--sapNegativeColor)' }}
            />
            {copied ? 'Copied' : 'Copy failed'}
          </span>
        </Popover>
      )}
    </div>
  );
};

type FactArea = 'id' | 'parent' | 'child';

const Fact = ({ area, label, children }: { area: FactArea; label: string; children: React.ReactNode }) => (
  <div className={`key-fact key-fact-${area}`}>
    <span className="muted">{label}</span>
    {children}
  </div>
);

const KeyRef = ({ lead, name, detail }: { lead: React.ReactNode; name: string; detail?: string }) => (
  <div className="key-ref">
    {lead}
    <div className="key-ref-text">
      <Truncate text={name} />
      {detail && <Truncate text={detail} className="muted" />}
    </div>
  </div>
);

const MissingRef = ({ name }: { name: string }) => (
  <Truncate text={`${name} is missing`} style={{ color: 'var(--sapNegativeTextColor)' }} />
);

const ActionSlot = ({ wide }: { wide?: boolean }) => (
  <span className={wide ? 'action-slot action-slot-wide' : 'action-slot'} aria-hidden="true" />
);

const LifecycleToggle = ({
  lifecycle,
  busyAction,
  blockedReason,
  onToggle
}: {
  lifecycle: string;
  busyAction: BusyActionKind;
  blockedReason?: string;
  onToggle: () => void;
}) => {
  const label = lifecycleActionLabel(lifecycle);
  if (!label) return <ActionSlot wide />;
  const blocked = label === 'Activate' && Boolean(blockedReason);
  return (
    <Button
      design={label === 'Activate' && !blocked ? 'Emphasized' : 'Default'}
      disabled={busyAction !== null || blocked}
      onClick={onToggle}
      tooltip={blocked ? blockedReason : undefined}
    >
      {busyAction === 'lifecycle' ? '…' : label}
    </Button>
  );
};

const KeyHeader = ({
  lead,
  name,
  subtitle,
  namespaceLabel,
  lifecycle,
  actions
}: {
  lead: React.ReactNode;
  name: string;
  subtitle?: string;
  namespaceLabel?: string;
  lifecycle: string;
  actions: React.ReactNode;
}) => (
  <div className="key-header">
    <div className="key-lead">{lead}</div>
    <div className="key-title">
      <Truncate text={name} className="key-name" />
      {subtitle && <Truncate text={subtitle} className="muted" />}
      {namespaceLabel && <Truncate text={`Namespace: ${namespaceLabel}`} className="muted" />}
    </div>
    <StatusPill className="key-status" state={lifecycleObjectState(lifecycle)}>
      {lifecycle}
    </StatusPill>
    <div className="key-actions">{actions}</div>
  </div>
);

const KeyCard = ({
  tier,
  children,
  ...header
}: React.ComponentProps<typeof KeyHeader> & { tier: Tier; children?: React.ReactNode }) => (
  <Card data-tier={tier} className="key-card">
    <div className="key-card-content">
      <div className="key-card-header">
        <KeyHeader {...header} />
      </div>
      {children && <div className="key-card-body">{children}</div>}
    </div>
  </Card>
);

const ProblemStrip = ({ ready, context }: { ready?: ReadyCondition; context: ProblemContext }) => {
  const problem = readyProblem(ready, context);
  return problem ? (
    <MessageStrip design={problem.design} hideCloseButton>
      {problem.text}
    </MessageStrip>
  ) : null;
};

const Chip = ({ text, kind }: { text: string; kind?: string }) => (
  <span
    title={kind ? `${kind}/${text}` : text}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.1rem 0.5rem',
      borderRadius: '0.6rem',
      background: 'var(--sapList_GroupHeaderBackground)',
      border: '1px solid var(--sapGroup_TitleBorderColor)',
      fontSize: '0.7rem',
      fontFamily: 'var(--sapContent_MonospaceFontFamily)',
      maxWidth: '100%'
    }}
  >
    {kind && (
      <span style={{ marginRight: '0.3rem', color: 'var(--sapContent_LabelColor)' }}>
        {kind}
      </span>
    )}
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
  </span>
);

const ServiceKeyCard = ({
  sk,
  namespaceLabel,
  parent,
  deks,
  busyAction,
  onDelete,
  onLifecycleToggle,
  onAddDek,
  onDeleteDek,
  onDekLifecycleToggle,
  busyDekActionFor,
  canAddDek
}: {
  sk: ServiceKey;
  namespaceLabel?: string;
  parent?: DomainKey;
  deks: DataEncryptionKey[];
  busyAction: BusyActionKind;
  onDelete: () => void;
  onLifecycleToggle: () => void;
  onAddDek: () => void;
  onDeleteDek: (dek: DataEncryptionKey) => void;
  onDekLifecycleToggle: (dek: DataEncryptionKey) => void;
  busyDekActionFor: (name: string) => BusyActionKind;
  canAddDek: boolean;
}) => {
  const lifecycle = keyLifecycle(sk);
  const parentActive = canActivateUnderParent(parent && keyLifecycle(parent));
  return (
    <KeyCard
      tier="L3"
      lead={<TierBadge tier="L3" />}
      name={sk.metadata.name}
      namespaceLabel={namespaceLabel}
      lifecycle={lifecycle}
      actions={
        <>
          <ActionSlot wide />
          <LifecycleToggle
            lifecycle={lifecycle}
            busyAction={busyAction}
            blockedReason={parentActive ? undefined : 'Cannot activate while the Domain Key is not Active.'}
            onToggle={onLifecycleToggle}
          />
          <ActionSlot />
          <Button
            design="Transparent"
            icon="delete"
            disabled={busyAction !== null || isDeleting(sk)}
            onClick={onDelete}
            tooltip="Delete Service Key"
          />
        </>
      }
    >
      <ProblemStrip
        ready={conditionByType(sk.status?.conditions, 'Ready')}
        context={{ kind: 'Service Key', inactiveParent: blockingParent(sk, parentActive, 'Domain Key') }}
      />
      <div className="key-facts">
        <Fact area="id" label="Key ID">
          <CopyableId id={sk.status?.cryptoState?.id} />
        </Fact>
        <Fact area="parent" label="Parent Domain Key">
          {parent ? (
            <KeyRef lead={<TierBadge tier="L2" />} name={parent.metadata.name} detail={scopeLabel(parent)} />
          ) : (
            <MissingRef name={sk.spec.domainKeyRef} />
          )}
        </Fact>
      </div>
      <div className="key-children">
        <div className="key-children-header">
          <span className="key-children-title">
            <TierBadge tier="L4" />
            <Label>Child Data Keys</Label>
            <span className="muted">{keyCount(deks.length)}</span>
          </span>
          <Button
            design="Transparent"
            icon="sys-add"
            disabled={!canAddDek}
            onClick={onAddDek}
            tooltip={canAddDek ? undefined : 'Service Key must be Active'}
          >
            Add Data Key
          </Button>
        </div>
        {deks.length === 0 ? (
          <span className="key-child muted">No Data Keys yet.</span>
        ) : (
          deks.map((dek) => {
            const dekLifecycle = keyLifecycle(dek);
            const dekBusy = busyDekActionFor(dek.metadata.name);
            return (
              <div key={dek.metadata.name} className="key-child" data-tier="L4">
                <KeyHeader
                  lead={null}
                  name={dek.metadata.name}
                  lifecycle={dekLifecycle}
                  actions={
                    <>
                      <LifecycleToggle
                        lifecycle={dekLifecycle}
                        busyAction={dekBusy}
                        blockedReason={
                          lifecycle === 'Active' ? undefined : 'Cannot activate while the Service Key is not Active.'
                        }
                        onToggle={() => onDekLifecycleToggle(dek)}
                      />
                      <Button
                        design="Transparent"
                        icon="delete"
                        disabled={dekBusy !== null || isDeleting(dek)}
                        onClick={() => onDeleteDek(dek)}
                        tooltip="Delete Data Key"
                      />
                    </>
                  }
                />
              </div>
            );
          })
        )}
      </div>
    </KeyCard>
  );
};

/* ----------------------------- Provider icons ------------------------------ */

// Per-provider icon: SVG path + brand color + label. Where the brand mark is
// freely redistributable we pull from simple-icons; for trademarked marks
// (AWS, Azure) we use a recognisable simplified shape in brand colours.
type ProviderVisual = { path: string; color: string; label: string };

const PROVIDER_VISUAL: Record<RootKey['kind'], ProviderVisual> = {
  // AWS dropped from simple-icons in v9 - use a stylised cloud in the
  // signature orange. Not the trademarked AWS logo.
  AWSRootKey: {
    label: 'AWS',
    color: '#FF9900',
    path:
      'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14a6 6 0 0 0 6 6h13a5 5 0 0 0 5-5c0-2.64-2.05-4.78-4.65-4.96z'
  },
  // Azure dropped from simple-icons - use a stylised triangle ("A" shape)
  // in Azure blue.
  AzureRootKey: {
    label: 'Azure',
    color: '#0078D4',
    path:
      'M13.05 4.24 6.56 18.05 2 18l5.09-8.76 5.96-5zm.72 1.62L17.5 22H7l6.77-16.14z'
  },
  // OpenBao - official mark via simple-icons.
  OpenBaoRootKey: {
    label: 'OpenBao',
    color: '#336D5C',
    path:
      'M11.997 4.631a3 3 0 0 0-.309.02c-3.277.098-6.427 1.737-8.084 4.74a8.2 8.2 0 0 0-.99 3.117C.922 13.256 0 14.185 0 15.142c0 1.12 1.264 2.196 3.515 2.989 2.25.793 5.302 1.238 8.485 1.238s6.235-.445 8.485-1.238S24 16.263 24 15.14c0-.956-.922-1.885-2.614-2.633a8.2 8.2 0 0 0-.99-3.117c-1.657-3.003-4.807-4.642-8.084-4.74a3 3 0 0 0-.315-.02m.9 2.09.037.02c.354.198.687.488.737.547.317.38.74 1.09.74 1.473a.896.896 0 0 0 1.793 0 3.24 3.24 0 0 0-.322-1.39 7.2 7.2 0 0 1 2.945 2.886c.676 1.226.902 2.634.75 3.605-.077.486-.244.847-.419 1.046s-.32.278-.622.278H5.464c-.301 0-.447-.079-.622-.278-.175-.2-.342-.56-.419-1.046-.152-.97.074-2.38.75-3.605A7.2 7.2 0 0 1 8.118 7.37a3.24 3.24 0 0 0-.322 1.39.896.896 0 0 0 1.792 0c0-.382.424-1.093.741-1.473a3.7 3.7 0 0 1 .775-.567v2.04a.896.896 0 1 0 1.792 0zm2.141 3.523a1.38 1.38 0 0 0-1.138.61c-.21.309-.278.562.151.827.28.173.605.11.795.016.124-.06.17-.107.387-.007.439.203.695.193.948-.017.284-.236.236-.58.023-.83-.306-.359-.72-.591-1.166-.599m-6.797.017c-.445.007-.86.24-1.167.6-.213.25-.26.593.024.829.253.21.51.22.948.017.217-.1.263-.053.386.007.191.093.516.156.796-.016.429-.265.36-.519.15-.827a1.38 1.38 0 0 0-1.137-.61'
  },
  // Google Cloud - official mark via simple-icons.
  GCPRootKey: {
    label: 'GCP',
    color: '#4285F4',
    path:
      'M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.002h5.192c1.6 0 3.153-.587 4.36-1.62 2.51-2.077 2.83-5.892.638-8.366l-.014-.014-.013-.013a6.064 6.064 0 0 0-1.243-1.012l-.039-.025c-.305-3.86-3.524-6.84-7.404-6.852A6.762 6.762 0 0 0 12.19 2.38m-.002 1.836a5.082 5.082 0 0 1 4.964 4.077l.402 2.05 1.61-1.311c.288-.235.69-.387 1.13-.387 1.085 0 1.954.86 1.954 1.928 0 .738-.414 1.365-1.02 1.685-.16.05-.328.092-.5.114l-2.483-2.482-1.297 1.297 3.539 3.54a3.6 3.6 0 0 1-1.823.493h-5.221l-.038-.001-.039.001H8.785a4.9 4.9 0 0 1-2.967-.992l-.21-.158L4 17.36c-1.794-1.853-1.625-4.95.39-6.58a4.4 4.4 0 0 1 .595-.393l.504-.275.143-.555a7.5 7.5 0 0 1 .824-1.99l1.243 1.242L9 7.512 7.448 5.96a7.5 7.5 0 0 1 4.74-1.745z'
  },
  // HashiCorp Vault - official mark via simple-icons.
  VaultRootKey: {
    label: 'Vault',
    color: '#FFEC6E',
    path:
      'M7.41 0 0 12.02 7.5 24l1.16-1.838-6.32-10.142L8.5 1.846zm9.18 0-1.097 1.835 6.32 10.183-6.32 10.146L16.59 24 24 11.977zm-4.65 5.265-1.867.013L13.158 12l-3.085 6.738 1.866.012L15.042 12z'
  },
  // HSM has no provider-specific mark - a generic shield + chip glyph.
  HSMRootKey: {
    label: 'HSM',
    color: '#6E6F71',
    path:
      'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1.5 13H8v-1h2.5V9H8V8h2.5V6h1v2H14v1h-2.5v4H14v1h-2.5v2h-1v-2z'
  }
};

const providerVisual = (kind: RootKey['kind']): ProviderVisual =>
  PROVIDER_VISUAL[kind] ?? PROVIDER_VISUAL.OpenBaoRootKey;

// Register each provider SVG as a ui5 custom icon so the standard Option
// `icon` prop can render it in Select dropdowns.
const PROVIDER_ICON_COLLECTION = 'openkcm-providers';
const PROVIDER_ICON_VIEW_BOX = '0 0 24 24';
const providerIconName = (kind: RootKey['kind']): string =>
  `${PROVIDER_ICON_COLLECTION}/${kind.toLowerCase()}`;

(Object.keys(PROVIDER_VISUAL) as Array<RootKey['kind']>).forEach((kind) => {
  const v = PROVIDER_VISUAL[kind];
  registerIcon(kind.toLowerCase(), {
    pathData: v.path,
    collection: PROVIDER_ICON_COLLECTION,
    ltr: true,
    viewBox: PROVIDER_ICON_VIEW_BOX
  });
});

const PROVIDER_SIZE = { XS: 16, S: 20, M: 28 } as const;

const ProviderIcon = ({
  kind,
  size = 'XS',
  withBackground = true
}: {
  kind: RootKey['kind'];
  size?: keyof typeof PROVIDER_SIZE;
  withBackground?: boolean;
}) => {
  const v = providerVisual(kind);
  const px = PROVIDER_SIZE[size];
  const pad = withBackground ? Math.max(2, Math.floor(px * 0.18)) : 0;
  const svgPx = px - pad * 2;
  return (
    <span
      title={v.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        padding: pad,
        borderRadius: withBackground ? 4 : 0,
        background: withBackground ? `${v.color}1A` : 'transparent',
        flexShrink: 0
      }}
    >
      <svg viewBox={PROVIDER_ICON_VIEW_BOX} width={svgPx} height={svgPx} aria-hidden focusable="false">
        <path d={v.path} fill={v.color} />
      </svg>
    </span>
  );
};

/* ------------------------------- Root and domain keys ---------------------- */

const RootKeyCard = ({
  rk, busyAction, canManage, onLifecycleToggle, onDelete
}: {
  rk: RootKey;
  busyAction: BusyActionKind;
  canManage: boolean;
  onLifecycleToggle: () => void;
  onDelete: () => void;
}) => {
  const writeInFlight = busyAction !== null || isDeleting(rk);
  const registered = Boolean(rk.status?.cryptoState);
  return (
    <KeyCard
      tier="L1"
      lead={<ProviderIcon kind={rk.kind} size="M" />}
      name={rk.metadata.name}
      subtitle={providerVisual(rk.kind).label}
      lifecycle={keyLifecycle(rk)}
      actions={
        <>
          <ActionSlot wide />
          {canManage && registered && !writeInFlight
            ? <LifecycleToggle lifecycle={keyLifecycle(rk)} busyAction={busyAction} onToggle={onLifecycleToggle} />
            : <ActionSlot wide />}
          <ActionSlot />
          {canManage
            ? (
              <Button
                design="Transparent"
                icon="delete"
                disabled={writeInFlight}
                onClick={onDelete}
                tooltip="Delete Root Key"
              />
            )
            : <ActionSlot />}
        </>
      }
    >
      <ProblemStrip ready={conditionByType(rk.status?.conditions, 'Ready')} context={{ kind: 'Root Key' }} />
      <div className="key-facts">
        <Fact area="id" label="Key ID"><CopyableId id={rk.status?.cryptoState?.id} /></Fact>
      </div>
    </KeyCard>
  );
};

const DomainKeyCard = ({
  domainKey,
  namespace,
  namespaceLabel,
  servedBy,
  rootKeys,
  accountNamespace,
  busyAction,
  onEditDk,
  onLifecycleToggleDk,
  onDeleteDk,
  onDetailDk,
  readOnly
}: {
  domainKey: DomainKey;
  namespace: string;
  namespaceLabel?: string;
  servedBy?: string;
  rootKeys: RootKey[];
  accountNamespace: string;
  busyAction: BusyActionKind;
  onEditDk: () => void;
  onLifecycleToggleDk: () => void;
  onDeleteDk: () => void;
  onDetailDk: () => void;
  readOnly?: boolean;
}) => {
  const lifecycle = keyLifecycle(domainKey);
  const locked = busyAction !== null || isDeleting(domainKey);
  const primary = linkedRootKeyRef(domainKey);
  const primaryRk = primary
    ? rootKeys.find(
        (rk) =>
          rk.kind === primary.kind &&
          (rk.metadata.namespace || accountNamespace) === (primary.namespace || namespace) &&
          rk.metadata.name === primary.name
      )
    : undefined;
  const rootActive = !primary || canActivateUnderParent(primaryRk && keyLifecycle(primaryRk));

  return (
    <KeyCard
      tier="L2"
      lead={<TierBadge tier="L2" />}
      name={domainKey.metadata.name}
      subtitle={readOnly ? `${scopeLabel(domainKey)} · Read-only` : scopeLabel(domainKey)}
      namespaceLabel={namespaceLabel}
      lifecycle={lifecycle}
      actions={
        <>
          <Button onClick={onDetailDk}>Details</Button>
          {readOnly ? (
            <>
              <ActionSlot wide />
              <ActionSlot />
              <ActionSlot />
            </>
          ) : (
            <>
              <LifecycleToggle lifecycle={lifecycle} busyAction={busyAction} onToggle={onLifecycleToggleDk} />
              <Button
                design="Transparent"
                icon="edit"
                disabled={locked}
                onClick={onEditDk}
                tooltip="Edit Domain Key"
              />
              <Button
                design="Transparent"
                icon="delete"
                disabled={locked}
                onClick={onDeleteDk}
                tooltip="Delete Domain Key"
              />
            </>
          )}
        </>
      }
    >
      <ProblemStrip
        ready={conditionByType(domainKey.status?.conditions, 'Ready')}
        context={{ kind: 'Domain Key', inactiveParent: blockingParent(domainKey, rootActive, 'Root Key') }}
      />
      <div className="key-facts">
        <Fact area="id" label="Key ID">
          <CopyableId id={domainKey.status?.cryptoState?.id} />
        </Fact>
        <Fact area="parent" label="Parent Root Key">
          {primaryRk ? (
            <KeyRef
              lead={<ProviderIcon kind={primaryRk.kind} size="S" />}
              name={primaryRk.metadata.name}
              detail={providerVisual(primaryRk.kind).label}
            />
          ) : primary ? (
            <MissingRef name={primary.name} />
          ) : (
            'Not linked'
          )}
        </Fact>
        {domainKeyScope(domainKey) === 'Instance' && (
          <Fact area="child" label="Child Service Key">
            {servedBy ? <KeyRef lead={<TierBadge tier="L3" />} name={servedBy} /> : 'None yet'}
          </Fact>
        )}
      </div>
    </KeyCard>
  );
};

/* ----------------------------------- Sections ------------------------------ */

const Collapse = ({
  open,
  offset = '0px',
  children
}: {
  open: boolean;
  offset?: string;
  children: React.ReactNode;
}) => {
  const [rendered, setRendered] = useState(open);
  const [hidden, setHidden] = useState(!open);
  const [shown, setShown] = useState(open);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setHidden(false);
      return undefined;
    }
    setShown(false);
    const timer = window.setTimeout(() => setHidden(true), COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || hidden || shown) return;
    ref.current?.getBoundingClientRect();
    setShown(true);
  }, [open, hidden, shown]);

  if (!rendered) return null;
  return (
    <div
      ref={ref}
      hidden={hidden}
      className={`collapse${shown ? ' collapse-open' : ''}`}
      style={{ '--collapse-offset': offset } as React.CSSProperties}
    >
      <div className="collapse-clip">
        <div className="collapse-body">{children}</div>
      </div>
    </div>
  );
};

const SectionHeader = ({
  tier,
  title = `${TIER_LABEL[tier]}s`,
  count,
  collapsed,
  onToggle,
  rightContent
}: {
  tier: Tier;
  title?: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  rightContent?: React.ReactNode;
}) => (
  <div className="section-header">
    <div className="key-lead">
      <TierBadge tier={tier} />
    </div>
    <button
      type="button"
      className="section-title section-toggle"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      title={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
      onClick={onToggle}
    >
      <Icon name="slim-arrow-down" />
      <Title level="H3" style={{ margin: 0 }}>
        {title}
      </Title>
      <span style={{ color: 'var(--sapContent_LabelColor)' }}>{keyCount(count)}</span>
    </button>
    <div className="section-actions">{rightContent}</div>
  </div>
);

/* ------------------------------------ App ---------------------------------- */

const App = () => {
  const [ctx, setCtx] = useState<RuntimeContext>(emptyRuntimeContext);
  const [l1PermissionRevision, setL1PermissionRevision] = useState(0);
  const refreshL1Permission = useCallback(() => setL1PermissionRevision((value) => value + 1), []);
  const canManageL1 = useL1Permission(ctx, 'manage_l1', l1PermissionRevision);
  const canManageL1Roles = useL1Permission(ctx, 'manage_iam_roles');
  const [tenant, setTenant] = useState<Tenant | undefined>();
  const [rootKeys, setRootKeys] = useState<RootKey[]>([]);
  const [serviceKeys, setServiceKeys] = useState<ServiceKey[]>([]);
  const [dataEncryptionKeys, setDataEncryptionKeys] = useState<DataEncryptionKey[]>([]);
  const [domainKeys, setDomainKeys] = useState<DomainKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionTier, boolean>>(readCollapsedSections);
  const [serviceKeyResourceVersion, setServiceKeyResourceVersion] = useState<string | null>(null);
  const [domainKeyResourceVersion, setDomainKeyResourceVersion] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const reloadGenerationRef = useRef(0);

  const [pendingAction, setPendingAction] = useState<{
    target: DeleteTarget['kind'];
    name: string;
    namespace: string;
    kind: BusyActionKind;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<DeactivateTarget | null>(null);

  const [skOpen, setSkOpen] = useState(false);
  const [skBusy, setSkBusy] = useState(false);
  const [skName, setSkName] = useState('');
  const [skDomainKeyName, setSkDomainKeyName] = useState('');

  const [rkOpen, setRkOpen] = useState(false);
  const [rkBusy, setRkBusy] = useState(false);
  const [rkProvider, setRkProvider] = useState<RootKeyProvider>('AWS');
  const [rkName, setRkName] = useState('');
  const [rkObFields, setRkObFields] = useState(EMPTY_OPENBAO_FIELDS);
  const [rkAwsFields, setRkAwsFields] = useState(EMPTY_AWS_FIELDS);
  const [rkAzureFields, setRkAzureFields] = useState(EMPTY_AZURE_FIELDS);

  const [dkOpen, setDkOpen] = useState(false);
  const [dkBusy, setDkBusy] = useState(false);
  const [dkEditing, setDkEditing] = useState<DomainKey | null>(null);
  const [dkScope, setDkScope] = useState<DomainKeyScope>('Namespace');
  const [dkName, setDkName] = useState('');
  const [dkPrimaryId, setDkPrimaryId] = useState<string>('');

  const [dekOpen, setDekOpen] = useState(false);
  const [dekBusy, setDekBusy] = useState(false);
  const [dekName, setDekName] = useState('');
  const [dekParent, setDekParent] = useState<ServiceKey | null>(null);

  useEffect(() => subscribeToLuigi(setCtx), []);

  useEffect(() => {
    setRkOpen(false);
    setConfirmDelete((target) => target?.kind === 'RootKey' ? null : target);
    setConfirmDeactivate((target) => target?.kind === 'RootKey' ? null : target);
  }, [ctx, canManageL1]);

  const [accountClient, setAccountClient] = useState<KcpClientOptions>({
    graphqlUrl: '', token: null, workspacePath: null
  });
  useEffect(() => {
    const controller = new AbortController();
    setAccountClient({
      graphqlUrl: ctx.graphqlUrl ?? '',
      token: ctx.token,
      workspacePath: ctx.workspacePath,
      signal: controller.signal,
      onL1PermissionDenied: refreshL1Permission
    });
    return () => controller.abort();
  }, [ctx.graphqlUrl, ctx.token, ctx.workspacePath, ctx.namespace, ctx.viewLevel, refreshL1Permission]);

  const accountNamespace = ctx.accountNamespace || 'default';
  const resourceNamespace = ctx.namespace;

  const accountName = useMemo(
    () => tenant?.metadata.name ?? ctx.workspacePath?.split(':').pop() ?? '',
    [tenant, ctx.workspacePath]
  );

  useEffect(() => {
    reloadGenerationRef.current += 1;
    hasLoadedRef.current = false;
    setLoading(Boolean(ctx.graphqlUrl && ctx.workspacePath));
    setError(null);
    setSuccess(null);
    setTenant(undefined);
    setRootKeys([]);
    setDomainKeys([]);
    setServiceKeys([]);
    setDataEncryptionKeys([]);
    setDomainKeyResourceVersion(null);
    setServiceKeyResourceVersion(null);
    setConfirmDelete(null);
    setConfirmDeactivate(null);
    setPendingAction(null);
    setRkOpen(false); setDkOpen(false); setSkOpen(false); setDekOpen(false);
    setRkBusy(false); setDkBusy(false); setSkBusy(false); setDekBusy(false);
    setDkEditing(null); setDekParent(null);
  }, [accountNamespace, ctx.graphqlUrl, ctx.viewLevel, ctx.workspacePath, ctx.token, resourceNamespace]);

  const reload = useCallback(async (options?: { background?: boolean }) => {
    if (ctx.openkcmPage === 'l1-key-managers' || !ctx.graphqlUrl || !ctx.workspacePath || accountClient.signal?.aborted || accountClient.workspacePath !== ctx.workspacePath) return;
    if (options?.background && !hasLoadedRef.current) return;
    const generation = reloadGenerationRef.current;
    const initialLoad = !hasLoadedRef.current && !options?.background;
    if (initialLoad) {
      setLoading(true);
    }
    try {
      const rootNamespaces = [accountNamespace];
      const [tenants, rootLists] = await Promise.all([
        listTenants(accountClient, accountNamespace),
        Promise.all(rootNamespaces.map((namespace) => listRootKeys(accountClient, namespace)))
      ]);
      const roots = mergeRootKeys(rootLists.flat());
      const [dks, sks, deks] =
        resourceNamespace
          ? await Promise.all([
              listDomainKeys(accountClient, resourceNamespace),
              listServiceKeys(accountClient, resourceNamespace),
              listDataEncryptionKeys(accountClient, resourceNamespace)
            ])
          : await Promise.all([
              listAllDomainKeys(accountClient),
              listAllServiceKeys(accountClient),
              listAllDataEncryptionKeys(accountClient)
            ]);
      // With one namespace selected, the System Domain Keys of the account namespace are still shown (read-only).
      let systemDks: DomainKey[] = [];
      if (resourceNamespace && resourceNamespace !== accountNamespace) {
        const account = await listDomainKeys(accountClient, accountNamespace).catch(() => null);
        systemDks = (account?.items ?? []).filter((dk) => domainKeyScope(dk) === 'System' &&
          !dks.items.some((own) => own.metadata.name === dk.metadata.name && own.metadata.namespace === dk.metadata.namespace));
      }
      if (accountClient.signal?.aborted || generation !== reloadGenerationRef.current) return;
      setTenant(tenants[0]);
      setDomainKeys([...dks.items, ...systemDks]);
      setServiceKeys(sks.items);
      setRootKeys(roots);
      setDataEncryptionKeys(deks);
      setDomainKeyResourceVersion(dks.resourceVersion);
      setServiceKeyResourceVersion(sks.resourceVersion);
      setError(null);
    } catch (err) {
      if (accountClient.signal?.aborted || generation !== reloadGenerationRef.current) return;
      setError((err as Error).message);
    } finally {
      if (accountClient.signal?.aborted || generation !== reloadGenerationRef.current) return;
      hasLoadedRef.current = true;
      if (initialLoad) setLoading(false);
    }
  }, [accountClient, accountNamespace, ctx.graphqlUrl, ctx.workspacePath, ctx.openkcmPage, resourceNamespace]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (ctx.openkcmPage === 'l1-key-managers' || !ctx.graphqlUrl || !ctx.workspacePath || accountClient.signal?.aborted || accountClient.workspacePath !== ctx.workspacePath) return;
    let reloadTimer: number | null = null;
    const queueReload = () => {
      if (!hasLoadedRef.current) return;
      if (reloadTimer != null) return;
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void reload({ background: true });
      }, 500);
    };
    const unsubscribers = [subscribeRootKeys(accountClient, accountNamespace, queueReload)];
    unsubscribers.push(
      subscribeServiceKeys(accountClient, resourceNamespace, serviceKeyResourceVersion, queueReload),
      subscribeDomainKeys(accountClient, resourceNamespace, domainKeyResourceVersion, queueReload),
      subscribeDataEncryptionKeys(accountClient, resourceNamespace, queueReload)
    );
    return () => {
      if (reloadTimer != null) window.clearTimeout(reloadTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [
    accountClient,
    accountNamespace,
    ctx.graphqlUrl,
    ctx.openkcmPage,
    domainKeyResourceVersion,
    reload,
    resourceNamespace,
    serviceKeyResourceVersion
  ]);

  const visibleRootKeys = useMemo(
    () => rootKeys.filter((rk) => !emptyRootKey(rk))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.metadata.name.localeCompare(b.metadata.name)),
    [rootKeys]
  );
  const activeRootKeys = useMemo(
    () => visibleRootKeys.filter((rk) => keyLifecycle(rk) === 'Active'),
    [visibleRootKeys]
  );
  const activeDomainKeys = useMemo(
    () => domainKeys.filter((dk) => keyLifecycle(dk) === 'Active'),
    [domainKeys]
  );
  const mintable = useMemo(() => mintableDomainKeys(domainKeys, serviceKeys), [domainKeys, serviceKeys]);

  const activeServiceKeys = useMemo(
    () => serviceKeys.filter((sk) => keyLifecycle(sk) === 'Active'),
    [serviceKeys]
  );

  const step1State: StepState =
    activeRootKeys.length > 0 ? 'done' : visibleRootKeys.length > 0 ? 'in-progress' : 'next';
  const step2State: StepState =
    activeDomainKeys.length > 0
      ? 'done'
      : domainKeys.length > 0
      ? 'in-progress'
      : activeRootKeys.length > 0
      ? 'next'
      : 'pending';
  const step3State: StepState =
    activeServiceKeys.length > 0
      ? 'done'
      : serviceKeys.length > 0
      ? 'in-progress'
      : activeDomainKeys.length > 0
      ? 'next'
      : 'pending';

  const pendingRootKey = useMemo(
    () => visibleRootKeys.find((rk) => keyLifecycle(rk) !== 'Active'),
    [visibleRootKeys]
  );
  const pendingDomainKey = useMemo(
    () => domainKeys.find((dk) => keyLifecycle(dk) !== 'Active'),
    [domainKeys]
  );
  const pendingServiceKey = useMemo(
    () => serviceKeys.find((sk) => keyLifecycle(sk) !== 'Active'),
    [serviceKeys]
  );
  const hasNamespaceKeyHierarchy =
    domainKeys.length > 0 || serviceKeys.length > 0 || dataEncryptionKeys.length > 0;

  const rootKeyNamespace = useCallback(
    (rk: RootKey) => rk.metadata.namespace || accountNamespace,
    [accountNamespace]
  );
  const rootKeyId = useCallback(
    (rk: RootKey) => `${rk.kind}/${rootKeyNamespace(rk)}/${rk.metadata.name}`,
    [rootKeyNamespace]
  );
  const currentRoot = (root: RootKey) => rootKeys.find((key) => rootKeyListId(key) === rootKeyListId(root));
  const canOperateRoot = (root: RootKey): boolean => {
    const current = currentRoot(root);
    return Boolean(canManageL1 && current && current.status?.cryptoState && !isDeleting(current));
  };
  const canDeleteRoot = (root: RootKey): boolean => {
    const current = currentRoot(root);
    return Boolean(canManageL1 && current && !isDeleting(current) &&
      !(pendingAction?.target === 'RootKey' && pendingAction.name === root.metadata.name &&
        pendingAction.namespace === root.metadata.namespace));
  };
  const rootRefId = useCallback(
    (ref: { kind: string; namespace?: string; name: string }, fallbackNamespace: string) =>
      `${ref.kind}/${ref.namespace || fallbackNamespace}/${ref.name}`,
    []
  );
  const domainKeyNamespace = useCallback(
    (dk: DomainKey) => dk.metadata.namespace || resourceNamespace || accountNamespace,
    [accountNamespace, resourceNamespace]
  );
  const domainKeysIn = useCallback(
    (namespace: string) => domainKeys.filter((dk) => domainKeyNamespace(dk) === namespace),
    [domainKeyNamespace, domainKeys]
  );

  const showOnboarding =
    !loading &&
    activeRootKeys.length > 0 &&
    !hasNamespaceKeyHierarchy;

  /* --------------------------- Service key handlers ----------------------- */

  const openSkDialog = () => {
    if (!resourceNamespace) return;
    setSkName('');
    setSkDomainKeyName(mintable[0] ? `${mintable[0].metadata.namespace}/${mintable[0].metadata.name}` : '');
    setSkOpen(true);
  };

  const skDomainKey = mintable.find((dk) => `${dk.metadata.namespace}/${dk.metadata.name}` === skDomainKeyName);
  const skTargetNamespace = resourceNamespace ?? '';

  const handleCreateServiceKey = async () => {
    if (!ctx.workspacePath) return;
    if (!RFC_1123.test(skName)) {
      setError('Name must be a valid RFC 1123 label (lowercase, dashes, digits).');
      return;
    }
    if (!skDomainKey?.metadata.namespace || !RFC_1123.test(skTargetNamespace)) {
      setError('Pick an Active Domain Key that can take a new Service Key, and a valid namespace.');
      return;
    }
    setSkBusy(true);
    try {
      await createServiceKey(accountClient, {
        namespace: skTargetNamespace,
        name: skName,
        tenantNameRef: skDomainKey.spec.tenantNameRef,
        domainKeyName: skDomainKey.metadata.name,
        domainKeyNamespace: skDomainKey.metadata.namespace === skTargetNamespace ? undefined : skDomainKey.metadata.namespace
      });
      if (accountClient.signal?.aborted) return;
      setSkOpen(false);
      setSkName('');
      setSuccess(`Service Key "${skName}" created.`);
      await reload();
    } catch (err) {
      if (accountClient.signal?.aborted) return;
      setError(`Create Service Key failed: ${(err as Error).message}`);
    } finally {
      if (accountClient.signal?.aborted) return;
      setSkBusy(false);
    }
  };

  /* ----------------------------- Root key handlers ------------------------ */

  const openRkCreateDialog = () => {
    if (!canManageL1) return;
    setRkProvider('AWS');
    setRkName('');
    setRkObFields(EMPTY_OPENBAO_FIELDS);
    setRkAwsFields(EMPTY_AWS_FIELDS);
    setRkAzureFields(EMPTY_AZURE_FIELDS);
    setRkOpen(true);
  };

  const closeRkDialog = () => {
    setRkOpen(false);
    setRkAwsFields(EMPTY_AWS_FIELDS);
  };

  const rkNameTaken = rootKeys.some((rk) => rk.kind === rootKeyKind(rkProvider) && rk.metadata.name === rkName);
  const rkValid = useMemo(() => {
    if (!RFC_1123.test(rkName)) return false;
    if (rkProvider === 'OpenBao') {
      const f = rkObFields;
      return Boolean(f.serverAddress && f.enginePath && f.keyName && f.certAuthMountPath && f.certAuthRoleName);
    }
    if (rkProvider === 'AWS') {
      const f = rkAwsFields;
      return Boolean(f.region && f.keyUri && f.roleArn && f.accessKeyId && f.secretAccessKey);
    }
    const f = rkAzureFields;
    return Boolean(f.vaultUrl && f.keyName && f.tenantId && f.clientId);
  }, [rkName, rkProvider, rkObFields, rkAwsFields, rkAzureFields]);

  const handleCreateRootKey = async () => {
    if (!canManageL1 || !rkValid || rkNameTaken) return;
    if (!accountName) {
      setError('Cannot determine account name for tenantNameRef.');
      return;
    }
    setRkBusy(true);
    try {
      const target = { namespace: accountNamespace, name: rkName, tenantNameRef: accountName };
      if (rkProvider === 'OpenBao') {
        await createOpenBaoRootKey(accountClient, { ...target, ...rkObFields });
      } else if (rkProvider === 'AWS') {
        await createAWSRootKey(accountClient, {
          ...target,
          region: rkAwsFields.region.trim(),
          keyUri: rkAwsFields.keyUri.trim(),
          roleArn: rkAwsFields.roleArn.trim(),
          accessKeyId: rkAwsFields.accessKeyId.trim(),
          secretAccessKey: rkAwsFields.secretAccessKey.trim()
        });
      } else {
        await createAzureRootKey(accountClient, {
          ...target,
          vaultUrl: rkAzureFields.vaultUrl,
          keyName: rkAzureFields.keyName,
          azureTenantId: rkAzureFields.tenantId,
          clientId: rkAzureFields.clientId
        });
      }
      if (accountClient.signal?.aborted) return;
      setRkOpen(false);
      setSuccess(`Root Key "${rkName}" added.`);
      await reload();
    } catch (err) {
      if (accountClient.signal?.aborted) return;
      setError(`Add Root Key failed: ${(err as Error).message}`);
    } finally {
      setRkAwsFields((f) => ({ ...f, accessKeyId: '', secretAccessKey: '' }));
      if (accountClient.signal?.aborted) return;
      setRkBusy(false);
    }
  };

  /* ---------------------------- Domain key handlers ----------------------- */

  const dkNamespace = resourceNamespace ?? accountNamespace;

  const openDkDialog = () => {
    setDkEditing(null);
    if (resourceNamespace) {
      const scope = namespaceDomainKey(domainKeysIn(resourceNamespace)) ? 'Instance' : 'Namespace';
      setDkScope(scope);
      setDkName(scope === 'Namespace' ? resourceNamespace : '');
    } else {
      setDkScope('System');
      setDkName('');
    }
    setDkPrimaryId('');
    setDkOpen(true);
  };

  const changeDkScope = (scope: DomainKeyScope) => {
    setDkScope(scope);
    setDkName((name) => {
      if (scope === 'Instance' && name === dkNamespace) return '';
      if (scope === 'Namespace' && name === '') return dkNamespace;
      return name;
    });
  };

  const openDkEditDialog = (dk: DomainKey) => {
    setDkEditing(dk);
    setDkName(dk.metadata.name);
    const p = linkedRootKeyRef(dk);
    setDkPrimaryId(p ? rootRefId(p, domainKeyNamespace(dk)) : '');
    setDkOpen(true);
  };

  const dkValid = RFC_1123.test(dkName);

  const parseRootKeyId = (id: string): { kind: string; namespace: string; name: string } | null => {
    const parts = id.split('/');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return { kind: parts[0], namespace: parts[1], name: parts[2] };
  };

  const handleCreateDomainKey = async () => {
    if (!accountName) {
      setError('Cannot determine account name for tenantNameRef.');
      return;
    }
    const rootKey = (dkEditing ? parseRootKeyId(dkPrimaryId) : null) ?? undefined;
    if (!dkValid) return;
    setDkBusy(true);
    try {
      if (dkEditing) {
        const target = { namespace: domainKeyNamespace(dkEditing), name: dkEditing.metadata.name };
        const linked = linkedRootKeyRef(dkEditing);
        if (rootKey) {
          await linkDomainKeyRoot(accountClient, { ...target, rootKey });
          if (accountClient.signal?.aborted) return;
        } else if (linked) {
          await unlinkDomainKeyRoot(accountClient, { ...target, rootKey: linked });
          if (accountClient.signal?.aborted) return;
        }
        setDkOpen(false);
        setDkEditing(null);
        setSuccess(`Domain Key "${dkEditing.metadata.name}" updated.`);
        setDkName('');
        await reload();
        return;
      }
      await createDomainKey(accountClient, {
        namespace: dkNamespace,
        name: dkName,
        // Namespace is the CRD default, so it is left out for a gateway that serves the schema without scope.
        scope: dkScope === 'Namespace' ? undefined : dkScope,
        tenantNameRef: accountName,
        primaryRootKey: rootKey
      });
      if (accountClient.signal?.aborted) return;
      setDkOpen(false);
      setSuccess(`Domain Key "${dkName}" created.`);
      setDkName('');
      await reload();
    } catch (err) {
      if (accountClient.signal?.aborted) return;
      setError(`${dkEditing ? 'Update' : 'Create'} Domain Key failed: ${(err as Error).message}`);
    } finally {
      if (accountClient.signal?.aborted) return;
      setDkBusy(false);
    }
  };

  /* ------------------------------ DEK handlers ---------------------------- */

  const openDekDialog = (sk: ServiceKey) => {
    setDekParent(sk);
    setDekName('');
    setDekOpen(true);
  };

  const handleCreateDek = async () => {
    if (!dekParent?.metadata.namespace) return;
    if (!RFC_1123.test(dekName)) {
      setError('Name must be a valid RFC 1123 label (lowercase, dashes, digits).');
      return;
    }
    if (!accountName) {
      setError('Cannot determine account name for tenantNameRef.');
      return;
    }
    setDekBusy(true);
    try {
      await createDataEncryptionKey(accountClient, {
        namespace: dekParent.metadata.namespace,
        name: dekName,
        tenantNameRef: accountName,
        serviceKeyRef: dekParent.metadata.name
      });
      if (accountClient.signal?.aborted) return;
      setDekOpen(false);
      setSuccess(`Data Key "${dekName}" created under ${dekParent.metadata.name}.`);
      setDekName('');
      await reload();
    } catch (err) {
      if (accountClient.signal?.aborted) return;
      setError(`Create Data Key failed: ${(err as Error).message}`);
    } finally {
      if (accountClient.signal?.aborted) return;
      setDekBusy(false);
    }
  };

  /* ------------------------------ Delete handler -------------------------- */

  const targetNamespaceOf = (target: DeleteTarget): string | null => {
    if (target.kind === 'RootKey') return rootKeyNamespace(target.rootKey);
    if (target.kind === 'DomainKey') return target.namespace;
    return target.namespace;
  };

  const rootKeyDependents = useCallback((rk: RootKey): DependentWarning | null => {
    if (resourceNamespace) return { kindLabel: 'Domain Key', names: [], unknown: true };
    const matches = (ref: { kind: string; namespace?: string; name: string }, dk: DomainKey) =>
      ref.kind === rk.kind && (ref.namespace || domainKeyNamespace(dk)) === rootKeyNamespace(rk) &&
      ref.name === rk.metadata.name;
    const refs = domainKeys.filter((dk) => {
      const primary = dk.spec.primaryRootKeyRef;
      return (primary && matches(primary, dk)) || (dk.spec.fallbackRootKeyRefs ?? []).some((ref) => matches(ref, dk));
    });
    return refs.length > 0 ? { kindLabel: 'Domain Key', names: refs.map((d) => d.metadata.name) } : null;
  }, [domainKeyNamespace, domainKeys, resourceNamespace, rootKeyNamespace]);

  const deleteDependents = useMemo<DependentWarning | null>(() => {
    if (!confirmDelete) return null;
    if (confirmDelete.kind === 'RootKey') return rootKeyDependents(confirmDelete.rootKey);
    if (confirmDelete.kind === 'DomainKey') {
      const refs = serviceKeys.filter(
        (sk) => sk.spec.domainKeyRef === confirmDelete.name && parentNamespace(sk) === confirmDelete.namespace
      );
      return refs.length > 0 ? { kindLabel: 'Service Key', names: refs.map((s) => s.metadata.name) } : null;
    }
    if (confirmDelete.kind === 'ServiceKey') {
      const refs = dataEncryptionKeys.filter((d) => d.spec.serviceKeyRef === confirmDelete.name && d.metadata.namespace === confirmDelete.namespace);
      return refs.length > 0
        ? { kindLabel: 'Data Key', names: refs.map((d) => d.metadata.name) }
        : null;
    }
    return null;
  }, [confirmDelete, dataEncryptionKeys, rootKeyDependents, serviceKeys]);

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === 'RootKey' && !canDeleteRoot(confirmDelete.rootKey)) return;
    const targetName =
      confirmDelete.kind === 'RootKey'
        ? confirmDelete.rootKey.metadata.name
        : confirmDelete.name;
    const targetNamespace = targetNamespaceOf(confirmDelete);
    if (!targetNamespace) return;
    setPendingAction({ target: confirmDelete.kind, name: targetName, namespace: targetNamespace, kind: 'delete' });
    try {
      if (confirmDelete.kind === 'RootKey') {
        await deleteRootKey(accountClient, confirmDelete.rootKey.kind, targetNamespace, targetName);
        if (accountClient.signal?.aborted) return;
      } else if (confirmDelete.kind === 'DomainKey') {
        await deleteDomainKey(accountClient, targetNamespace, targetName);
        if (accountClient.signal?.aborted) return;
      } else if (confirmDelete.kind === 'ServiceKey') {
        await deleteServiceKey(accountClient, targetNamespace, targetName);
        if (accountClient.signal?.aborted) return;
      } else {
        await deleteDataEncryptionKey(accountClient, targetNamespace, targetName);
        if (accountClient.signal?.aborted) return;
      }
      setConfirmDelete(null);
      setSuccess(`${deleteKindLabel(confirmDelete.kind)} "${targetName}" is being deleted.`);
      await reload();
    } catch (err) {
      if (accountClient.signal?.aborted) return;
      setError(`Delete failed: ${(err as Error).message}`);
    } finally {
      if (accountClient.signal?.aborted) return;
      setPendingAction(null);
    }
  };

  const deleteLabel = confirmDelete ? deleteKindLabel(confirmDelete.kind) : '';
  const deleteTargetName =
    confirmDelete?.kind === 'RootKey'
      ? confirmDelete.rootKey.metadata.name
      : confirmDelete?.name ?? '';
  const deleteBlockedMessage = (() => {
    if (!deleteDependents) return '';
    if (deleteDependents.unknown) return 'To delete a Root Key, select all namespaces.';
    const count = deleteDependents.names.length;
    const keys = `${count} ${count === 1 ? deleteDependents.kindLabel : `${deleteDependents.kindLabel}s`}`;
    const them = count === 1 ? 'it' : 'them';
    return confirmDelete?.kind === 'RootKey'
      ? `${deleteTargetName} is linked to ${keys}. Unlink or delete ${them} first.`
      : `${deleteTargetName} still has ${keys}. Delete ${them} first.`;
  })();

  /* ---------------------------- Lifecycle handlers ----------------------- */

  // Dependents that would also be deactivated if we deactivate the target.
  // Same computation as deleteDependents but driven off the deactivate target.
  const deactivateDependents = useMemo<DependentWarning | null>(() => {
    if (!confirmDeactivate) return null;
    if (confirmDeactivate.kind === 'RootKey') return rootKeyDependents(confirmDeactivate.rootKey);
    if (confirmDeactivate.kind === 'DomainKey') {
      const refs = serviceKeys.filter(
        (sk) =>
          sk.spec.domainKeyRef === confirmDeactivate.name && parentNamespace(sk) === confirmDeactivate.namespace
      );
      return refs.length > 0 ? { kindLabel: 'Service Key', names: refs.map((s) => s.metadata.name) } : null;
    }
    if (confirmDeactivate.kind === 'ServiceKey') {
      const refs = dataEncryptionKeys.filter((d) => d.spec.serviceKeyRef === confirmDeactivate.name && d.metadata.namespace === confirmDeactivate.namespace);
      return refs.length > 0
        ? { kindLabel: 'Data Key', names: refs.map((d) => d.metadata.name) }
        : null;
    }
    return null;
  }, [confirmDeactivate, dataEncryptionKeys, rootKeyDependents, serviceKeys]);

  const setLifecycleFor = async (
    target: DeleteTarget,
    desired: DesiredLifecycle
  ): Promise<void> => {
    if (target.kind === 'RootKey' && !canOperateRoot(target.rootKey)) return;
    const targetName =
      target.kind === 'RootKey' ? target.rootKey.metadata.name : target.name;
    const targetNamespace = targetNamespaceOf(target);
    if (!targetNamespace) return;
    setPendingAction({ target: target.kind, name: targetName, namespace: targetNamespace, kind: 'lifecycle' });
    try {
      if (target.kind === 'RootKey') {
        await setRootKeyLifecycle(accountClient, target.rootKey.kind, targetNamespace, targetName, desired);
        if (accountClient.signal?.aborted) return;
      } else if (target.kind === 'DomainKey') {
        await setDomainKeyLifecycle(accountClient, targetNamespace, targetName, desired);
        if (accountClient.signal?.aborted) return;
      } else if (target.kind === 'ServiceKey') {
        await setServiceKeyLifecycle(accountClient, targetNamespace, targetName, desired);
        if (accountClient.signal?.aborted) return;
      } else {
        await setDataEncryptionKeyLifecycle(accountClient, targetNamespace, targetName, desired);
        if (accountClient.signal?.aborted) return;
      }
      setSuccess(`${deleteKindLabel(target.kind)} "${targetName}" ${desired === 'Active' ? 'activated' : 'deactivated'}.`);
      await reload();
    } catch (err) {
      if (accountClient.signal?.aborted) return;
      setError(`${desired === 'Active' ? 'Activate' : 'Deactivate'} failed: ${(err as Error).message}`);
    } finally {
      if (accountClient.signal?.aborted) return;
      setPendingAction(null);
    }
  };

  const handleLifecycleToggle = async (target: DeleteTarget, currentState?: string) => {
    if (target.kind === 'RootKey' && !canOperateRoot(target.rootKey)) return;
    const next = lifecycleActionLabel(currentState);
    if (next === 'Activate') {
      await setLifecycleFor(target, 'Active');
      if (accountClient.signal?.aborted) return;
    } else if (next === 'Deactivate') {
      setConfirmDeactivate(target);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivate) return;
    const target = confirmDeactivate;
    setConfirmDeactivate(null);
    await setLifecycleFor(target, 'Deactivated');
    if (accountClient.signal?.aborted) return;
  };

  /* --------------------------------- Render ------------------------------- */

  if (ctx.openkcmPage === 'l1-key-managers') return <L1KeyManagers ctx={ctx} allowed={canManageL1Roles} />;

  if (ctx.source === 'pending') {
    return (
      <FlexBox
        direction={FlexBoxDirection.Column}
        alignItems={FlexBoxAlignItems.Center}
        justifyContent={FlexBoxJustifyContent.Center}
        style={{ height: '100vh', gap: '0.75rem' }}
      >
        <BusyIndicator active size="L" />
        <span>Waiting for portal context…</span>
      </FlexBox>
    );
  }

  if (!ctx.graphqlUrl || !ctx.workspacePath) {
    return (
      <IllustratedMessage
        name="UnableToLoad"
        titleText="No GraphQL gateway"
        subtitleText="The portal did not provide crdGatewayApiUrl in the Luigi context."
      />
    );
  }

  const canCreateDk = Boolean(accountName);
  const canCreateSk = mintable.length > 0;

  const busyActionFor = (target: DeleteTarget['kind'], name: string, namespace?: string): BusyActionKind =>
    pendingAction?.target === target &&
    pendingAction.name === name &&
    (!namespace || pendingAction.namespace === namespace)
      ? pendingAction.kind
      : null;

  const dkRootKeyOptions = activeRootKeys;

  const dkNamespaceKey = namespaceDomainKey(domainKeysIn(dkNamespace));

  const dkDialogScope = dkEditing ? domainKeyScope(dkEditing) : dkScope;

  // Account level creates System keys only; namespace level creates Namespace and Instance ones.
  const dkScopeAllowed = (scope: DomainKeyScope) =>
    scope === 'System'
      ? !resourceNamespace
      : Boolean(resourceNamespace) && !(scope === 'Namespace' && dkNamespaceKey);

  const allSectionsCollapsed = SECTION_TIERS.every((tier) => collapsedSections[tier]);
  const applyCollapsedSections = (sections: Record<SectionTier, boolean>) => {
    setCollapsedSections(sections);
    writeCollapsedSections(sections);
  };
  const toggleSection = (tier: SectionTier) =>
    applyCollapsedSections({ ...collapsedSections, [tier]: !collapsedSections[tier] });
  const toggleAllSections = () =>
    applyCollapsedSections({ L1: !allSectionsCollapsed, L2: !allSectionsCollapsed, L3: !allSectionsCollapsed });

  const namespaceLabelFor = (namespace?: string) =>
    !resourceNamespace && namespace && namespace !== accountNamespace ? namespace : undefined;

  const renderDomainKeyCard = (dk: DomainKey) => {
    const namespace = domainKeyNamespace(dk);
    return (
      <DomainKeyCard
        key={`${namespace}/${dk.metadata.name}`}
        domainKey={dk}
        namespace={namespace}
        namespaceLabel={namespaceLabelFor(namespace)}
        servedBy={serviceKeyOn(dk, serviceKeys)?.metadata.name}
        rootKeys={rootKeys}
        accountNamespace={accountNamespace}
        busyAction={busyActionFor('DomainKey', dk.metadata.name, namespace)}
        onEditDk={() => openDkEditDialog(dk)}
        onLifecycleToggleDk={() =>
          handleLifecycleToggle(
            { kind: 'DomainKey', name: dk.metadata.name, namespace },
            keyLifecycle(dk)
          )
        }
        onDetailDk={() => { void navigateToDomainKey(dk.metadata.name, namespace, accountClient.signal).catch((error) => { if (!accountClient.signal?.aborted) setError(error.message); }); }}
        onDeleteDk={() => setConfirmDelete({ kind: 'DomainKey', name: dk.metadata.name, namespace })}
        readOnly={Boolean(resourceNamespace) && namespace !== resourceNamespace}
      />
    );
  };

  const createDkButton = (
    <Button design="Transparent" icon="sys-add" disabled={!canCreateDk} onClick={openDkDialog}>
      Create Domain Key
    </Button>
  );

  const domainKeyNamespaces = [...new Set(domainKeys.map(domainKeyNamespace))].sort();

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ height: '100vh' }}>
      <header className="app-header">
        <div className="app-header-inner page-width">
          <span className="app-title">OpenKCM</span>
          <span className="app-subtitle">
            Account key management
          </span>
        </div>
      </header>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '1.25rem 1.5rem',
          background: 'var(--sapBackgroundColor)'
        }}
      >
        <FlexBox
          direction={FlexBoxDirection.Column}
          className="page page-width"
          style={{
            gap: 'var(--page-gap)',
            '--page-gap': '1.25rem',
            '--collapse-ms': `${COLLAPSE_MS}ms`
          } as React.CSSProperties}
          data-ui5-compact-size
        >
          <AccountHeader
            tenant={tenant}
            path={ctx.workspacePath}
            rootKeys={visibleRootKeys}
            domainKeys={domainKeys}
            serviceKeys={serviceKeys}
            dataEncryptionKeys={dataEncryptionKeys}
          />

          {error && (
            <MessageStrip design="Negative" onClose={() => setError(null)}>
              {error}
            </MessageStrip>
          )}
          {loading && (
            <FlexBox justifyContent={FlexBoxJustifyContent.Center} style={{ padding: '2rem' }}>
              <BusyIndicator active size="M" />
            </FlexBox>
          )}

          {showOnboarding && (
            <OnboardingCard
              step1={step1State}
              step2={step2State}
              step3={step3State}
              pendingRootKeyName={pendingRootKey?.metadata.name}
              pendingDomainKeyName={pendingDomainKey?.metadata.name}
              pendingServiceKeyName={pendingServiceKey?.metadata.name}
              canAddDomainKey={canCreateDk}
              canAddServiceKey={canCreateSk}
              onAddDomainKey={() => openDkDialog()}
              onAddServiceKey={openSkDialog}
            />
          )}

          {!loading && (
            <section className="keys-box" aria-label="Keys">
              <div className="keys-box-header">
                <Button
                  design="Transparent"
                  icon={allSectionsCollapsed ? 'expand-all' : 'collapse-all'}
                  onClick={toggleAllSections}
                >
                  {allSectionsCollapsed ? 'Expand all' : 'Collapse all'}
                </Button>
              </div>
              <SectionHeader
                tier="L1"
                count={visibleRootKeys.length}
                collapsed={collapsedSections.L1}
                onToggle={() => toggleSection('L1')}
                rightContent={canManageL1 ? (
                  <Button design="Transparent" icon="sys-add" onClick={openRkCreateDialog}>
                    Add Root Key
                  </Button>
                ) : undefined}
              />
              <Collapse open={!collapsedSections.L1} offset="var(--page-gap)">
                {visibleRootKeys.length === 0 ? (
                  <MessageStrip design="Information" hideCloseButton>
                    No Root Keys yet.
                  </MessageStrip>
                ) : (
                  <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.75rem' }}>
                    {visibleRootKeys.map((rk) => (
                      <RootKeyCard
                        key={rootKeyId(rk)}
                        rk={rk}
                        canManage={canManageL1}
                        busyAction={busyActionFor('RootKey', rk.metadata.name)}
                        onLifecycleToggle={() =>
                          handleLifecycleToggle({ kind: 'RootKey', rootKey: rk }, keyLifecycle(rk))
                        }
                        onDelete={() => setConfirmDelete({ kind: 'RootKey', rootKey: rk })}
                      />
                    ))}
                  </FlexBox>
                )}
              </Collapse>

              <SectionHeader tier="L2" count={domainKeys.length} collapsed={collapsedSections.L2} onToggle={() => toggleSection('L2')} rightContent={createDkButton} />
              <Collapse open={!collapsedSections.L2} offset="var(--page-gap)">
                {domainKeys.length === 0 ? (
                  <MessageStrip design="Information" hideCloseButton>
                    No Domain Keys yet.
                  </MessageStrip>
                ) : (
                  <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.75rem' }}>
                    {domainKeyNamespaces.flatMap((namespace) => orderedDomainKeys(domainKeysIn(namespace))).map(renderDomainKeyCard)}
                  </FlexBox>
                )}
              </Collapse>

              <SectionHeader
                tier="L3"
                count={serviceKeys.length}
                collapsed={collapsedSections.L3}
                onToggle={() => toggleSection('L3')}
                rightContent={
                  resourceNamespace ? (
                    <Button design="Transparent" icon="sys-add" disabled={!canCreateSk} onClick={openSkDialog}>
                      Mint Service Key
                    </Button>
                  ) : (
                    <span className="muted">Select a namespace to mint Service Keys.</span>
                  )
                }
              />
              <Collapse open={!collapsedSections.L3} offset="var(--page-gap)">
                {serviceKeys.length === 0 ? (
                  <MessageStrip design={canCreateSk ? 'Information' : 'Critical'} hideCloseButton>
                    {canCreateSk ? 'No Service Keys yet.' : 'Waiting for an Active Domain Key.'}
                  </MessageStrip>
                ) : (
                  <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.75rem' }}>
                    {serviceKeys.map((sk) => (
                      <ServiceKeyCard
                        key={`${sk.metadata.namespace}/${sk.metadata.name}`}
                        sk={sk}
                        namespaceLabel={namespaceLabelFor(sk.metadata.namespace)}
                        parent={domainKeys.find((dk) => dk.metadata.name === sk.spec.domainKeyRef && dk.metadata.namespace === parentNamespace(sk))}
                        deks={dataEncryptionKeys.filter((dek) => dek.spec.serviceKeyRef === sk.metadata.name && dek.metadata.namespace === sk.metadata.namespace)}
                        busyAction={busyActionFor('ServiceKey', sk.metadata.name, sk.metadata.namespace)}
                        onDelete={() => setConfirmDelete({ kind: 'ServiceKey', name: sk.metadata.name, namespace: sk.metadata.namespace! })}
                        onLifecycleToggle={() =>
                          handleLifecycleToggle(
                            { kind: 'ServiceKey', name: sk.metadata.name, namespace: sk.metadata.namespace! },
                            keyLifecycle(sk)
                          )
                        }
                        onAddDek={() => openDekDialog(sk)}
                        onDeleteDek={(dek) => setConfirmDelete({ kind: 'DEK', name: dek.metadata.name, namespace: dek.metadata.namespace! })}
                        onDekLifecycleToggle={(dek) =>
                          handleLifecycleToggle(
                            { kind: 'DEK', name: dek.metadata.name, namespace: dek.metadata.namespace! },
                            keyLifecycle(dek)
                          )
                        }
                        busyDekActionFor={(name) => busyActionFor('DEK', name)}
                        canAddDek={keyLifecycle(sk) === 'Active'}
                      />
                    ))}
                  </FlexBox>
                )}
              </Collapse>
            </section>
          )}
        </FlexBox>
      </div>

      <Toast open={Boolean(success)} onClose={() => setSuccess(null)}>
        {success}
      </Toast>

      {/* Root Key dialog */}
      <Dialog
        open={rkOpen && canManageL1}
        headerText="Add Root Key"
        onClose={closeRkDialog}
        footer={
          <Bar
            design="Footer"
            endContent={
              <>
                <Button design="Transparent" onClick={closeRkDialog}>
                  Cancel
                </Button>
                <Button
                  design="Emphasized"
                  disabled={rkBusy || !rkValid || rkNameTaken}
                  onClick={handleCreateRootKey}
                >
                  {rkBusy ? 'Adding…' : 'Add'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox
          direction={FlexBoxDirection.Column}
          style={{
            gap: '1rem',
            width: ROOT_KEY_DIALOG_WIDTH,
            minHeight: ROOT_KEY_FORM_MIN_HEIGHT,
            padding: '0.5rem 0'
          }}
        >
          <FieldGroup title="Provider & Name">
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label required>Provider</Label>
              <SegmentedButton
                onSelectionChange={(e) => {
                  const value = (e.detail.selectedItems[0] as HTMLElement | undefined)?.dataset.value;
                  const entry = ROOT_KEY_PROVIDERS.find((item) => item.provider === value);
                  if (entry) setRkProvider(entry.provider);
                }}
              >
                {ROOT_KEY_PROVIDERS.map(({ provider }) => (
                  <SegmentedButtonItem key={provider} data-value={provider} selected={rkProvider === provider}>
                    {provider}
                  </SegmentedButtonItem>
                ))}
              </SegmentedButton>
            </FlexBox>
            <FormField
              id="rk-name"
              label="Name"
              required
              hint={rkNameTaken ? 'This name is taken.' : NAME_HINT}
              placeholder="eu-central-prod"
              value={rkName}
              onChange={setRkName}
            />
          </FieldGroup>

          {rkProvider === 'OpenBao' && (
            <>
              <FieldGroup title="Transit Engine">
                <FormField
                  label="Server address"
                  required
                  placeholder="https://openbao.example.com:8200"
                  value={rkObFields.serverAddress}
                  onChange={(v) => setRkObFields({ ...rkObFields, serverAddress: v })}
                />
                <FormField
                  label="Engine path"
                  required
                  hint="The mount path of the Transit secrets engine."
                  placeholder="transit"
                  value={rkObFields.enginePath}
                  onChange={(v) => setRkObFields({ ...rkObFields, enginePath: v })}
                />
                <FormField
                  label="Key name"
                  required
                  hint="Existing Transit key name to wrap with."
                  placeholder="openkcm-l1-root"
                  value={rkObFields.keyName}
                  onChange={(v) => setRkObFields({ ...rkObFields, keyName: v })}
                />
              </FieldGroup>
              <FieldGroup title="mTLS Cert Auth">
                <FormField
                  label="Auth mount path"
                  required
                  placeholder="cert"
                  value={rkObFields.certAuthMountPath}
                  onChange={(v) => setRkObFields({ ...rkObFields, certAuthMountPath: v })}
                />
                <FormField
                  label="Role name"
                  required
                  placeholder="openkcm-tenant-role"
                  value={rkObFields.certAuthRoleName}
                  onChange={(v) => setRkObFields({ ...rkObFields, certAuthRoleName: v })}
                />
              </FieldGroup>
            </>
          )}

          {rkProvider === 'AWS' && (
            <>
              <FieldGroup title="KMS">
                <FormField
                  label="Region"
                  required
                  placeholder="eu-central-1"
                  value={rkAwsFields.region}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, region: v })}
                />
                <FormField
                  label="Key URI"
                  required
                  hint="ARN of the KMS key."
                  monospace
                  placeholder="arn:aws:kms:eu-central-1:123456789012:key/mrk-..."
                  value={rkAwsFields.keyUri}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, keyUri: v })}
                />
              </FieldGroup>
              <FieldGroup title="Access key">
                <FormField
                  label="Role ARN"
                  required
                  hint="The IAM role the access key's user assumes to reach the KMS key."
                  monospace
                  placeholder="arn:aws:iam::123456789012:role/..."
                  value={rkAwsFields.roleArn}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, roleArn: v })}
                />
                <FormField
                  label="Access key ID"
                  required
                  monospace
                  placeholder="AKIA..."
                  value={rkAwsFields.accessKeyId}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, accessKeyId: v })}
                />
                <FormField
                  label="Secret access key"
                  required
                  password
                  hint="Kept in a Secret named awsrootkey-<root key name> in this namespace, not in the root key. It is not shown again."
                  value={rkAwsFields.secretAccessKey}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, secretAccessKey: v })}
                />
              </FieldGroup>
            </>
          )}

          {rkProvider === 'Azure' && (
            <>
              <FieldGroup title="Key Vault">
                <FormField
                  label="Vault URL"
                  required
                  placeholder="https://my-vault.vault.azure.net/"
                  value={rkAzureFields.vaultUrl}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, vaultUrl: v })}
                />
                <FormField
                  label="Key name"
                  required
                  placeholder="openkcm-l1-root"
                  value={rkAzureFields.keyName}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, keyName: v })}
                />
              </FieldGroup>
              <FieldGroup title="Federated Identity">
                <FormField
                  label="Azure tenant ID"
                  required
                  monospace
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={rkAzureFields.tenantId}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, tenantId: v })}
                />
                <FormField
                  label="Client ID"
                  required
                  monospace
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={rkAzureFields.clientId}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, clientId: v })}
                />
              </FieldGroup>
            </>
          )}
        </FlexBox>
      </Dialog>

      {/* Domain Key dialog */}
      <Dialog
        open={dkOpen}
        headerText={
          dkEditing
            ? `Edit Domain Key: ${dkEditing.metadata.name}`
            : 'Create Domain Key'
        }
        onClose={() => {
          setDkOpen(false);
          setDkEditing(null);
          setDkName('');
        }}
        footer={
          <Bar
            design="Footer"
            endContent={
              <>
                <Button
                  design="Transparent"
                  onClick={() => {
                    setDkOpen(false);
                    setDkEditing(null);
                    setDkName('');
                  }}
                >
                  Cancel
                </Button>
                <Button design="Emphasized" disabled={dkBusy || !dkValid} onClick={handleCreateDomainKey}>
                  {dkBusy ? (dkEditing ? 'Saving…' : 'Creating…') : dkEditing ? 'Save' : 'Create'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', width: DIALOG_WIDTH, padding: '0.5rem 0' }}>
          <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
            <Label required>Scope</Label>
            <SegmentedButton
              onSelectionChange={(e) => {
                const value = (e.detail.selectedItems[0] as HTMLElement | undefined)?.dataset.value;
                if (!dkEditing && (value === 'Namespace' || value === 'Instance')) changeDkScope(value);
              }}
            >
              {DOMAIN_KEY_SCOPES.map((scope) => (
                <SegmentedButtonItem
                  key={scope}
                  data-value={scope}
                  selected={dkDialogScope === scope}
                  disabled={dkEditing ? dkDialogScope !== scope : !dkScopeAllowed(scope)}
                >
                  {scope}
                </SegmentedButtonItem>
              ))}
            </SegmentedButton>
            <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
              {SCOPE_HINTS[dkDialogScope]}
            </span>
            {dkEditing ? (
              <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                The scope cannot be changed after the key is created.
              </span>
            ) : (
              <>
                {dkScope !== 'System' && dkNamespaceKey && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                    Namespace is taken by {dkNamespaceKey.metadata.name}.
                  </span>
                )}
                <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                  {resourceNamespace
                    ? 'To create a System key, select all namespaces.'
                    : 'To create a Namespace or Instance key, select a namespace.'}
                </span>
              </>
            )}
          </FlexBox>
          <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
            <Label for="dk-name" required>Name</Label>
            <Input
              id="dk-name"
              value={dkName}
              readonly={Boolean(dkEditing)}
              placeholder={dkScope === 'Instance' ? 'e.g. mongodb-primary' : dkScope === 'System' ? 'e.g. shared' : `e.g. ${dkNamespace}`}
              onInput={(e) => setDkName(inputValue(e).toLowerCase())}
            />
            {!dkEditing && (
              <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>{NAME_HINT}</span>
            )}
          </FlexBox>
          <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
            <Label>Parent Root Key</Label>
            <Select disabled={!dkEditing} onChange={(e) => setDkPrimaryId(selectedValue(e))}>
              <Option data-value="" icon="broken-link" selected={dkPrimaryId === ''}>
                Not linked
              </Option>
              {(dkEditing ? dkRootKeyOptions : []).map((rk) => {
                const id = rootKeyId(rk);
                return (
                  <Option
                    key={id}
                    data-value={id}
                    icon={providerIconName(rk.kind)}
                    additionalText={rk.provider}
                    selected={dkPrimaryId === id}
                  >
                    {rk.metadata.name}
                  </Option>
                );
              })}
            </Select>
            {!dkEditing && (
              <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                Link a root key later with Edit.
              </span>
            )}
          </FlexBox>
        </FlexBox>
      </Dialog>

      {/* Service Key dialog */}
      <Dialog
        open={skOpen}
        headerText="Mint Service Key"
        onClose={() => {
          setSkOpen(false);
          setSkName('');
        }}
        footer={
          <Bar
            design="Footer"
            endContent={
              <>
                <Button
                  design="Transparent"
                  onClick={() => {
                    setSkOpen(false);
                    setSkName('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  design="Emphasized"
                  disabled={skBusy || !RFC_1123.test(skName) || !canCreateSk || !skDomainKey || !RFC_1123.test(skTargetNamespace)}
                  onClick={handleCreateServiceKey}
                >
                  {skBusy ? 'Creating…' : 'Mint'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', width: DIALOG_WIDTH, padding: '0.5rem 0' }}>
          <FormField
            id="sk-name"
            label="Name"
            required
            value={skName}
            placeholder="e.g. mongodb-primary"
            hint={NAME_HINT}
            onChange={(v) => setSkName(v.toLowerCase())}
          />
          <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
            <Label required>Parent Domain Key</Label>
            {mintable.length === 0 ? (
              <Input value="No Active Domain Key" readonly />
            ) : (
              <Select onChange={(e) => setSkDomainKeyName(selectedValue(e))}>
                {!skDomainKey && (
                  <Option data-value="" selected>
                    Pick a Domain Key
                  </Option>
                )}
                {mintable.map((dk) => (
                  <Option
                    key={`${dk.metadata.namespace}/${dk.metadata.name}`}
                    data-value={`${dk.metadata.namespace}/${dk.metadata.name}`}
                    additionalText={scopeLabel(dk)}
                    selected={skDomainKeyName === `${dk.metadata.namespace}/${dk.metadata.name}`}
                  >
                    {dk.metadata.name}
                  </Option>
                ))}
              </Select>
            )}
            {skDomainKey && (
              <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                {scopeLabel(skDomainKey)}
              </span>
            )}
          </FlexBox>
        </FlexBox>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog
        open={Boolean(confirmDelete) && (confirmDelete?.kind !== 'RootKey' || canDeleteRoot(confirmDelete.rootKey))}
        headerText={`Delete ${deleteLabel}`}
        onClose={() => setConfirmDelete(null)}
        footer={
          <Bar
            design="Footer"
            endContent={
              <>
                <Button design="Transparent" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button
                  design="Negative"
                  disabled={!confirmDelete || Boolean(deleteDependents) || pendingAction?.kind === 'delete'}
                  onClick={handleConfirmDelete}
                >
                  {pendingAction?.kind === 'delete' ? 'Deleting…' : 'Delete'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox
          direction={FlexBoxDirection.Column}
          style={{ gap: '0.75rem', width: CONFIRM_DIALOG_WIDTH, padding: '0.5rem 0' }}
        >
          {deleteDependents ? (
            <>
              <MessageStrip design="Negative" hideCloseButton>
                {deleteBlockedMessage}
              </MessageStrip>
              <FlexBox style={{ gap: 4, flexWrap: 'wrap' }}>
                {deleteDependents.names.map((n) => (
                  <Chip key={n} text={n} kind={deleteDependents.kindLabel} />
                ))}
              </FlexBox>
            </>
          ) : (
            <>
              <MessageStrip design="Critical" hideCloseButton>
                Deleting a {deleteLabel} removes it from this account. No other resources currently
                reference it.
              </MessageStrip>
              <div>
                Delete <strong>{deleteTargetName || `this ${deleteLabel}`}</strong>?
              </div>
            </>
          )}
        </FlexBox>
      </Dialog>

      {/* Confirm deactivate dialog */}
      <Dialog
        open={Boolean(confirmDeactivate) && (confirmDeactivate?.kind !== 'RootKey' || canOperateRoot(confirmDeactivate.rootKey))}
        headerText={`Deactivate ${confirmDeactivate ? deleteKindLabel(confirmDeactivate.kind) : ''}`}
        onClose={() => setConfirmDeactivate(null)}
        footer={
          <Bar
            design="Footer"
            endContent={
              <>
                <Button design="Transparent" onClick={() => setConfirmDeactivate(null)}>
                  Cancel
                </Button>
                <Button
                  design="Negative"
                  disabled={!confirmDeactivate || pendingAction?.kind === 'lifecycle'}
                  onClick={handleConfirmDeactivate}
                >
                  {pendingAction?.kind === 'lifecycle' ? 'Deactivating…' : 'Deactivate'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox
          direction={FlexBoxDirection.Column}
          style={{ gap: '0.75rem', width: CONFIRM_DIALOG_WIDTH, padding: '0.5rem 0' }}
        >
          {deactivateDependents ? (
            <MessageStrip design="Negative" hideCloseButton>
              {deactivateDependents.unknown ? (
                <>
                  Deactivating this Root Key may cascade to Domain Keys and lower-level keys in namespaces.
                </>
              ) : (
                <>
                  Deactivating this key will cascade to {deactivateDependents.names.length}{' '}
                  {deactivateDependents.names.length === 1
                    ? deactivateDependents.kindLabel
                    : `${deactivateDependents.kindLabel}s`}
                  . They will all be moved to Deactivated.
                </>
              )}
            </MessageStrip>
          ) : (
            <MessageStrip design="Critical" hideCloseButton>
              Deactivating turns the key off. You can re-activate it later.
              No downstream resources currently depend on this key.
            </MessageStrip>
          )}
          <div>
            Deactivate{' '}
            <strong>
              {confirmDeactivate?.kind === 'RootKey'
                ? confirmDeactivate.rootKey.metadata.name
                : confirmDeactivate?.name ?? ''}
            </strong>
            ?
          </div>
          {deactivateDependents && !deactivateDependents.unknown && (
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label>Will also be deactivated:</Label>
              <FlexBox style={{ gap: 4, flexWrap: 'wrap' }}>
                {deactivateDependents.names.map((n) => (
                  <Chip key={n} text={n} kind={deactivateDependents.kindLabel} />
                ))}
              </FlexBox>
            </FlexBox>
          )}
        </FlexBox>
      </Dialog>

      {/* DEK creation dialog */}
      <Dialog
        open={dekOpen}
        headerText="Add Data Key"
        onClose={() => {
          setDekOpen(false);
          setDekName('');
        }}
        footer={
          <Bar
            design="Footer"
            endContent={
              <>
                <Button
                  design="Transparent"
                  onClick={() => {
                    setDekOpen(false);
                    setDekName('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  design="Emphasized"
                  disabled={dekBusy || !RFC_1123.test(dekName) || !dekParent}
                  onClick={handleCreateDek}
                >
                  {dekBusy ? 'Creating…' : 'Create'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', width: DIALOG_WIDTH, padding: '0.5rem 0' }}>
          <FormField
            id="dek-name"
            label="Name"
            required
            value={dekName}
            placeholder={dekParent ? `e.g. ${dekParent.metadata.name}-dek` : 'e.g. workload-dek'}
            hint={NAME_HINT}
            onChange={(v) => setDekName(v.toLowerCase())}
          />
          <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
            <Label>Parent Service Key</Label>
            <Input value={dekParent?.metadata.name ?? ''} readonly />
          </FlexBox>
        </FlexBox>
      </Dialog>
    </FlexBox>
  );
};

export default App;
