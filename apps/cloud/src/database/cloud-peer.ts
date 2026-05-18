import * as Y from 'yjs';
import { SCHEMA_SQL, TRIGGERS_SQL, mapNodeRowToObject, mapEdgeRowToObject, logger } from '@superapp/core';
import { BetterSQLite3Adapter } from './better-sqlite3-adapter.js';

export class CloudPeer {
  private db: BetterSQLite3Adapter;
  private docs: Map<string, Y.Doc> = new Map();
  private initialized = false;

  constructor(filename = 'cloud_peer.sqlite') {
    this.db = new BetterSQLite3Adapter(filename);
  }

  public async init() {
    if (this.initialized) return;
    
    logger.info('SyncWorker', 'Inicializando banco de dados físico no Cloud Peer...');
    await this.db.exec(SCHEMA_SQL);
    await this.db.exec(TRIGGERS_SQL);
    this.initialized = true;
    logger.info('SyncWorker', 'Banco de dados físico do Cloud Peer pronto.');
  }

  public async getRoomDoc(topic: string): Promise<Y.Doc> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.docs.has(topic)) {
      return this.docs.get(topic)!;
    }

    const doc = this.getOrCreateRoomDoc(topic);
    
    // Hydrate from SQLite cold storage
    try {
      const nodeRows = await this.db.query('SELECT * FROM nodes');
      const edgeRows = await this.db.query('SELECT * FROM edges');
      const existingNodes = nodeRows.map(mapNodeRowToObject);
      const existingEdges = edgeRows.map(mapEdgeRowToObject);

      doc.transact(() => {
        const nodesMap = doc.getMap('nodes');
        for (const node of existingNodes) {
          if (!nodesMap.has(node.id)) {
            nodesMap.set(node.id, node);
          }
        }

        const edgesMap = doc.getMap('edges');
        for (const edge of existingEdges) {
          if (!edgesMap.has(edge.id)) {
            edgesMap.set(edge.id, edge);
          }
        }
      }, 'hydration');

      logger.info('CRDT', `Hydrated room "${topic}" on server with ${existingNodes.length} nodes and ${existingEdges.length} edges.`);
    } catch (err) {
      logger.error('SQLite', `Falha ao hidratar a sala "${topic}" do banco de dados`, err);
    }

    return doc;
  }

  public async handleSyncMessage(
    topic: string, 
    messageBinary: Uint8Array, 
    broadcastCallback: (updateMessage: Uint8Array) => void
  ): Promise<Uint8Array | null> {
    const doc = await this.getRoomDoc(topic);

    const type = messageBinary[0];
    const payload = messageBinary.slice(1);

    if (type === 1) {
      // Client sent State Vector: send back server state vector update
      const stateVector = payload;
      const update = Y.encodeStateAsUpdate(doc, stateVector);
      
      if (update.length > 2) {
        const packet = new Uint8Array(1 + update.length);
        packet[0] = 0; // type 0 = update
        packet.set(update, 1);
        return packet;
      }
    } 
    else if (type === 0) {
      // Client sent Yjs Update: apply locally and notify others
      Y.applyUpdate(doc, payload, 'remote');

      // Observe callback has already saved it to SQLite.
      // Broadcast this update to all other peers in the room
      const packet = new Uint8Array(1 + payload.length);
      packet[0] = 0;
      packet.set(payload, 1);
      broadcastCallback(packet);
    }

    return null;
  }

  private getOrCreateRoomDoc(topic: string): Y.Doc {
    const doc = new Y.Doc();
    this.docs.set(topic, doc);

    // Observe nodes Map
    const nodesMap = doc.getMap('nodes');
    nodesMap.observe(async (event: any, transaction: any) => {
      if (transaction.origin !== 'hydration') {
        const mutations: any[] = [];
        event.changes.keys.forEach((change: any, key: any) => {
          if (change.action === 'add' || change.action === 'update') {
            const val: any = nodesMap.get(key);
            const nodeObj = val instanceof Y.Map ? val.toJSON() : val;
            mutations.push(nodeObj);
          }
        });

        if (mutations.length > 0) {
          logger.info('CRDT', `[Cloud Peer] Persistindo ${mutations.length} nós no SQLite do servidor.`);
          for (const node of mutations) {
            if (!node || !node.id) continue;
            try {
              await this.db.query(
                `INSERT OR IGNORE INTO nodes (id, entity_id, type, pub_key, payload, payload_iv, epoch, created_at, signature, retention_state) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  node.id, node.entity_id, node.type, node.pub_key || null, 
                  node.payload || null, node.payload_iv || null, node.epoch, node.created_at, 
                  node.signature || null, node.retention_state || 'integral'
                ]
              );
            } catch (err) {
              logger.error('SQLite', 'Cloud DB Node Insert Error:', err);
            }
          }
        }
      }
    });

    // Observe edges Map
    const edgesMap = doc.getMap('edges');
    edgesMap.observe(async (event: any, transaction: any) => {
      if (transaction.origin !== 'hydration') {
        const mutations: any[] = [];
        event.changes.keys.forEach((change: any, key: any) => {
          if (change.action === 'add' || change.action === 'update') {
            const val: any = edgesMap.get(key);
            const edgeObj = val instanceof Y.Map ? val.toJSON() : val;
            mutations.push(edgeObj);
          }
        });

        if (mutations.length > 0) {
          logger.info('CRDT', `[Cloud Peer] Persistindo ${mutations.length} arestas no SQLite do servidor.`);
          for (const edge of mutations) {
            if (!edge || !edge.id) continue;
            try {
              await this.db.query(
                `INSERT OR IGNORE INTO edges (id, entity_id, source_id, target_id, type, payload, payload_iv, epoch, weight, created_at, signature, retention_state) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  edge.id, edge.entity_id, edge.source_id, edge.target_id, edge.type,
                  edge.payload || null, edge.payload_iv || null, edge.epoch, edge.weight !== undefined ? edge.weight : 1.0,
                  edge.created_at, edge.signature || null, edge.retention_state || 'integral'
                ]
              );
            } catch (err) {
              logger.error('SQLite', 'Cloud DB Edge Insert Error:', err);
            }
          }
        }
      }
    });

    return doc;
  }

  public async getStats() {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      const nodesCount = await this.db.query('SELECT COUNT(*) FROM nodes');
      const edgesCount = await this.db.query('SELECT COUNT(*) FROM edges');
      return {
        nodes: nodesCount[0][0],
        edges: edgesCount[0][0]
      };
    } catch {
      return { nodes: 0, edges: 0 };
    }
  }
}
