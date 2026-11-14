import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { listenLoopback } from '../bridge/bind.mjs';

test('JARVIS computer-control bridge binds only to IPv4 loopback', async () => {
  const server = createServer();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      listenLoopback(server, 0, resolve);
    });

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }
});
