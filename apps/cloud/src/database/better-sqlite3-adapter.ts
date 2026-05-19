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
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      return stmt.raw().all(params) as any[][];
    }
    stmt.run(params);
    return [];
  }

  public async close(): Promise<void> {
    this.db.close();
  }
}
