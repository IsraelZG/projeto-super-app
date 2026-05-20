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
        const tablesInfo = await workerApi.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
        const dbTables = tablesInfo
          .map((row: any) => row[0])
          .filter((name: string) => name !== 'nodes' && name !== 'edges');

        const loadedTables: Record<string, any> = {};

        for (const tableName of dbTables) {
          const colsInfo = await workerApi.query(`PRAGMA table_info(${tableName})`);
          const colNames = colsInfo.map((col: any) => col[1]);
          
          // Find primary key column index
          const pkIndex = colsInfo.findIndex((col: any) => col[5] === 1);
          const keyIndex = pkIndex !== -1 ? pkIndex : 0;

          const rowsRaw = await workerApi.query(`SELECT * FROM ${tableName}`);
          const tableRows: Record<string, any> = {};

          for (const row of rowsRaw) {
            const rowId = row[keyIndex];
            const rowObj: Record<string, any> = {};
            for (let i = 0; i < colNames.length; i++) {
              if (i !== keyIndex && row[i] !== null && row[i] !== undefined) {
                rowObj[colNames[i]] = row[i];
              }
            }
            tableRows[rowId] = rowObj;
          }
          loadedTables[tableName] = tableRows;
        }

        // Load logical audit_logs table from nodes table using getDecryptedAuditLogs
        try {
          const decryptedLogs = await workerApi.getDecryptedAuditLogs();
          const auditRows: Record<string, any> = {};
          for (const entry of decryptedLogs) {
            const id = entry.id;
            const document_id = entry.entity_id;
            const created_at = entry.created_at;
            const payloadRaw = entry.decryptedPayload;

            let parsedPayload: any = {};
            if (payloadRaw) {
              try {
                parsedPayload = JSON.parse(payloadRaw);
              } catch (e) {
                console.error("Failed to parse audit log payload:", e);
              }
            }

            auditRows[id] = {
              document_id,
              created_at,
              path: parsedPayload.path || '',
              userId: parsedPayload.userId || '',
              before_value: parsedPayload.before_value || '',
              after_value: parsedPayload.after_value || '',
              vector_clock: parsedPayload.vector_clock || '',
              status: parsedPayload.status || 'active'
            };
          }
          loadedTables['audit_logs'] = auditRows;
        } catch (auditErr) {
          console.warn("Failed to load audit logs from nodes:", auditErr);
          loadedTables['audit_logs'] = {};
        }

        return [loadedTables, {}] as any;
      } catch (err) {
        console.error("Load error:", err);
        return [{}, {}] as any;
      }
    },
    async (getContent) => {
      try {
        const [tables] = getContent();
        const readOnlyTables = ['nodes', 'edges', 'entity_heads', 'active_edges', 'audit_logs', 'pending_staging'];

        for (const [tableName, tableRows] of Object.entries(tables)) {
          if (readOnlyTables.includes(tableName)) continue;

          // 1. Gather all unique cell keys to declare columns
          const uniqueCells = new Set<string>();
          for (const rowObj of Object.values(tableRows as any)) {
            for (const cellId of Object.keys(rowObj as any)) {
              uniqueCells.add(cellId);
            }
          }
          const columnsList = Array.from(uniqueCells);

          // 2. Ensure the table is created/migrated dynamically
          await workerApi.ensureTable(tableName, columnsList);

          // 3. Fetch current database IDs to detect deletions
          const existingIdsInfo = await workerApi.query(`SELECT id FROM ${tableName}`);
          const existingIds = new Set(existingIdsInfo.map((row: any) => row[0]));

          // 4. Upsert table rows
          for (const [rowId, rowObj] of Object.entries(tableRows as any)) {
            existingIds.delete(rowId);

            const cells = Object.keys(rowObj as any);
            if (cells.length === 0) {
              await workerApi.query(`DELETE FROM ${tableName} WHERE id = ?`, [rowId]);
              continue;
            }

            const cols = ['id', ...cells];
            const placeholders = cols.map(() => '?').join(', ');
            const values = [rowId, ...cells.map(c => (rowObj as any)[c])];

            await workerApi.query(
              `INSERT OR REPLACE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`,
              values
            );
          }

          // 5. Delete rows that no longer exist in TinyBase
          for (const deletedId of existingIds) {
            await workerApi.query(`DELETE FROM ${tableName} WHERE id = ?`, [deletedId]);
          }
        }
      } catch (err) {
        console.error("Save error:", err);
      }
    },
    (listener) => {
      workerApi.setChangeListener(Comlink.proxy(() => {
        listener();
      }));
    },
    () => {}
  );

  return { store, queries, persister };
}
