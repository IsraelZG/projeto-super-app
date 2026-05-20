import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Comlink from 'comlink';
import { ulid } from 'ulid';

import { createSuperAppStore } from './tinybase.js';
import type { SyncWorkerAPI } from '../worker/sync-worker.js';

describe('TinyBase Integration (Phase 4)', () => {
  let workerApi: Comlink.Remote<typeof SyncWorkerAPI>;
  let worker: Worker;

  beforeAll(async () => {
    worker = new Worker(new URL('../worker/sync-worker.ts', import.meta.url), { type: 'module' });
    workerApi = Comlink.wrap<typeof SyncWorkerAPI>(worker);
    await workerApi.init('tinybase_test.sqlite');
    
    await workerApi.exec('DELETE FROM edges');
    await workerApi.exec('DELETE FROM nodes');
    await workerApi.exec('DELETE FROM entity_heads');
    await workerApi.exec('DELETE FROM active_edges');
  });

  afterAll(() => {
    worker.terminate();
  });
  
  async function waitForTableRecord(store: any, tableName: string, recordId: string, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const table = store.getTable(tableName);
      if (table && table[recordId] !== undefined) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout waiting for record ${recordId} in table ${tableName}`);
  }

  it('should load initial state into TinyBase', async () => {
    const { store, persister } = createSuperAppStore(workerApi);
    await persister.startAutoLoad();
    expect(store.getTable('entity_heads')).toEqual({});
  });

  it('should react to worker mutations and load pending intents automatically', async () => {
    const { store, persister } = createSuperAppStore(workerApi);
    await persister.startAutoLoad();

    const intentId = ulid();
    const entityId = ulid();
    
    await workerApi.saveIntent({
      id: intentId,
      entity_id: entityId,
      type: 'CONTENT:PURCHASE_ORDER',
      payload: JSON.stringify({ price: 100 }),
      created_at: Date.now(),
      status: 'pending'
    });

    // Wait until the record is synced
    await waitForTableRecord(store, 'pending_intents', intentId);

    const table = store.getTable('pending_intents');
    expect(table[intentId]).toBeDefined();
    expect(table[intentId].entity_id).toBe(entityId);
    expect(table[intentId].type).toBe('CONTENT:PURCHASE_ORDER');
    
    persister.destroy();
  });

  it('should react to worker mutations and load audit logs automatically', async () => {
    const { store, persister } = createSuperAppStore(workerApi);
    await persister.startAutoLoad();

    const logId = ulid();
    const docId = ulid();
    
    await workerApi.saveAuditLog({
      id: logId,
      document_id: docId,
      path: 'status',
      userId: 'user_1',
      before_value: 'draft',
      after_value: 'submitted',
      vector_clock: '{}',
      created_at: Date.now(),
      status: 'active'
    });

    // Wait until the record is synced
    await waitForTableRecord(store, 'audit_logs', logId);

    const table = store.getTable('audit_logs');
    expect(table[logId]).toBeDefined();
    expect(table[logId].document_id).toBe(docId);
    expect(table[logId].after_value).toBe('submitted');

    // Verify that the audit log is stored physically in the nodes table (append-only)
    const nodeRows = await workerApi.query('SELECT * FROM nodes WHERE id = ?', [logId]);
    expect(nodeRows.length).toBe(1);
    expect(nodeRows[0][2]).toBe('CONTENT:AUDIT'); // column 2 is type
    
    persister.destroy();
  });
});
