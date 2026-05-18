import * as Comlink from 'comlink';
import * as SQLite from 'wa-sqlite';
// @ts-expect-error wa-sqlite 1.0.0 untyped example
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
import { 
  SCHEMA_SQL, 
  TRIGGERS_SQL, 
  mapNodeRowToObject, 
  mapEdgeRowToObject, 
  logger 
} from '@superapp/core';
import type { DatabaseAdapter } from '@superapp/core';
import { CRDTManager } from './network/crdt-manager';

let dbAdapter: DatabaseAdapter | null = null;
let sqlite3: any | null = null;
let changeListener: (() => void) | null = null;

let queryQueue: Promise<any> = Promise.resolve();

async function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queryQueue.then(operation);
  queryQueue = next.catch(() => {});
  return next;
}

class WASQLiteAdapter implements DatabaseAdapter {
  private sqlite3: any;
  private db: number;

  constructor(sqlite3: any, db: number) {
    this.sqlite3 = sqlite3;
    this.db = db;
  }

  async exec(sql: string): Promise<void> {
    return enqueue(async () => {
      await this.sqlite3.exec(this.db, sql);
    });
  }

  async query(sql: string, bindParams: any[] = []): Promise<any[][]> {
    return enqueue(async () => {
      const results: any[][] = [];
      for await (const stmt of this.sqlite3.statements(this.db, sql)) {
        if (bindParams.length > 0) {
          for (let i = 0; i < bindParams.length; i++) {
            let param = bindParams[i];
            if (typeof param === 'string') this.sqlite3.bind_text(stmt, i + 1, param);
            else if (typeof param === 'number') this.sqlite3.bind_double(stmt, i + 1, param);
            else if (param === null) this.sqlite3.bind_null(stmt, i + 1);
          }
        }

        while (await this.sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
          const row = this.sqlite3.row(stmt);
          results.push(row);
        }
      }
      return results;
    });
  }

  async close(): Promise<void> {
    if (this.sqlite3 && this.db) {
      await this.sqlite3.close(this.db);
    }
  }
}

let crdt: CRDTManager | null = null;
let networkPort: MessagePort | null = null;
let onMessageCallback: ((peerId: string, topic: string, message: Uint8Array) => void) | null = null;
let onConnectionCallback: ((peerId: string) => void) | null = null;

const networkBridge = {
  setOnMessage(handler: (peerId: string, topic: string, message: Uint8Array) => void) {
    onMessageCallback = handler;
  },
  setOnConnection(handler: (peerId: string) => void) {
    onConnectionCallback = handler;
  },
  broadcast(topic: string, message: Uint8Array) {
    if (networkPort) {
      networkPort.postMessage({ type: 'broadcast', topic, message });
    }
  },
  joinTopic(topic: string) {
    if (networkPort) {
      networkPort.postMessage({ type: 'joinTopic', topic });
    }
  }
};

