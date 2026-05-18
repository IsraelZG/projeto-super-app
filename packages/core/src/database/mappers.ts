export function mapNodeRowToObject(row: any[]) {
  return {
    id: row[0],
    entity_id: row[1],
    type: row[2],
    pub_key: row[3],
    payload: row[4],
    payload_iv: row[5],
    epoch: row[6],
    created_at: row[7],
    signature: row[8],
    retention_state: row[9],
  };
}

export function mapEdgeRowToObject(row: any[]) {
  return {
    id: row[0],
    entity_id: row[1],
    source_id: row[2],
    target_id: row[3],
    type: row[4],
    payload: row[5],
    payload_iv: row[6],
    epoch: row[7],
    weight: row[8],
    created_at: row[9],
    signature: row[10],
    retention_state: row[11],
  };
}
