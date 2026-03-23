import * as net from 'node:net';
import { ensurePortAvailable } from './utils';

function listen(server: net.Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
}

function close(server: net.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('ensurePortAvailable', () => {
  it('rejects when the target port is already listening', async () => {
    const occupiedServer = net.createServer();
    await listen(occupiedServer, 0);
    const address = occupiedServer.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    await expect(
      ensurePortAvailable(address.port, '127.0.0.1'),
    ).rejects.toThrow(`Port ${address.port} is already in use`);

    await close(occupiedServer);
  });

  it('resolves when the target port is free', async () => {
    const probeServer = net.createServer();
    await listen(probeServer, 0);
    const address = probeServer.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    const freePort = address.port;
    await close(probeServer);

    await expect(
      ensurePortAvailable(freePort, '127.0.0.1'),
    ).resolves.toBeUndefined();
  });
});
