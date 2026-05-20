import * as Comlink from 'comlink';
import * as SQLite from 'wa-sqlite';
// @ts-expect-error wa-sqlite 1.0.0 untyped example
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
import { SCHEMA_SQL, TRIGGERS_SQL } from '@superapp/core/src/database/schema.js';
import { mapNodeRowToObject, mapEdgeRowToObject } from '@superapp/core/src/database/mappers.js';
import { logger } from '@superapp/core/src/logger.js';
import { encryptPayload, decryptPayload, deriveEpochKey } from '@superapp/core/src/security/encryption.js';
import { fromBase64, toBase64 } from '@superapp/core/src/security/utils.js';
import type { DatabaseAdapter } from '@superapp/core';
import { CRDTManager } from './network/crdt-manager';
import { ulid } from 'ulid';

let dbAdapter: DatabaseAdapter | null = null;
let sqlite3: any | null = null;
let changeListener: (() => void) | null = null;
let coalescenceInterval: any = null;

// Session key management for E2EE
let sessionMasterKey: Uint8Array | null = null;
let sessionActiveEpoch = 1;
let activeEpochKey: Uint8Array | null = null;
const epochKeysCache = new Map<number, Uint8Array>();

async function getEpochKey(epoch: number): Promise<Uint8Array | null> {
  if (epochKeysCache.has(epoch)) {
    return epochKeysCache.get(epoch)!;
  }
  if (!sessionMasterKey) return null;
  const key = await deriveEpochKey(sessionMasterKey, epoch);
  epochKeysCache.set(epoch, key);
  return key;
}

