'use strict'
const { test } = require('tap')
const proxyquire = require('proxyquire')
const WebSocket = require('ws')
const fastify = require('fastify')
const mq = require('mqemitter')
const SubscriptionConnection = require('../lib/subscription-connection')
const { PubSub } = require('../lib/subscriber')

test('socket is closed on unhandled promise rejection in handleMessage', t => {
  t.plan(1)
  let handleConnectionCloseCalled = false
  class MockSubscriptionConnection extends SubscriptionConnection {
    async handleMessage (message) {
      throw new Error('error')
      // return Promise.reject(new Error('some error'))
    }

    handleConnectionClose () {
      handleConnectionCloseCalled = true
      this.socket.close()
    }
  }

  const subscription = proxyquire('../lib/subscription', {
    './subscription-connection': MockSubscriptionConnection
  })

  const app = fastify()
  t.tearDown(() => app.close())
  app.register(subscription, {
    getOptions: {
      url: '/graphql',
      method: 'GET',
      handler: async function (request, reply) {
        return 'ok'
      }
    },
    schema: `
      type Subscribtion {
        onMessage: String
      }
    `,
    subscriber: new PubSub(mq())
  })

  app.listen(0, () => {
    const url = 'ws://localhost:' + (app.server.address()).port + '/graphql'
    const ws = new WebSocket(url, 'graphql-ws')
    const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8', objectMode: true })
    t.tearDown(client.destroy.bind(client))

    client.on('error', () => {})
    client.setEncoding('utf8')
    client.write(JSON.stringify({
      type: 'connection_init_error'
    }))
    ws.on('close', () => {
      t.is(handleConnectionCloseCalled, true)
    })
  })
})

test('subscripction connection sends error message when message is not json string', async (t) => {
  const sc = new SubscriptionConnection({
    on () {},
    send (message) {
      t.equal(JSON.stringify({
        type: 'error',
        id: null,
        payload: 'Message must be a JSON string'
      }), message)
    }
  }, {})

  await sc.handleMessage('invalid json string')
})

test('subscription connection handles GQL_CONNECTION_TERMINATE message correctly', async (t) => {
  const sc = new SubscriptionConnection({
    on () {},
    close () { t.pass() },
    send (message) {}
  }, {})

  await sc.handleMessage(JSON.stringify({
    id: 1,
    type: 'connection_terminate'
  }))
})

test('subscription connection handles GQL_STOP message correctly', async (t) => {
  t.plan(2)
  const sc = new SubscriptionConnection({
    on () {},
    close () {},
    send (message) {}
  }, {})

  sc.subscriptionContexts = new Map()
  sc.subscriptionContexts.set(1, {
    close () {
      t.pass()
    }
  })

  await sc.handleMessage(JSON.stringify({
    id: 1,
    type: 'stop'
  }))

  t.equal(sc.subscriptionContexts.size, 0)
})

test('handles error in send and closes connection', async t => {
  const sc = new SubscriptionConnection(
    {
      send (message) {
        throw new Error('Socket closed')
      },
      close () {
        t.pass()
      },
      on () {}
    },
    {}
  )

  await sc.sendMessage('foo')
})

test('subscription connection handles GQL_STOP message correctly, with no data', async (t) => {
  const sc = new SubscriptionConnection({
    on () {},
    close () {},
    send (message) {}
  }, {})

  await sc.handleMessage(JSON.stringify({
    id: 1,
    type: 'stop'
  }))

  t.notOk(sc.subscriptionContexts.get(0))
})

test('subscription connection send error message when GQL_START handler errs', async (t) => {
  const sc = new SubscriptionConnection({
    on () {},
    close () {},
    send (message) {
      t.equal(JSON.stringify({
        id: 1,
        type: 'error',
        payload: 'handleGQLStart error'
      }), '{"id":1,"type":"error","payload":"handleGQLStart error"}')
    }
  }, {})

  sc.handleGQLStart = async (data) => {
    throw new Error('handleGQLStart error')
  }

  await sc.handleMessage(JSON.stringify({
    id: 1,
    type: 'start',
    payload: { }
  }))
})

test('subscription connection send error message when client message type is invalid', async (t) => {
  const sc = new SubscriptionConnection({
    on () {},
    close () {},
    send (message) {
      t.equal(JSON.stringify({
        id: 1,
        type: 'error',
        payload: 'Invalid payload type'
      }), '{"id":1,"type":"error","payload":"Invalid payload type"}')
    }
  }, {})

  await sc.handleMessage(JSON.stringify({
    id: 1,
    type: 'invalid-type',
    payload: { }
  }))
})

test('subscription connection handles GQL_START message correctly, when payload.query is not defined', async (t) => {
  const sc = new SubscriptionConnection({
    on () {},
    close () {},
    send (message) {}
  }, {})

  await sc.handleMessage(JSON.stringify({
    id: 1,
    type: 'start',
    payload: { }
  }))
})
