# Eval results

_Written by the runners in eval/; see eval/README.md. Mock runs cost $0._

## E4 — intake accuracy

_2026-09-28T05:24:41.742Z · mode mock · 30 pastes · $0 spent (deterministic parser only; ai-intake fallback skipped) · rows in eval/results/e4-2026-09-28T05-24-41Z.jsonl_

### Per layout

| Layout | Pastes | Course rows | Row precision | Row recall | Grades | Units | Major file | College file | All majors | GPA | Low confidence (→ ai-intake) | ai-intake row recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| web | 5 | 104 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0 | n/a |
| wrapped | 5 | 103 | 100% | 100% | 100% | 100% | 80% | 100% | 100% | 100% | 1 | n/a |
| reordered | 5 | 129 | 100% | 76.0% | 100% | 100% | 100% | 100% | 100% | 100% | 0 | n/a |
| pdf | 5 | 109 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0 | n/a |
| double-major | 5 | 140 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0 | n/a |
| transfer | 5 | 135 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0 | n/a |
| all | 30 | 720 | 100% | 95.7% | 100% | 100% | 96.7% | 100% | 100% | 100% | 1 | n/a |

### Per paste

| # | Layout | Major file | Rows exp/got/match | Recall | Grades | Major | College | GPA | Confidence | ai-intake |
| ---: | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 0 | web | sociology-sociology-science-and-medicine | 23/23/23 | 100% | 100% | yes | yes | yes | high | not needed |
| 1 | wrapped | cognitive-science-cognitive-science-with-specialization-in-clini | 22/22/22 | 100% | 100% | yes | yes | yes | high | not needed |
| 2 | reordered | visual-arts-studio | 30/30/30 | 100% | 100% | yes | yes | yes | high | not needed |
| 3 | pdf | economics-economics | 25/25/25 | 100% | 100% | yes | yes | yes | high | not needed |
| 4 | double-major | classical-studies-classical-studies-language-emphasis | 27/27/27 | 100% | 100% | yes | yes | yes | high | not needed |
| 5 | transfer | italian-studies-italian-studies | 16/16/16 | 100% | 100% | yes | yes | yes | high | not needed |
| 6 | web | sociology-sociology-science-and-medicine | 26/26/26 | 100% | 100% | yes | yes | yes | high | not needed |
| 7 | wrapped | political-science-political-science-political-theory | 21/21/21 | 100% | 100% | yes | yes | yes | high | not needed |
| 8 | reordered | biological-sciences-biology-with-specialization-in-bioinformatic | 26/26/26 | 100% | 100% | yes | yes | yes | high | not needed |
| 9 | pdf | classical-studies-classical-studies-language-emphasis | 10/10/10 | 100% | 100% | yes | yes | yes | high | not needed |
| 10 | double-major | chemistry-and-biochemistry-pharmacological-chemistry | 28/28/28 | 100% | 100% | yes | yes | yes | high | not needed |
| 11 | transfer | chemical-engineering-chemical-engineering | 36/36/36 | 100% | 100% | yes | yes | yes | high | not needed |
| 12 | web | chemical-engineering-chemical-engineering | 10/10/10 | 100% | 100% | yes | yes | yes | high | not needed |
| 13 | wrapped | cognitive-science-cognitive-science-with-specialization-in-langu | 14/14/14 | 100% | 100% | yes | yes | yes | high | not needed |
| 14 | reordered | computer-science-and-engineering-computer-science | 25/25/25 | 100% | 100% | yes | yes | yes | high | not needed |
| 15 | pdf | biological-sciences-ecology-behavior-and-evolution | 27/27/27 | 100% | 100% | yes | yes | yes | high | not needed |
| 16 | double-major | sociology-sociology-science-and-medicine | 23/23/23 | 100% | 100% | yes | yes | yes | high | not needed |
| 17 | transfer | mathematics-applied-mathematics | 20/20/20 | 100% | 100% | yes | yes | yes | high | not needed |
| 18 | web | linguistics-linguistics-4 | 18/18/18 | 100% | 100% | yes | yes | yes | high | not needed |
| 19 | wrapped | cognitive-science-cognitive-and-behavioral-neuroscience | 30/30/30 | 100% | 100% | no | yes | yes | low | skipped (mock) |
| 20 | reordered | biological-sciences-microbiology | 15/15/15 | 100% | 100% | yes | yes | yes | high | not needed |
| 21 | pdf | psychology-psychology-with-a-specialization-in-clinical-psycholo | 32/32/32 | 100% | 100% | yes | yes | yes | high | not needed |
| 22 | double-major | electrical-and-computer-engineering-engineering-physics | 30/30/30 | 100% | 100% | yes | yes | yes | high | not needed |
| 23 | transfer | physics-physics | 34/34/34 | 100% | 100% | yes | yes | yes | high | not needed |
| 24 | web | economics-economics-and-mathematics | 27/27/27 | 100% | 100% | yes | yes | yes | high | not needed |
| 25 | wrapped | political-science-political-science-race-ethnicity-and-politics | 16/16/16 | 100% | 100% | yes | yes | yes | high | not needed |
| 26 | reordered | cognitive-science-cognitive-science-with-specialization-in-clini | 33/2/2 | 6.1% | 100% | yes | yes | yes | high | not needed |
| 27 | pdf | astronomy-astrophysics-astronomy-and-astrophysics | 15/15/15 | 100% | 100% | yes | yes | yes | high | not needed |
| 28 | double-major | cognitive-science-cognitive-science-2 | 32/32/32 | 100% | 100% | yes | yes | yes | high | not needed |
| 29 | transfer | black-diaspora-and-african-american-studies-black-diaspora-and-a | 29/29/29 | 100% | 100% | yes | yes | yes | high | not needed |

