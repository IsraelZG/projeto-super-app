import { Provider, useTable } from 'tinybase/ui-react';
import { useSyncWorker } from './hooks/useSyncWorker';
import { Timeline } from './core/engines/timeline/timeline';
import { SuperCard } from './core/engines/super-card/super-card';
import { ulid } from 'ulid';
import { Loader2, Plus, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';

export function App() {
  const [peerName, setPeerName] = useState<string | null>(null);
  const [inputName, setInputName] = useState('');
  const { isReady, store, workerApi, webrtc } = useSyncWorker(peerName);

  if (!peerName) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <form 
          onSubmit={(e) => { e.preventDefault(); if (inputName.trim()) setPeerName(inputName.trim()); }}
          className="flex flex-col items-center gap-4 bg-card p-8 rounded-xl border border-border shadow-lg"
        >
          <h2 className="text-2xl font-bold tracking-tight">Superapp P2P</h2>
          <p className="text-sm text-muted-foreground mb-2">Digite um nome para entrar na rede</p>
          <input 
            autoFocus
            type="text" 
            placeholder="Seu Nome..." 
            value={inputName}
            onChange={e => setInputName(e.target.value)}
            className="px-4 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary w-64"
          />
          <button 
            type="submit"
            disabled={!inputName.trim()}
            className="w-full bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Conectar
          </button>
        </form>
      </div>
    );
  }

  if (!isReady || !store || !workerApi) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Inicializando OPFS Sync Worker...</p>
        </div>
      </div>
    );
  }

  return (
    <Provider store={store}>
      <MainScreen workerApi={workerApi} webrtc={webrtc} />
    </Provider>
  );
}

function MainScreen({ workerApi, webrtc }: { workerApi: any; webrtc: any }) {
  const [connectionStatus, setConnectionStatus] = useState<string>('Offline');
  const [connectedPeers, setConnectedPeers] = useState<{peerId: string, peerName: string}[]>([]);

  useEffect(() => {
    if (!webrtc) return;
    const interval = setInterval(() => {
      const status = webrtc.hasConnections() ? 'Conectado (P2P)' : 'Desconectado / Aguardando';
      setConnectionStatus(status);

      const peers = webrtc.getConnectedPeers();
      setConnectedPeers(peers);
    }, 1000);
    return () => clearInterval(interval);
  }, [webrtc]);

  // We use TinyBase's reactive hook directly
  const entityHeads = useTable('entity_heads');
  
  // Convert object to array and reverse to show newest first (naive approach for demo)
  const items = Object.entries(entityHeads).reverse().map(([entity_id, data]) => ({
    id: entity_id,
    node_id: data.node_id
  }));

  const handleCreateRandom = async () => {
    const entity_id = ulid();
    const node_id = ulid();
    const epoch = 1;
    const createdAt = Date.now();

    // The UI sends raw command to the Worker
    await workerApi.injectAndBroadcastNode({
      id: node_id,
      entity_id,
      type: 'POST',
      epoch,
      created_at: createdAt,
      retention_state: 'integral'
    });
    // Observe the magic! We don't update React state manually. 
    // Trigger runs in SQLite -> Comlink callback -> TinyBase Load -> React Re-render!
  };

  const handleResetDatabase = async () => {
    if (confirm("Tem certeza que deseja apagar todos os dados locais?")) {
      await workerApi.resetDatabase();
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Superapp P2P</h1>
            <div className="flex items-center gap-2 mt-1">
              <Wifi className={`w-4 h-4 ${connectionStatus !== 'Offline' ? 'text-green-500' : 'text-red-500'}`} />
              <p className="text-sm text-muted-foreground">
                Status: {connectionStatus}
              </p>
            </div>
            {connectedPeers.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Conectado a: {connectedPeers.map(p => p.peerName).join(', ')}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handleResetDatabase}
              className="flex items-center gap-2 bg-red-600/10 text-red-600 hover:bg-red-600/20 px-4 py-2 rounded-md transition-all font-medium text-sm"
            >
              Reset BD
            </button>
            <button 
              onClick={handleCreateRandom}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
              Novo Nó
            </button>
          </div>
        </div>

        <Timeline 
          items={items} 
          renderItem={(item) => (
            <SuperCard 
              key={item.id}
              title={`Entity: ${item.id.slice(0, 8)}...`}
              subtitle={`Node ID: ${item.node_id}`}
              body="Nó criado localmente e salvo no SQLite OPFS. A interface atualizou sozinha graças aos Triggers CQRS."
            />
          )} 
        />

        {items.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-border rounded-lg text-muted-foreground">
            O banco local está vazio. Crie um nó para começar.
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
