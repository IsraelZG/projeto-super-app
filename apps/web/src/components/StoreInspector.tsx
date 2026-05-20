import { useTable, useStore } from 'tinybase/ui-react';
import { useState } from 'react';
import { 
  FileQuestion, 
  History, 
  Send, 
  User, 
  Calendar, 
  Plus,
  Play,
  CheckCircle,
  FileCode,
  Cpu,
  FileText
} from 'lucide-react';
import { ulid } from 'ulid';

interface StoreInspectorProps {
  workerApi: any;
  latestEntityId: string | null;
}

export function StoreInspector({ workerApi, latestEntityId }: StoreInspectorProps) {
  const store = useStore();
  const pendingIntents = useTable('pending_intents', store);
  const auditLogs = useTable('audit_logs', store);
  
  const pendingStaging = useTable('pending_staging', store);
  const [activeTab, setActiveTab] = useState<'intents' | 'audits' | 'staging'>('intents');
  
  // States for simulating new items
  const [intentType, setIntentType] = useState('CONTENT:UPDATE');
  const [intentPayload, setIntentPayload] = useState('{"title": "Novo Título"}');
  
  const [auditPath, setAuditPath] = useState('title');
  const [auditBefore, setAuditBefore] = useState('Rascunho Inicial');
  const [auditAfter, setAuditAfter] = useState('Título Atualizado');

  const [stagingPath, setStagingPath] = useState('title');
  const [stagingValue, setStagingValue] = useState('A');
  const [stagingUserId, setStagingUserId] = useState('usuario_teste');

  const handleSimulateIntent = async () => {
    const entityId = latestEntityId || ulid();
    const intentId = ulid();
    
    await workerApi.saveIntent({
      id: intentId,
      entity_id: entityId,
      type: intentType,
      payload: intentPayload,
      created_at: Date.now(),
      status: 'pending'
    });
  };

  const handleSimulateAudit = async () => {
    const docId = latestEntityId || ulid();
    const logId = ulid();
    
    await workerApi.saveAuditLog({
      id: logId,
      document_id: docId,
      path: auditPath,
      userId: 'usuario_teste',
      before_value: auditBefore,
      after_value: auditAfter,
      vector_clock: JSON.stringify({ 'peer-a': 1 }),
      created_at: Date.now(),
      status: 'active'
    });
  };

  const handleSimulateStaging = async () => {
    const docId = latestEntityId || ulid();
    await workerApi.saveStagingEntry({
      document_id: docId,
      path: stagingPath,
      userId: stagingUserId,
      value: stagingValue
    });
  };

  const handleTriggerCoalescence = async () => {
    await workerApi.runCoalescence();
  };

  const handleResolveIntent = async (intentId: string, intent: any) => {
    // 1. Mark intent as approved/resolved in pending_intents
    await workerApi.saveIntent({
      ...intent,
      id: intentId,
      status: 'resolved'
    });

    // 2. Consolidate: Create the physical node that represents this action!
    const nodeId = ulid();
    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(intent.payload);
    } catch (e) {
      console.error(e);
    }

    await workerApi.injectAndBroadcastNode({
      id: nodeId,
      entity_id: intent.entity_id,
      type: intent.type,
      epoch: 1,
      created_at: Date.now(),
      payload: JSON.stringify(parsedPayload),
      retention_state: 'integral'
    });

    // 3. Optional: Create an audit log for this consolidation
    const logId = ulid();
    await workerApi.saveAuditLog({
      id: logId,
      document_id: intent.entity_id,
      path: 'all',
      userId: 'validator_bot',
      before_value: 'null',
      after_value: intent.payload,
      vector_clock: '{}',
      created_at: Date.now(),
      status: 'active'
    });
  };

  const sortedIntents = Object.entries(pendingIntents || {}).reverse();
  const sortedAudits = Object.entries(auditLogs || {}).reverse();
  const sortedStaging = Object.entries(pendingStaging || {}).reverse();

  return (
    <div className="bg-card text-foreground rounded-xl border border-border shadow-lg p-6 flex flex-col h-[550px]">
      <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('intents')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all shrink-0 ${
              activeTab === 'intents'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            <FileQuestion className="w-4 h-4" />
            Intenções ({sortedIntents.length})
          </button>
          <button
            onClick={() => setActiveTab('audits')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all shrink-0 ${
              activeTab === 'audits'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            <History className="w-4 h-4" />
            Logs Auditoria ({sortedAudits.length})
          </button>
          <button
            onClick={() => setActiveTab('staging')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all shrink-0 ${
              activeTab === 'staging'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Área de Estágio ({sortedStaging.length})
          </button>
        </div>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* Left Side: Forms to simulate */}
        <div className="w-2/5 border-r border-border pr-6 overflow-y-auto space-y-5">
          {activeTab === 'intents' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                Simular Intenção Offline-First
              </h3>
              <p className="text-xs text-muted-foreground">
                As intenções são gravadas localmente em `pending_intents` e ficam aguardando validação.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Tipo da Ação</label>
                  <input
                    type="text"
                    value={intentType}
                    onChange={(e) => setIntentType(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Payload (JSON)</label>
                  <textarea
                    rows={2}
                    value={intentPayload}
                    onChange={(e) => setIntentPayload(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>
                {latestEntityId && (
                  <div className="text-[10px] text-muted-foreground font-mono bg-muted/30 p-2 rounded border border-border">
                    Destino: {latestEntityId.slice(0, 10)}... (Última Entidade)
                  </div>
                )}
                <button
                  onClick={handleSimulateIntent}
                  className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground font-medium py-2 rounded-md hover:opacity-90 active:scale-95 transition-all"
                >
                  <Send className="w-3.5 h-3.5" /> Enviar Intenção
                </button>
              </div>
            </div>
          )}

          {activeTab === 'audits' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                Simular Log de Auditoria
              </h3>
              <p className="text-xs text-muted-foreground">
                Mapeia a trilha de alteração semântica, persistida na tabela `nodes` como `CONTENT:AUDIT`.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Caminho (Path)</label>
                  <input
                    type="text"
                    value={auditPath}
                    onChange={(e) => setAuditPath(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Valor Anterior</label>
                  <input
                    type="text"
                    value={auditBefore}
                    onChange={(e) => setAuditBefore(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Novo Valor</label>
                  <input
                    type="text"
                    value={auditAfter}
                    onChange={(e) => setAuditAfter(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <button
                  onClick={handleSimulateAudit}
                  className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground font-medium py-2 rounded-md hover:opacity-90 active:scale-95 transition-all"
                >
                  <Send className="w-3.5 h-3.5" /> Enviar Log de Auditoria
                </button>
              </div>
            </div>
          )}

          {activeTab === 'staging' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                Simular Digitação (Staging)
              </h3>
              <p className="text-xs text-muted-foreground">
                Micro-alterações e keystrokes salvos na tabela temporária local `pending_staging` antes da compilação semântica.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Campo (Path)</label>
                  <input
                    type="text"
                    value={stagingPath}
                    onChange={(e) => setStagingPath(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Texto Digitado / Valor</label>
                  <input
                    type="text"
                    value={stagingValue}
                    onChange={(e) => setStagingValue(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Usuário</label>
                  <input
                    type="text"
                    value={stagingUserId}
                    onChange={(e) => setStagingUserId(e.target.value)}
                    className="w-full text-xs px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <button
                  onClick={handleSimulateStaging}
                  className="w-full flex items-center justify-center gap-2 text-xs bg-primary text-primary-foreground font-medium py-2 rounded-md hover:opacity-90 active:scale-95 transition-all"
                >
                  <Send className="w-3.5 h-3.5" /> Salvar no Staging
                </button>
                <div className="pt-2 border-t border-border mt-3">
                  <button
                    onClick={handleTriggerCoalescence}
                    className="w-full flex items-center justify-center gap-2 text-xs bg-green-600 hover:bg-green-500 text-white font-medium py-2 rounded-md transition-all active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5" /> Compilar Semântica Agora
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Tab Lists */}
        <div className="w-3/5 overflow-y-auto pr-2 space-y-3">
          {activeTab === 'intents' && (
            sortedIntents.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs border border-dashed border-border rounded-lg p-6 text-center">
                Nenhuma intenção pendente registrada no momento.
              </div>
            ) : (
              sortedIntents.map(([id, intent]: [string, any]) => (
                <div key={id} className="bg-background/50 border border-border rounded-lg p-4 space-y-2 relative hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-muted-foreground">{id.slice(0, 10)}...</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                      intent.status === 'resolved' 
                        ? 'bg-green-500/10 text-green-500' 
                        : 'bg-yellow-500/10 text-yellow-500 animate-pulse'
                    }`}>
                      {intent.status}
                    </span>
                  </div>
                  <div className="text-xs">
                    <p className="font-semibold text-foreground">{intent.type}</p>
                    <p className="text-muted-foreground text-[11px] font-mono truncate mt-0.5">Entidade: {intent.entity_id}</p>
                  </div>
                  {intent.payload && (
                    <div className="bg-muted/40 p-2 rounded text-[10px] font-mono overflow-x-auto text-muted-foreground max-h-16">
                      {intent.payload}
                    </div>
                  )}
                  {intent.status === 'pending' && (
                    <button
                      onClick={() => handleResolveIntent(id, intent)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] bg-green-600 hover:bg-green-500 text-white font-medium py-1.5 rounded transition-all"
                    >
                      <CheckCircle className="w-3 h-3" /> Consolidar no Grafo
                    </button>
                  )}
                </div>
              ))
            )
          )}

          {activeTab === 'audits' && (
            sortedAudits.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs border border-dashed border-border rounded-lg p-6 text-center">
                Nenhum log de auditoria carregado do TinyBase.
              </div>
            ) : (
              sortedAudits.map(([id, log]: [string, any]) => (
                <div key={id} className="bg-background/50 border border-border rounded-lg p-4 space-y-2 hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono border-b border-border pb-1.5">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" /> {log.userId}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <FileCode className="w-3.5 h-3.5 text-primary" />
                      <span>Alteração em: <span className="font-mono text-primary">{log.path}</span></span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">ID: {id.slice(0, 10)}... (Doc: {log.document_id.slice(0, 8)}...)</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono mt-2">
                    <div className="bg-red-500/5 border border-red-500/10 rounded p-2 text-red-400">
                      <span className="text-[9px] uppercase font-bold block opacity-60">Antes</span>
                      <div className="truncate mt-0.5">{log.before_value}</div>
                    </div>
                    <div className="bg-green-500/5 border border-green-500/10 rounded p-2 text-green-400">
                      <span className="text-[9px] uppercase font-bold block opacity-60">Depois</span>
                      <div className="truncate mt-0.5">{log.after_value}</div>
                    </div>
                  </div>
                </div>
              ))
            )
          )}

          {activeTab === 'staging' && (
            sortedStaging.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs border border-dashed border-border rounded-lg p-6 text-center">
                Área de estágio local vazia. Simule digitações ao lado!
              </div>
            ) : (
              sortedStaging.map(([id, entry]: [string, any]) => (
                <div key={id} className="bg-background/50 border border-border rounded-lg p-4 space-y-2 hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono border-b border-border pb-1.5">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" /> {entry.userId}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(entry.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      <span>Digitação no campo: <span className="font-mono text-primary">{entry.path}</span></span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">ID: {id.slice(0, 10)}... (Doc: {entry.document_id.slice(0, 8)}...)</p>
                  </div>
                  <div className="bg-muted p-2 rounded text-xs font-mono text-foreground">
                    Valor: <span className="font-semibold">{entry.value}</span>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}