Metric definitions: eval/README.md.

## E1 — plan validity and optimality

_2026-09-28T05:00:53.054Z · mode mock · 3 students × 10 configs · 30 runs · $0 spent (fixtures) · rows in eval/results/e1-2026-09-28T05-00-53Z.jsonl_

_Replayed runs report the USD and latency of the original recording (`replayed: true` in the JSONL); nothing was billed._

### Per config (losing configs kept)

| Config | Runs | No fixture | Errors | Valid 1st pass | Valid ≤3 rounds | Rounds | Rejected drafts | Progress / optimum | Refusals | Refusal precision | Plant recall | Plants avoided | Plants missed | Plans > 19.5u | Tool calls ok | Cache-hit tokens | $ / run | s / run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| super-b4096+critic | 3 | 0 | 0 | 100% | 100% | 1.00 | 0.33 | 0.80 | 0 | n/a | n/a | 0 | 0 | 0 | 97.5% | 0 | $0.0795 | 0.2 |
| super-b4096 | 3 | 0 | 0 | 100% | 100% | 1.00 | 0.33 | 0.80 | 0 | n/a | n/a | 0 | 0 | 0 | 97.5% | 0 | $0.0543 | 0.2 |
| super-b0+critic | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| super-b0 | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| super-b2048+critic | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| super-b2048 | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| super-b8192+critic | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| super-b8192 | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| lightning+critic | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |
| lightning | 0 | 3 | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | n/a | 0 | 0 | 0 | n/a | 0 | n/a | n/a |

### Per run

