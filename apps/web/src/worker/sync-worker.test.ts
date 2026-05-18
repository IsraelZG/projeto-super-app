import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Comlink from 'comlink';
import { ulid } from 'ulid';

import type { SyncWorkerAPI } from './sync-worker.js';

describe('Sync Worker & CQRS Triggers', () => {
  let workerApi: Comlink.Remote<typeof SyncWorkerAPI>;
  let worker: Worker;

  beforeAll(async () => {
    worker = new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' });
    workerApi = Comlink.wrap<typeof SyncWorkerAPI>(worker);
    await workerApi.init('sync_test.sqlite');
    
    // Clear for clean tests
    await workerApi.exec('DELETE FROM edges');
    await workerApi.exec('DELETE FROM nodes');
    await workerApi.exec('DELETE FROM entity_heads');
    await workerApi.exec('DELETE FROM active_edges');
  });

  afterAll(() => {
    worker.terminate();
  });

  it('Phase 2: should be able to insert a node into physical table', async () => {
    const id = ulid();
    const entity_id = ulid();
    
    const sql = `
      INSERT INTO nodes (id, entity_id, type, epoch, created_at, retention_state) 
      VALUES (?, ?, 'PROFILE', 1, 1600000000, 'integral')
    `;
    await workerApi.query(sql, [id, entity_id]);
    
    const results = await workerApi.query('SELECT * FROM nodes WHERE id = ?', [id]);
    expect(results.length).toBe(1);
    expect(results[0][0]).toBe(id); // column 0 is id
  });

  it('Phase 3: inserting a node should trigger entity_heads update', async () => {
    const entity_id = ulid();
    
    // Insert version 1
    const v1_id = ulid();
    await workerApi.query(
      "INSERT INTO nodes (id, entity_id, type, epoch, created_at) VALUES (?, ?, 'POST', 1, 100)", 
      [v1_id, entity_id]
    );

    let heads = await workerApi.query('SELECT node_id FROM entity_heads WHERE entity_id = ?', [entity_id]);
    expect(heads[0][0]).toBe(v1_id);

    // Insert version 2 (mutates)
    const v2_id = ulid();
    await workerApi.query(
      "INSERT INTO nodes (id, entity_id, type, epoch, created_at) VALUES (?, ?, 'POST', 1, 200)", 
      [v2_id, entity_id]
    );

    heads = await workerApi.query('SELECT node_id FROM entity_heads WHERE entity_id = ?', [entity_id]);
    expect(heads.length).toBe(1);
    expect(heads[0][0]).toBe(v2_id); // The trigger should have updated it to v2!
  });

  it('Phase 3: active_edges should reflect only weight > 0 edges', async () => {
    // Setup 2 nodes
    const n1 = ulid(); const e1 = ulid();
    const n2 = ulid(); const e2 = ulid();
    await workerApi.query("INSERT INTO nodes (id, entity_id, type, epoch, created_at) VALUES (?, ?, 'PERSONA', 1, 100)", [n1, e1]);
    await workerApi.query("INSERT INTO nodes (id, entity_id, type, epoch, created_at) VALUES (?, ?, 'PERSONA', 1, 100)", [n2, e2]);

    // Insert active edge
    const edge_id = ulid();
    const edge_entity = ulid(); // Lineage of the edge itself
    await workerApi.query(`
      INSERT INTO edges (id, entity_id, source_id, target_id, type, epoch, weight, created_at)
      VALUES (?, ?, ?, ?, 'FOLLOWS', 1, 1.0, 100)
    `, [edge_id, edge_entity, n1, n2]);

    let active = await workerApi.query('SELECT id FROM active_edges WHERE entity_id = ?', [edge_entity]);
    expect(active.length).toBe(1);
    expect(active[0][0]).toBe(edge_id);

    // Insert tombstone (weight = 0)
    const tombstone_id = ulid();
    await workerApi.query(`
      INSERT INTO edges (id, entity_id, source_id, target_id, type, epoch, weight, created_at)
      VALUES (?, ?, ?, ?, 'FOLLOWS', 1, 0.0, 200)
    `, [tombstone_id, edge_entity, n1, n2]);

    // Trigger should have DELETED from active_edges where entity_id = edge_entity
    active = await workerApi.query('SELECT id FROM active_edges WHERE entity_id = ?', [edge_entity]);
    expect(active.length).toBe(0); // Successfully expunged from the active projection!
  });

  it('deve realizar hidratação completa no cold start (SQLite -> Y.js)', async () => {
    // 1. Start a fresh worker for cold start testing to keep the file lock completely clean
    worker.terminate();
    await new Promise(resolve => setTimeout(resolve, 100)); // Let OPFS release lock cleanly

    worker = new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' });
    workerApi = Comlink.wrap<typeof SyncWorkerAPI>(worker);
    await workerApi.init('sync_test_cold.sqlite');

    // 2. Insert records directly to SQLite (simulating local offline-saved records)
    const nodeId = ulid();
    const nodeEntityId = ulid();
    await workerApi.query(
      `INSERT INTO nodes (id, entity_id, type, epoch, created_at, retention_state) 
       VALUES (?, ?, 'CONTENT:POST', 1, 12345, 'integral')`,
      [nodeId, nodeEntityId]
    );

    const edgeId = ulid();
    const edgeEntityId = ulid();
    await workerApi.query(
      `INSERT INTO edges (id, entity_id, source_id, target_id, type, epoch, weight, created_at, retention_state) 
       VALUES (?, ?, ?, ?, 'AUTHORED', 1, 1.0, 12346, 'integral')`,
      [edgeId, edgeEntityId, nodeId, nodeId]
    );

    // 3. Terminate current worker to force cold start
    worker.terminate();
    await new Promise(resolve => setTimeout(resolve, 100)); // Let OPFS release lock cleanly

    // 4. Start a brand NEW worker on the same DB file
    worker = new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' });
    workerApi = Comlink.wrap<typeof SyncWorkerAPI>(worker);
    await workerApi.init('sync_test_cold.sqlite');

    // 5. Query CRDT State - Y.js must have hydrated 1 node and 1 edge!
    const crdtState = await workerApi.getCRDTState('global-room');
    expect(crdtState.nodes).toBe(1);
    expect(crdtState.edges).toBe(1);
  });

  it('deve injetar e replicar arestas e nos bidirectionalmente', async () => {
    // Start a clean, isolated worker for eventual consistency to avoid any locks
    worker.terminate();
    await new Promise(resolve => setTimeout(resolve, 100)); // Let OPFS release lock cleanly

    worker = new Worker(new URL('./sync-worker.ts', import.meta.url), { type: 'module' });
    workerApi = Comlink.wrap<typeof SyncWorkerAPI>(worker);
    await workerApi.init('sync_test_eventual.sqlite');

    const nodeId = ulid();
    const nodeEntityId = ulid();
    
    await workerApi.injectAndBroadcastNode({
      id: nodeId,
      entity_id: nodeEntityId,
      type: 'CONTENT:CHAT_MESSAGE',
      epoch: 1,
      created_at: Date.now()
    });

    const edgeId = ulid();
    const edgeEntityId = ulid();

    await workerApi.injectAndBroadcastEdge({
      id: edgeId,
      entity_id: edgeEntityId,
      source_id: nodeId,
      target_id: nodeId,
      type: 'REPLY_TO',
      epoch: 1,
      weight: 1.0,
      created_at: Date.now()
    });

    // Check CRDT size incremented
    const crdtState = await workerApi.getCRDTState('global-room');
    expect(crdtState.nodes).toBeGreaterThanOrEqual(1);
    expect(crdtState.edges).toBeGreaterThanOrEqual(1);

    // Check SQLite physically holds the edge
    const edgeRows = await workerApi.query('SELECT * FROM edges WHERE id = ?', [edgeId]);
    expect(edgeRows.length).toBe(1);
    expect(edgeRows[0][0]).toBe(edgeId); // Column 0 is id
  });
});
