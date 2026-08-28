import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BusyIndicator,
  Button,
  Card,
  CardHeader,
  CheckBox,
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
  ObjectStatus,
  Option,
  Select,
  ShellBar,
  Title
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-fiori/dist/illustrations/NoData.js';
import '@ui5/webcomponents-fiori/dist/illustrations/UnableToLoad.js';
import '@ui5/webcomponents-icons/dist/shield.js';
import '@ui5/webcomponents-icons/dist/key.js';
import '@ui5/webcomponents-icons/dist/key-user-settings.js';
import '@ui5/webcomponents-icons/dist/chain-link.js';
import '@ui5/webcomponents-icons/dist/hint.js';
import '@ui5/webcomponents-icons/dist/sys-add.js';
import '@ui5/webcomponents-icons/dist/accept.js';
import '@ui5/webcomponents-icons/dist/decline.js';
import '@ui5/webcomponents-icons/dist/edit.js';
import '@ui5/webcomponents-icons/dist/slim-arrow-down.js';
import '@ui5/webcomponents-icons/dist/slim-arrow-right.js';
import { registerIcon } from '@ui5/webcomponents-base/dist/asset-registries/Icons.js';

import {
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
  updateAWSRootKey,
  updateAzureRootKey,
  updateDomainKeyRefs,
  updateOpenBaoRootKey,
  type DesiredLifecycle,
  type KcpClientOptions,
  type RootKeyProvider
} from './lib/kcp';
import type { DataEncryptionKey, DomainKey, RootKey, ServiceKey, Tenant } from './types';

const RFC_1123 = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const shortId = (id?: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '—');

const lifecycleObjectState = (
  state?: string
): 'Positive' | 'Negative' | 'Critical' | 'None' => {
  const v = (state ?? '').toLowerCase();
  if (v === 'active') return 'Positive';
  if (v.includes('fail') || v.includes('error') || v === 'destroyed' || v === 'compromised') return 'Negative';
  if (v === 'preactive' || v === 'suspended' || v === 'deactivated' || v === 'initializing' || v === 'processing') return 'Critical';
  return 'None';
};

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

const TIER_ACCENT: Record<Tier, string> = {
  L1: 'var(--sapAccentColor1)',
  L2: 'var(--sapAccentColor3)',
  L3: 'var(--sapAccentColor5)',
  L4: 'var(--sapAccentColor7)'
};

const TIER_LABEL: Record<Tier, string> = {
  L1: 'Root Key',
  L2: 'Domain Key',
  L3: 'Service Key',
  L4: 'Data Key'
};

const TierBadge = ({ tier }: { tier: Tier }) => (
  <span
    title={`${tier} · ${TIER_LABEL[tier]}`}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '1.75rem',
      height: '1.1rem',
      padding: '0 0.4rem',
      borderRadius: '0.55rem',
      background: TIER_ACCENT[tier],
      color: '#fff',
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.05em',
      flexShrink: 0
    }}
  >
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
  monospace
}: {
  id?: string;
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monospace?: boolean;
}) => (
  <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2, minWidth: 0 }}>
    <Label for={id} required={required}>
      {label}
    </Label>
    <Input
      id={id}
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
  | { kind: 'DomainKey'; name: string }
  | { kind: 'ServiceKey'; name: string }
  | { kind: 'DEK'; name: string };

type DeactivateTarget =
  | { kind: 'RootKey'; rootKey: RootKey }
  | { kind: 'DomainKey'; name: string }
  | { kind: 'ServiceKey'; name: string }
  | { kind: 'DEK'; name: string };

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

