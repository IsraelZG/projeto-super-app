export interface DatabaseAdapter {
  exec(sql: string): Promise<void>;
  query(sql: string, params?: any[]): Promise<any[][]>;
  close(): Promise<void>;
}
