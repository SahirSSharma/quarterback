// The Lightning fallback branch of POST /api/intake, with the agent replaced: the route hands the paste and the
// calendar's current term to aiIntake only when the deterministic parser reports low confidence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentState } from '@/lib/types';
import { currentTermFromCalendar } from '@/app/lib/deadlines';

const aiIntake = vi.fn(async (_text: string, opts: { currentTerm: string }): Promise<StudentState> => ({
  college: 'Sixth College', collegeFile: 'sixth-college.json', major: 'Data Science', majors: ['Data Science'], majorFile: 'data-science.json',
  courses: [{ code: 'DSC 10', term: opts.currentTerm, units: 4, grade: null, status: 'wip' }],
  transfer: [], gpa: null, currentTerm: opts.currentTerm, source: 'ai-intake', confidence: 'medium', warnings: ['Confirm the major.'],
}));
vi.mock('@/lib/agents/intake', () => ({ aiIntake: (text: string, opts: { currentTerm: string }) => aiIntake(text, opts) }));

const { POST } = await import('./route');
const post = (body: unknown) => POST(new Request('http://qb/api/intake', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => vi.stubEnv('QB_MODE', 'mock'));
afterEach(() => {
  vi.unstubAllEnvs();
  aiIntake.mockClear();
});

describe('POST /api/intake fallback', () => {
  it('returns the model candidate for an unstructured paste, with the current term from the calendar', async () => {
    const state = (await (await post({ text: 'I am a Sixth College data science student taking DSC 10 and MATH 20A' })).json()) as StudentState;
    expect(aiIntake).toHaveBeenCalledTimes(1);
    expect(aiIntake.mock.calls[0][1]).toEqual({ currentTerm: currentTermFromCalendar(new Date()) });
    expect(state).toMatchObject({ source: 'ai-intake', confidence: 'medium', majorFile: 'data-science.json' });
  });

  it('does not call the model when the parser is confident', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('lib/engine/fixtures/academic-history-demo.txt', 'utf8');
    const state = (await (await post({ text })).json()) as StudentState;
    expect(state.source).toBe('paste');
    expect(aiIntake).not.toHaveBeenCalled();
  });
});