| Student | Config | Status | Plans | Rejected | Rounds | Progress / optimum (per term) | Verdict | Plant | Tool calls | Model calls | $ | s |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: |
| demo-a | super-b4096+critic | ok | 2 | 1 | 1 | 12 / 17 (4+4+4 / 7+5+5) | p-balanced; refused 0; risks 1 | n/a | 6/6 | 8 | $0.1009 | 0.4 |
| demo-a | super-b4096 | ok | 2 | 1 | 1 | 12 / 17 (4+4+4 / 7+5+5) | critic off | n/a | 6/6 | 7 | $0.0732 | 0.4 |
| demo-a | super-b0+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | super-b0 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | super-b2048+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | super-b2048 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | super-b8192+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | super-b8192 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | lightning+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-a | lightning | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.1 |
| demo-b | super-b4096+critic | ok | 3 | 0 | 1 | 7 / 7 (5+1+1 / 6+1+0) | p-fastest; refused 0; risks 2 | n/a | 32/32 | 8 | $0.0654 | 0.0 |
| demo-b | super-b4096 | ok | 3 | 0 | 1 | 7 / 7 (5+1+1 / 6+1+0) | critic off | n/a | 32/32 | 7 | $0.0467 | 0.0 |
| demo-b | super-b0+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | super-b0 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | super-b2048+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | super-b2048 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | super-b8192+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | super-b8192 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | lightning+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-b | lightning | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | super-b4096+critic | ok | 3 | 0 | 1 | 11 / 16 (4+3+4 / 6+5+5) | p-balanced; refused 0; risks 3 | n/a | 1/2 | 5 | $0.0721 | 0.1 |
| demo-c | super-b4096 | ok | 3 | 0 | 1 | 11 / 16 (4+3+4 / 6+5+5) | critic off | n/a | 1/2 | 4 | $0.0429 | 0.1 |
| demo-c | super-b0+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | super-b0 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | super-b2048+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | super-b2048 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | super-b8192+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | super-b8192 | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | lightning+critic | no-fixture | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | $0.0000 | 0.0 |
| demo-c | lightning | no-fixture | 0 | 0 | 0 | n/a | critic off | n/a | n/a | 0 | $0.0000 | 0.0 |

Metric definitions: eval/README.md.

## Planner configuration (measured)

_2026-09-28T05:56:50.907Z · mode live · 12 students (12 major/college pairs; 3 demos + synthetic from eval/synth.ts) × 4 configs · 46 runs · spent $1.0410 of $2.50 · rows in eval/results/planner-configs-2026-09-28.jsonl_

Order per student: A (cold), then C and D (the same Lightning draft requests again, cache-warm), then B. Wall-clock is planRun() end to end; the draft phase is the first step to the "Drafted" step. Default choice: highest final validity, then latency, then cost (see the paragraph after the tables and notes/agents.md).

### Per config

| Config | Drafts + repair | Students | Errors | First-pass validity (drafts passing verify) | Final plans / student | Students with ≥ 1 plan | Students with 3 plans | Rejected drafts | Repair rounds / student | Draft phase ms (mean) | Wall-clock ms (mean) | p50 | max | $ / student | $ total | Cache-hit tokens | Runs with a cache hit | Super reasoning tokens / call (mean) | max | Tool calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | Lightning drafts + Super repair (thinking off) | 12 | 0 | 22.2% | 1.75 | 83.3% | 33.3% | 64 | 1.83 | 6651 | 23893 | 26952 | 37223 | $0.0249 | $0.2992 | 733600 | 12 | 0 | 0 | 43 |
| C | Lightning drafts, no repair (warm repeat) | 12 | 0 | 13.9% | 0.42 | 25% | 8.3% | 31 | 0.00 | 6574 | 6677 | 5514 | 16190 | $0.0061 | $0.0730 | 899184 | 12 | n/a | n/a | 35 |
| D | Lightning drafts + Lightning repair (warm repeat) | 11 | 0 | 15.2% | 1.18 | 90.9% | 0% | 70 | 2.00 | 6226 | 13373 | 11869 | 24724 | $0.0106 | $0.1168 | 1433664 | 11 | n/a | n/a | 36 |
| B | Super drafts (thinking off) + Super repair (thinking off) | 11 | 0 | 30.3% | 1.82 | 90.9% | 18.2% | 53 | 1.91 | 36589 | 52663 | 50150 | 112002 | $0.0502 | $0.5520 | 0 | 0 | 0 | 0 | 43 |

### Per run

