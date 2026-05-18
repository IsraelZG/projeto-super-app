import { createStore, createQueries } from 'tinybase';
import { createCustomPersister } from 'tinybase/persisters';
import type { SyncWorkerAPI } from '../worker/sync-worker.js';
import * as Comlink from 'comlink';

export function createSuperAppStore(workerApi: Comlink.Remote<typeof SyncWorkerAPI>) {
  const store = createStore();
  const queries = createQueries(store);

  const persister = createCustomPersister(
    store,
    async () => {
      try {
        const headsRaw = await workerApi.query('SELECT entity_id, node_id FROM entity_heads');
        const edgesRaw = await workerApi.query('SELECT id, entity_id, source_id, target_id, type FROM active_edges');
        
        const entity_heads: Record<string, any> = {};
        for (const row of headsRaw) {
          entity_heads[row[0]] = { node_id: row[1] };
        }

        const active_edges: Record<string, any> = {};
        for (const row of edgesRaw) {
          active_edges[row[0]] = { 
            entity_id: row[1], 
            source_id: row[2], 
            target_id: row[3], 
            type: row[4] 
          };
        }

        return [{
          entity_heads,
          active_edges
        }, {}] as any;
      } catch (err) {
        console.error("Load error:", err);
        return [{}, {}] as any;
      }
    },
    async () => {},
    (listener) => {
      workerApi.setChangeListener(Comlink.proxy(() => {
        listener();
      }));
    },
    () => {}
  );

  return { store, queries, persister };
}
