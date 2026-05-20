import { useEffect, useState } from 'react';
import { Database, RefreshCw, Table as TableIcon } from 'lucide-react';

interface DatabaseInspectorProps {
  workerApi: any;
}

export function DatabaseInspector({ workerApi }: DatabaseInspectorProps) {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTables = async () => {
    try {
      const result = await workerApi.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      const tableNames = result.map((row: any) => row[0]);
      setTables(tableNames);
      if (tableNames.length > 0 && !selectedTable) {
        setSelectedTable(tableNames[0]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar tabelas');
    }
  };

  const fetchTableData = async (tableName: string) => {
    if (!tableName) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Get column metadata
      const columnsInfo = await workerApi.query(`PRAGMA table_info(${tableName})`);
      const colNames = columnsInfo.map((col: any) => col[1]);
      setColumns(colNames);

      // 2. Get rows
      const dataRows = await workerApi.query(`SELECT * FROM ${tableName} LIMIT 100`);
      setRows(dataRows);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar dados da tabela');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  useEffect(() => {
    if (selectedTable) {
      fetchTableData(selectedTable);
    }
  }, [selectedTable]);

  const handleRefresh = () => {
    fetchTables();
    if (selectedTable) {
      fetchTableData(selectedTable);
    }
  };

  // Helper to format values for display
  const formatValue = (val: any) => {
    if (val === null || val === undefined) return <span className="text-muted-foreground italic">null</span>;
    if (val instanceof Uint8Array) return <span className="text-blue-400 font-mono text-xs">{`BLOB [${val.length}B]`}</span>;
    if (typeof val === 'object') return <span className="text-yellow-400 font-mono text-xs">{JSON.stringify(val)}</span>;
    const strVal = String(val);
    if (strVal.length > 40) return `${strVal.slice(0, 38)}...`;
    return strVal;
  };

  return (
    <div className="bg-card text-foreground rounded-xl border border-border shadow-lg p-6 flex flex-col h-[500px]">
      <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">Database Inspector</h2>
        </div>
        <button
          onClick={handleRefresh}
          className="p-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
          title="Atualizar dados"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Sidebar - Tables List */}
        <div className="w-1/3 border-r border-border pr-4 overflow-y-auto space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Tabelas</p>
          {tables.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTable(t)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all text-left ${
                selectedTable === t
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <TableIcon className="w-4 h-4 shrink-0" />
              <span className="truncate">{t}</span>
            </button>
          ))}
        </div>

        {/* Content Area - Data Grid */}
        <div className="w-2/3 flex flex-col overflow-hidden">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-md p-3 text-sm mb-4">
              {error}
            </div>
          )}

          {!selectedTable ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Nenhuma tabela selecionada.
            </div>
          ) : loading && rows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Carregando dados...
            </div>
          ) : (
            <div className="flex-1 overflow-auto border border-border rounded-lg bg-background/50">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/50 border-b border-border sticky top-0">
                    {columns.map((col) => (
                      <th key={col} className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-muted/20 transition-colors">
                      {row.map((val, valIndex) => (
                        <td key={valIndex} className="px-4 py-2 text-sm max-w-[200px] truncate font-mono">
                          {formatValue(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Tabela vazia
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
