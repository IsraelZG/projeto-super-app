import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BetterSQLite3Adapter } from './better-sqlite3-adapter.js';
import fs from 'fs';
import path from 'path';

describe('BetterSQLite3Adapter', () => {
  const testDbFile = 'test_adapter.sqlite';
  let adapter: BetterSQLite3Adapter;

  beforeEach(async () => {
    // Ensure clean database before each test
    if (fs.existsSync(testDbFile)) {
      fs.unlinkSync(testDbFile);
    }
    adapter = new BetterSQLite3Adapter(testDbFile);
  });

  afterEach(async () => {
    await adapter.close();
    if (fs.existsSync(testDbFile)) {
      fs.unlinkSync(testDbFile);
    }
  });

  it('should execute schema creations using exec', async () => {
    await expect(adapter.exec('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)')).resolves.not.toThrow();
  });

  it('should perform INSERT queries without raw() errors and return empty results', async () => {
    await adapter.exec('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
    
    // Test parameterized INSERT through query method
    const insertRes = await adapter.query(
      'INSERT INTO test (id, value) VALUES (?, ?)',
      ['1', 'hello']
    );
    
    expect(insertRes).toEqual([]);
  });

  it('should perform SELECT queries with parameters and return raw row arrays', async () => {
    await adapter.exec('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)');
    await adapter.query('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'hello']);
    await adapter.query('INSERT INTO test (id, value) VALUES (?, ?)', ['2', 'world']);

    // Test SELECT
    const rows = await adapter.query('SELECT id, value FROM test WHERE id = ?', ['1']);
    
    expect(rows).toEqual([['1', 'hello']]);
  });
});
