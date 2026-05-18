import fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '@superapp/core';
import * as Y from 'yjs';
import { CloudPeer } from './database/cloud-peer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PeerConnection {
  socket: any; // WebSocket
  peerId: string;
  peerName?: string;
  topics: Set<string>;
}

export function buildServer(cloudPeer?: CloudPeer): FastifyInstance {
  const server = fastify();
  const activePeer = cloudPeer || new CloudPeer(':memory:');

  // Register WebSocket
  server.register(fastifyWebsocket);

  // Health check route
  server.get('/health', async () => {
    return { status: 'ok' };
  });

  // DB state verification route
  server.get('/admin/db-state', async () => {
    const stats = await activePeer.getStats();
    return {
      status: 'online',
      peerId: 'cloud-peer',
      database: stats
    };
  });

  // State for rooms
  // topic -> set of peers
  const topics = new Map<string, Set<PeerConnection>>();
  const connections = new Set<PeerConnection>();

  server.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket, _req) => {
      logger.info('WebRTC', 'Novo cliente WebSocket conectando ao sinalizador...');
      
      const peerConn: PeerConnection = {
        socket,
        peerId: '',
        topics: new Set()
      };
      
      connections.add(peerConn);

      socket.on('message', message => {
        try {
          const msg = JSON.parse(message.toString());

          if (msg.type === 'JOIN') {
            peerConn.peerId = msg.peerId;
            peerConn.peerName = msg.peerName || 'Anonymous';
            const newTopics: string[] = msg.topics || [];

            newTopics.forEach(topic => {
              peerConn.topics.add(topic);
              if (!topics.has(topic)) {
                topics.set(topic, new Set());
              }
              const room = topics.get(topic)!;

              logger.info('WebRTC', `Peer "${peerConn.peerName}" (${peerConn.peerId}) ingressou na sala: "${topic}"`);

              // Notify others in room
              const existingPeers: any[] = [];
              room.forEach(otherPeer => {
                existingPeers.push({ peerId: otherPeer.peerId, peerName: otherPeer.peerName });
                if (otherPeer.socket.readyState === 1) { // OPEN
                  otherPeer.socket.send(JSON.stringify({
                    type: 'PEER_JOINED',
                    topic,
                    peerId: peerConn.peerId,
                    peerName: peerConn.peerName
                  }));
                }
              });

              room.add(peerConn);

              // Tell the joining peer who is already there
              socket.send(JSON.stringify({
                type: 'ROOM_JOINED',
                topic,
                peers: existingPeers
              }));

              // Send the Cloud Peer Yjs State Vector to the client to trigger sync!
              activePeer.getRoomDoc(topic).then(doc => {
                const sv = Y.encodeStateVector(doc);
                const packet = new Uint8Array(1 + sv.length);
                packet[0] = 1; // type 1 = stateVector
                packet.set(sv, 1);

                if (socket.readyState === 1) {
                  socket.send(JSON.stringify({
                    type: 'SYNC_MESSAGE',
                    topic,
                    message: Buffer.from(packet).toString('base64')
                  }));
                }
              }).catch(err => {
                logger.error('CRDT', `[Cloud Peer] Falha ao enviar State Vector para ${peerConn.peerId}`, err);
              });
            });
          } else if (msg.type === 'WEBRTC_MESSAGE') {
            const { targetId, topic, payload } = msg;
            
            logger.debug('WebRTC', `Roteando sinal de "${peerConn.peerName || 'Desconhecido'}" (${peerConn.peerId}) para target "${targetId}" na sala "${topic}" [Payload: ${payload.type}]`);

            const room = topics.get(topic);
            if (room) {
              for (const otherPeer of room) {
                if (otherPeer.peerId === targetId && otherPeer.socket.readyState === 1) {
                  otherPeer.socket.send(JSON.stringify({
                    type: 'WEBRTC_MESSAGE',
                    topic,
                    senderId: peerConn.peerId,
                    payload
                  }));
                  break; // Found the target
                }
              }
            }
          } else if (msg.type === 'SYNC_MESSAGE') {
            const { topic, message } = msg;
            const binary = Buffer.from(message, 'base64');
            
            activePeer.handleSyncMessage(topic, binary, (updatePacket) => {
              // Broadcast this update to all other connected peers in the same topic room
              const room = topics.get(topic);
              if (room) {
                room.forEach(otherPeer => {
                  if (otherPeer.peerId !== peerConn.peerId && otherPeer.socket.readyState === 1) {
                    otherPeer.socket.send(JSON.stringify({
                      type: 'SYNC_MESSAGE',
                      topic,
                      message: Buffer.from(updatePacket).toString('base64')
                    }));
                  }
                });
              }
            }).then(replyPacket => {
              if (replyPacket && socket.readyState === 1) {
                socket.send(JSON.stringify({
                  type: 'SYNC_MESSAGE',
                  topic,
                  message: Buffer.from(replyPacket).toString('base64')
                }));
              }
            }).catch(err => {
              logger.error('CRDT', `[Cloud Peer] Erro ao sincronizar mensagem do peer ${peerConn.peerId}`, err);
            });
          }
        } catch (e) {
          logger.warn('WebRTC', 'Falha ao processar mensagem recebida no sinalizador', {
            error: e,
            rawMessage: message.toString()
          });
        }
      });
      
      socket.on('close', () => {
        logger.info('WebRTC', `Conexão fechada com peer "${peerConn.peerName || 'Anonymous'}" (${peerConn.peerId || 'Sem ID'})`);
        connections.delete(peerConn);
        peerConn.topics.forEach(topic => {
          const room = topics.get(topic);
          if (room) {
            room.delete(peerConn);
            // Notify remaining peers
            room.forEach(otherPeer => {
              if (otherPeer.socket.readyState === 1) {
                otherPeer.socket.send(JSON.stringify({
                  type: 'PEER_LEFT',
                  topic,
                  peerId: peerConn.peerId
                }));
              }
            });
            if (room.size === 0) {
              topics.delete(topic);
            }
          }
        });
      });
    });
  });

  // Serve static files from the React frontend
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  
  server.register(fastifyStatic, {
    root: webDistPath,
    wildcard: false,
  });

  // SPA fallback
  server.setNotFoundHandler((req, reply) => {
    reply.sendFile('index.html');
  });

  return server;
}
