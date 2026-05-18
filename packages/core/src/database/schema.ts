export const SCHEMA_SQL = `
-- Physical Tables (Replicable)
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  pub_key TEXT,
  payload BLOB,
  payload_iv BLOB,
  epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  signature BLOB,
  retention_state TEXT NOT NULL DEFAULT 'integral'
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload BLOB,
  payload_iv BLOB,
  epoch INTEGER NOT NULL,
  weight REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  signature BLOB,
  retention_state TEXT NOT NULL DEFAULT 'integral',
  FOREIGN KEY(source_id) REFERENCES nodes(id),
  FOREIGN KEY(target_id) REFERENCES nodes(id)
);

-- Structural Projections (Local only, maintained by triggers)
CREATE TABLE IF NOT EXISTS entity_heads (
  entity_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  FOREIGN KEY(node_id) REFERENCES nodes(id)
);

CREATE TABLE IF NOT EXISTS active_edges (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  FOREIGN KEY(id) REFERENCES edges(id)
);
`;

export const TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_update_entity_heads
AFTER INSERT ON nodes
BEGIN
  INSERT INTO entity_heads (entity_id, node_id)
  VALUES (new.entity_id, new.id)
  ON CONFLICT(entity_id) DO UPDATE SET node_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_insert_active_edges
AFTER INSERT ON edges
WHEN new.weight > 0
BEGIN
  INSERT INTO active_edges (id, entity_id, source_id, target_id, type)
  VALUES (new.id, new.entity_id, new.source_id, new.target_id, new.type);
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_active_edges
AFTER INSERT ON edges
WHEN new.weight = 0
BEGIN
  DELETE FROM active_edges WHERE entity_id = new.entity_id;
END;
`;
