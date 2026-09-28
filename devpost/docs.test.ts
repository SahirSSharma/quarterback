// Consistency checks for the public-facing docs. They exist because Stage 1 requires the model ids to be
// spelled identically everywhere, and because the README states dates and counts that live in data/.
// Run: node --test devpost/docs.test.ts   (Node >= 24 strips types; no dependency; not in the Vitest include list yet)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const docPaths = [
  'README.md',
  'CHANGELOG.md',
  'devpost/SUBMISSION.md',
  'devpost/feedback.md',
  'devpost/VIDEO.md',
  'devpost/GALLERY.md',
  'notes/stage1-checklist.md',
];
const docs = Object.fromEntries(docPaths.map((p) => [p, read(p)]));
const design = read('DESIGN.md');

// The three models Stage 1 requires us to name identically everywhere. Spelling is Token Factory's.
const modelIds = [
  'nvidia/Nemotron-3_5-Lightning',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/Nemotron-3-Ultra-550b-a55b',
];

test('the three model ids are spelled identically in DESIGN, README, SUBMISSION, VIDEO and feedback', () => {
  const where = ['README.md', 'devpost/SUBMISSION.md', 'devpost/VIDEO.md', 'devpost/feedback.md'];
  for (const id of modelIds) {
    assert.ok(design.includes(id), `DESIGN.md lacks ${id}`);
    for (const p of where) assert.ok(docs[p].includes(id), `${p} lacks ${id}`);
  }
  // The registry is another module's file; when it exists it must agree with the docs.
  if (existsSync(path.join(root, 'lib/tf/models.ts'))) {
    const registry = read('lib/tf/models.ts');
    for (const id of modelIds) assert.ok(registry.includes(id), `lib/tf/models.ts lacks ${id}`);
  }
});

test('the platform is called "Nebius Token Factory" where judges read', () => {
  for (const p of ['README.md', 'devpost/SUBMISSION.md', 'devpost/VIDEO.md', 'devpost/feedback.md']) {
    assert.ok(docs[p].includes('Nebius Token Factory'), `${p} lacks "Nebius Token Factory"`);
  }
});

test('README and SUBMISSION deadlines match data/registrar-calendar.json for FA26', () => {
  const cal = JSON.parse(read('data/registrar-calendar.json'));
  const fa = cal.terms.FA26;
  // The docs state one date for units, grading option and drop-with-W; the calendar must agree with that.
  assert.equal(fa.changeUnits, fa.dropWithW);
  assert.equal(fa.changeGradingOption, fa.dropWithW);
  const fmt = (iso: string, month: 'short' | 'long') =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month, day: 'numeric', timeZone: 'UTC' });
  for (const iso of [fa.dropWithoutW, fa.dropWithW]) {
    assert.ok(docs['README.md'].includes(fmt(iso, 'short')), `README lacks "${fmt(iso, 'short')}" (${iso})`);
    assert.ok(docs['devpost/SUBMISSION.md'].includes(fmt(iso, 'long')), `SUBMISSION lacks "${fmt(iso, 'long')}"`);
  }
});

test('no emoji in any public doc', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const [p, text] of Object.entries(docs)) {
    const m = emoji.exec(text);
    assert.equal(m, null, `${p} contains ${m?.[0]} at ${m?.index}`);
  }
});

test('every relative link in the docs resolves to a file', () => {
  for (const p of ['README.md', 'devpost/SUBMISSION.md', 'devpost/feedback.md', 'notes/stage1-checklist.md']) {
    for (const m of docs[p].matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const file = path.resolve(root, path.dirname(p), target.split('#')[0]);
      assert.ok(existsSync(file), `${p} links to missing ${target}`);
    }
  }
});

test('each Devpost tagline is at most 200 characters', () => {
  const section = docs['devpost/SUBMISSION.md'].split('## Tagline')[1].split('\n## ')[0];
  const taglines = [...section.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
  assert.equal(taglines.length, 3);
  for (const t of taglines) assert.ok(t.length <= 200, `${t.length} chars: ${t}`);
});

test('the video shot list ends at or before 3:00', () => {
  const ends = [...docs['devpost/VIDEO.md'].matchAll(/(\d):(\d\d)–(\d):(\d\d)/g)].map(
    (m) => Number(m[3]) * 60 + Number(m[4]),
  );
  assert.ok(ends.length >= 5, 'shot list not found');
  assert.ok(Math.max(...ends) <= 180, `last shot ends at ${Math.max(...ends)} s`);
});

test('README data counts match the snapshot', () => {
  const majors = readdirSync(path.join(root, 'data/majors')).filter(
    (f) => f.endsWith('.json') && !['index.json', 'uncovered.json'].includes(f),
  );
  assert.ok(docs['README.md'].includes(`${majors.length} major requirement files`), `majors: ${majors.length}`);
  const grades = JSON.parse(read('data/grades.json'));
  const nGrades = Object.keys(grades.grades).length.toLocaleString('en-US');
  assert.ok(docs['README.md'].includes(`${nGrades} courses`), `grades: ${nGrades}`);
  const sections = JSON.parse(read('data/sections/FA26.json'));
  const nSections = Object.keys(sections).length.toLocaleString('en-US');
  assert.ok(docs['README.md'].includes(`${nSections} courses`), `sections: ${nSections}`);
  // CSV records, not lines: one CSE row has a quoted field with a newline in it.
  const cseRows = read('data/offerings/raw-cse-2026-27.csv').split('\n').filter((l) => l.startsWith('CSE-')).length;
  assert.ok(docs['README.md'].includes(`CSE as CSV (${cseRows} course rows)`), `CSE rows: ${cseRows}`);
});
