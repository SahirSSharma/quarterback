// Shared by POST /api/impact and POST /api/plan: the course must be in progress this term, or it is a client error.
import type { Action, StudentState } from '@/lib/types';

export function situation(body: { state?: StudentState; action?: Action } | null): { state: StudentState; action: Action } | { error: string } {
  if (!body?.state || !body.action) return { error: 'Send {state, action}.' };
  const { state, action } = body;
  if (!state.courses.some((c) => c.code === action.course && c.status === 'wip' && c.term === state.currentTerm)) {
    return { error: `${action.course} is not one of your ${state.currentTerm} courses.` };
  }
  return { state, action };
}