async function decryptPayloadIfNeeded(
  payload: Uint8Array | string | null,
  iv: Uint8Array | null,
  epoch: number
): Promise<string | null> {
  if (!payload || !iv) {
    if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
    return payload;
  }
  try {
    const key = await getEpochKey(epoch);
    if (!key) {
      if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
      return payload as string;
    }
    const ciphertext = typeof payload === 'string' ? fromBase64(payload) : payload;
    const decryptedBytes = await decryptPayload(ciphertext, key, iv);
    return new TextDecoder().decode(decryptedBytes);
  } catch (err) {
    logger.warn('Crypto', `Failed to decrypt payload for epoch ${epoch}:`, err);
    if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
    return payload as string;
  }
}

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
            else if (param instanceof Uint8Array) this.sqlite3.bind_blob(stmt, i + 1, param);
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
let activeAuthRoom: string | null = null;
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

    const LOCAL_DDL = `
      CREATE TABLE IF NOT EXISTS snapshots (
        room_id TEXT PRIMARY KEY,
        bin BLOB NOT NULL,
        state_vector BLOB,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS yjs_updates (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        update_bin BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_staging (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        path TEXT NOT NULL,
        userId TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_yjs_updates_room ON yjs_updates(room_id, created_at);
    `;

    try {
      const openedDb = await sqlite3.open_v2(dbName, SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, 'opfs');
      dbAdapter = new WASQLiteAdapter(sqlite3, openedDb);
      await dbAdapter.exec(SCHEMA_SQL);
      await dbAdapter.exec(TRIGGERS_SQL);
      await dbAdapter.exec(LOCAL_DDL);
    } catch (err: any) {
      logger.error('SQLite', 'Failed to initialize database, attempting recovery and recreation', err);
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(dbName).catch(() => {});
        
        const openedDb = await sqlite3.open_v2(dbName, SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, 'opfs');
        dbAdapter = new WASQLiteAdapter(sqlite3, openedDb);
        await dbAdapter.exec(SCHEMA_SQL);
        await dbAdapter.exec(TRIGGERS_SQL);
        await dbAdapter.exec(LOCAL_DDL);
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
    
    const crdtPersistence = {
      async saveUpdate(topic: string, update: Uint8Array) {
        if (!dbAdapter) return;
        const id = ulid();
        await SyncWorkerAPI.query(
          "INSERT INTO yjs_updates (id, room_id, update_bin, created_at) VALUES (?, ?, ?, ?)",
          [id, topic, update, Date.now()]
        );
      },
      async loadSnapshot(topic: string) {
        if (!dbAdapter) return null;
        const rows = await SyncWorkerAPI.query(
          "SELECT bin, state_vector FROM snapshots WHERE room_id = ?",
          [topic]
        );
        if (rows.length === 0) return null;
        return {
          bin: rows[0][0],
          state_vector: rows[0][1]
        };
      },
      async loadUpdates(topic: string) {
        if (!dbAdapter) return [];
        const rows = await SyncWorkerAPI.query(
          "SELECT update_bin FROM yjs_updates WHERE room_id = ? ORDER BY created_at ASC",
          [topic]
        );
        return rows.map((row: any) => row[0]);
      },
      async saveSnapshot(topic: string, bin: Uint8Array, stateVector: Uint8Array) {
        if (!dbAdapter) return;
        await SyncWorkerAPI.query(
          "INSERT OR REPLACE INTO snapshots (room_id, bin, state_vector, updated_at) VALUES (?, ?, ?, ?)",
          [topic, bin, stateVector, Date.now()]
        );
      },
      async clearUpdates(topic: string) {
        if (!dbAdapter) return;
        await SyncWorkerAPI.query(
          "DELETE FROM yjs_updates WHERE room_id = ?",
          [topic]
        );
      }
    };

    crdt = new CRDTManager(networkBridge, crdtPersistence);
    
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

    // Hydrate Y.Doc with existing database nodes and edges (excluding private authentication nodes)
    const nodeRows = await this.query("SELECT * FROM nodes WHERE type != 'PROFILE:AUTHENTICATION'");
    const edgeRows = await this.query(`
      SELECT e.* FROM edges e 
      JOIN nodes s ON e.source_id = s.id 
      JOIN nodes t ON e.target_id = t.id 
      WHERE s.type != 'PROFILE:AUTHENTICATION' AND t.type != 'PROFILE:AUTHENTICATION'
    `);
    const existingNodes = nodeRows.map(mapNodeRowToObject);
    const existingEdges = edgeRows.map(mapEdgeRowToObject);
    
    crdt.hydrate('global-room', existingNodes, existingEdges);

    // Join the global topic to prove the concept
    crdt.joinContext('global-room');

    // Run recovery on startup for residual staging entries
    await SyncWorkerAPI.runCoalescence().catch(err => {
      logger.error('MFA-S', 'Failed to run startup coalescence recovery:', err);
    });

    // Start periodic semantic compiler (every 10s)
    if (!coalescenceInterval) {
      coalescenceInterval = setInterval(async () => {
        try {
          await SyncWorkerAPI.runCoalescence();
        } catch (e) {
          logger.error('MFA-S', 'Error during background coalescence:', e);
        }
      }, 10000);
    }

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
    
    // Encrypt sensitive payload if key is available and not already encrypted
    if (
      (nodeData.type.startsWith('CONTENT:') || nodeData.type === 'POST') &&
      activeEpochKey &&
      (!nodeData.payload_iv || nodeData.payload_iv.length === 0)
    ) {
      const payloadBytes = typeof nodeData.payload === 'string'
        ? new TextEncoder().encode(nodeData.payload)
        : nodeData.payload;
        
      if (payloadBytes) {
        const { ciphertext, iv } = await encryptPayload(payloadBytes, activeEpochKey);
        nodeData.payload = ciphertext;
        nodeData.payload_iv = iv;
        nodeData.epoch = sessionActiveEpoch;
      }
    }

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

    // 2. Inject into Y.js, which auto-encodes and broadcasts
    if (crdt) {
      if (nodeData.type === 'PROFILE:AUTHENTICATION') {
        if (activeAuthRoom) {
          crdt.injectLocalNode(activeAuthRoom, nodeData);
        }
      } else {
        crdt.injectLocalNode('global-room', nodeData);
      }
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

    // 2. Inject into Y.js, which auto-encodes and broadcasts
    if (crdt) {
      if (edgeData.type.startsWith('AUTH_') || edgeData.type === 'AUTHENTICATION') {
        if (activeAuthRoom) {
          crdt.injectLocalEdge(activeAuthRoom, edgeData);
        }
      } else {
        crdt.injectLocalEdge('global-room', edgeData);
      }
    }
  },

  async getConnectionStatus() {
    return 'Desconectado / Aguardando';
  },

  async joinAuthRoom(userIdHash: string) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    activeAuthRoom = `auth-room:${userIdHash}`;
    
    // Hydrate the private auth room with our local credentials
    const authNodeRows = await this.query("SELECT * FROM nodes WHERE type = 'PROFILE:AUTHENTICATION'");
    const existingAuthNodes = authNodeRows.map(mapNodeRowToObject);
    
    if (crdt) {
      crdt.hydrate(activeAuthRoom, existingAuthNodes, []);
      crdt.joinContext(activeAuthRoom);
    }
    logger.info('SyncWorker', `Ingressou na sala privada de autenticação: ${activeAuthRoom}`);
    return true;
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

  async ensureTable(tableName: string, columns: string[]) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    
    // 1. Create table with id if not exists
    await dbAdapter.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY)`);
    
    // 2. Get existing columns
    const columnsInfo = await dbAdapter.query(`PRAGMA table_info(${tableName})`);
    const existingCols = new Set(columnsInfo.map((row: any) => row[1]));
    
    // 3. Alter table for missing columns
    for (const col of columns) {
      if (col !== 'id' && !existingCols.has(col)) {
        await dbAdapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col} TEXT`);
      }
    }
  },

  async saveIntent(intent: any) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    await this.ensureTable('pending_intents', ['entity_id', 'type', 'payload', 'created_at', 'status', 'error_message']);
    await this.query(
      `INSERT OR REPLACE INTO pending_intents (id, entity_id, type, payload, created_at, status, error_message) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        intent.id,
        intent.entity_id,
        intent.type,
        intent.payload || null,
        intent.created_at,
        intent.status || 'pending',
        intent.error_message || null
      ]
    );
  },

  async saveAuditLog(log: any) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    
    const nodeData = {
      id: log.id,
      entity_id: log.document_id,
      type: 'CONTENT:AUDIT',
      epoch: 1,
      created_at: log.created_at,
      retention_state: 'integral',
      payload: JSON.stringify({
        path: log.path,
        userId: log.userId,
        before_value: log.before_value || null,
        after_value: log.after_value || null,
        vector_clock: log.vector_clock || null,
        status: log.status || 'active'
      })
    };

    await SyncWorkerAPI.injectAndBroadcastNode(nodeData);
  },

  async saveStagingEntry(entry: {
    document_id: string;
    path: string;
    userId: string;
    value: string;
  }) {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    const id = ulid();
    await this.query(
      `INSERT INTO pending_staging (id, document_id, path, userId, value, created_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, entry.document_id, entry.path, entry.userId, entry.value, Date.now()]
    );
    if (changeListener) {
      changeListener();
    }
  },

  async runCoalescence() {
    if (!dbAdapter) return;
    
    // 1. Fetch all pending staging entries
    const rows = await this.query(
      "SELECT id, document_id, path, userId, value, created_at FROM pending_staging ORDER BY created_at ASC"
    );
    if (rows.length === 0) return;

    logger.info('MFA-S', `Running coalescence on ${rows.length} staging entries...`);

    // 2. Group by (document_id, path, userId)
    const groups: Record<string, {
      document_id: string;
      path: string;
      userId: string;
      entries: Array<{ id: string; value: string; created_at: number }>;
    }> = {};

    for (const row of rows) {
      const id = row[0];
      const docId = row[1];
      const path = row[2];
      const userId = row[3];
      const value = row[4];
      const createdAt = row[5];

      const groupKey = `${docId}:${path}:${userId}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          document_id: docId,
          path,
          userId,
          entries: []
        };
      }
      groups[groupKey].entries.push({ id, value, created_at: createdAt });
    }

    // 3. Process each group
    for (const [groupKey, group] of Object.entries(groups)) {
      // Find before_value: we can query the latest CONTENT:AUDIT node for this document/path to see what the value was,
      // or if none exists, before_value is empty.
      const latestAuditRows = await this.query(
        `SELECT payload, payload_iv, epoch FROM nodes 
         WHERE entity_id = ? AND type = 'CONTENT:AUDIT' 
         ORDER BY created_at DESC LIMIT 1`,
        [group.document_id]
      );
      
      let beforeValue = '';
      if (latestAuditRows.length > 0) {
        const payloadRaw = latestAuditRows[0][0];
        const ivRaw = latestAuditRows[0][1];
        const epochRaw = latestAuditRows[0][2];
        
        try {
          const decrypted = await decryptPayloadIfNeeded(payloadRaw, ivRaw, epochRaw);
          if (decrypted) {
            const parsed = JSON.parse(decrypted);
            if (parsed.path === group.path) {
              beforeValue = parsed.after_value || '';
            }
          }
        } catch (e) {
          console.error("Failed to parse previous audit payload for beforeValue:", e);
        }
      }

      // Calculate after_value
      const lastEntry = group.entries[group.entries.length - 1];
      const afterValue = lastEntry.value;

      // Only create an audit log if the value actually changed
      if (beforeValue !== afterValue) {
        const logId = ulid();
        await this.saveAuditLog({
          id: logId,
          document_id: group.document_id,
          path: group.path,
          userId: group.userId,
          before_value: beforeValue,
          after_value: afterValue,
          vector_clock: JSON.stringify({}),
          created_at: Date.now(),
          status: 'active'
        });
      }

      // 4. Delete the processed entries from pending_staging
      const entryIds = group.entries.map(e => e.id);
      for (const entryId of entryIds) {
        await this.query("DELETE FROM pending_staging WHERE id = ?", [entryId]);
      }
    }

    // Notify TinyBase that projections changed
    if (changeListener) {
      changeListener();
    }
  },

  async compactSnapshot(topic: string) {
    if (!crdt) return;
    await crdt.compactSnapshot(topic);
  },

  async resetDatabase() {
    if (!dbAdapter) throw new Error("SQLite not initialized");
    
    // Find all tables dynamically and delete rows from each
    const tablesInfo = await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const tables = tablesInfo.map((row: any) => row[0]);
    for (const tableName of tables) {
      await this.exec(`DELETE FROM ${tableName}`);
    }
    
    if (changeListener) {
      changeListener();
    }
    return true;
  },

  async setSessionKeys(masterKeyBase64: string, activeEpoch: number) {
    sessionMasterKey = fromBase64(masterKeyBase64);
    sessionActiveEpoch = activeEpoch;
    activeEpochKey = await deriveEpochKey(sessionMasterKey, activeEpoch);
    epochKeysCache.clear();
    epochKeysCache.set(activeEpoch, activeEpochKey);
    logger.info('SyncWorker', `Chaves de sessão configuradas para época ${activeEpoch}.`);
    return true;
  },

  async clearSessionKeys() {
    sessionMasterKey = null;
    sessionActiveEpoch = 1;
    activeEpochKey = null;
    epochKeysCache.clear();
    logger.info('SyncWorker', 'Chaves de sessão limpas.');
    return true;
  },

  async getDecryptedAuditLogs() {
    const rows = await this.query(
      "SELECT id, entity_id, payload, payload_iv, epoch, created_at FROM nodes WHERE type = 'CONTENT:AUDIT' ORDER BY created_at DESC"
    );
    const results: any[] = [];
    for (const row of rows) {
      const id = row[0];
      const entity_id = row[1];
      const payload = row[2];
      const iv = row[3];
      const epoch = row[4];
      const created_at = row[5];
      
      const decrypted = await decryptPayloadIfNeeded(payload, iv, epoch);
      results.push({ id, entity_id, decryptedPayload: decrypted, created_at });
    }
    return results;
  }
};

Comlink.expose(SyncWorkerAPI);

