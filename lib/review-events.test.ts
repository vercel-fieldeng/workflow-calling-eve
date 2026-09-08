import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageStreamEvent } from 'eve/client'
import { reduceReviewEvent, type ReviewAccumulator } from './review-events'

const empty = (): ReviewAccumulator => ({ message: null, analysis: null, error: null, terminal: false })
const event = (type: string, data: unknown = {}) => ({ type, data, meta: { id: 'test', at: new Date().toISOString() } }) as MessageStreamEvent
const analysis = { summary: 'A bounded pilot can test the idea.', points: ['Learn before making a permanent commitment.'], assumptions: [] }

test('preserves structured output across poll boundaries', () => {
  const firstPoll = reduceReviewEvent(empty(), event('result.completed', { result: analysis }))
  assert.equal(firstPoll.terminal, false)
  const secondPoll = reduceReviewEvent(JSON.parse(JSON.stringify(firstPoll)), event('session.waiting'))
  assert.deepEqual(secondPoll.analysis, analysis)
  assert.equal(secondPoll.terminal, true)
  assert.equal(secondPoll.error, null)
})

test('a completed message replaces provisional deltas', () => {
  let state = reduceReviewEvent(empty(), event('message.appended', { messageDelta: 'partial' }))
  state = reduceReviewEvent(state, event('message.completed', { message: 'Complete authoritative text', finishReason: 'stop' }))
  assert.equal(state.message, 'Complete authoritative text')
})

test('plain text without structured output is not success', () => {
  const text = reduceReviewEvent(empty(), event('message.completed', { message: 'Please tell me more', finishReason: 'stop' }))
  assert.match(reduceReviewEvent(text, event('session.waiting')).error!, /without a valid structured/)
})

test('human input and authorization pauses fail unattended execution', () => {
  for (const type of ['input.requested', 'authorization.required']) {
    const state = reduceReviewEvent(empty(), event(type))
    assert.equal(state.terminal, true)
    assert.match(state.error!, /human input/)
  }
})

test('invalid structured output is rejected', () => {
  const state = reduceReviewEvent(empty(), event('result.completed', { result: { summary: 42 } }))
  assert.equal(state.analysis, null)
  assert.ok(reduceReviewEvent(state, event('session.completed')).error)
})

test('failure in one branch never mutates the successful branch', () => {
  const success = reduceReviewEvent(reduceReviewEvent(empty(), event('result.completed', { result: analysis })), event('session.waiting'))
  const failure = reduceReviewEvent(empty(), event('session.failed', { error: 'secret upstream detail' }))
  assert.equal(success.error, null)
  assert.deepEqual(success.analysis, analysis)
  assert.ok(failure.error)
  assert.equal(failure.error.includes('secret'), false)
})
