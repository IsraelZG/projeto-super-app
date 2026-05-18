import { buildServer } from './server.js';
import { logger } from '@superapp/core';
import { CloudPeer } from './database/cloud-peer.js';

const start = async () => {
  const cloudPeer = new CloudPeer();
  await cloudPeer.init();

  const server = buildServer(cloudPeer);
  
  try {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await server.listen({ port, host });
    logger.info('WebRTC', `Cloud Node Seed / Signaling Server rodando em http://${host}:${port}`);
    logger.info('WebRTC', `Websocket Endpoint ativo em ws://${host}:${port}/ws`);
  } catch (err: any) {
    logger.error('WebRTC', 'Erro catastrófico ao inicializar o Cloud Node Seed', err);
    process.exit(1);
  }
};

start();
