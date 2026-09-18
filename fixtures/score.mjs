#!/usr/bin/env node
// Score a fixture run against fixtures/routing.json.
//
//   node fixtures/score.mjs <run.json>
//
// The run file is either { results: [...] } or { baseline: [...], withSkill: [...] },
// each entry carrying { id, folder, needsFiling }.

import { readFileSync } from 'node:fs'

const spec = JSON.parse(readFileSync(new URL('./routing.json', import.meta.url), 'utf8'))
const run = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const norm = (folder) => (folder ?? '').trim().replace(/\/+$/, '').toLowerCase()

// Runs have been stored both as an array and as an object keyed by id.
const asList = (results) =>
  Array.isArray(results)
    ? results
    : Object.entries(results ?? {}).map(([id, value]) => ({ id, ...value }))

function score(rawResults, label) {
  const results = asList(rawResults)
  const byId = new Map(results.map((r) => [r.id, r]))
  let correct = 0
  let inbox = 0
  let misfiled = 0
  let refused = 0
  const rows = []

  for (const fixture of spec.fixtures) {
    const got = byId.get(fixture.id)
    if (!got) continue

    const actual = norm(got.folder)
    const expected = norm(fixture.expect)
    const acceptable = new Set([expected, ...(fixture.alsoAcceptable ?? []).map(norm)])
    // The inbox is never a failure. It is the blessed way to say "I cannot
    // place this", and a wrong guess is invisible where an inbox item is not.
    const usedInbox = actual === '00-inbox' || got.needsFiling === true

    let verdict
    if (expected === 'reject') {
      if (actual === 'refuse') {
        verdict = 'ok'
        refused++
        correct++
      } else if (usedInbox) {
        verdict = 'inbox'
        inbox++
      } else {
        verdict = 'MISFILE'
        misfiled++
      }
    } else if (acceptable.has(actual)) {
      verdict = 'ok'
      correct++
    } else if (usedInbox) {
      verdict = 'inbox'
      inbox++
    } else {
      verdict = 'MISFILE'
      misfiled++
    }

    rows.push({
      id: fixture.id,
      verdict,
      expected: fixture.expect,
      got: got.folder,
      trap: fixture.trap,
    })
  }

  const total = rows.length
  const rate = total === 0 ? 0 : correct / total
  const passed = rate >= spec.bar.correctFolder && misfiled <= spec.bar.silentMisfiles

  return { label, rows, total, correct, inbox, misfiled, refused, rate, passed }
}

function report(result) {
  console.log(`\n${result.label}`)
  console.log('-'.repeat(60))

  for (const row of result.rows) {
    if (row.verdict === 'ok' && !row.trap) continue
    const mark = row.verdict === 'ok' ? 'ok   ' : row.verdict === 'inbox' ? 'inbox' : 'FAIL '
    const note = row.trap ? `  (trap: ${row.trap})` : ''
    console.log(`  ${row.id}  ${mark} ${row.expected} -> ${row.got}${note}`)
  }

  console.log(
    `  correct ${result.correct}/${result.total} = ${Math.round(result.rate * 100)}%` +
      `   inbox ${result.inbox}   misfiled ${result.misfiled}   refused ${result.refused}/2`,
  )
  console.log(`  ${result.passed ? 'PASS' : 'FAIL'}`)
}

const arms =
  run.baseline !== undefined && run.withSkill !== undefined
    ? [score(run.baseline, 'no skill loaded'), score(run.withSkill, 'with brain-capture')]
    : [score(run.results ?? run, 'run')]

for (const arm of arms) report(arm)

if (arms.length === 2) {
  const [base, skill] = arms
  const gap = Math.round((skill.rate - base.rate) * 100)

  console.log(`\ngap: ${gap >= 0 ? '+' : ''}${gap} points`)
  console.log(
    gap > 10
      ? 'The skill is carrying work the tool descriptions should be doing (FR-30).'
      : 'The tool descriptions hold their own without a skill (FR-30).',
  )
}

process.exit(arms.every((arm) => arm.passed) ? 0 : 1)