export const SyncWorkerAPI = {
  async init(dbName = 'superapp.sqlite', peerName?: string, port?: MessagePort) {
    if (sqlite3) return true;
    
    logger.info('SyncWorker', 'Initializing SyncWorker for peer', { peerName, dbName });
    
    const { default: moduleFactory } = await import('wa-sqlite/dist/wa-sqlite-async.mjs');
    sqlite3 = SQLite.Factory(await moduleFactory());

    const vfs = new OriginPrivateFileSystemVFS();
    sqlite3.vfs_register(vfs, true);

    try {
      const openedDb = await sqlite3.open_v2(dbName, SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, 'opfs');
      dbAdapter = new WASQLiteAdapter(sqlite3, openedDb);
      await dbAdapter.exec(SCHEMA_SQL);
      await dbAdapter.exec(TRIGGERS_SQL);
    } catch (err: any) {
      logger.error('SQLite', 'Failed to initialize database, attempting recovery and recreation', err);
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(dbName).catch(() => {});
        
        const openedDb = await sqlite3.open_v2(dbName, SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, 'opfs');
        dbAdapter = new WASQLiteAdapter(sqlite3, openedDb);
        await dbAdapter.exec(SCHEMA_SQL);
        await dbAdapter.exec(TRIGGERS_SQL);
      } catch (recoveryErr) {
        logger.error('SQLite', 'Database recovery failed completely', recoveryErr);
        throw err;
      }
    }

    if (port) {
      networkPort = port;
      networkPort.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'message' && onMessageCallback) {
          onMessageCallback(data.peerId, data.topic, data.message);
        } else if (data.type === 'connection' && onConnectionCallback) {
          onConnectionCallback(data.peerId);
        }
      };
    }
    
    crdt = new CRDTManager(networkBridge);
    
    // When Y.js receives remote mutations via WebRTC, save them to SQLite!
    crdt.setOnRemoteData(async (_topic, nodes, edges) => {
      if (nodes.length > 0) {
        logger.info('CRDT', `Received ${nodes.length} remote nodes from network!`, nodes);
        for (const node of nodes) {
          if (!node || !node.id) continue;
          try {
            await SyncWorkerAPI.query(
              `INSERT OR IGNORE INTO nodes (id, entity_id, type, pub_key, payload, payload_iv, epoch, created_at, signature, retention_state) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                node.id, node.entity_id, node.type, node.pub_key || null, 
                node.payload || null, node.payload_iv || null, node.epoch, node.created_at, 
                node.signature || null, node.retention_state || 'integral'
              ]
            );
          } catch (err) {
            logger.error('SQLite', 'DB Node Insert Error:', err);
          }
        }
      }

      if (edges.length > 0) {
        logger.info('CRDT', `Received ${edges.length} remote edges from network!`, edges);
        for (const edge of edges) {
          if (!edge || !edge.id) continue;
          try {
            await SyncWorkerAPI.query(
              `INSERT OR IGNORE INTO edges (id, entity_id, source_id, target_id, type, payload, payload_iv, epoch, weight, created_at, signature, retention_state) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                edge.id, edge.entity_id, edge.source_id, edge.target_id, edge.type,
                edge.payload || null, edge.payload_iv || null, edge.epoch, edge.weight !== undefined ? edge.weight : 1.0,
                edge.created_at, edge.signature || null, edge.retention_state || 'integral'
              ]
            );
          } catch (err) {
            logger.error('SQLite', 'DB Edge Insert Error:', err);
          }
        }
      }
      
      // Notify TinyBase that projections might have changed!
      if (changeListener) {
        changeListener();
      }
    });

    // Hydrate Y.Doc with existing database nodes and edges!
    const nodeRows = await this.query('SELECT * FROM nodes');
    const edgeRows = await this.query('SELECT * FROM edges');
    const existingNodes = nodeRows.map(mapNodeRowToObject);
    const existingEdges = edgeRows.map(mapEdgeRowToObject);
    
    crdt.hydrate('global-room', existingNodes, existingEdges);

    // Join the global topic to prove the concept
    crdt.joinContext('global-room');

    return true;
  },

  async exec(sql: string) {
    if (!dbAdapter) throw new Error("DB not initialized");
    await dbAdapter.exec(sql);
  },

  async query(sql: string, bindParams: any[] = []) {
    if (!dbAdapter) throw new Error("DB not initialized");
    const results = await dbAdapter.query(sql, bindParams);

    const isMutation = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
    if (isMutation && changeListener) {
      changeListener();
    }

    return results;
  },

  setChangeListener(listener: () => void) {
    changeListener = listener;
  },

  async injectAndBroadcastNode(nodeData: any) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    
    // 1. Write to SQLite (Local Offline-First)
    await SyncWorkerAPI.query(
      `INSERT INTO nodes (id, entity_id, type, pub_key, payload, payload_iv, epoch, created_at, signature, retention_state) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nodeData.id, 
        nodeData.entity_id, 
        nodeData.type, 
        nodeData.pub_key || null, 
        nodeData.payload || null, 
        nodeData.payload_iv || null, 
        nodeData.epoch, 
        nodeData.created_at, 
        nodeData.signature || null, 
        nodeData.retention_state || 'integral'
      ]
    );

    // 2. Inject into Y.js, which auto-encodes and broadcasts via WebRTC
    if (crdt) {
      crdt.injectLocalNode('global-room', nodeData);
    }
  },

  async injectAndBroadcastEdge(edgeData: any) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    
    // 1. Write to SQLite (Local Offline-First)
    await SyncWorkerAPI.query(
      `INSERT INTO edges (id, entity_id, source_id, target_id, type, payload, payload_iv, epoch, weight, created_at, signature, retention_state) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edgeData.id, 
        edgeData.entity_id, 
        edgeData.source_id, 
        edgeData.target_id, 
        edgeData.type, 
        edgeData.payload || null, 
        edgeData.payload_iv || null, 
        edgeData.epoch, 
        edgeData.weight !== undefined ? edgeData.weight : 1.0, 
        edgeData.created_at, 
        edgeData.signature || null, 
        edgeData.retention_state || 'integral'
      ]
    );

    // 2. Inject into Y.js, which auto-encodes and broadcasts via WebRTC
    if (crdt) {
      crdt.injectLocalEdge('global-room', edgeData);
    }
  },

  async getConnectionStatus() {
    return 'Desconectado / Aguardando';
  },

  async getCRDTState(topic = 'global-room') {
    if (!crdt) return { nodes: 0, edges: 0 };
    const doc = (crdt as any).docs.get(topic);
    if (!doc) return { nodes: 0, edges: 0 };
    return {
      nodes: doc.getMap('nodes').size,
      edges: doc.getMap('edges').size
    };
  },

  async getConnectedPeers() {
    return [];
  },

  async resetDatabase() {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    await this.exec(`DELETE FROM nodes; DELETE FROM edges; DELETE FROM entity_heads; DELETE FROM active_edges;`);
    if (changeListener) {
      changeListener();
    }
    return true;
  }
};

Comlink.expose(SyncWorkerAPI);

