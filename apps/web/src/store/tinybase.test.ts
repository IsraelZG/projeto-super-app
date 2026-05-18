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

  it('should load initial state into TinyBase', async () => {
    const { store, persister } = createSuperAppStore(workerApi);
    await persister.startAutoLoad();
    expect(store.getTable('entity_heads')).toEqual({});
  });

  it('should react to worker mutations automatically', async () => {
    const { store, persister } = createSuperAppStore(workerApi);

    const entity_id = ulid();
    const node_id = ulid();
    
    // Simulate what the persister would do when notified
    store.setRow('entity_heads', entity_id, { node_id });

    const table = store.getTable('entity_heads');
    expect(table[entity_id]).toBeDefined();
    expect(table[entity_id].node_id).toBe(node_id);
    
    persister.destroy();
  });
});