const deleteKindLabel = (kind: DeleteTarget['kind']): string => {
  if (kind === 'RootKey') return 'Root Key';
  if (kind === 'DomainKey') return 'Domain Key';
  if (kind === 'ServiceKey') return 'Service Key';
  return 'Data Encryption Key';
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
          <ObjectStatus state={dotState} inverted>
            {activeCount}/{count} active
          </ObjectStatus>
        )}
        {pendingCount !== undefined && pendingCount > 0 && (
          <ObjectStatus state="Critical" inverted>
            {pendingCount} pending
          </ObjectStatus>
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
  const activeRoots = rootKeys.filter((r) => r.status?.cryptoState?.lifecycleState === 'Active').length;
  const activeDomains = domainKeys.filter((d) => d.status?.cryptoState?.lifecycleState === 'Active').length;
  const activeServices = serviceKeys.filter((s) => s.status?.cryptoState?.lifecycleState === 'Active').length;
  const activeDeks = dataEncryptionKeys.filter((d) => d.status?.cryptoState?.lifecycleState === 'Active').length;

  return (
    <FlexBox
      direction={FlexBoxDirection.Column}
      style={{
        background: 'var(--sapObjectHeader_Background)',
        border: '1px solid var(--sapGroup_TitleBorderColor)',
        borderRadius: 'var(--sapElement_BorderCornerRadius)',
        padding: '1rem 1.25rem',
        gap: '0.85rem'
      }}
    >
      <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <Icon name="shield" style={{ color: 'var(--sapContent_IconColor)' }} />
        <FlexBox direction={FlexBoxDirection.Column} style={{ minWidth: 0, gap: 2 }}>
          <Label style={{ color: 'var(--sapContent_LabelColor)' }}>Tenant</Label>
          <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.5rem' }}>
            <Title level="H4" style={{ margin: 0 }}>
              {tenant?.metadata.name ?? '—'}
            </Title>
            {tenantReady && (
              <ObjectStatus state={tenantReady.status === 'True' ? 'Positive' : 'Critical'} inverted>
                {tenantReady.status === 'True' ? 'Registered' : tenantReady.status}
              </ObjectStatus>
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
          borderTop: '1px solid var(--sapGroup_TitleBorderColor)'
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
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
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
        padding: '1rem 1rem 1rem calc(1rem + 4px)',
        border: `1px solid ${isNext || isInProgress ? accent : 'var(--sapGroup_TitleBorderColor)'}`,
        borderRadius: 'var(--sapElement_BorderCornerRadius)',
        boxShadow: `inset 4px 0 0 ${accent}`,
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
            background: accent,
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.75rem'
          }}
        >
          {isDone ? <Icon name="accept" style={{ width: '0.85rem', height: '0.85rem' }} /> : n}
        </span>
        <Title level="H6" style={{ margin: 0 }}>
          {title}
        </Title>
        {isInProgress && (
          <ObjectStatus state="Critical" inverted>
            in progress
          </ObjectStatus>
        )}
        {isDone && (
          <ObjectStatus state="Positive" inverted>
            done
          </ObjectStatus>
        )}
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
      <div style={{ marginTop: 'auto' }}>
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
      </div>
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
  canAddRootKey,
  canAddDomainKey,
  canAddServiceKey,
  onAddRootKey,
  onAddDomainKey,
  onAddServiceKey
}: {
  step1: StepState;
  step2: StepState;
  step3: StepState;
  pendingRootKeyName?: string;
  pendingDomainKeyName?: string;
  pendingServiceKeyName?: string;
  canAddRootKey: boolean;
  canAddDomainKey: boolean;
  canAddServiceKey: boolean;
  onAddRootKey: () => void;
  onAddDomainKey: () => void;
  onAddServiceKey: () => void;
}) => (
  <Card
    header={
      <CardHeader
        avatar={<Icon name="hint" />}
        titleText="Get started with OpenKCM"
        subtitleText="Three steps from an empty tenant to a working key hierarchy. Shown only before this namespace has keys."
      />
    }
  >
    <FlexBox style={{ padding: '0.75rem 1rem 1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
      <OnboardingStep
        n={1}
        title="Register a Root Key"
        description="Bind your KMS backend (OpenBao, AWS KMS, or Azure Key Vault). This is your L1."
        state={step1}
        actionLabel="Register Root Key"
        actionDisabled={!canAddRootKey}
        onAction={onAddRootKey}
        inProgressHint={
          pendingRootKeyName
            ? `Waiting for "${pendingRootKeyName}" to reach Active. If the config is wrong it will stay PreActive — fix it via Delete + Register again.`
            : 'Waiting for the registered Root Key to become Active.'
        }
      />
      <OnboardingStep
        n={2}
        title="Create a Domain Key"
        description="Define the single Team or BusinessUnit domain rooted at an Active L1. Exactly one Domain Key per namespace."
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
        description="Per-workload key under an Active L2. Each Service Key can have Data Encryption Keys (L4)."
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

const KvRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <FlexBox justifyContent={FlexBoxJustifyContent.SpaceBetween} alignItems={FlexBoxAlignItems.Center}>
    <Label>{label}</Label>
    <span style={{ textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {value}
    </span>
  </FlexBox>
);

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
  parentLifecycle,
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
  parentLifecycle?: string;
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
  const lifecycle = sk.status?.cryptoState?.lifecycleState ?? 'Unknown';
  const ready = conditionByType(sk.status?.conditions, 'Ready');
  const toggleLabel = lifecycleActionLabel(lifecycle);
  const blockedByParent = toggleLabel === 'Activate' && !canActivateUnderParent(parentLifecycle);
  const dekParentActive = lifecycle === 'Active';
  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex' }}>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: TIER_ACCENT.L3,
          borderTopLeftRadius: 'var(--sapElement_BorderCornerRadius)',
          borderBottomLeftRadius: 'var(--sapElement_BorderCornerRadius)',
          zIndex: 2,
          pointerEvents: 'none'
        }}
      />
      <Card
        style={{ flex: 1 }}
        header={
          <CardHeader
            avatar={<TierBadge tier="L3" />}
            titleText={sk.metadata.name}
            subtitleText={`under ${sk.spec.domainKeyRef}`}
            additionalText={lifecycle}
          />
        }
      >
        <FlexBox style={{ padding: '0.75rem 1rem', gap: '1.25rem', flexWrap: 'wrap' }}>
          {/* Left half: SK info + actions */}
          <FlexBox
            direction={FlexBoxDirection.Column}
            style={{ flex: '1 1 260px', minWidth: 0, maxWidth: 380, gap: '0.4rem' }}
          >
            <KvRow
              label="Key ID"
              value={
                <span style={{ fontFamily: 'var(--sapContent_MonospaceFontFamily)' }}>
                  {shortId(sk.status?.cryptoState?.id)}
                </span>
              }
            />
            <KvRow label="Version" value={sk.status?.cryptoState?.version ?? '—'} />
            {ready?.message && (
              <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
                {ready.message}
              </span>
            )}
            <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem', paddingTop: '0.75rem' }}>
              {toggleLabel && (
                <Button
                  design={toggleLabel === 'Activate' && !blockedByParent ? 'Emphasized' : 'Default'}
                  disabled={busyAction !== null || blockedByParent}
                  onClick={onLifecycleToggle}
                  tooltip={blockedByParent ? 'Cannot activate while the Domain Key is not Active.' : undefined}
                >
                  {busyAction === 'lifecycle' ? '…' : toggleLabel}
                </Button>
              )}
              <Button
                design="Transparent"
                disabled={busyAction !== null}
                onClick={onDelete}
              >
                {busyAction === 'delete' ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </FlexBox>
          {/* Right half: DEK list */}
          <FlexBox
            direction={FlexBoxDirection.Column}
            style={{
              flex: '2 1 380px',
              minWidth: 0,
              gap: '0.4rem',
              borderLeft:
                deks.length > 0 ? '1px solid var(--sapGroup_TitleBorderColor)' : 'none',
              paddingLeft: deks.length > 0 ? '1rem' : 0
            }}
          >
            <FlexBox
              alignItems={FlexBoxAlignItems.Center}
              justifyContent={FlexBoxJustifyContent.SpaceBetween}
              style={{ gap: '0.4rem' }}
            >
              <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.4rem' }}>
                <TierBadge tier="L4" />
                <Label>Data encryption keys ({deks.length})</Label>
              </FlexBox>
              <Button
                design="Transparent"
                icon="sys-add"
                disabled={!canAddDek}
                onClick={onAddDek}
                tooltip={canAddDek ? 'Add Data Key' : 'Service Key must be Active'}
              />
            </FlexBox>
            {deks.length === 0 ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
                {canAddDek
                  ? 'No Data Keys yet. Use + to add one.'
                  : 'Service Key is not Active yet — Data Keys can be added once it is.'}
              </span>
            ) : (
              deks.map((dek) => {
                const dekBusy = busyDekActionFor(dek.metadata.name);
                const dekToggle = lifecycleActionLabel(dek.status?.cryptoState?.lifecycleState);
                const dekBlockedByParent = dekToggle === 'Activate' && !dekParentActive;
                return (
                  <FlexBox
                    key={dek.metadata.name}
                    alignItems={FlexBoxAlignItems.Center}
                    style={{
                      gap: '0.5rem',
                      padding: '0.4rem 0.6rem',
                      border: '1px solid var(--sapGroup_TitleBorderColor)',
                      borderRadius: 'var(--sapElement_BorderCornerRadius)',
                      background: 'var(--sapList_Background)'
                    }}
                  >
                    <span
                      style={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {dek.metadata.name}
                    </span>
                    <ObjectStatus
                      state={lifecycleObjectState(dek.status?.cryptoState?.lifecycleState)}
                      inverted
                    >
                      {dek.status?.cryptoState?.lifecycleState ?? 'Unknown'}
                    </ObjectStatus>
                    {dekToggle && (
                      <Button
                        design="Transparent"
                        disabled={dekBusy !== null || dekBlockedByParent}
                        onClick={() => onDekLifecycleToggle(dek)}
                        tooltip={
                          dekBlockedByParent
                            ? 'Cannot activate while the Service Key is not Active.'
                            : dekToggle === 'Activate'
                            ? 'Activate Data Key'
                            : 'Deactivate Data Key'
                        }
                        style={{ minWidth: 0 }}
                      >
                        {dekToggle === 'Activate' ? '▶' : '⏸'}
                      </Button>
                    )}
                    <Button
                      design="Transparent"
                      icon="decline"
                      disabled={dekBusy !== null}
                      onClick={() => onDeleteDek(dek)}
                      tooltip="Delete Data Key"
                    />
                  </FlexBox>
                );
              })
            )}
          </FlexBox>
        </FlexBox>
      </Card>
    </div>
  );
};

/* ----------------------------- Provider icons ------------------------------ */

// Per-provider icon: SVG path + brand color + label. Where the brand mark is
// freely redistributable we pull from simple-icons; for trademarked marks
// (AWS, Azure) we use a recognisable simplified shape in brand colours.
type ProviderVisual = { path: string; color: string; label: string };

const PROVIDER_VISUAL: Record<RootKey['kind'], ProviderVisual> = {
  // AWS dropped from simple-icons in v9 — use a stylised cloud in the
  // signature orange. Not the trademarked AWS logo.
  AWSRootKey: {
    label: 'AWS',
    color: '#FF9900',
    path:
      'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14a6 6 0 0 0 6 6h13a5 5 0 0 0 5-5c0-2.64-2.05-4.78-4.65-4.96z'
  },
  // Azure dropped from simple-icons — use a stylised triangle ("A" shape)
  // in Azure blue.
  AzureRootKey: {
    label: 'Azure',
    color: '#0078D4',
    path:
      'M13.05 4.24 6.56 18.05 2 18l5.09-8.76 5.96-5zm.72 1.62L17.5 22H7l6.77-16.14z'
  },
  // OpenBao — official mark via simple-icons.
  OpenBaoRootKey: {
    label: 'OpenBao',
    color: '#336D5C',
    path:
      'M11.997 4.631a3 3 0 0 0-.309.02c-3.277.098-6.427 1.737-8.084 4.74a8.2 8.2 0 0 0-.99 3.117C.922 13.256 0 14.185 0 15.142c0 1.12 1.264 2.196 3.515 2.989 2.25.793 5.302 1.238 8.485 1.238s6.235-.445 8.485-1.238S24 16.263 24 15.14c0-.956-.922-1.885-2.614-2.633a8.2 8.2 0 0 0-.99-3.117c-1.657-3.003-4.807-4.642-8.084-4.74a3 3 0 0 0-.315-.02m.9 2.09.037.02c.354.198.687.488.737.547.317.38.74 1.09.74 1.473a.896.896 0 0 0 1.793 0 3.24 3.24 0 0 0-.322-1.39 7.2 7.2 0 0 1 2.945 2.886c.676 1.226.902 2.634.75 3.605-.077.486-.244.847-.419 1.046s-.32.278-.622.278H5.464c-.301 0-.447-.079-.622-.278-.175-.2-.342-.56-.419-1.046-.152-.97.074-2.38.75-3.605A7.2 7.2 0 0 1 8.118 7.37a3.24 3.24 0 0 0-.322 1.39.896.896 0 0 0 1.792 0c0-.382.424-1.093.741-1.473a3.7 3.7 0 0 1 .775-.567v2.04a.896.896 0 1 0 1.792 0zm2.141 3.523a1.38 1.38 0 0 0-1.138.61c-.21.309-.278.562.151.827.28.173.605.11.795.016.124-.06.17-.107.387-.007.439.203.695.193.948-.017.284-.236.236-.58.023-.83-.306-.359-.72-.591-1.166-.599m-6.797.017c-.445.007-.86.24-1.167.6-.213.25-.26.593.024.829.253.21.51.22.948.017.217-.1.263-.053.386.007.191.093.516.156.796-.016.429-.265.36-.519.15-.827a1.38 1.38 0 0 0-1.137-.61'
  },
  // Google Cloud — official mark via simple-icons.
  GCPRootKey: {
    label: 'GCP',
    color: '#4285F4',
    path:
      'M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.002h5.192c1.6 0 3.153-.587 4.36-1.62 2.51-2.077 2.83-5.892.638-8.366l-.014-.014-.013-.013a6.064 6.064 0 0 0-1.243-1.012l-.039-.025c-.305-3.86-3.524-6.84-7.404-6.852A6.762 6.762 0 0 0 12.19 2.38m-.002 1.836a5.082 5.082 0 0 1 4.964 4.077l.402 2.05 1.61-1.311c.288-.235.69-.387 1.13-.387 1.085 0 1.954.86 1.954 1.928 0 .738-.414 1.365-1.02 1.685-.16.05-.328.092-.5.114l-2.483-2.482-1.297 1.297 3.539 3.54a3.6 3.6 0 0 1-1.823.493h-5.221l-.038-.001-.039.001H8.785a4.9 4.9 0 0 1-2.967-.992l-.21-.158L4 17.36c-1.794-1.853-1.625-4.95.39-6.58a4.4 4.4 0 0 1 .595-.393l.504-.275.143-.555a7.5 7.5 0 0 1 .824-1.99l1.243 1.242L9 7.512 7.448 5.96a7.5 7.5 0 0 1 4.74-1.745z'
  },
  // HashiCorp Vault — official mark via simple-icons.
  VaultRootKey: {
    label: 'Vault',
    color: '#FFEC6E',
    path:
      'M7.41 0 0 12.02 7.5 24l1.16-1.838-6.32-10.142L8.5 1.846zm9.18 0-1.097 1.835 6.32 10.183-6.32 10.146L16.59 24 24 11.977zm-4.65 5.265-1.867.013L13.158 12l-3.085 6.738 1.866.012L15.042 12z'
  },
  // HSM has no provider-specific mark — a generic shield + chip glyph.
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
const providerIconName = (kind: RootKey['kind']): string =>
  `${PROVIDER_ICON_COLLECTION}/${kind.toLowerCase()}`;

(Object.keys(PROVIDER_VISUAL) as Array<RootKey['kind']>).forEach((kind) => {
  const v = PROVIDER_VISUAL[kind];
  registerIcon(kind.toLowerCase(), {
    pathData: v.path,
    collection: PROVIDER_ICON_COLLECTION,
    ltr: true
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
      <svg viewBox="0 0 24 24" width={svgPx} height={svgPx} aria-hidden focusable="false">
        <path d={v.path} fill={v.color} />
      </svg>
    </span>
  );
};

/* ----------------------------- Encryption Domain --------------------------- */

const RootKeyRow = ({
  rk,
  role,
  busyAction,
  blockedByParent,
  readOnly,
  onEdit,
  onLifecycleToggle,
  onDelete
}: {
  rk: RootKey;
  role?: 'Primary' | 'Fallback' | 'Unattached';
  busyAction: BusyActionKind;
  blockedByParent?: boolean;
  readOnly?: boolean;
  onEdit: () => void;
  onLifecycleToggle: () => void;
  onDelete: () => void;
}) => {
  const lifecycle = rk.status?.cryptoState?.lifecycleState ?? 'Unknown';
  const toggleLabel = lifecycleActionLabel(lifecycle);
  const provider = providerVisual(rk.kind);
  return (
    <FlexBox
      alignItems={FlexBoxAlignItems.Center}
      style={{
        gap: '0.6rem',
        padding: '0.55rem 0.75rem',
        border: '1px solid var(--sapGroup_TitleBorderColor)',
        borderRadius: 'var(--sapElement_BorderCornerRadius)',
        background: 'var(--sapList_Background)'
      }}
      title={role}
    >
      <ProviderIcon kind={rk.kind} size="M" />
      <FlexBox direction={FlexBoxDirection.Column} style={{ minWidth: 0, flex: '1 1 auto', gap: 2 }}>
        <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{rk.metadata.name}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
            {provider.label}
          </span>
          <ObjectStatus state={lifecycleObjectState(lifecycle)} inverted>
            {lifecycle}
          </ObjectStatus>
        </FlexBox>
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--sapContent_LabelColor)',
            fontFamily: 'var(--sapContent_MonospaceFontFamily)'
          }}
        >
          {shortId(rk.status?.cryptoState?.id)}
        </span>
      </FlexBox>
      {!readOnly && toggleLabel && (
        <Button
          design="Transparent"
          disabled={busyAction !== null || blockedByParent}
          onClick={onLifecycleToggle}
          tooltip={
            blockedByParent
              ? 'Cannot activate while no Encryption Domain references this Root Key as primary.'
              : toggleLabel === 'Activate'
              ? 'Activate Root Key'
              : 'Deactivate Root Key'
          }
        >
          {busyAction === 'lifecycle' ? '…' : toggleLabel === 'Activate' ? '▶' : '⏸'}
        </Button>
      )}
      {!readOnly && (
        <>
          <Button design="Transparent" icon="edit" disabled={busyAction !== null} onClick={onEdit} tooltip="Edit" />
          <Button design="Transparent" icon="decline" disabled={busyAction !== null} onClick={onDelete} tooltip="Delete" />
        </>
      )}
    </FlexBox>
  );
};

const EncryptionDomainCard = ({
  domainKey,
  rootKeys,
  accountNamespace,
  busyAction,
  onEditDk,
  onLifecycleToggleDk,
  onDeleteDk
}: {
  domainKey: DomainKey;
  rootKeys: RootKey[];
  accountNamespace: string;
  busyAction: BusyActionKind;
  onEditDk: () => void;
  onLifecycleToggleDk: () => void;
  onDeleteDk: () => void;
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem('openkcm.encryption-domain.collapsed') === '1';
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem('openkcm.encryption-domain.collapsed', next ? '1' : '0');
      } catch {
        // sessionStorage unavailable; ignore
      }
      return next;
    });
  };

  const lifecycle = domainKey.status?.cryptoState?.lifecycleState ?? 'Unknown';
  const ready = conditionByType(domainKey.status?.conditions, 'Ready');
  const toggleLabel = lifecycleActionLabel(lifecycle);
  const primary = domainKey.spec.primaryRootKeyRef;
  const fallbacks = domainKey.spec.fallbackRootKeyRefs ?? [];

  const domainNamespace = domainKey.metadata.namespace || accountNamespace;
  const refNamespace = (ref: { namespace?: string }) => ref.namespace || domainNamespace;
  const rootNamespace = (rk: RootKey) => rk.metadata.namespace || accountNamespace;
  const matches = (rk: RootKey, ref: { kind: string; namespace?: string; name: string }) =>
    rk.kind === ref.kind && rootNamespace(rk) === refNamespace(ref) && rk.metadata.name === ref.name;
  const primaryRk = primary ? rootKeys.find((rk) => matches(rk, primary)) : undefined;
  const fallbackRks = fallbacks
    .map((ref) => rootKeys.find((rk) => matches(rk, ref)))
    .filter((rk): rk is RootKey => Boolean(rk));

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex' }}>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: TIER_ACCENT.L2,
          borderTopLeftRadius: 'var(--sapElement_BorderCornerRadius)',
          borderBottomLeftRadius: 'var(--sapElement_BorderCornerRadius)',
          zIndex: 2,
          pointerEvents: 'none'
        }}
      />
      <Card
        style={{ flex: 1 }}
        header={
          <CardHeader
            avatar={<TierBadge tier="L2" />}
            titleText={`Encryption Domain — ${domainKey.metadata.name}`}
            subtitleText={`${domainKey.spec.type} · tenant ${domainKey.spec.tenantNameRef}`}
            additionalText={lifecycle}
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {toggleLabel && (
                  <Button
                    design={toggleLabel === 'Activate' ? 'Emphasized' : 'Default'}
                    disabled={busyAction !== null}
                    onClick={onLifecycleToggleDk}
                  >
                    {busyAction === 'lifecycle' ? '…' : toggleLabel}
                  </Button>
                )}
                <Button
                  design="Transparent"
                  icon="edit"
                  disabled={busyAction !== null}
                  onClick={onEditDk}
                  tooltip="Edit Domain Key"
                />
                <Button
                  design="Transparent"
                  icon="decline"
                  disabled={busyAction !== null}
                  onClick={onDeleteDk}
                  tooltip="Delete Domain Key"
                />
                <Button
                  design="Transparent"
                  icon={collapsed ? 'slim-arrow-right' : 'slim-arrow-down'}
                  onClick={toggleCollapsed}
                  tooltip={collapsed ? 'Expand' : 'Collapse'}
                />
              </div>
            }
          />
        }
      >
        {!collapsed && (
        <FlexBox direction={FlexBoxDirection.Column} style={{ padding: '0.75rem 1rem', gap: '0.75rem' }}>
          <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: 'var(--sapContent_MonospaceFontFamily)',
                fontSize: '0.75rem',
                color: 'var(--sapContent_LabelColor)'
              }}
            >
              {shortId(domainKey.status?.cryptoState?.id)}
            </span>
            {domainKey.status?.cryptoState?.version != null && (
              <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
                v{domainKey.status.cryptoState.version}
              </span>
            )}
          </FlexBox>
          {ready?.message && (
            <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
              {ready.message}
            </span>
          )}

          {/* Root key (L1): read-only reference; managed in the Account view */}
          <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 6, marginTop: '0.25rem' }}>
            <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.4rem' }}>
              <TierBadge tier="L1" />
              <Label>Root key</Label>
            </FlexBox>

            {primaryRk ? (
              <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
                <ProviderIcon kind={primaryRk.kind} size="S" />
                <span style={{ fontWeight: 600 }}>{primaryRk.metadata.name}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                  {providerVisual(primaryRk.kind).label}
                </span>
                <ObjectStatus
                  state={lifecycleObjectState(primaryRk.status?.cryptoState?.lifecycleState ?? 'Unknown')}
                  inverted
                >
                  {primaryRk.status?.cryptoState?.lifecycleState ?? 'Unknown'}
                </ObjectStatus>
                {fallbackRks.length > 0 && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                    +{fallbackRks.length} fallback
                  </span>
                )}
              </FlexBox>
            ) : primary ? (
              <MessageStrip design="Negative" hideCloseButton>
                Primary Root Key{' '}
                <code>
                  {primary.kind}/{primary.name}
                </code>{' '}
                is referenced but not registered.
              </MessageStrip>
            ) : rootKeys.length === 0 ? (
              <MessageStrip design="Critical" hideCloseButton>
                Not linked to a Root Key. Register one in the Account view first.
              </MessageStrip>
            ) : (
              <MessageStrip design="Critical" hideCloseButton>
                Not linked to a Root Key.{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onEditDk();
                  }}
                >
                  Edit
                </a>{' '}
                to attach one.
              </MessageStrip>
            )}

            <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
              To add or change root keys, switch to the account&apos;s OpenKCM view.
            </span>
          </FlexBox>
        </FlexBox>
        )}
      </Card>
    </div>
  );
};

