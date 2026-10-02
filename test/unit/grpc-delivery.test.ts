import assert from 'node:assert/strict'
import { createServer as createSocketServer } from 'node:net'
import { test } from 'node:test'
import * as grpc from '@grpc/grpc-js'
import { grpcDelivery } from '../../src/main/network/grpc-delivery'

// A Firestore write goes over @grpc/grpc-js. The library tells a call that never had a transport stream apart only by
// the words of its status; these calls are made for real against the installed library, so a change in those words
// fails here rather than quietly turning a write that never left into one that may have been applied.
const method = { path: '/test.Test/Ping', requestStream: false, responseStream: false,
  requestSerialize: (value: Buffer) => value, requestDeserialize: (value: Buffer) => value,
  responseSerialize: (value: Buffer) => value, responseDeserialize: (value: Buffer) => value }
const Client = grpc.makeGenericClientConstructor({ ping: method }, 'Test')
function call(target: string, deadline: number): Promise<grpc.ServiceError> {
  const client = new Client(target, grpc.credentials.createInsecure())
  return new Promise((resolve, reject) => {
    (client as unknown as { ping(request: Buffer, options: grpc.CallOptions, callback: (error: grpc.ServiceError | null) => void): void })
      .ping(Buffer.from('x'), { deadline: Date.now() + deadline }, error => { client.close(); if (error) resolve(error); else reject(new Error('answered')) })
  })
}
const refusals = [grpc.status.INVALID_ARGUMENT, grpc.status.NOT_FOUND, grpc.status.PERMISSION_DENIED, grpc.status.UNAUTHENTICATED]

test('a write to a port nothing listens on never left', async () => {
  const port = await new Promise<number>(done => { const probe = createSocketServer().listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => done(port)) }) })
  const error = await call(`127.0.0.1:${port}`, 5000)
  assert.equal(grpcDelivery(error, refusals), 'not-sent', `${error.code} ${error.details}`)
})

test('a write to a name that does not resolve never left', async () => {
  const error = await call('no-such-host.invalid:443', 5000)
  assert.equal(grpcDelivery(error, refusals), 'not-sent', `${error.code} ${error.details}`)
})

test('a write the server received and never answered may have been applied', async () => {
  const server = new grpc.Server()
  server.addService({ ping: method } as grpc.ServiceDefinition, { ping: () => { /* never answers */ } })
  const port = await new Promise<number>((done, fail) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, bound) => error ? fail(error) : done(bound)))
  try {
    const error = await call(`127.0.0.1:${port}`, 800)
    assert.equal(error.code, grpc.status.DEADLINE_EXCEEDED)
    assert.equal(grpcDelivery(error, refusals), 'unknown', error.details)
  } finally { server.forceShutdown() }
})

test('the server\'s own answer is a refusal only when the caller names it as one', () => {
  assert.equal(grpcDelivery({ code: grpc.status.PERMISSION_DENIED, details: 'Missing or insufficient permissions.' }, refusals), 'refused')
  assert.equal(grpcDelivery({ code: grpc.status.FAILED_PRECONDITION, details: 'the stored version does not match' }, refusals), 'unknown')
  assert.equal(grpcDelivery({ code: grpc.status.UNAVAILABLE, details: 'Connection dropped' }, refusals), 'unknown')
})
