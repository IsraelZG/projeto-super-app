import { DatabaseAdapter } from '@superapp/core';
import Database from 'better-sqlite3';

export class BetterSQLite3Adapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
  }

  public async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  public async query(sql: string, params: any[] = []): Promise<any[][]> {
    return this.db.prepare(sql).raw().all(params) as any[][];
  }

  public async close(): Promise<void> {
    this.db.close();
  }
}
