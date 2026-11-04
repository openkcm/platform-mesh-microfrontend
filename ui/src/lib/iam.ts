import { checkL1Permission, L1_MARKER } from './l1Permission';
import type { RuntimeContext } from './luigi';

export const L1_KEY_MANAGER_ROLE = 'l1_key_manager';
export interface L1KeyManager { userId: string; email: string }
export interface L1KeyManagerPage { users: L1KeyManager[]; hasNextPage: boolean; totalCount: number }

const resourceContext = (ctx: RuntimeContext) => ({
  group: L1_MARKER.group, kind: 'L1KeyAccess',
  resource: { name: L1_MARKER.name }, accountPath: ctx.workspacePath
});

const requireIamPermission = async (ctx: RuntimeContext, signal: AbortSignal): Promise<void> => {
  if (!await checkL1Permission(ctx, signal, 'manage_iam_roles')) {
    throw new Error('IAM management permission is unavailable.');
  }
};

const iamFetch = async (ctx: RuntimeContext, query: string, variables: object, signal: AbortSignal) => {
  signal.throwIfAborted();
  if (ctx.source !== 'luigi' || !ctx.iamServiceApiUrl || !ctx.token || !ctx.workspacePath) {
    throw new Error('The portal IAM connection is unavailable.');
  }
  const response = await fetch(ctx.iamServiceApiUrl, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
    body: JSON.stringify({ query, variables })
  });
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`IAM request failed (HTTP ${response.status}).`);
  const envelope = await response.json();
  signal.throwIfAborted();
  if (envelope.errors?.length || !envelope.data) throw new Error('The IAM request failed.');
  return envelope.data;
};

export const listL1KeyManagers = async (ctx: RuntimeContext, page: number, signal: AbortSignal): Promise<L1KeyManagerPage> => {
  await requireIamPermission(ctx, signal);
  const data = await iamFetch(ctx, `query L1KeyManagers($context: ResourceContext!, $roleFilters: [String!], $page: PageInput) {
    users(context: $context, roleFilters: $roleFilters, page: $page) {
      users { user { userId email } roles { id } }
      pageInfo { hasNextPage totalCount }
    }
  }`, { context: resourceContext(ctx), roleFilters: [L1_KEY_MANAGER_ROLE], page: { limit: 10, page } }, signal);
  const connection = data.users;
  if (!Array.isArray(connection?.users) || typeof connection?.pageInfo?.hasNextPage !== 'boolean' ||
    !Number.isInteger(connection.pageInfo.totalCount) || connection.pageInfo.totalCount < connection.users.length) {
    throw new Error('The IAM member list is invalid.');
  }
  const users: L1KeyManager[] = [];
  for (const entry of connection.users) {
    if (typeof entry?.user?.userId !== 'string' || !entry.user.userId ||
      typeof entry.user.email !== 'string' || !Array.isArray(entry.roles)) {
      throw new Error('The IAM member list is invalid.');
    }
    if (entry.roles.some((role: { id?: unknown }) => role?.id === L1_KEY_MANAGER_ROLE)) users.push(entry.user);
  }
  return { users, hasNextPage: connection.pageInfo.hasNextPage, totalCount: connection.pageInfo.totalCount };
};

export const revokeL1KeyManager = async (ctx: RuntimeContext, userId: string, signal: AbortSignal): Promise<void> => {
  await requireIamPermission(ctx, signal);
  const data = await iamFetch(ctx, `mutation RevokeL1KeyManager($context: ResourceContext!, $input: RemoveRoleInput!) {
    removeRole(context: $context, input: $input) { success error wasAssigned }
  }`, { context: resourceContext(ctx), input: { userId, role: L1_KEY_MANAGER_ROLE } }, signal);
  if (data.removeRole?.success !== true || data.removeRole.error || typeof data.removeRole.wasAssigned !== 'boolean') {
    throw new Error('The IAM role could not be revoked.');
  }
};

// iam-ui v0.12.14 USER and ASSIGN_ROLES_TO_USERS; iam-service v0.19.0.
// User accepts an email despite the argument name. Null means absent from the org's IDM realm.
export const lookupL1Candidate = async (ctx: RuntimeContext, email: string, signal: AbortSignal): Promise<L1KeyManager | null> => {
  await requireIamPermission(ctx, signal);
  const data = await iamFetch(ctx, `query L1Candidate($userId: String!) {
    user(userId: $userId) { userId email }
  }`, { userId: email.trim() }, signal);
  if (data.user === null) return null;
  if (typeof data.user?.userId !== 'string' || !data.user.userId ||
    typeof data.user.email !== 'string' || data.user.email.toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error('The IAM user lookup is invalid.');
  }
  return data.user;
};

export const assignL1KeyManager = async (ctx: RuntimeContext, user: L1KeyManager, signal: AbortSignal): Promise<'added' | 'duplicate'> => {
  // Read every page so an assignment outside the visible page cannot be added again.
  for (let page = 1; ; page++) {
    const holders = await listL1KeyManagers(ctx, page, signal);
    if (holders.users.some((holder) => holder.userId === user.userId || holder.email.toLowerCase() === user.email.toLowerCase())) {
      return 'duplicate';
    }
    if (!holders.hasNextPage) break;
    if (holders.users.length === 0) throw new Error('The IAM member list is invalid.');
  }
  await requireIamPermission(ctx, signal);
  const data = await iamFetch(ctx, `mutation AddL1KeyManager($context: ResourceContext!, $changes: [UserRoleChange!]) {
    assignRolesToUsers(context: $context, changes: $changes) { success errors assignedCount }
  }`, { context: resourceContext(ctx), changes: [{ userId: user.userId, roles: [L1_KEY_MANAGER_ROLE] }] }, signal);
  const result = data.assignRolesToUsers;
  if (result?.success !== true || (result.errors !== null && (!Array.isArray(result.errors) || result.errors.length > 0)) ||
    !Number.isInteger(result.assignedCount) || result.assignedCount < 0) {
    throw new Error('The IAM role could not be assigned. Refresh the list before you try again.');
  }
  // The service ignores duplicate tuples and counts newly written tuples, not users.
  return result.assignedCount === 0 ? 'duplicate' : 'added';
};