/* ----------------------------------- Sections ------------------------------ */

const SectionHeader = ({
  tier,
  count,
  rightContent
}: {
  tier: Tier;
  count: number;
  rightContent?: React.ReactNode;
}) => (
  <FlexBox
    alignItems={FlexBoxAlignItems.Baseline}
    justifyContent={FlexBoxJustifyContent.SpaceBetween}
    style={{ marginTop: '0.5rem' }}
  >
    <FlexBox alignItems={FlexBoxAlignItems.Center} style={{ gap: '0.6rem' }}>
      <TierBadge tier={tier} />
      <Title level="H3" style={{ margin: 0 }}>
        {TIER_LABEL[tier]}s
      </Title>
      <span style={{ color: 'var(--sapContent_LabelColor)' }}>
        {count} {count === 1 ? 'key' : 'keys'}
      </span>
    </FlexBox>
    {rightContent}
  </FlexBox>
);

/* ------------------------------------ App ---------------------------------- */

const App = () => {
  const [ctx, setCtx] = useState<RuntimeContext>(emptyRuntimeContext);
  const [tenant, setTenant] = useState<Tenant | undefined>();
  const [rootKeys, setRootKeys] = useState<RootKey[]>([]);
  const [serviceKeys, setServiceKeys] = useState<ServiceKey[]>([]);
  const [dataEncryptionKeys, setDataEncryptionKeys] = useState<DataEncryptionKey[]>([]);
  const [domainKeys, setDomainKeys] = useState<DomainKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceKeyResourceVersion, setServiceKeyResourceVersion] = useState<string | null>(null);
  const [domainKeyResourceVersion, setDomainKeyResourceVersion] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const reloadGenerationRef = useRef(0);

  const [pendingAction, setPendingAction] = useState<{ name: string; kind: BusyActionKind } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<DeactivateTarget | null>(null);

  const [skOpen, setSkOpen] = useState(false);
  const [skBusy, setSkBusy] = useState(false);
  const [skName, setSkName] = useState('');
  const [skDomainKeyName, setSkDomainKeyName] = useState('');

  const [rkOpen, setRkOpen] = useState(false);
  const [rkBusy, setRkBusy] = useState(false);
  const [rkEditing, setRkEditing] = useState<RootKey | null>(null);
  const [rkProvider, setRkProvider] = useState<RootKeyProvider>('OpenBao');
  const [rkName, setRkName] = useState('');
  const [rkObFields, setRkObFields] = useState({
    serverAddress: 'https://openbao.internal.acme.corp:8200',
    enginePath: 'transit',
    keyName: 'krypton-l1-root',
    certAuthMountPath: 'cert',
    certAuthRoleName: 'krypton-tenant-role'
  });
  const [rkAwsFields, setRkAwsFields] = useState({
    region: 'us-east-1',
    keyUri: 'arn:aws:kms:us-east-1:123456789012:key/mrk-EXAMPLE',
    trustAnchorArn: 'arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/ta-EXAMPLE',
    profileArn: 'arn:aws:rolesanywhere:us-east-1:123456789012:profile/prof-EXAMPLE',
    roleArn: 'arn:aws:iam::123456789012:role/Krypton-Tenant-Role'
  });
  const [rkAzureFields, setRkAzureFields] = useState({
    vaultUrl: 'https://my-enterprise-vault.vault.azure.net/',
    keyName: 'openkcm-l1-root',
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '00000000-0000-0000-0000-000000000000'
  });

  const [dkOpen, setDkOpen] = useState(false);
  const [dkBusy, setDkBusy] = useState(false);
  const [dkEditing, setDkEditing] = useState<DomainKey | null>(null);
  const [dkName, setDkName] = useState('');
  const [dkType, setDkType] = useState<'Team' | 'BusinessUnit'>('Team');
  const [dkPrimaryId, setDkPrimaryId] = useState<string>('');
  const [dkFallbackIds, setDkFallbackIds] = useState<string[]>([]);

  const [dekOpen, setDekOpen] = useState(false);
  const [dekBusy, setDekBusy] = useState(false);
  const [dekName, setDekName] = useState('');
  const [dekParent, setDekParent] = useState<ServiceKey | null>(null);

  useEffect(() => subscribeToLuigi(setCtx), []);

  const accountClient: KcpClientOptions = useMemo(
    () => ({
      graphqlUrl: ctx.graphqlUrl ?? '',
      token: ctx.token,
      workspacePath: ctx.workspacePath
    }),
    [ctx.graphqlUrl, ctx.token, ctx.workspacePath]
  );

  const isNamespaceView = ctx.viewLevel === 'namespace';
  const accountNamespace = ctx.accountNamespace || 'default';
  const resourceNamespace = isNamespaceView ? ctx.namespace : null;

  const accountName = useMemo(
    () => tenant?.metadata.name ?? ctx.workspacePath?.split(':').pop() ?? '',
    [tenant, ctx.workspacePath]
  );

  useEffect(() => {
    reloadGenerationRef.current += 1;
    hasLoadedRef.current = false;
    setLoading(Boolean(ctx.graphqlUrl && (!isNamespaceView || resourceNamespace)));
    setError(null);
    setSuccess(null);
    setTenant(undefined);
    setRootKeys([]);
    setDomainKeys([]);
    setServiceKeys([]);
    setDataEncryptionKeys([]);
    setDomainKeyResourceVersion(null);
    setServiceKeyResourceVersion(null);
  }, [accountNamespace, ctx.graphqlUrl, ctx.viewLevel, ctx.workspacePath, isNamespaceView, resourceNamespace]);

  const reload = useCallback(async (options?: { background?: boolean }) => {
    if (!ctx.graphqlUrl || (isNamespaceView && !resourceNamespace)) return;
    if (options?.background && !hasLoadedRef.current) return;
    const generation = reloadGenerationRef.current;
    const initialLoad = !hasLoadedRef.current && !options?.background;
    if (initialLoad) {
      setLoading(true);
    }
    try {
      const rootNamespaces =
        isNamespaceView && resourceNamespace && resourceNamespace !== accountNamespace
          ? [accountNamespace, resourceNamespace]
          : [accountNamespace];
      const [tenants, rootLists] = await Promise.all([
        listTenants(accountClient, accountNamespace),
        Promise.all(rootNamespaces.map((namespace) => listRootKeys(accountClient, namespace)))
      ]);
      const roots = mergeRootKeys(rootLists.flat());
      const [dks, sks, deks] =
        isNamespaceView && resourceNamespace
          ? await Promise.all([
              listDomainKeys(accountClient, resourceNamespace),
              listServiceKeys(accountClient, resourceNamespace),
              listDataEncryptionKeys(accountClient, resourceNamespace)
            ])
          : [
              { items: [], resourceVersion: null },
              { items: [], resourceVersion: null },
              [] as DataEncryptionKey[]
            ];
      if (generation !== reloadGenerationRef.current) return;
      setTenant(tenants[0]);
      setDomainKeys(dks.items);
      setServiceKeys(sks.items);
      setRootKeys(roots);
      setDataEncryptionKeys(deks);
      setDomainKeyResourceVersion(dks.resourceVersion);
      setServiceKeyResourceVersion(sks.resourceVersion);
      setError(null);
    } catch (err) {
      if (generation !== reloadGenerationRef.current) return;
      setError((err as Error).message);
    } finally {
      if (generation !== reloadGenerationRef.current) return;
      hasLoadedRef.current = true;
      if (initialLoad) setLoading(false);
    }
  }, [accountClient, accountNamespace, ctx.graphqlUrl, isNamespaceView, resourceNamespace]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!ctx.graphqlUrl || (isNamespaceView && !resourceNamespace)) return;
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
    if (isNamespaceView && resourceNamespace) {
      if (resourceNamespace !== accountNamespace) {
        unsubscribers.push(subscribeRootKeys(accountClient, resourceNamespace, queueReload));
      }
      unsubscribers.push(
        subscribeServiceKeys(accountClient, resourceNamespace, serviceKeyResourceVersion, queueReload),
        subscribeDomainKeys(accountClient, resourceNamespace, domainKeyResourceVersion, queueReload),
        subscribeDataEncryptionKeys(accountClient, resourceNamespace, queueReload)
      );
    }
    return () => {
      if (reloadTimer != null) window.clearTimeout(reloadTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [
    accountClient,
    accountNamespace,
    ctx.graphqlUrl,
    domainKeyResourceVersion,
    isNamespaceView,
    reload,
    resourceNamespace,
    serviceKeyResourceVersion
  ]);

  // Auto-dismiss success after 4s
  useEffect(() => {
    if (!success) return;
    const t = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(t);
  }, [success]);

  const activeRootKeys = useMemo(
    () => rootKeys.filter((rk) => rk.status?.cryptoState?.lifecycleState === 'Active'),
    [rootKeys]
  );
  const activeDomainKeys = useMemo(
    () => domainKeys.filter((dk) => dk.status?.cryptoState?.lifecycleState === 'Active'),
    [domainKeys]
  );

  const activeServiceKeys = useMemo(
    () => serviceKeys.filter((sk) => sk.status?.cryptoState?.lifecycleState === 'Active'),
    [serviceKeys]
  );

  const step1State: StepState =
    activeRootKeys.length > 0 ? 'done' : rootKeys.length > 0 ? 'in-progress' : 'next';
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
    () => rootKeys.find((rk) => rk.status?.cryptoState?.lifecycleState !== 'Active'),
    [rootKeys]
  );
  const pendingDomainKey = useMemo(
    () => domainKeys.find((dk) => dk.status?.cryptoState?.lifecycleState !== 'Active'),
    [domainKeys]
  );
  const pendingServiceKey = useMemo(
    () => serviceKeys.find((sk) => sk.status?.cryptoState?.lifecycleState !== 'Active'),
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
  const rootRefId = useCallback(
    (ref: { kind: string; namespace?: string; name: string }, fallbackNamespace: string) =>
      `${ref.kind}/${ref.namespace || fallbackNamespace}/${ref.name}`,
    []
  );
  const domainKeyNamespace = useCallback(
    (dk: DomainKey) => dk.metadata.namespace || resourceNamespace || accountNamespace,
    [accountNamespace, resourceNamespace]
  );

  const showOnboarding =
    !loading &&
    isNamespaceView &&
    activeRootKeys.length > 0 &&
    !hasNamespaceKeyHierarchy;

  /* --------------------------- Service key handlers ----------------------- */

  const openSkDialog = () => {
    if (!isNamespaceView) return;
    setSkName('');
    setSkDomainKeyName(activeDomainKeys[0]?.metadata.name ?? '');
    setSkOpen(true);
  };

  const handleCreateServiceKey = async () => {
    if (!resourceNamespace) return;
    if (!RFC_1123.test(skName)) {
      setError('Name must be a valid RFC 1123 label (lowercase, dashes, digits).');
      return;
    }
    const dk = activeDomainKeys.find((d) => d.metadata.name === skDomainKeyName) ?? activeDomainKeys[0];
    if (!dk) {
      setError('No Active Domain Key is available for new Service Keys.');
      return;
    }
    setSkBusy(true);
    try {
      await createServiceKey(accountClient, {
        namespace: resourceNamespace,
        name: skName,
        tenantNameRef: dk.spec.tenantNameRef,
        domainKeyName: dk.metadata.name
      });
      setSkOpen(false);
      setSkName('');
      setSuccess(`Service Key "${skName}" created.`);
      await reload();
    } catch (err) {
      setError(`Create Service Key failed: ${(err as Error).message}`);
    } finally {
      setSkBusy(false);
    }
  };

  /* ----------------------------- Root key handlers ------------------------ */

  const openRkDialog = () => {
    if (ctx.viewLevel !== 'account') return;
    setRkEditing(null);
    setRkName(rootKeys.length === 0 && accountName ? `${accountName}-root` : '');
    setRkOpen(true);
  };

  const openRkEditDialog = (rk: RootKey) => {
    if (ctx.viewLevel !== 'account') return;
    setRkEditing(rk);
    setRkName(rk.metadata.name);
    if (rk.kind === 'OpenBaoRootKey') {
      setRkProvider('OpenBao');
      setRkObFields({
        serverAddress: String(rk.spec.serverAddress ?? ''),
        enginePath: String(rk.spec.enginePath ?? ''),
        keyName: String(rk.spec.keyName ?? ''),
        certAuthMountPath: String(
          ((rk.spec.certAuth as { authMountPath?: string } | undefined)?.authMountPath) ?? ''
        ),
        certAuthRoleName: String(
          ((rk.spec.certAuth as { roleName?: string } | undefined)?.roleName) ?? ''
        )
      });
    } else if (rk.kind === 'AWSRootKey') {
      setRkProvider('AWS');
      const ra =
        (rk.spec.rolesAnywhere as
          | { trustAnchorArn?: string; profileArn?: string; roleArn?: string }
          | undefined) ?? {};
      setRkAwsFields({
        region: String(rk.spec.region ?? ''),
        keyUri: String(rk.spec.keyUri ?? ''),
        trustAnchorArn: String(ra.trustAnchorArn ?? ''),
        profileArn: String(ra.profileArn ?? ''),
        roleArn: String(ra.roleArn ?? '')
      });
    } else if (rk.kind === 'AzureRootKey') {
      setRkProvider('Azure');
      const fi =
        (rk.spec.federatedIdentity as { tenantId?: string; clientId?: string } | undefined) ?? {};
      setRkAzureFields({
        vaultUrl: String(rk.spec.vaultUrl ?? ''),
        keyName: String(rk.spec.keyName ?? ''),
        tenantId: String(fi.tenantId ?? ''),
        clientId: String(fi.clientId ?? '')
      });
    }
    setRkOpen(true);
  };

  const rkValid = useMemo(() => {
    if (!RFC_1123.test(rkName)) return false;
    if (rkProvider === 'OpenBao') {
      const f = rkObFields;
      return Boolean(f.serverAddress && f.enginePath && f.keyName && f.certAuthMountPath && f.certAuthRoleName);
    }
    if (rkProvider === 'AWS') {
      const f = rkAwsFields;
      return Boolean(f.region && f.keyUri && f.trustAnchorArn && f.profileArn && f.roleArn);
    }
    const f = rkAzureFields;
    return Boolean(f.vaultUrl && f.keyName && f.tenantId && f.clientId);
  }, [rkName, rkProvider, rkObFields, rkAwsFields, rkAzureFields]);

  const handleCreateRootKey = async () => {
    if (!accountNamespace) return;
    if (!accountName) {
      setError('Cannot determine account name for tenantNameRef.');
      return;
    }
    setRkBusy(true);
    try {
      if (rkEditing) {
        // Edit mode — patch spec via update<Kind>; name + provider are immutable.
        if (rkEditing.kind === 'OpenBaoRootKey') {
          await updateOpenBaoRootKey(accountClient, {
            namespace: accountNamespace,
            name: rkEditing.metadata.name,
            ...rkObFields
          });
        } else if (rkEditing.kind === 'AWSRootKey') {
          await updateAWSRootKey(accountClient, {
            namespace: accountNamespace,
            name: rkEditing.metadata.name,
            ...rkAwsFields
          });
        } else if (rkEditing.kind === 'AzureRootKey') {
          await updateAzureRootKey(accountClient, {
            namespace: accountNamespace,
            name: rkEditing.metadata.name,
            vaultUrl: rkAzureFields.vaultUrl,
            keyName: rkAzureFields.keyName,
            azureTenantId: rkAzureFields.tenantId,
            clientId: rkAzureFields.clientId
          });
        }
        setRkOpen(false);
        setRkEditing(null);
        setSuccess(`Root Key "${rkEditing.metadata.name}" updated.`);
        setRkName('');
        await reload();
        return;
      }

      if (rkProvider === 'OpenBao') {
        await createOpenBaoRootKey(accountClient, {
          namespace: accountNamespace,
          name: rkName,
          tenantNameRef: accountName,
          ...rkObFields
        });
      } else if (rkProvider === 'AWS') {
        await createAWSRootKey(accountClient, {
          namespace: accountNamespace,
          name: rkName,
          tenantNameRef: accountName,
          ...rkAwsFields
        });
      } else {
        await createAzureRootKey(accountClient, {
          namespace: accountNamespace,
          name: rkName,
          tenantNameRef: accountName,
          vaultUrl: rkAzureFields.vaultUrl,
          keyName: rkAzureFields.keyName,
          azureTenantId: rkAzureFields.tenantId,
          clientId: rkAzureFields.clientId
        });
      }
      setRkOpen(false);
      setSuccess(`Root Key "${rkName}" submitted. It will become Active once the backend authenticates.`);
      setRkName('');
      await reload();
    } catch (err) {
      setError(`${rkEditing ? 'Update' : 'Create'} Root Key failed: ${(err as Error).message}`);
    } finally {
      setRkBusy(false);
    }
  };

  /* ---------------------------- Domain key handlers ----------------------- */

  const openDkDialog = () => {
    if (!isNamespaceView) return;
    setDkEditing(null);
    setDkName(domainKeys.length === 0 ? resourceNamespace ?? accountName : '');
    setDkType('Team');
    setDkPrimaryId(activeRootKeys[0] ? rootKeyId(activeRootKeys[0]) : '');
    setDkFallbackIds([]);
    setDkOpen(true);
  };

  const openDkEditDialog = (dk: DomainKey) => {
    if (!isNamespaceView) return;
    setDkEditing(dk);
    setDkName(dk.metadata.name);
    setDkType((dk.spec.type as 'Team' | 'BusinessUnit') || 'Team');
    const p = dk.spec.primaryRootKeyRef;
    const fallbackNamespace = domainKeyNamespace(dk);
    setDkPrimaryId(p ? rootRefId(p, fallbackNamespace) : '');
    setDkFallbackIds((dk.spec.fallbackRootKeyRefs ?? []).map((r) => rootRefId(r, fallbackNamespace)));
    setDkOpen(true);
  };

  const dkValid = useMemo(
    () => RFC_1123.test(dkName) && Boolean(dkPrimaryId),
    [dkName, dkPrimaryId]
  );

  const parseRootKeyId = (id: string): { kind: string; namespace: string; name: string } | null => {
    const parts = id.split('/');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return { kind: parts[0], namespace: parts[1], name: parts[2] };
  };

  const handleCreateDomainKey = async () => {
    if (!resourceNamespace) return;
    if (!accountName) {
      setError('Cannot determine account name for tenantNameRef.');
      return;
    }
    const primary = parseRootKeyId(dkPrimaryId);
    if (!primary) {
      setError('Pick a primary Root Key.');
      return;
    }
    const fallbacks = dkFallbackIds
      .map(parseRootKeyId)
      .filter((r): r is { kind: string; namespace: string; name: string } => r !== null);
    setDkBusy(true);
    try {
      if (dkEditing) {
        await updateDomainKeyRefs(accountClient, {
          namespace: resourceNamespace,
          name: dkEditing.metadata.name,
          primaryRootKey: primary,
          fallbackRootKeys: fallbacks
        });
        setDkOpen(false);
        setDkEditing(null);
        setSuccess(`Domain Key "${dkEditing.metadata.name}" updated.`);
        setDkName('');
        await reload();
        return;
      }
      await createDomainKey(accountClient, {
        namespace: resourceNamespace,
        name: dkName,
        type: dkType,
        tenantNameRef: accountName,
        primaryRootKey: primary,
        fallbackRootKeys: fallbacks
      });
      setDkOpen(false);
      setSuccess(`Domain Key "${dkName}" created.`);
      setDkName('');
      await reload();
    } catch (err) {
      setError(`${dkEditing ? 'Update' : 'Create'} Domain Key failed: ${(err as Error).message}`);
    } finally {
      setDkBusy(false);
    }
  };

  /* ------------------------------ DEK handlers ---------------------------- */

  const openDekDialog = (sk: ServiceKey) => {
    if (!isNamespaceView) return;
    setDekParent(sk);
    setDekName('');
    setDekOpen(true);
  };

  const handleCreateDek = async () => {
    if (!resourceNamespace || !dekParent) return;
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
        namespace: resourceNamespace,
        name: dekName,
        tenantNameRef: accountName,
        serviceKeyRef: dekParent.metadata.name
      });
      setDekOpen(false);
      setSuccess(`Data Key "${dekName}" created under ${dekParent.metadata.name}.`);
      setDekName('');
      await reload();
    } catch (err) {
      setError(`Create Data Key failed: ${(err as Error).message}`);
    } finally {
      setDekBusy(false);
    }
  };

  /* ------------------------------ Delete handler -------------------------- */

  // Compute dependents that reference the delete target.
  const deleteDependents = useMemo<DependentWarning | null>(() => {
    if (!confirmDelete) return null;
    if (confirmDelete.kind === 'RootKey') {
      if (!isNamespaceView) {
        return { kindLabel: 'Domain Key', names: [], unknown: true };
      }
      const rk = confirmDelete.rootKey;
      const refs = domainKeys.filter((dk) => {
        const p = dk.spec.primaryRootKeyRef;
        if (p && p.kind === rk.kind && (p.namespace || domainKeyNamespace(dk)) === rootKeyNamespace(rk) && p.name === rk.metadata.name) return true;
        return (dk.spec.fallbackRootKeyRefs ?? []).some(
          (f) => f.kind === rk.kind && (f.namespace || domainKeyNamespace(dk)) === rootKeyNamespace(rk) && f.name === rk.metadata.name
        );
      });
      return refs.length > 0 ? { kindLabel: 'Domain Key', names: refs.map((d) => d.metadata.name) } : null;
    }
    if (confirmDelete.kind === 'DomainKey') {
      const refs = serviceKeys.filter((sk) => sk.spec.domainKeyRef === confirmDelete.name);
      return refs.length > 0 ? { kindLabel: 'Service Key', names: refs.map((s) => s.metadata.name) } : null;
    }
    if (confirmDelete.kind === 'ServiceKey') {
      const refs = dataEncryptionKeys.filter((d) => d.spec.serviceKeyRef === confirmDelete.name);
      return refs.length > 0
        ? { kindLabel: 'Data Encryption Key', names: refs.map((d) => d.metadata.name) }
        : null;
    }
    return null;
  }, [confirmDelete, dataEncryptionKeys, domainKeyNamespace, domainKeys, isNamespaceView, rootKeyNamespace, serviceKeys]);

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const targetName =
      confirmDelete.kind === 'RootKey'
        ? confirmDelete.rootKey.metadata.name
        : confirmDelete.name;
    const targetNamespace =
      confirmDelete.kind === 'RootKey' ? rootKeyNamespace(confirmDelete.rootKey) : resourceNamespace;
    if (!targetNamespace) return;
    setPendingAction({ name: targetName, kind: 'delete' });
    try {
      if (confirmDelete.kind === 'RootKey') {
        await deleteRootKey(accountClient, confirmDelete.rootKey.kind, targetNamespace, targetName);
      } else if (confirmDelete.kind === 'DomainKey') {
        await deleteDomainKey(accountClient, targetNamespace, targetName);
      } else if (confirmDelete.kind === 'ServiceKey') {
        await deleteServiceKey(accountClient, targetNamespace, targetName);
      } else {
        await deleteDataEncryptionKey(accountClient, targetNamespace, targetName);
      }
      setConfirmDelete(null);
      setSuccess(`${deleteKindLabel(confirmDelete.kind)} "${targetName}" deleted.`);
      await reload();
    } catch (err) {
      setError(`Delete failed: ${(err as Error).message}`);
    } finally {
      setPendingAction(null);
    }
  };

  const deleteLabel = confirmDelete ? deleteKindLabel(confirmDelete.kind) : '';
  const deleteTargetName =
    confirmDelete?.kind === 'RootKey'
      ? confirmDelete.rootKey.metadata.name
      : confirmDelete?.name ?? '';

  /* ---------------------------- Lifecycle handlers ----------------------- */

  // Dependents that would also be deactivated if we deactivate the target.
  // Same computation as deleteDependents but driven off the deactivate target.
  const deactivateDependents = useMemo<DependentWarning | null>(() => {
    if (!confirmDeactivate) return null;
    if (confirmDeactivate.kind === 'RootKey') {
      if (!isNamespaceView) {
        return { kindLabel: 'Domain Key', names: [], unknown: true };
      }
      const rk = confirmDeactivate.rootKey;
      const refs = domainKeys.filter((dk) => {
        const p = dk.spec.primaryRootKeyRef;
        if (p && p.kind === rk.kind && (p.namespace || domainKeyNamespace(dk)) === rootKeyNamespace(rk) && p.name === rk.metadata.name) return true;
        return (dk.spec.fallbackRootKeyRefs ?? []).some(
          (f) => f.kind === rk.kind && (f.namespace || domainKeyNamespace(dk)) === rootKeyNamespace(rk) && f.name === rk.metadata.name
        );
      });
      return refs.length > 0 ? { kindLabel: 'Domain Key', names: refs.map((d) => d.metadata.name) } : null;
    }
    if (confirmDeactivate.kind === 'DomainKey') {
      const refs = serviceKeys.filter((sk) => sk.spec.domainKeyRef === confirmDeactivate.name);
      return refs.length > 0 ? { kindLabel: 'Service Key', names: refs.map((s) => s.metadata.name) } : null;
    }
    if (confirmDeactivate.kind === 'ServiceKey') {
      const refs = dataEncryptionKeys.filter((d) => d.spec.serviceKeyRef === confirmDeactivate.name);
      return refs.length > 0
        ? { kindLabel: 'Data Encryption Key', names: refs.map((d) => d.metadata.name) }
        : null;
    }
    return null;
  }, [confirmDeactivate, dataEncryptionKeys, domainKeyNamespace, domainKeys, isNamespaceView, rootKeyNamespace, serviceKeys]);

  const setLifecycleFor = async (
    target: DeleteTarget,
    desired: DesiredLifecycle
  ): Promise<void> => {
    const targetName =
      target.kind === 'RootKey' ? target.rootKey.metadata.name : target.name;
    const targetNamespace = target.kind === 'RootKey' ? rootKeyNamespace(target.rootKey) : resourceNamespace;
    if (!targetNamespace) return;
    setPendingAction({ name: targetName, kind: 'lifecycle' });
    try {
      if (target.kind === 'RootKey') {
        await setRootKeyLifecycle(accountClient, target.rootKey.kind, targetNamespace, targetName, desired);
      } else if (target.kind === 'DomainKey') {
        await setDomainKeyLifecycle(accountClient, targetNamespace, targetName, desired);
      } else if (target.kind === 'ServiceKey') {
        await setServiceKeyLifecycle(accountClient, targetNamespace, targetName, desired);
      } else {
        await setDataEncryptionKeyLifecycle(accountClient, targetNamespace, targetName, desired);
      }
      setSuccess(`${deleteKindLabel(target.kind)} "${targetName}" ${desired === 'Active' ? 'activated' : 'deactivated'}.`);
      await reload();
    } catch (err) {
      setError(`${desired === 'Active' ? 'Activate' : 'Deactivate'} failed: ${(err as Error).message}`);
    } finally {
      setPendingAction(null);
    }
  };

  const handleLifecycleToggle = async (target: DeleteTarget, currentState?: string) => {
    const next = lifecycleActionLabel(currentState);
    if (next === 'Activate') {
      await setLifecycleFor(target, 'Active');
    } else if (next === 'Deactivate') {
      setConfirmDeactivate(target);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivate) return;
    const target = confirmDeactivate;
    setConfirmDeactivate(null);
    await setLifecycleFor(target, 'Deactivated');
  };

  /* --------------------------------- Render ------------------------------- */

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

  if (!ctx.graphqlUrl) {
    return (
      <IllustratedMessage
        name="UnableToLoad"
        titleText="No GraphQL gateway"
        subtitleText="The portal did not provide crdGatewayApiUrl in the Luigi context."
      />
    );
  }

  const canCreateRk = ctx.viewLevel === 'account' && Boolean(accountNamespace);
  // L2 is a singleton per namespace — controller rejects a second DomainKey
  // in the same namespace. UI mirrors that limit.
  const canCreateDk =
    isNamespaceView && Boolean(resourceNamespace) && activeRootKeys.length > 0 && domainKeys.length === 0;
  const canCreateSk = isNamespaceView && Boolean(resourceNamespace) && activeDomainKeys.length > 0;

  const busyActionFor = (name: string): BusyActionKind =>
    pendingAction?.name === name ? pendingAction.kind : null;

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ height: '100vh' }}>
      <ShellBar
        primaryTitle="OpenKCM"
        secondaryTitle={isNamespaceView ? 'Namespace key management' : 'Account root keys'}
      />
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '1.25rem 1.5rem',
          background: 'var(--sapBackgroundColor)'
        }}
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1.25rem', maxWidth: 1200, margin: '0 auto' }}>
          <AccountHeader
            tenant={tenant}
            path={ctx.workspacePath}
            rootKeys={rootKeys}
            domainKeys={domainKeys}
            serviceKeys={serviceKeys}
            dataEncryptionKeys={dataEncryptionKeys}
          />

          {error && (
            <MessageStrip design="Negative" onClose={() => setError(null)}>
              {error}
            </MessageStrip>
          )}
          {success && (
            <MessageStrip design="Positive" onClose={() => setSuccess(null)}>
              {success}
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
              canAddRootKey={false}
              canAddDomainKey={canCreateDk}
              canAddServiceKey={canCreateSk}
              onAddRootKey={() => undefined}
              onAddDomainKey={openDkDialog}
              onAddServiceKey={openSkDialog}
            />
          )}

          {!loading && !isNamespaceView && (
            <>
              <SectionHeader
                tier="L1"
                count={rootKeys.length}
                rightContent={
                  <Button design="Transparent" icon="sys-add" disabled={!canCreateRk} onClick={openRkDialog}>
                    Register Root Key
                  </Button>
                }
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)', marginTop: '-0.25rem' }}>
                Shared by every namespace in this account. Domain, Service, and Data Encryption Keys live in the namespace views.
              </span>
              {rootKeys.length === 0 ? (
                <MessageStrip design="Information" hideCloseButton>
                  No account-level Root Key is registered yet.{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openRkDialog();
                    }}
                  >
                    Register Root Key
                  </a>
                </MessageStrip>
              ) : (
                <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.5rem' }}>
                  {rootKeys.map((rk) => (
                    <RootKeyRow
                      key={rootKeyId(rk)}
                      rk={rk}
                      busyAction={busyActionFor(rk.metadata.name)}
                      onEdit={() => openRkEditDialog(rk)}
                      onLifecycleToggle={() =>
                        handleLifecycleToggle(
                          { kind: 'RootKey', rootKey: rk },
                          rk.status?.cryptoState?.lifecycleState
                        )
                      }
                      onDelete={() => setConfirmDelete({ kind: 'RootKey', rootKey: rk })}
                    />
                  ))}
                </FlexBox>
              )}
            </>
          )}

          {!loading && isNamespaceView && (
            <>
              {/* L2 singleton + L1 rows combined into a single Encryption Domain card. */}
              {domainKeys.length > 0 ? (
                <EncryptionDomainCard
                  domainKey={domainKeys[0]}
                  rootKeys={rootKeys}
                  accountNamespace={accountNamespace}
                  busyAction={busyActionFor(domainKeys[0].metadata.name)}
                  onEditDk={() => openDkEditDialog(domainKeys[0])}
                  onLifecycleToggleDk={() =>
                    handleLifecycleToggle(
                      { kind: 'DomainKey', name: domainKeys[0].metadata.name },
                      domainKeys[0].status?.cryptoState?.lifecycleState
                    )
                  }
                  onDeleteDk={() => setConfirmDelete({ kind: 'DomainKey', name: domainKeys[0].metadata.name })}
                />
              ) : (
                // No Domain Key yet: just the CTA. Root keys live in the Account view.
                <MessageStrip design={canCreateDk ? 'Information' : 'Critical'} hideCloseButton>
                  {canCreateDk ? (
                    <>
                      Create the Encryption Domain for this namespace, rooted at an Active L1.{' '}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          openDkDialog();
                        }}
                      >
                        Create Encryption Domain
                      </a>
                    </>
                  ) : rootKeys.length === 0 ? (
                    'Register an account-level Root Key (Account view) before creating an Encryption Domain in this namespace.'
                  ) : (
                    'Waiting for an Active Root Key before the Encryption Domain can be created.'
                  )}
                </MessageStrip>
              )}

              {(serviceKeys.length > 0 || !showOnboarding) && (
                <>
                  <SectionHeader tier="L3" count={serviceKeys.length} />
                  {serviceKeys.length === 0 ? (
                    <MessageStrip design={canCreateSk ? 'Information' : 'Critical'} hideCloseButton>
                      {canCreateSk
                        ? 'No Service Keys yet. Mint per-workload keys under an Active L2.'
                        : 'Waiting for an Active Domain Key before a Service Key can be created.'}
                      {canCreateSk && (
                        <>
                          {' '}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              openSkDialog();
                            }}
                          >
                            Mint Service Key
                          </a>
                        </>
                      )}
                    </MessageStrip>
                  ) : (
                    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.75rem' }}>
                      {serviceKeys.map((sk) => (
                        <ServiceKeyCard
                          key={sk.metadata.name}
                          sk={sk}
                          parentLifecycle={
                            domainKeys.find((dk) => dk.metadata.name === sk.spec.domainKeyRef)
                              ?.status?.cryptoState?.lifecycleState
                          }
                          deks={dataEncryptionKeys.filter((dek) => dek.spec.serviceKeyRef === sk.metadata.name)}
                          busyAction={busyActionFor(sk.metadata.name)}
                          onDelete={() => setConfirmDelete({ kind: 'ServiceKey', name: sk.metadata.name })}
                          onLifecycleToggle={() =>
                            handleLifecycleToggle(
                              { kind: 'ServiceKey', name: sk.metadata.name },
                              sk.status?.cryptoState?.lifecycleState
                            )
                          }
                          onAddDek={() => openDekDialog(sk)}
                          onDeleteDek={(dek) => setConfirmDelete({ kind: 'DEK', name: dek.metadata.name })}
                          onDekLifecycleToggle={(dek) =>
                            handleLifecycleToggle(
                              { kind: 'DEK', name: dek.metadata.name },
                              dek.status?.cryptoState?.lifecycleState
                            )
                          }
                          busyDekActionFor={busyActionFor}
                          canAddDek={sk.status?.cryptoState?.lifecycleState === 'Active'}
                        />
                      ))}
                      <Button
                        design="Transparent"
                        icon="sys-add"
                        disabled={!canCreateSk}
                        onClick={openSkDialog}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        Mint Service Key
                      </Button>
                    </FlexBox>
                  )}
                </>
              )}
            </>
          )}
        </FlexBox>
      </div>

      {/* Root Key dialog */}
      <Dialog
        open={rkOpen}
        headerText={rkEditing ? `Edit Root Key — ${rkEditing.metadata.name}` : 'Register a Root Key'}
        onClose={() => {
          setRkOpen(false);
          setRkEditing(null);
          setRkName('');
        }}
        footer={
          <Bar
            endContent={
              <>
                <Button
                  design="Transparent"
                  onClick={() => {
                    setRkOpen(false);
                    setRkEditing(null);
                    setRkName('');
                  }}
                >
                  Cancel
                </Button>
                <Button design="Emphasized" disabled={rkBusy || !rkValid} onClick={handleCreateRootKey}>
                  {rkBusy ? (rkEditing ? 'Saving…' : 'Creating…') : rkEditing ? 'Save' : 'Register'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', minWidth: 480, padding: '0.5rem 0' }}>
          <MessageStrip design="Information" hideCloseButton>
            The Root Key represents your KMS backend (L1). Pick the provider you actually use and
            provide its connection details.
          </MessageStrip>

          <FieldGroup title="Provider & Name">
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label required>Provider</Label>
              {rkEditing ? (
                <Input value={rkProvider} readonly />
              ) : (
                <Select
                  onChange={(e) => {
                    const v = selectedValue(e);
                    if (v === 'AWS' || v === 'Azure' || v === 'OpenBao') setRkProvider(v);
                  }}
                >
                  <Option
                    data-value="OpenBao"
                    icon={providerIconName('OpenBaoRootKey')}
                    selected={rkProvider === 'OpenBao'}
                  >
                    OpenBao (Transit)
                  </Option>
                  <Option
                    data-value="AWS"
                    icon={providerIconName('AWSRootKey')}
                    selected={rkProvider === 'AWS'}
                  >
                    AWS KMS (Roles Anywhere)
                  </Option>
                  <Option
                    data-value="Azure"
                    icon={providerIconName('AzureRootKey')}
                    selected={rkProvider === 'Azure'}
                  >
                    Azure Key Vault (Federated Identity)
                  </Option>
                </Select>
              )}
            </FlexBox>
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label for="rk-name" required>Name</Label>
              <Input
                id="rk-name"
                value={rkName}
                readonly={Boolean(rkEditing)}
                placeholder={`e.g. ${accountName || 'tenant'}-root`}
                onInput={(e) => setRkName(inputValue(e).toLowerCase())}
              />
              {!rkEditing && (
                <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                  Lowercase letters, digits, dashes. Must be unique in this account namespace.
                </span>
              )}
              {rkEditing && (
                <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                  Name + provider are immutable. Delete and re-create to change them.
                </span>
              )}
            </FlexBox>
          </FieldGroup>

          {rkProvider === 'OpenBao' && (
            <>
              <FieldGroup title="Transit Engine">
                <FormField
                  label="Server address"
                  required
                  value={rkObFields.serverAddress}
                  onChange={(v) => setRkObFields({ ...rkObFields, serverAddress: v })}
                />
                <FormField
                  label="Engine path"
                  required
                  hint="The mount path of the Transit secrets engine."
                  value={rkObFields.enginePath}
                  onChange={(v) => setRkObFields({ ...rkObFields, enginePath: v })}
                />
                <FormField
                  label="Key name"
                  required
                  hint="Existing Transit key name to wrap with."
                  value={rkObFields.keyName}
                  onChange={(v) => setRkObFields({ ...rkObFields, keyName: v })}
                />
              </FieldGroup>
              <FieldGroup title="mTLS Cert Auth">
                <FormField
                  label="Auth mount path"
                  required
                  value={rkObFields.certAuthMountPath}
                  onChange={(v) => setRkObFields({ ...rkObFields, certAuthMountPath: v })}
                />
                <FormField
                  label="Role name"
                  required
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
                  value={rkAwsFields.region}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, region: v })}
                />
                <FormField
                  label="Key URI"
                  required
                  hint="ARN of the KMS key."
                  monospace
                  value={rkAwsFields.keyUri}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, keyUri: v })}
                />
              </FieldGroup>
              <FieldGroup title="Roles Anywhere (X.509 federation)">
                <FormField
                  label="Trust anchor ARN"
                  required
                  monospace
                  value={rkAwsFields.trustAnchorArn}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, trustAnchorArn: v })}
                />
                <FormField
                  label="Profile ARN"
                  required
                  monospace
                  value={rkAwsFields.profileArn}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, profileArn: v })}
                />
                <FormField
                  label="Role ARN"
                  required
                  monospace
                  value={rkAwsFields.roleArn}
                  onChange={(v) => setRkAwsFields({ ...rkAwsFields, roleArn: v })}
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
                  value={rkAzureFields.vaultUrl}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, vaultUrl: v })}
                />
                <FormField
                  label="Key name"
                  required
                  value={rkAzureFields.keyName}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, keyName: v })}
                />
              </FieldGroup>
              <FieldGroup title="Federated Identity">
                <FormField
                  label="Azure tenant ID"
                  required
                  monospace
                  value={rkAzureFields.tenantId}
                  onChange={(v) => setRkAzureFields({ ...rkAzureFields, tenantId: v })}
                />
                <FormField
                  label="Client ID"
                  required
                  monospace
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
        headerText={dkEditing ? `Edit Domain Key — ${dkEditing.metadata.name}` : 'Create a Domain Key'}
        onClose={() => {
          setDkOpen(false);
          setDkEditing(null);
          setDkName('');
        }}
        footer={
          <Bar
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
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', minWidth: 460, padding: '0.5rem 0' }}>
          <MessageStrip design="Information" hideCloseButton>
            {dkEditing
              ? 'Editing changes the primary and fallback Root Keys. Name and type are immutable — delete and re-create to change them.'
              : 'A Domain Key (L2) is bound to a primary Active Root Key. Optionally add fallback Root Keys for multi-cloud / multi-region resilience.'}
          </MessageStrip>

          <FieldGroup title="Identity">
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label for="dk-name" required>Name</Label>
              <Input
                id="dk-name"
                value={dkName}
                readonly={Boolean(dkEditing)}
                placeholder={`e.g. ${accountName || 'tenant'}`}
                onInput={(e) => setDkName(inputValue(e).toLowerCase())}
              />
              {!dkEditing && (
                <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                  Lowercase RFC 1123 label.
                </span>
              )}
            </FlexBox>
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label required>Type</Label>
              {dkEditing ? (
                <Input value={dkType} readonly />
              ) : (
                <Select
                  onChange={(e) => {
                    const v = selectedValue(e);
                    if (v === 'Team' || v === 'BusinessUnit') setDkType(v);
                  }}
                >
                  <Option data-value="Team" selected={dkType === 'Team'}>
                    Team — scoped to one engineering team
                  </Option>
                  <Option data-value="BusinessUnit" selected={dkType === 'BusinessUnit'}>
                    BusinessUnit — scoped to a broader org unit
                  </Option>
                </Select>
              )}
            </FlexBox>
          </FieldGroup>

          <FieldGroup title="Linkage">
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label required>Primary Root Key</Label>
              {activeRootKeys.length === 0 ? (
                <Input value="— no Active Root Key —" readonly />
              ) : (
                <Select onChange={(e) => setDkPrimaryId(selectedValue(e))}>
                  <Option data-value="" selected={dkPrimaryId === ''}>
                    — pick one —
                  </Option>
                  {activeRootKeys.map((rk) => {
                    const id = rootKeyId(rk);
                    return (
                      <Option
                        key={id}
                        data-value={id}
                        icon={providerIconName(rk.kind)}
                        selected={dkPrimaryId === id}
                      >
                        {rk.metadata.name} · {rk.provider}
                      </Option>
                    );
                  })}
                </Select>
              )}
            </FlexBox>
            {activeRootKeys.length > 1 && (
              <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 4 }}>
                <Label>Fallback Root Keys (optional)</Label>
                {activeRootKeys
                  .filter((rk) => rootKeyId(rk) !== dkPrimaryId)
                  .map((rk) => {
                    const id = rootKeyId(rk);
                    const checked = dkFallbackIds.includes(id);
                    return (
                      <FlexBox
                        key={id}
                        alignItems={FlexBoxAlignItems.Center}
                        style={{ gap: '0.4rem' }}
                      >
                        <CheckBox
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = (e.target as unknown as { checked: boolean }).checked;
                            setDkFallbackIds((prev) => {
                              const without = prev.filter((p) => p !== id);
                              return isChecked ? [...without, id] : without;
                            });
                          }}
                        />
                        <ProviderIcon kind={rk.kind} size="S" />
                        <span>
                          {rk.metadata.name}{' '}
                          <span style={{ color: 'var(--sapContent_LabelColor)' }}>
                            · {rk.provider}
                          </span>
                        </span>
                      </FlexBox>
                    );
                  })}
                <span style={{ fontSize: '0.7rem', color: 'var(--sapContent_LabelColor)' }}>
                  Used if the primary becomes Suspended / Deactivated / Compromised.
                </span>
              </FlexBox>
            )}
          </FieldGroup>
        </FlexBox>
      </Dialog>

      {/* Service Key dialog */}
      <Dialog
        open={skOpen}
        headerText="Mint a new Service Key"
        onClose={() => {
          setSkOpen(false);
          setSkName('');
        }}
        footer={
          <Bar
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
                  disabled={skBusy || !RFC_1123.test(skName) || !canCreateSk || !skDomainKeyName}
                  onClick={handleCreateServiceKey}
                >
                  {skBusy ? 'Creating…' : 'Mint'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', minWidth: 400, padding: '0.5rem 0' }}>
          <MessageStrip design="Information" hideCloseButton>
            The Service Key (L3) is minted under the selected Active Domain Key. Data Encryption
            Keys (L4) live under each Service Key.
          </MessageStrip>
          <FieldGroup title="Identity">
            <FormField
              id="sk-name"
              label="Name"
              required
              value={skName}
              placeholder="e.g. mongodb-primary"
              hint="Lowercase RFC 1123 label."
              onChange={(v) => setSkName(v.toLowerCase())}
            />
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label required>Domain Key</Label>
              {activeDomainKeys.length === 0 ? (
                <Input value="— no Active Domain Key —" readonly />
              ) : (
                <Select onChange={(e) => setSkDomainKeyName(selectedValue(e))}>
                  {activeDomainKeys.map((dk) => (
                    <Option
                      key={dk.metadata.name}
                      data-value={dk.metadata.name}
                      selected={skDomainKeyName === dk.metadata.name}
                    >
                      {dk.metadata.name} · {dk.spec.type}
                    </Option>
                  ))}
                </Select>
              )}
            </FlexBox>
          </FieldGroup>
        </FlexBox>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog
        open={Boolean(confirmDelete)}
        headerText={`Delete ${deleteLabel}`}
        onClose={() => setConfirmDelete(null)}
        footer={
          <Bar
            endContent={
              <>
                <Button design="Transparent" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button
                  design="Negative"
                  disabled={!confirmDelete || pendingAction?.kind === 'delete'}
                  onClick={handleConfirmDelete}
                >
                  {pendingAction?.kind === 'delete' ? 'Deleting…' : 'Delete'}
                </Button>
              </>
            }
          />
        }
      >
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.75rem', minWidth: 420, padding: '0.5rem 0' }}>
          {deleteDependents ? (
            <MessageStrip design="Negative" hideCloseButton>
              {deleteDependents.unknown ? (
                <>
                  Namespace Domain Keys are not loaded in account view. Deleting this {deleteLabel}{' '}
                  may leave namespace Domain Keys unresolved.
                </>
              ) : (
                <>
                  {deleteDependents.names.length}{' '}
                  {deleteDependents.names.length === 1
                    ? deleteDependents.kindLabel
                    : `${deleteDependents.kindLabel}s`}{' '}
                  reference this {deleteLabel}. Deleting it will leave them in an unresolved state.
                </>
              )}
            </MessageStrip>
          ) : (
            <MessageStrip design="Critical" hideCloseButton>
              Deleting a {deleteLabel} removes it from this account. No other resources currently
              reference it.
            </MessageStrip>
          )}
          <div>
            Delete <strong>{deleteTargetName || `this ${deleteLabel}`}</strong>?
          </div>
          {deleteDependents && !deleteDependents.unknown && (
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label>Will be affected:</Label>
              <FlexBox style={{ gap: 4, flexWrap: 'wrap' }}>
                {deleteDependents.names.map((n) => (
                  <Chip key={n} text={n} kind={deleteDependents.kindLabel} />
                ))}
              </FlexBox>
            </FlexBox>
          )}
        </FlexBox>
      </Dialog>

      {/* Confirm deactivate dialog */}
      <Dialog
        open={Boolean(confirmDeactivate)}
        headerText={`Deactivate ${confirmDeactivate ? deleteKindLabel(confirmDeactivate.kind) : ''}`}
        onClose={() => setConfirmDeactivate(null)}
        footer={
          <Bar
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
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '0.75rem', minWidth: 420, padding: '0.5rem 0' }}>
          {deactivateDependents ? (
            <MessageStrip design="Negative" hideCloseButton>
              {deactivateDependents.unknown ? (
                <>
                  Namespace Domain Keys are not loaded in account view. Deactivating this Root Key{' '}
                  may cascade to Domain Keys and lower-level keys in namespaces.
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
              Deactivating turns the key off via the upstream KMS. You can re-activate it later.
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
        headerText="Add a Data Encryption Key"
        onClose={() => {
          setDekOpen(false);
          setDekName('');
        }}
        footer={
          <Bar
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
        <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1rem', minWidth: 400, padding: '0.5rem 0' }}>
          <MessageStrip design="Information" hideCloseButton>
            The Data Encryption Key (L4) is derived from the parent Service Key. It is what
            workloads actually use to encrypt data.
          </MessageStrip>
          <FieldGroup title="Identity">
            <FormField
              id="dek-name"
              label="Name"
              required
              value={dekName}
              placeholder={dekParent ? `e.g. ${dekParent.metadata.name}-dek` : 'e.g. workload-dek'}
              hint="Lowercase RFC 1123 label."
              onChange={(v) => setDekName(v.toLowerCase())}
            />
            <FlexBox direction={FlexBoxDirection.Column} style={{ gap: 2 }}>
              <Label>Parent Service Key</Label>
              <Input value={dekParent?.metadata.name ?? ''} readonly />
            </FlexBox>
          </FieldGroup>
        </FlexBox>
      </Dialog>
    </FlexBox>
  );
};

export default App;
