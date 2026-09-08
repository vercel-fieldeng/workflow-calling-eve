import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepAgent, deriveOverall, parseTerminalReturnValue } from './workflow-run-status'
import { emptyBranch } from './review-types'

test('attributes hydrated step args envelopes to independent agents', () => {
  assert.equal(stepAgent({ args: ['benefits', 'proposal'] }), 'benefits')
  assert.equal(stepAgent({ args: ['risks', 'session', 0] }), 'risks')
  assert.equal(stepAgent(['benefits']), 'benefits')
  assert.equal(stepAgent({ args: ['unrelated'] }), null)
  assert.equal(stepAgent(null), null)
})

test('aggregates success, partial failure, full failure and queued status', () => {
  const benefits = { ...emptyBranch('benefits'), status: 'completed' as const, finishedAt: 100 }
  const risks = { ...emptyBranch('risks'), status: 'failed' as const, finishedAt: 120 }
  assert.equal(deriveOverall(benefits, risks).overall, 'partial_failure')
  assert.equal(deriveOverall(benefits, { ...risks, status: 'completed' }).overall, 'completed')
  assert.equal(deriveOverall({ ...benefits, status: 'failed' }, risks).overall, 'failed')
  assert.equal(deriveOverall(emptyBranch('benefits'), emptyBranch('risks')).overall, 'queued')
  assert.equal(deriveOverall(benefits, emptyBranch('risks')).overall, 'running')
})

test('does not expose unrelated or malformed stored return values', () => {
  assert.equal(parseTerminalReturnValue('wrun_test', { secret: 'unrelated' }), null)
})
