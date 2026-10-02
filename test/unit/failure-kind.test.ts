import assert from 'node:assert/strict'
import { test } from 'node:test'
import { status } from '@grpc/grpc-js'
import { failureKind } from '../../src/main/platform/failure-kind'
import { NotEmitted, MessageMutationFailure } from '../../src/main/network/contracts'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { ReadFailure } from '../../src/main/network/firestore-values'
import { ChannelPostCreationFailure } from '../../src/main/network/channel-post-creation-write'
import { UploadRefused } from '../../src/main/network/upload-refused'
import { AuthenticationFailure } from '../../src/main/auth/contracts'
import { grpcCode } from '../../src/main/network/grpc-delivery'

// connection-check.log says of every failed attempt whether it left (안 보냄/모름/서버 답) and a code, and nothing else.
test('a failed attempt is told as not sent, unknown or answered, with a code and no text', () => {
  assert.deepEqual(failureKind(new NotEmitted('연결을 기다리고 있습니다.')), { delivery: 'not-sent', code: 'not-emitted' })
  assert.deepEqual(failureKind(new MorseCallableFailure('not-sent', 'UNAVAILABLE', '', 'ECONNREFUSED')), { delivery: 'not-sent', code: 'callable/UNAVAILABLE/ECONNREFUSED' })
  assert.deepEqual(failureKind(new MorseCallableFailure('unknown', 'UNKNOWN', '', 'UND_ERR_SOCKET')), { delivery: 'unknown', code: 'callable/UNKNOWN/UND_ERR_SOCKET' })
  assert.deepEqual(failureKind(new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'NOT_MEMBER')), { delivery: 'answered', code: 'callable/PERMISSION_DENIED' })
  assert.deepEqual(failureKind(new MorseCallableFailure('unknown', 'a status with <text> in it')), { delivery: 'unknown', code: 'callable/OTHER' })
  assert.deepEqual(failureKind(new ReadFailure('network', 'UNAVAILABLE/no-connection')), { delivery: 'not-sent', code: 'read/network/UNAVAILABLE/no-connection' })
  assert.deepEqual(failureKind(new ReadFailure('network', 'DEADLINE_EXCEEDED')), { delivery: 'unknown', code: 'read/network/DEADLINE_EXCEEDED' })
  assert.deepEqual(failureKind(new ReadFailure('permission', 'PERMISSION_DENIED')), { delivery: 'answered', code: 'read/permission/PERMISSION_DENIED' })
  assert.deepEqual(failureKind(new ChannelPostCreationFailure('not-sent', 'UNAVAILABLE/no-connection')), { delivery: 'not-sent', code: 'commit/UNAVAILABLE/no-connection' })
  assert.deepEqual(failureKind(new ChannelPostCreationFailure('refused', 'PERMISSION_DENIED')), { delivery: 'answered', code: 'commit/PERMISSION_DENIED' })
  assert.deepEqual(failureKind(new UploadRefused('x')), { delivery: 'answered', code: 'upload-refused' })
  assert.deepEqual(failureKind(new AuthenticationFailure('network')), { delivery: 'not-sent', code: 'auth/network' })
  assert.deepEqual(failureKind(new MessageMutationFailure('x', true)), { delivery: 'answered', code: 'mutation' })
  assert.deepEqual(failureKind(new MessageMutationFailure('x')), { delivery: 'unknown', code: 'mutation' })
  assert.deepEqual(failureKind(Object.assign(new Error('x'), { code: status.UNAVAILABLE, details: 'No connection established. Last error: connect ECONNREFUSED 127.0.0.1:1' })),
    { delivery: 'not-sent', code: 'UNAVAILABLE/no-connection' })
  assert.deepEqual(failureKind(Object.assign(new Error('x'), { code: status.PERMISSION_DENIED, details: 'Missing or insufficient permissions.' })), { delivery: 'answered', code: 'PERMISSION_DENIED' })
  assert.deepEqual(failureKind(new Error('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) })), { delivery: 'unknown', code: 'ECONNREFUSED' })
  assert.deepEqual(failureKind(new TypeError('some message with an address 10.0.0.1')), { delivery: 'unknown', code: 'TypeError' })
})

test('a gRPC failure keeps its status and why it stayed here, never the address in its details', () => {
  assert.equal(grpcCode({ code: status.UNAVAILABLE, details: 'No connection established. Last error: connect ECONNREFUSED 127.0.0.1:47821' }), 'UNAVAILABLE/no-connection')
  assert.equal(grpcCode({ code: status.UNAVAILABLE, details: 'Name resolution failed for target dns:firestore.googleapis.com:443' }), 'UNAVAILABLE/no-address')
  assert.equal(grpcCode({ code: status.DEADLINE_EXCEEDED, details: 'Deadline exceeded after 30.001s,Waiting for LB pick' }), 'DEADLINE_EXCEEDED/no-pick')
  assert.equal(grpcCode({ code: status.UNAVAILABLE, details: 'read ECONNRESET' }), 'UNAVAILABLE')
  assert.equal(grpcCode({}), 'NO_STATUS')
})
