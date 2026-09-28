// Typed fetch helpers for the route contracts. Errors carry the server's message when it sent one.
import type { Action, ApprovalRecord, Impact, StudentState, Verdict } from '@/lib/types';
import type { ApproveResponse, CatalogTitles, DemoId, ExplainResponse, LedgerSummary, RunRecord, SaveResponse } from './contracts';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return call<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
}

export const api = {
  intake: (body: { text?: string; demo?: DemoId }) => post<StudentState>('/api/intake', body),
  impact: (state: StudentState, action: Action, signal?: AbortSignal) => post<Impact>('/api/impact', { state, action }, signal),
  plan: (state: StudentState, action: Action) => post<{ runId: string }>('/api/plan', { state, action }),
  run: (id: string) => call<RunRecord>(`/api/run/${encodeURIComponent(id)}`, { cache: 'no-store' }),
  stress: (runId: string) => post<Verdict>('/api/stress', { runId }),
  approve: (runId: string, planId: string, overrides: ApprovalRecord['overrides']) => post<ApproveResponse>('/api/approve', { runId, planId, overrides }),
  save: (runId: string) => post<SaveResponse>('/api/save', { runId }),
  remove: (runId: string) => call<{ ok: true }>(`/api/run/${encodeURIComponent(runId)}`, { method: 'DELETE' }),
  titles: (codes: string[]) => call<CatalogTitles>(`/api/catalog?codes=${encodeURIComponent(codes.join(','))}`),
  explain: (runId: string, code: string) => post<ExplainResponse>('/api/explain', { runId, code }),
  ledgerSummary: () => call<LedgerSummary>('/api/ledger/summary', { cache: 'no-store' }),
};
