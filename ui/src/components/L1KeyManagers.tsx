import { useEffect, useRef, useState } from 'react';
import { Button, BusyIndicator, MessageStrip } from '@ui5/webcomponents-react';
import { assignL1KeyManager, listL1KeyManagers, lookupL1Candidate, revokeL1KeyManager, type L1KeyManager, type L1KeyManagerPage } from '../lib/iam';
import type { RuntimeContext } from '../lib/luigi';

export const L1KeyManagers = ({ ctx, allowed }: { ctx: RuntimeContext; allowed: boolean }) => {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ context: RuntimeContext; page: number; data: L1KeyManagerPage } | null>(null);
  const [error, setError] = useState<{ context: RuntimeContext; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [candidate, setCandidate] = useState<{ context: RuntimeContext; user: L1KeyManager } | null>(null);
  const [notice, setNotice] = useState<{ context: RuntimeContext; message: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => { setPage(1); }, [ctx]);
  useEffect(() => { setEmail(''); setCandidate(null); setNotice(null); }, [ctx, allowed]);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setSnapshot(null); setError(null); setBusy(false);
    if (allowed) {
      void listL1KeyManagers(ctx, page, request.signal).then((data) => {
        if (!request.signal.aborted) setSnapshot({ context: ctx, page, data });
      }).catch((reason: Error) => {
        if (!request.signal.aborted) setError({ context: ctx, message: reason.message });
      });
    }
    return () => request.abort();
  }, [ctx, allowed, page, refresh]);

  const data = snapshot?.context === ctx && snapshot.page === page ? snapshot.data : null;
  const message = error?.context === ctx ? error.message : null;
  const revoke = async (userId: string) => {
    const signal = controller.current?.signal;
    if (!allowed || !data || message || busy || !signal || signal.aborted) return;
    setBusy(true); setError(null);
    try {
      await revokeL1KeyManager(ctx, userId, signal);
      if (!signal.aborted) setRefresh((value) => value + 1);
    } catch (reason) {
      if (!signal.aborted) setError({ context: ctx, message: (reason as Error).message });
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };
  const lookup = async () => {
    const signal = controller.current?.signal;
    if (!allowed || !data || message || busy || !email.trim() || !signal || signal.aborted) return;
    setBusy(true); setCandidate(null); setNotice(null);
    try {
      const user = await lookupL1Candidate(ctx, email, signal);
      if (!signal.aborted) {
        if (user) setCandidate({ context: ctx, user });
        else setNotice({ context: ctx, message: 'This user is not in the organization. Add them on the org Members page first.' });
      }
    } catch (reason) {
      if (!signal.aborted) setError({ context: ctx, message: (reason as Error).message });
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };
  const add = async () => {
    const signal = controller.current?.signal;
    if (!allowed || !data || message || busy || candidate?.context !== ctx || !signal || signal.aborted) return;
    setBusy(true); setNotice(null);
    try {
      const result = await assignL1KeyManager(ctx, candidate.user, signal);
      if (!signal.aborted) {
        setCandidate(null); setEmail(''); setPage(1);
        setNotice({ context: ctx, message: result === 'duplicate' ? 'This user is already an L1 Key Manager.' : 'The L1 Key Manager was added.' });
        setRefresh((value) => value + 1);
      }
    } catch (reason) {
      if (!signal.aborted) setError({ context: ctx, message: (reason as Error).message });
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };

  return (
    <main className="page page-width" style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <h1>L1 Key Managers</h1>
      {!allowed ? <MessageStrip design="Information" hideCloseButton>Read-only. Only account owners can manage L1 Key Managers.</MessageStrip> : (
        <>
          <form className="l1-add-form" aria-labelledby="l1-add-title" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
            <h2 id="l1-add-title">Add L1 Key Manager</h2>
            <p>Find a user by their email address. Add new users on the org Members page first.</p>
            <label htmlFor="l1-member-email">Email address</label>
            <div className="l1-add-controls">
              <input id="l1-member-email" type="email" required value={email} disabled={busy || !data || Boolean(message)}
                onChange={(event) => { setEmail(event.target.value); setCandidate(null); setNotice(null); }} />
              <Button type="Submit" disabled={busy || !data || Boolean(message) || !email.trim()}>Find user</Button>
            </div>
            {candidate?.context === ctx && <div className="l1-member-row l1-confirm-row">
              <span>{candidate.user.email}</span>
              <Button design="Emphasized" disabled={busy || !data || Boolean(message)} onClick={() => { void add(); }}>Assign L1 Key Manager</Button>
            </div>}
            {busy && <BusyIndicator active><span>Contacting IAM</span></BusyIndicator>}
            {notice?.context === ctx && <MessageStrip design="Information" hideCloseButton>{notice.message}</MessageStrip>}
          </form>
          <section className="l1-members-card" aria-labelledby="l1-current-title">
            <header className="l1-members-header">
              <h2 id="l1-current-title">Current L1 Key Managers {data && <span className="l1-member-count">{data.totalCount}</span>}</h2>
              <Button icon="refresh" design="Transparent" tooltip="Refresh" accessibleName="Refresh" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh</Button>
            </header>
            <div className="l1-members-body">
              {message && <MessageStrip design="Negative" hideCloseButton>{message}</MessageStrip>}
              {!data && !message && <BusyIndicator active><span>Loading L1 Key Managers</span></BusyIndicator>}
              {data && data.users.length === 0 && <p className="l1-empty">No L1 Key Managers yet.</p>}
              {data && data.users.length > 0 && <ul className="l1-member-list">{data.users.map((user) => (
                <li key={user.userId} className="l1-member-row">
                  <span>{user.email || user.userId}</span>
                  <Button disabled={busy || Boolean(message)} onClick={() => { void revoke(user.userId); }}>Revoke</Button>
                </li>
              ))}</ul>}
              {(page > 1 || data?.hasNextPage) && <div className="l1-pagination">
                <Button disabled={busy || !data || page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <span>Page {page}</span>
                <Button disabled={busy || !data?.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>}
            </div>
          </section>
        </>
      )}
    </main>
  );
};
