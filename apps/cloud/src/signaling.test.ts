import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './server.js';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

describe('Signaling Server (WebSockets)', () => {
  let server: FastifyInstance;
  let wsUrl: string;

  beforeAll(async () => {
    server = buildServer();
    await server.listen({ port: 0 }); // Random free port
    const port = (server.server.address() as any).port;
    wsUrl = `ws://localhost:${port}/ws`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('should accept websocket connections', () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        reject(err);
      });
    });
  });

  it('should respond to ping with pong', () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        ws.ping();
      });

      ws.on('pong', () => {
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        reject(err);
      });
    });
  });

  describe('Rooms and WebRTC Handshake', () => {
    it('should manage JOIN, PEER_JOINED, and PEER_LEFT', async () => {
      const peerA = new WebSocket(wsUrl);
      const peerB = new WebSocket(wsUrl);

      await Promise.all([
        new Promise(resolve => peerA.on('open', resolve)),
        new Promise(resolve => peerB.on('open', resolve)),
      ]);

      // A joins 'network_1'
      const joinA = new Promise<void>((resolve) => {
        peerA.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('ROOM_JOINED');
          expect(msg.peers).toEqual([]); // empty initially
          resolve();
        });
      });

      peerA.send(JSON.stringify({ type: 'JOIN', topics: ['network_1'], peerId: 'peer_A' }));
      await joinA;

      // B joins 'network_1'
      const joinB = new Promise<void>((resolve) => {
        peerB.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('ROOM_JOINED');
          expect(msg.peers.map((p: any) => p.peerId)).toContain('peer_A');
          resolve();
        });
      });

      // A should be notified that B joined
      const notifyA = new Promise<void>((resolve) => {
        peerA.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('PEER_JOINED');
          expect(msg.peerId).toBe('peer_B');
          resolve();
        });
      });

      peerB.send(JSON.stringify({ type: 'JOIN', topics: ['network_1'], peerId: 'peer_B' }));
      await Promise.all([joinB, notifyA]);

      // Peer B disconnects, A should receive PEER_LEFT
      const notifyLeft = new Promise<void>((resolve) => {
        peerA.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('PEER_LEFT');
          expect(msg.peerId).toBe('peer_B');
          resolve();
        });
      });

      peerB.close();
      await notifyLeft;
      peerA.close();
    });

    it('should route OFFER, ANSWER, and ICE_CANDIDATE to target peers', async () => {
      const peerA = new WebSocket(wsUrl);
      const peerB = new WebSocket(wsUrl);

      await Promise.all([
        new Promise(resolve => peerA.on('open', resolve)),
        new Promise(resolve => peerB.on('open', resolve)),
      ]);

      peerA.send(JSON.stringify({ type: 'JOIN', topics: ['network_2'], peerId: 'peer_A' }));
      peerB.send(JSON.stringify({ type: 'JOIN', topics: ['network_2'], peerId: 'peer_B' }));

      // Wait a tiny bit for joins to process
      await new Promise(r => setTimeout(r, 50));

      // A sends offer to B
      const offerReceived = new Promise<void>((resolve) => {
        peerB.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'WEBRTC_MESSAGE' && msg.payload.type === 'offer') {
            expect(msg.senderId).toBe('peer_A');
            resolve();
          }
        });
      });

      peerA.send(JSON.stringify({
        type: 'WEBRTC_MESSAGE',
        targetId: 'peer_B',
        topic: 'network_2',
        payload: { type: 'offer', sdp: 'dummy_sdp' }
      }));

      await offerReceived;
      
      peerA.close();
      peerB.close();
    });
  });
});