| Student | Major file | College | Action | Config | Status | First pass | Plans | Rejected | Rounds | Draft ms | Wall ms | Calls | Tool calls | Cache hits | Super reasoning tokens | $ | Error |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| demo-a | computer-science-and-engineering-artificial-inte | revelle | drop CSE 29 | A | ok | 2/3 | 3 | 1 | 2 | 5945 | 8454 | 7 | 4 | 127856 | 0 | $0.0169 | n/a |
| demo-a | computer-science-and-engineering-artificial-inte | revelle | drop CSE 29 | C | ok | 3/3 | 3 | 0 | 1 | 6234 | 6324 | 6 | 3 | 127856 | n/a | $0.0093 | n/a |
| demo-a | computer-science-and-engineering-artificial-inte | revelle | drop CSE 29 | D | ok | 1/3 | 1 | 6 | 3 | 5898 | 11053 | 10 | 3 | 211696 | n/a | $0.0152 | n/a |
| demo-a | computer-science-and-engineering-artificial-inte | revelle | drop CSE 29 | B | ok | 1/3 | 3 | 3 | 3 | 16945 | 24599 | 9 | 3 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0682 | n/a |
| demo-b | cognitive-science-cognitive-science-2 | thurgood-marshall | drop COGS 109 | A | ok | 0/3 | 2 | 5 | 3 | 5655 | 14064 | 10 | 3 | 50304 | 0, 0, 0, 0 | $0.0203 | n/a |
| demo-b | cognitive-science-cognitive-science-2 | thurgood-marshall | drop COGS 109 | C | ok | 0/3 | 0 | 3 | 1 | 5298 | 5325 | 6 | 3 | 50304 | n/a | $0.0047 | n/a |
| demo-b | cognitive-science-cognitive-science-2 | thurgood-marshall | drop COGS 109 | D | ok | 0/3 | 2 | 5 | 3 | 5844 | 11246 | 10 | 3 | 83840 | n/a | $0.0080 | n/a |
| demo-b | cognitive-science-cognitive-science-2 | thurgood-marshall | drop COGS 109 | B | ok | 1/3 | 2 | 4 | 3 | 20423 | 26152 | 9 | 16 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0379 | n/a |
| demo-c | mathematics-mathematics-computer-science | sixth | drop CSE 101 | A | ok | 2/3 | 3 | 1 | 2 | 5543 | 7976 | 7 | 3 | 100608 | 0 | $0.0140 | n/a |
| demo-c | mathematics-mathematics-computer-science | sixth | drop CSE 101 | C | ok | 1/3 | 1 | 2 | 1 | 5766 | 5833 | 6 | 3 | 100608 | n/a | $0.0078 | n/a |
| demo-c | mathematics-mathematics-computer-science | sixth | drop CSE 101 | D | ok | 1/3 | 2 | 5 | 3 | 5653 | 10551 | 10 | 3 | 169776 | n/a | $0.0128 | n/a |
| demo-c | mathematics-mathematics-computer-science | sixth | drop CSE 101 | B | ok | 1/3 | 3 | 2 | 2 | 20060 | 24678 | 8 | 1 | 0 | 0, 0, 0, 0, 0, 0, 0, 0 | $0.0522 | n/a |
| synth-3-0 | astronomy-astrophysics-astrophysical-sciences | earl-warren | drop BILD 1 | A | ok | 1/3 | 2 | 5 | 3 | 11476 | 29566 | 10 | 5 | 48208 | 0, 0, 0, 0 | $0.0233 | n/a |
| synth-3-0 | astronomy-astrophysics-astrophysical-sciences | earl-warren | drop BILD 1 | C | ok | 0/3 | 0 | 3 | 1 | 15874 | 16190 | 5 | 2 | 56592 | n/a | $0.0046 | n/a |
| synth-3-0 | astronomy-astrophysics-astrophysical-sciences | earl-warren | drop BILD 1 | D | ok | 1/3 | 1 | 6 | 3 | 9761 | 24724 | 10 | 3 | 106896 | n/a | $0.0091 | n/a |
| synth-3-0 | astronomy-astrophysics-astrophysical-sciences | earl-warren | drop BILD 1 | B | ok | 0/3 | 1 | 8 | 3 | 72320 | 112002 | 12 | 0 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0561 | n/a |
| synth-3-1 | computer-science-and-engineering-computer-engine | seventh | drop HILD 7C | A | ok | 0/3 | 1 | 8 | 3 | 5898 | 37223 | 12 | 5 | 56592 | 0, 0, 0, 0, 0, 0 | $0.0355 | n/a |
| synth-3-1 | computer-science-and-engineering-computer-engine | seventh | drop HILD 7C | C | ok | 0/3 | 0 | 3 | 1 | 5365 | 5438 | 6 | 3 | 75456 | n/a | $0.0059 | n/a |
| synth-3-1 | computer-science-and-engineering-computer-engine | seventh | drop HILD 7C | D | ok | 0/3 | 1 | 7 | 3 | 5580 | 11831 | 11 | 5 | 138336 | n/a | $0.0110 | n/a |
| synth-3-1 | computer-science-and-engineering-computer-engine | seventh | drop HILD 7C | B | ok | 0/3 | 1 | 7 | 3 | 36813 | 58754 | 11 | 5 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0554 | n/a |
| synth-3-2 | economics-economics | earl-warren | drop PSYC 60 | A | ok | 0/3 | 0 | 9 | 3 | 6120 | 29893 | 12 | 3 | 29344 | 0, 0, 0, 0, 0, 0 | $0.0235 | n/a |
| synth-3-2 | economics-economics | earl-warren | drop PSYC 60 | C | ok | 0/3 | 0 | 3 | 1 | 5365 | 5600 | 6 | 3 | 37728 | n/a | $0.0039 | n/a |
| synth-3-2 | economics-economics | earl-warren | drop PSYC 60 | D | ok | 0/3 | 1 | 7 | 3 | 4823 | 11869 | 11 | 5 | 69168 | n/a | $0.0072 | n/a |
| synth-3-2 | economics-economics | earl-warren | drop PSYC 60 | B | ok | 1/3 | 2 | 5 | 3 | 39104 | 56359 | 10 | 2 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0330 | n/a |
| synth-3-3 | structural-engineering-structural-engineering-2 | earl-warren | drop CENG 15 | A | ok | 0/3 | 0 | 9 | 3 | 7770 | 36581 | 12 | 3 | 37728 | 0, 0, 0, 0, 0, 0 | $0.0281 | n/a |
| synth-3-3 | structural-engineering-structural-engineering-2 | earl-warren | drop CENG 15 | C | ok | 0/3 | 0 | 3 | 1 | 6583 | 6800 | 6 | 3 | 50304 | n/a | $0.0047 | n/a |
| synth-3-3 | structural-engineering-structural-engineering-2 | earl-warren | drop CENG 15 | D | ok | 0/3 | 0 | 9 | 3 | 6857 | 14670 | 12 | 3 | 100608 | n/a | $0.0095 | n/a |
| synth-3-3 | structural-engineering-structural-engineering-2 | earl-warren | drop CENG 15 | B | ok | 2/3 | 2 | 3 | 3 | 40771 | 49635 | 8 | 3 | 0 | 0, 0, 0, 0, 0, 0, 0, 0 | $0.0334 | n/a |
| synth-3-4 | environmental-systems-program-environmental-syst | eighth | drop SIO 102 | A | ok | 1/3 | 1 | 6 | 3 | 7075 | 29618 | 10 | 5 | 48208 | 0, 0, 0, 0 | $0.0232 | n/a |
| synth-3-4 | environmental-systems-program-environmental-syst | eighth | drop SIO 102 | C | ok | 1/3 | 1 | 2 | 1 | 5134 | 5157 | 6 | 3 | 62880 | n/a | $0.0054 | n/a |
| synth-3-4 | environmental-systems-program-environmental-syst | eighth | drop SIO 102 | D | ok | 0/3 | 1 | 8 | 3 | 5404 | 12722 | 11 | 2 | 115280 | n/a | $0.0099 | n/a |
| synth-3-4 | environmental-systems-program-environmental-syst | eighth | drop SIO 102 | B | ok | 1/3 | 2 | 5 | 3 | 50959 | 75425 | 10 | 1 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0460 | n/a |
| synth-3-5 | computer-science-and-engineering-computer-scienc | eighth | drop PHYS 2A | A | ok | 0/3 | 3 | 4 | 3 | 5560 | 28880 | 9 | 2 | 46112 | 0, 0, 0, 0 | $0.0257 | n/a |
| synth-3-5 | computer-science-and-engineering-computer-scienc | eighth | drop PHYS 2A | C | ok | 0/3 | 0 | 3 | 1 | 7772 | 7826 | 6 | 3 | 77552 | n/a | $0.0063 | n/a |
| synth-3-5 | computer-science-and-engineering-computer-scienc | eighth | drop PHYS 2A | D | ok | 0/3 | 1 | 7 | 3 | 7407 | 15835 | 11 | 3 | 142528 | n/a | $0.0115 | n/a |
| synth-3-5 | computer-science-and-engineering-computer-scienc | eighth | drop PHYS 2A | B | ok | 1/3 | 2 | 4 | 3 | 41211 | 57486 | 9 | 2 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0474 | n/a |
| synth-3-6 | human-developmental-sciences-healthy-aging | sixth | drop BILD 2 | A | ok | 1/3 | 2 | 4 | 3 | 7992 | 19436 | 9 | 3 | 79648 | 0, 0, 0 | $0.0263 | n/a |
| synth-3-6 | human-developmental-sciences-healthy-aging | sixth | drop BILD 2 | C | ok | 0/3 | 0 | 3 | 1 | 5401 | 5449 | 6 | 3 | 100608 | n/a | $0.0077 | n/a |
| synth-3-6 | human-developmental-sciences-healthy-aging | sixth | drop BILD 2 | D | ok | 2/3 | 2 | 3 | 3 | 5858 | 10031 | 8 | 3 | 134144 | n/a | $0.0102 | n/a |
| synth-3-6 | human-developmental-sciences-healthy-aging | sixth | drop BILD 2 | B | ok | 2/3 | 2 | 3 | 3 | 40334 | 50150 | 8 | 0 | 0 | 0, 0, 0, 0, 0, 0, 0, 0 | $0.0534 | n/a |
| synth-3-7 | biological-sciences-human-biology | seventh | drop BILD 2 | A | ok | 1/3 | 1 | 6 | 3 | 5520 | 18067 | 10 | 3 | 67072 | 0, 0, 0, 0 | $0.0288 | n/a |
| synth-3-7 | biological-sciences-human-biology | seventh | drop BILD 2 | C | ok | 0/3 | 0 | 3 | 1 | 4613 | 4671 | 6 | 3 | 88032 | n/a | $0.0067 | n/a |
| synth-3-7 | biological-sciences-human-biology | seventh | drop BILD 2 | D | ok | 0/3 | 1 | 7 | 3 | 5404 | 12570 | 11 | 3 | 161392 | n/a | $0.0123 | n/a |
| synth-3-7 | biological-sciences-human-biology | seventh | drop BILD 2 | B | ok | 0/3 | 0 | 9 | 3 | 23544 | 44056 | 12 | 10 | 0 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | $0.0689 | n/a |
| synth-3-8 | biological-sciences-ecology-behavior-and-evoluti | eighth | drop HILD 11 | A | ok | 0/3 | 3 | 6 | 3 | 5255 | 26952 | 11 | 4 | 41920 | 0, 0, 0, 0, 0, 0 | $0.0337 | n/a |
| synth-3-8 | biological-sciences-ecology-behavior-and-evoluti | eighth | drop HILD 11 | C | ok | 0/3 | 0 | 3 | 1 | 5482 | 5514 | 6 | 3 | 71264 | n/a | $0.0059 | n/a |
