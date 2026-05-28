# 02-sync-worker-and-memory-lifecycle.md — Sync Worker & Memory Lifecycle

Este documento especifica a arquitetura de execução em segundo plano, a sincronização em ondas, o ciclo de vida do cache em memória e o Garbage Collection da Plataforma V3.1.

---

## 1. Orquestração de Web Workers

Para garantir que a Main Thread da interface (UI) permaneça responsiva durante operações de sync e criptografia em lote, a camada lógica da aplicação executa dividida em três **Web Workers** assíncronos no navegador/WebView:

```
                  ┌─────────────────────────────────┐
                  │      Main Thread (React UI)     │
                  └────────────────┬───▲────────────┘
                        postMessage│   │Reactive updates
                      (via Comlink)│   │(TinyBase Store)
                  ┌────────────────▼───┴────────────────┐
                  │             Sync Worker             │
                  └──────────────┬──────────┬───────────┘
                                 │          │
                     postMessage │          │ postMessage
                                 ▼          ▼
                       ┌───────────┐      ┌───────────┐
                       │Crypto Wkr │      │ Index Wkr │
                       └───────────┘      └───────────┘
```

### 1.1 Sync Worker
O Worker central do sistema operacional de dados local. Suas responsabilidades são:
* Orquestrar o **Automerge Repo** (carregamento de snapshots, aplicação de Changes e controle de conexões WebRTC).
* Manter o loop de sincronização por **Range-Based Set Reconciliation** de dados estruturados.
* Gerenciar as transações diretas no banco de dados SQLite WASM persistido em OPFS.
* **Zen Engine (Validador Procedural)**: Motor leve de execução procedural (WASM com interpretador AST simplificado) embutido no worker. Ele executa de maneira preguiçosa (lazy-loading no mobile) as regras de negócio declaradas nas `SPECIFICATION`s (validações locais, processamento de migrações estruturais de dados e políticas multi-sig), garantindo economia de RAM e CPU.
* Comunicar-se com a Main Thread via RPC utilizando a biblioteca **Comlink**.

### 1.2 Crypto Worker
Worker isolado para processamento criptográfico pesado.
* Executa encriptação e decifração de payloads (AES-256-GCM) em batch.
* Valida assinaturas Ed25519 em blocos durante sincronizações em massa (Onda 1 e 2).
* **Cofre de Chaves (Key Vault)**: Subsistema interno para custódia segura de chaves. Intercepta tokens UCAN para validar direitos (`ASSET:PERMISSION` ou `ASSET:ROLE`) e entrega a chave de conteúdo correspondente baseada no TTL do papel ativo.
* Armazena em RAM as chaves de época decifradas, com **TTL rígido de 4 horas**. Após a expiração, as chaves são limpas da memória física do worker.

### 1.3 Index Worker
Worker que processa mensagens e payloads decifrados de forma assíncrona.
* Reconstrói e atualiza as tabelas virtuais locais do indexador FTS5 (`search_index_fts`) e dados geográficos do `geo_index`.

---

## 2. TinyBase como Ponte Reativa

A Main Thread da interface de usuário nunca realiza conexões diretas ou consultas SQL no banco SQLite local. 

* **Cache em Memória**: A UI lê e escreve exclusivamente em uma Store do **TinyBase** em memória.
* **Política de Espelhamento Parcial**: TinyBase retém em cache (`nodes_cache` e `edges_cache`) apenas o conjunto de dados ativamente assinados pela janela visível da UI atual, mais um buffer de virtualização. Quando componentes se desinscrevem, a RAM é limpa.
* **Persistência Assíncrona (Persister)**: Um persister customizado do TinyBase intercepta escritas e envia os deltas de forma assíncrona ao Sync Worker para gravação durável no SQLite. Triggers SQLite atualizam `entity_heads` no banco, e o persister lê a alteração atualizando reativamente a store do TinyBase.

---

## 3. Sincronização em Ondas (Waves)

Ao realizar o primeiro login ou retornar após longa ausência, o Sync Worker prioriza a transferência de dados em ondas sucessivas para tornar a interface usável em segundos:

* **Onda 0: Operacional (Segundos)**: Baixa a identidade-âncora (`PROFILE:AUTHENTICATION`), as personas do usuário, as permissões ativas (`local_permissions`) obtidas via UCAN, configurações básicas e as specifications de rede. **A UI abre.**
* **Onda 1: Domínios Prioritários (Minutos)**: Baixa o saldo quente de ativos (`ASSET:BALANCE_STATE`), as notificações recentes e o histórico de conversas dos últimos 30 dias.
* **Onda 2: Histórico em Segundo Plano (Background)**: Baixa o histórico completo em estado **Podado** (apenas IDs, signatures e arestas do grafo, sem payloads pesados).
* **Onda 3: Sob Demanda (Lazy)**: Quando o usuário rola o histórico ou abre um documento antigo que está podado, o Sync Worker executa **Graph-Based Routing** em tempo real para solicitar o payload criptografado aos peers conectados e reidratar o nó para o estado **Integral**.

---

## 4. Garbage Collection Híbrido (G4) e Quotas

O dispositivo monitora o armazenamento ocupado pelo OPFS. Ao atingir o limiar de **90% da quota** disponível ou o limite fixado pelo usuário:

1. **Notificação Proativa**: O sistema sugere a liberação de espaço de forma transparente.
2. **Execução do G4**: O Garbage Collector executa a compactação local:
   * **Poda do SQLite**: Converte registros do estado Integral para Podado (`retention_state = 'pruned'`), removendo fisicamente a coluna `payload` e `payload_iv` do SQLite. As assinaturas e arestas de relacionamento são mantidas intactas para auditoria.
   * **Compactação do CRDT (Automerge)**: O GC limpa os micro-updates históricos e Changes brutas da tabela local `pending_changes` e consolida o log do Automerge Repo correspondente aos blocos podados.
   * **Pins e Proteções**: O G4 **nunca** poda registros protegidos por nós de prioridade (`ASSET:PIN` do usuário) ou sob conformidade de retenção regulatória obrigatória (dados fiscais/financeiros).
