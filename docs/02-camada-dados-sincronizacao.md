# Plataforma V3.0 — Documento 2: Camada de Dados e Sincronização

**Versão:** 3.0 (Consolidada)
**Status:** Especificação de Referência
**Pré-requisito:** Documento 1 — Fundamentos Arquiteturais

---

## Sumário

1. [Visão Geral da Camada de Dados](#1-visão-geral-da-camada-de-dados)
2. [Estrutura Física: nodes e edges](#2-estrutura-física-nodes-e-edges)
3. [TinyBase como Ponte Reativa](#3-tinybase-como-ponte-reativa)
4. [Índices Locais e Privacidade](#4-índices-locais-e-privacidade)
5. [Estados de Retenção e Ciclo de Vida](#5-estados-de-retenção-e-ciclo-de-vida)
6. [Graph-Based Routing](#6-graph-based-routing)
7. [Modelo de Sincronização em Ondas](#7-modelo-de-sincronização-em-ondas)
8. [Replicação Coordenada e Replication Factor](#8-replicação-coordenada-e-replication-factor)
9. [Snapshots e Bootstrap Acelerado](#9-snapshots-e-bootstrap-acelerado)
10. [Hierarquia Criptográfica e Forward Secrecy](#10-hierarquia-criptográfica-e-forward-secrecy)
11. [Cache Volátil e Modos de Acesso](#11-cache-volátil-e-modos-de-acesso)
12. [Web Workers e Processamento em Background](#12-web-workers-e-processamento-em-background)
13. [Performance e Tier-Aware Degradation](#13-performance-e-tier-aware-degradation)
14. [Quotas de Storage e Garbage Collection](#14-quotas-de-storage-e-garbage-collection)

---

## 1. Visão Geral da Camada de Dados

A camada de dados da plataforma é construída sobre quatro componentes lógicos que cooperam de forma estritamente definida:

- **SQLite WASM/OPFS** — fonte de verdade persistente no dispositivo. Contém apenas duas tabelas físicas replicáveis (`nodes` e `edges`) e tabelas auxiliares locais não-replicáveis.
- **Y.js (CRDT)** — motor de sincronização P2P. Calcula deltas, resolve conflitos em domínios colaborativos, propaga mudanças entre peers.
- **Sync Worker** — componente isolado em background que sincroniza deltas P2P (Y.js) e escreve diretamente no SQLite para máxima performance.
- **Triggers SQLite** — mantêm as projeções estruturais permanentes e índices auxiliares de forma automática e reativa no disco.
- **TinyBase** — camada reativa em memória que atua como *consumidora* das projeções estruturais e *gestora* de projeções modulares efêmeras na RAM, expondo APIs reativas para a UI.
- **WebRTC** — canal de transporte entre peers, com signaling via Cloud da plataforma ou trackers federados.

A separação de responsabilidades é vinculativa:

- A **UI nunca lê do SQLite diretamente.** Sempre via TinyBase, que oferece reatividade granular (re-render apenas quando dados consumidos mudam).
- O **SQLite recebe escritas** através do TinyBase (dados vindos da UI local) e através do Sync Worker (dados recebidos da rede externa via Y.js).
- O **Y.js e a rede P2P** operam isolados no Sync Worker, garantindo que o volume de sincronização não gere gargalos na Main Thread (UI).
- A **encriptação acontece em camada dedicada**, antes de payload entrar no SQLite e antes de delta sair pelo WebRTC.

Esta arquitetura permite que cada componente seja substituído ou otimizado independentemente sem rewrites massivos, e isola as responsabilidades de forma testável.

### 1.1 Fluxo Canônico de Escrita

```
UI → TinyBase → SQLite (tabelas `nodes` e `edges`)
  ↓ (via Triggers nativos)
  ├─ Atualiza Projeções Estruturais (`entity_heads`, `active_edges`, etc.)
  └─ TinyBase observa as projeções e atualiza a UI reativamente
```

### 1.2 Fluxo Canônico de Leitura

```
UI subscreve → TinyBase Query → 
  ↓
  ├─ Cache em memória (hit: retorno imediato)
  └─ SQLite (miss: hidrata cache, retorna)
```

### 1.3 Fluxo Canônico de Recepção P2P

```
WebRTC delta → Provider Y.js → Y.js Document (merge CRDT no Sync Worker) → 
  ↓
  ├─ Sync Worker / Validador (verifica assinatura, capability) → 
  │   ├─ Aceito: Sync Worker escreve direto em SQLite → Triggers atualizam projeções → TinyBase na Main Thread é notificado e recarrega
  │   └─ Rejeitado: registra REJECTED edge para auditoria, descarta payload
  └─ Cache de chaves: Web Worker de UI descriptografa on-demand (Lazy Decryption)
```

---

## 2. Estrutura Física: nodes e edges

### 2.1 Schema das Tabelas Replicáveis

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,            -- ULID (versão única)
  entity_id TEXT NOT NULL,        -- ULID (identificador da linhagem de versões)
  type TEXT NOT NULL,             -- "PROFILE:PERSONA", "CONTENT:POST", etc.
  pub_key TEXT,                   -- Chave pública do criador (NULL para nós sem autoria explícita)
  payload BLOB,                   -- Encriptado com AES-256-GCM (chave de época)
  payload_iv BLOB,                -- Initialization Vector do GCM
  epoch INTEGER NOT NULL,         -- Época da chave usada para encriptar
  created_at INTEGER NOT NULL,    -- Unix timestamp em milissegundos
  signature BLOB,                 -- Ed25519 sobre o ciphertext + metadados (garante integridade universal)
  retention_state TEXT NOT NULL DEFAULT 'integral'  -- 'integral' | 'pruned' | 'expunged'
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,            -- ULID
  entity_id TEXT NOT NULL,        -- ULID (linhagem da aresta, se aplicável)
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,             -- "AUTHORED", "MEMBER_OF", "TRANSFERRED_TO", etc.
  payload BLOB,                   -- Metadados encriptados (peso, timestamp interno, etc.)
  payload_iv BLOB,
  epoch INTEGER NOT NULL,
  weight REAL DEFAULT 1.0,        -- Em texto plano (não-sensível); usado em ASSETs
  created_at INTEGER NOT NULL,
  signature BLOB,
  retention_state TEXT NOT NULL DEFAULT 'integral',
  FOREIGN KEY(source_id) REFERENCES nodes(id),
  FOREIGN KEY(target_id) REFERENCES nodes(id)
);

CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_pub_key ON nodes(pub_key);
CREATE INDEX idx_edges_source ON edges(source_id, type);
CREATE INDEX idx_edges_target ON edges(target_id, type);
CREATE INDEX idx_edges_type ON edges(type);
```

### 2.2 Justificativas de Design

**`weight` em texto plano:** alguns domínios (financeiro, inventário, reputação) precisam de queries agregadas (`SUM(weight)`, `COUNT WHERE weight > X`) para validações. Manter `weight` em texto plano permite essas queries em SQL puro, com custo aceitável de privacidade (revela "quanto", não "o quê"). Quando privacidade total de quantidade for necessária, o domínio usa `weight = 1.0` constante e move o valor real para o payload encriptado.

**`epoch` como inteiro indexável:** permite localização rápida de nós encriptados sob chaves antigas durante rotação de chaves (seção 10).

**`retention_state` na coluna:** evita necessidade de tabelas separadas por estado. Queries filtram por estado quando necessário (ex: ao buscar conteúdo legível, filtrar `retention_state = 'integral'`).

**`signature` sobre conteúdo bruto antes de encriptar:** garante que o autor original assinou aquele conteúdo, não apenas o cifrado. Validação ocorre após decryption.

**Sem `updated_at`:** o sistema é append-only (Princípio 2.7). Mudanças geram novos nós com aresta `MUTATES`.

### 2.3 Tabelas Auxiliares Locais (Não-Replicáveis)

Além das duas tabelas replicáveis, o SQLite local contém tabelas auxiliares (**Projeções Estruturais**) mantidas por **Triggers nativos do SQLite**. Estas **nunca saem do dispositivo**:

- **entity_heads**: Ponteiro para a versão mais recente de cada `entity_id`.
- **active_edges**: Relações vigentes (tombstones de `weight=0` removem entradas daqui).
- **asset_balances**: Saldo achatado.
- **local_capabilities**: Árvore achatada de delegações UCAN.
- **geo_index**: R*Tree nativa para buscas por raio.
- **search_index_fts**: Índices em texto plano para busca (FTS5).
- **Estado de sync e Auditoria Colaborativa (MFA-S)**:
  - **snapshots**: Armazena o estado binário consolidado (`Y.encodeStateAsUpdate`) e o último `State Vector`.
  - **yjs_updates**: O "Rolling Window". Contém os últimos $X$ updates binários para permitir sincronização rápida e Undo nativo.
  - **pending_staging**: Tabela temporária que armazena mudanças brutas capturadas pelo `observeDeep` antes da consolidação semântica.
  - **audit_logs**: O histórico imutável semântico. Contém JSONs legíveis com `antes/depois` (before/after), `userId`, `path` e o `vector_clock` (para rastreio de causalidade).
- **Preferências do usuário** específica do dispositivo.
- **Cache de mídia** (thumbnails, blobs descriptografados temporários).
- **Fila de intenções pendentes** (intenções aguardando validação online).

A estrutura dessas tabelas é definida pela plataforma e pode evoluir entre versões sem requerer migração de dados replicados.

---

## 3. TinyBase e Sync Worker: Leituras e Escritas

### 3.1 Papel Arquitetural

A escrita e leitura são divididas arquiteturalmente. O TinyBase foca em ser a **camada reativa exclusiva** para a interface. Suas responsabilidades:

- **Consumir Projeções do SQLite**: Observar `entity_heads` e outras projeções mantidas por Triggers SQLite.
- **Gerir Projeções Modulares Efêmeras**: Módulos da UI (ex: Marketplace) podem injetar Queries/Indexes no TinyBase ao abrir e destruí-los ao sair. (Essas projeções extras podem viver apenas na RAM ou serem persistidas no SQLite localmente para sobreviver entre sessões, mas *nunca* são replicadas no P2P).
- **Conduzir a Escrita Local**: A UI comanda o TinyBase, que escreve deltas locais diretamente na tabela `nodes`.
- **Expor reatividade granular**: componentes React subscrevem queries específicas e re-renderizam apenas quando afetados.

Por sua vez, o **Sync Worker** assume o fardo pesado:
- **Aplicar deltas P2P**: ouvir deltas do Y.js, decifrar, validar e persistir direto no SQLite (Opção B - via rápida de performance).
- **Construir Merge Commits**: em caso de merges de branches, o Sync Worker gera a `V_Merge` materializada com duas arestas `MUTATES` e assina, evitando dependência da UI para resolver conflitos.

### 3.2 Estrutura Lógica

TinyBase organiza dados em **stores** (uma store por escopo lógico). Cada store contém **tables**, e cada table contém **rows** identificadas por ID. Para a plataforma, há tipicamente uma **store por rede** ativa no dispositivo.

Tables canônicas em uma store de rede:

- `nodes_cache` — espelho parcial em memória de `nodes` SQLite, com payload já descriptografado (quando peer tem capability) e tipos JS nativos.
- `edges_cache` — idem para `edges`.
- `indices_text` — índices FTS5 derivados de payload descriptografado, para busca local.
- `projections_*` — projeções específicas por módulo (ex: `projections_chat_messages_by_thread`).
- `pending_intents` — intenções não validadas localmente.
- `peer_directory` — peers conhecidos e seus estados (online, capabilities oferecidas, último contato).
- `sync_state` — vetores de estado Y.js por documento/grupo.

### 3.3 Política de Espelhamento

Não é viável manter todo o SQLite em memória. TinyBase mantém em `nodes_cache` e `edges_cache` apenas o que é **ativamente consumido**:

- Nós/arestas que aparecem em queries ativas da UI atual.
- Margem de buffer para virtualização (próximos itens previstos).
- Nós/arestas referenciados por relações próximas (ex: ao carregar um post, carregar o autor).

Quando um componente UI deixa de subscrever um conjunto de dados, o cache pode liberar essas entradas. SQLite continua sendo a fonte de verdade.

### 3.4 Reatividade Granular

Componentes React subscrevem queries TinyBase via hooks:

```typescript
// Exemplo conceitual; API exata será definida na implementação
const messages = useTable('projections_chat_messages_by_thread', {
  filter: { thread_id: currentThreadId },
  orderBy: 'created_at desc',
  limit: 50
});
```

O componente re-renderiza apenas quando dados que casam com essa query mudam. Mudanças em outras threads, em outros módulos ou em outros nós não disparam re-render desnecessário.

### 3.5 Coordenação com Y.js (Sync Worker)

O Sync Worker opera como ponte exclusiva entre a rede P2P (Y.js) e o banco local:

- Quando a UI escreve algo, o TinyBase persiste localmente e notifica o Sync Worker para traduzir para uma operação Y.js (ex: criar nó vira `Y.Map.set`).
- O provider WebRTC (gerido pelo Worker) envia o delta para peers.
- Deltas remotos chegam no Y.js, que dispara o observer no próprio Worker.
- O Sync Worker traduz o delta remoto de volta para escrita estruturada no SQLite.
- O SQLite dispara seus Triggers, atualizando `entity_heads`.
- O TinyBase é notificado do flush e recarrega os dados na UI (mantendo alta performance de 60fps sem congelar a Main Thread).

Isso significa que **escritas locais e remotas seguem o mesmo caminho**, garantindo consistência.

---

## 4. Índices Locais e Privacidade

### 4.1 O Problema

Vários requisitos do sistema dependem de busca/filtro/ordenação em texto plano:

- Entity Picker (autocomplete de @mentions, contatos, produtos) com FTS5.
- Filter Engine com predictive count em tempo real.
- Search global na Command Palette.
- Validação de unicidade em Smart Forms.
- Ordenação por campos de payload (data, valor, prioridade).

Mas o `payload` está encriptado em repouso. Não é possível fazer `WHERE payload LIKE '%termo%'` quando payload é BLOB AES-GCM.

### 4.2 A Solução: Índices em Texto Plano com Encriptação Extra

O peer mantém **índices em texto plano** em tabelas auxiliares locais para conteúdo ao qual ele tem capability de acesso. Estes índices:

- Contêm extratos descriptografados de campos buscáveis (título, nome, tags, valores numéricos).
- São usados internamente por TinyBase e SQLite (FTS5) para queries rápidas.
- São **encriptados em arquivo via uma chave única do dispositivo** (derivada da chave mestra), separada das chaves de conteúdo por época.
- São **descriptografados apenas em memória** durante operação ativa do app.
- Nunca saem do dispositivo (não são replicáveis P2P).

### 4.3 Threat Model dos Índices

Esta abordagem tem trade-offs explícitos:

**Protege contra:**
- Backups do dispositivo (índices ficam inúteis sem chave do dispositivo).
- Apps de terceiros tentando ler arquivos da plataforma.
- Propagação não-autorizada (índices não são replicáveis).

**Não protege contra:**
- Atacante com acesso runtime ao app desbloqueado (mesma limitação universal — princípio 2.4).
- Atacante com root/jailbreak no dispositivo capaz de extrair chave do dispositivo.

Esta postura é coerente com o threat model da plataforma como um todo (Documento 1, seção 8.2): proteção sólida em repouso e em propagação, limitações honestas em runtime no dispositivo.

### 4.4 Estrutura dos Índices

Cada nó com payload tem entradas correspondentes no índice apenas para campos declarados como **searchable** pela SPECIFICATION que o governa. Campos não-searchable nunca entram em índice.

Exemplo conceitual de tabela de índice:

```sql
CREATE TABLE indices_text (
  node_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  text_value TEXT,           -- Encriptado em arquivo, decriptado em memória
  numeric_value REAL,
  PRIMARY KEY (node_id, field_name)
);

CREATE VIRTUAL TABLE indices_fts USING fts5(
  node_id UNINDEXED,
  text_blob,
  content='indices_text'
);
```

A SPECIFICATION canônica de cada subtipo declara:

- Quais campos do payload são `searchable: true`.
- Quais são `sortable: true`.
- Quais nunca devem ser indexados (campos sensíveis explícitos).

### 4.5 Busca Federada (Sucinto)

Quando o usuário busca conteúdo que não está no índice local (por não ter sido replicado), a Graph-Based Routing (seção 6) é acionada para busca federada — peers vizinhos que têm o conteúdo respondem com resultados, respeitando suas próprias capabilities.

A UX da busca federada (two-tier: resultados locais imediatos + federados em background) é detalhada na seção 7 e refletida no Documento 4.

---

## 5. Estados de Retenção e Ciclo de Vida

A replicação no sistema é **parcial e baseada em grupos de acesso**. Mesmo dentro do que o peer tem direito a acessar, ele não armazena tudo indefinidamente. Três estados gerenciam o ciclo de vida do dado no dispositivo:

### 5.1 Estado 1: Integral

- Nó/aresta existe completo no dispositivo: `payload`, `signature`, todas as colunas.
- Acesso é imediato (zero round-trip).
- Estado padrão para conteúdo recente, frequentemente acessado, ou crítico.

### 5.2 Estado 2: Podado (Pruned)

- Nó atua como "casca" (shallow node).
- Coluna `payload` é esvaziada (NULL ou tombstone) no banco local.
- `id`, `type`, `pub_key`, `created_at`, `signature` permanecem.
- Todas as arestas associadas ao nó **permanecem intactas**.
- O peer sabe exatamente o que o nó é e com quem ele se relaciona, apenas não possui o conteúdo.
- Permite reidratação cirúrgica via Graph-Based Routing (seção 6).

### 5.3 Estado 3: Expurgado (Expunged)

- Nós e arestas associadas foram completamente removidos das tabelas locais.
- O peer mantém apenas a **assinatura do snapshot** que cobria aquele intervalo, e o ID do contexto/grupo.
- Permite saber que uma linha do tempo histórica existe e pertence àquele grupo, sem ter o mapa topológico local.
- Reidratação requer baixar snapshot inteiro daquele contexto, ou requisição direcionada por timestamp.

### 5.4 Snapshot Manifest para Estado Expurgado

Para permitir reidratação granular após expurgo, o snapshot guarda manifest compacto:

```json
{
  "snapshot_id": "snap_abc123",
  "context_id": "group_xyz",
  "epoch_range": [42, 48],
  "time_range": [1747000000000, 1747999999999],
  "expunged_node_ids": ["sha256_truncated_1", "sha256_truncated_2", ...],
  "merkle_root": "...",
  "signature": "..."
}
```

O peer pode então solicitar nós específicos por ID quando precisar reidratá-los, sem baixar o grupo inteiro.

### 5.5 Política de Transição Entre Estados

A transição Integral → Podado → Expurgado é governada por **G4 (híbrido por domínio)**:

**Defaults por subtipo de nó (canonicalizados nas SPECIFICATIONs):**

| Subtipo | Integral até | Podado até | Expurgado |
|---------|--------------|------------|-----------|
| `CONTENT:CHAT_MESSAGE` (1-1, casual) | 30 dias | 180 dias | Após 1 ano |
| `CONTENT:CHAT_MESSAGE` (grupo profissional) | 90 dias | 1 ano | Após 3 anos |
| `CONTENT:DOCUMENT` (workspace ativo) | Permanente | — | — |
| `CONTENT:POST` (feed social) | Imediata (poda agressiva) | 1 ano | Após 2 anos |
| `CONTENT:INVOICE`, `CONTENT:RECEIPT` | Conforme retenção legal (5+ anos) | — | Nunca |
| `CONTENT:FINANCIAL_TRANSACTION` | Conforme retenção legal | — | Nunca |
| `ASSET:CONSENT` | Permanente enquanto válido | Após revogação: arquivado | Nunca |

**Regras de override:**

- Usuário pode "pinar" (forçar Integral) qualquer nó individual ou conjunto.
- Pressão de armazenamento (quota próxima do limite) acelera transição automática, respeitando pins.
- Em redes com "dono", regras dinâmicas podem distribuir responsabilidade de retenção entre peers (poda coordenada — seção 8).
- **Retenção legal forçada** para domínios regulados (fiscal, financeiro, eSocial): nunca expurgar, ignorar pressão de storage (notificar usuário se necessário expandir).

### 5.6 Cuidado com Expurgo Prematuro

A transição para Expurgado é **destrutiva localmente** — recuperação requer rede. Em modalidades onde rede pode ser indisponível (P2P puro com peers offline), o sistema é conservador:

- P2P puro: prefere Podado a Expurgado por mais tempo, porque reidratação não é garantida.
- Corporativa com super peer: pode ser mais agressivo no expurgo, porque super peer sempre tem o dado.
- Pública: meio termo, considerando que peer do sistema atua como reserva.

---

## 6. Graph-Based Routing

Em substituição a uma DHT global, a plataforma utiliza o próprio grafo como diretório topológico para descoberta de peers e roteamento de busca/reidratação. Esta é a inovação central da camada de dados.

### 6.1 Premissa

Toda relação no sistema (autoria, pertencimento, transferência, governança) é uma aresta. Quando um peer precisa encontrar quem detém um conteúdo, ele consulta as **arestas que já possui** — elas revelam outros peers que estão no mesmo contexto e portanto provavelmente têm acesso ao conteúdo procurado.

Isso evita:
- Broadcast cego (custoso e revelador de metadados).
- DHT global (complexo de implementar em browser/Capacitor, vulnerável a sybil).
- Diretório centralizado (contraria modelo P2P).

### 6.2 Ciclo de Reidratação

Quando o peer precisa de um nó em estado Podado ou Expurgado:

**Etapa 1: Identificação Topológica (Local)**

- Para nó Podado: consulta `edges` local. Arestas como `MEMBER_OF`, `AUTHORED`, `BELONGS_TO` revelam outros peers no mesmo contexto.
- Para nó Expurgado: usa metadados do snapshot para identificar o `context_id` (grupo, tópico, conversa, projeto).

**Etapa 2: Descoberta Direcionada**

Com IDs dos peers candidatos identificados, o peer aciona a camada de signaling (Cloud da rede ou trackers federados) solicitando abertura de túneis WebRTC com esses peers específicos.

**Etapa 3: Reidratação via Y.js**

Conexão WebRTC estabelecida, os documentos Y.js trocam **State Vectors**. O peer remoto calcula exatamente quais deltas o peer local não possui e envia apenas o necessário.

**Etapa 4: Reconstrução de Estado**

Deltas chegam, passam por Validador de Domínio (verifica assinatura, hash MFA-S, capability), e via TinyBase são aplicados ao SQLite. O nó retorna ao estado Integral.

### 6.3 Garantias

- **Privacidade rigorosa**: o roteamento é restrito pela matemática do grafo. Apenas nós que já têm permissão e ciência mútua sobre o domínio são envolvidos.
- **Sem broadcast**: a busca não revela ao mundo "quero esse dado".
- **Resiliência por redundância**: tipicamente múltiplos peers no mesmo contexto têm o dado; falha de um não impede reidratação.
- **Escalabilidade**: cada peer só precisa conhecer peers de seus próprios contextos, não o universo.

### 6.4 Trade-offs Conhecidos

- **Disponibilidade depende de peers do contexto online.** Em P2P puro, se todos os peers de um pequeno grupo estiverem offline, dado é temporariamente inacessível. Em modalidades com super peer (Cloud always-on), super peer atua como sempre-disponível para o contexto.
- **Reidratação tem latência maior que acesso local.** Aceitável dada a UX adequada (loading states explícitos, princípio 2.2 de adequação transparente).
- **Onboarding de peer novo tem desafio inicial.** Sem arestas no grafo local, não há topologia para roteamento. Resolvido pelo "peer do sistema" (Documento 1, seção 5.1) que é primeiro peer conhecido.

### 6.5 Busca Federada via Graph-Based Routing

A mesma mecânica suporta busca:

- Peer faz query local nos índices em texto plano (instantâneo).
- Em paralelo, propaga query para peers conhecidos do contexto relevante.
- Peers respondem com resultados de seus próprios índices, **filtrados pelas capabilities do solicitante** (super peer corporativo, por exemplo, filtra resultados por escopo de role do peer requisitante).
- UI agrega resultados local-primeiro, depois federados (two-tier).

A UX detalhada de busca federada está no Documento 4.

---

## 7. Modelo de Sincronização em Ondas

A sincronização inicial de um peer (primeiro login, novo dispositivo, retorno após longa ausência) é orquestrada em ondas progressivas. Esta abordagem reconhece que **operacionalidade do app é prioridade absoluta** — usuário não deve esperar GBs de download para começar a usar.

### 7.1 Onda 0 — Operacional (Segundos)

Não-negociável: o app deve ficar operacional em poucos segundos após autenticação.

**Conteúdo da Onda 0:**

- Identidade do usuário: `PROFILE:AUTHENTICATION`, `CONTENT:PERSONAL_DATA`, personas associadas.
- Capabilities ativas: ASSETs `CAPABILITY` e `ROLE` que o usuário possui.
- Lista de grupos/canais/contextos de acesso: arestas `MEMBER_OF` ativas.
- Specifications canônicas + specifications de rede relevantes.
- Estado mínimo de UI (tema selecionado, idioma, preferências).

**Tamanho típico:** poucos KB a poucos MB.

**Resultado:** app abre. Usuário pode entrar em qualquer módulo. Pode não haver histórico ainda; UI mostra estado de carregamento progressivo.

### 7.2 Onda 1 — Domínios Prioritários (Minutos)

Conteúdo dos domínios marcados como prioritários, limitado a janela recente.

**Conteúdo padrão:**

- Mensagens de chat dos últimos 30 dias.
- Notificações pendentes.
- Saldo financeiro atual e últimas transações (Cenário Pública/Corporativa).
- Documentos abertos recentemente.

**Variação por modalidade:**

- **Rede pública/P2P puro (primeiro login)**: Onda 1 simplificada — apenas o estritamente necessário, lazy puro para o resto. Justificativa: usuário pode estar testando, não vale prefetch agressivo.
- **Rede pública/P2P puro (logins subsequentes)**: Onda 1 completa para domínios prioritários.
- **Rede corporativa (qualquer login)**: Onda 1 robusta, frequentemente com snapshot do super peer (seção 9).

**Fonte da Onda 1:**

- Padrinho (peer que convidou o usuário) atua como fonte primária natural.
- Snapshot de super peer corporativo, quando disponível.
- Graph-Based Routing geral como fallback.

### 7.3 Onda 2 — Histórico em Background (Background Contínuo)

Em background, sem bloquear UI:

- Histórico mais antigo dos domínios prioritários.
- Módulos secundários (CRM, SCM, Workspace, etc. conforme caso de uso).

**Estado padrão dos dados desta onda:** Podado. Metadados e arestas presentes; payload chega sob demanda quando usuário acessa.

**Prioridade dinâmica:** se o usuário abre um módulo durante Onda 2, esse módulo sobe na fila.

### 7.4 Onda 3 — Sob Demanda

Reidratação Podado → Integral via Graph-Based Routing (seção 6) quando usuário acessa item específico.

UI mostra estado "buscando..." durante a reidratação. Em redes com super peer always-on, latência típica é de centenas de milissegundos. Em P2P puro com peers offline, pode ser indisponibilidade temporária com mensagem apropriada.

### 7.5 Casos Especiais de Sincronização

**Novo dispositivo do mesmo usuário:**

Otimização: dispositivo existente do usuário (em outra rede ou outra instância da mesma rede) atua como padrinho perfeito. Mesma identidade, mesmas capabilities, dados já validados localmente. Sync entre dispositivos do mesmo usuário pode ser mais agressivo:

- Validação simplificada (assume validade do estado do dispositivo origem).
- Replicação proativa de mais dados além das ondas padrão.
- Casa com fluxo SSS de recuperação (Documento 3).

**Retorno após longa ausência:**

Tratado como sync incremental. Vetores de estado Y.js indicam o que mudou desde o último sync; apenas deltas novos chegam. Onda 0 reduzida (apenas refresh de capabilities e specifications).

### 7.6 Indicador de Sync na UI

Princípio: **transparente sem intrusivo**.

- **Onda 0** tem skeleton/loader explícito (poucos segundos), porque a UI ainda não está pronta.
- **Onda 1** tem indicador discreto (ícone ou linha de progresso fina no topo), porque app já está usável.
- **Ondas 2 e 3** geralmente não têm indicador global. Quando usuário pede algo que ainda não chegou ("ver mensagens do ano passado"), aí sim aparece "buscando..." contextual.
- Notificação ativa apenas em casos de erro persistente ou conclusão de operação iniciada pelo usuário.

---

## 8. Replicação Coordenada e Replication Factor

Para garantir disponibilidade de dados sem replicar tudo em todos os peers, o sistema coordena replicação entre peers de um mesmo grupo. A coordenação varia por modalidade (H4: híbrido por tipo de rede).

### 8.1 P2P Puro: Replication Factor via Gossip

**Mecânica:**

- Cada nó precisa estar em pelo menos N peers do grupo (default: N=3, ajustável por SPECIFICATION).
- Antes de qualquer peer transitar um nó para Podado/Expurgado, ele verifica via gossip que outros N-1 peers o têm em estado Integral.
- Se a verificação falha (não há N peers com o dado), o peer **adia poda**.

**Vantagens:**

- Sem coordenador centralizado.
- Robusto a falhas individuais.

**Custos:**

- Overhead de gossip antes de poda.
- Pode levar a sub-replicação em redes pequenas (se há apenas 2 peers ativos, N=3 é inalcançável).

**Fallback em redes muito pequenas:**

- Sistema reduz N temporariamente e notifica usuário ("Disponibilidade reduzida — apenas 2 peers ativos no grupo").

### 8.2 Corporativa/Whitelabel: Coordenador no Super Peer

**Mecânica:**

- Super peer da empresa mantém manifest de retenção: "peer A guarda estes IDs; peer B guarda estes outros".
- Pesos dinâmicos são atribuídos a cada nó conforme criticidade, frequência de acesso, contexto.
- Peers consultam manifest antes de podar; super peer pode alocar redistribuição.
- Super peer sempre mantém cópia integral de tudo (é o garantidor de disponibilidade).

**Comunicação sistema↔peer:**

A coordenação acontece via canal estruturado (a definir como tipo específico de nó/aresta durante implementação — provavelmente via SPECIFICATION dedicada que governa instruções de replicação). Peers honram as instruções porque são parte do contrato da rede corporativa.

**Vantagens:**

- Controle fino: super peer pode otimizar por dispositivo (máquina com mais storage retém mais).
- Garantia de disponibilidade absoluta (super peer sempre tem).

**Custos:**

- Centralização do coordenador.
- Aceito como trade-off em modalidade corporativa.

### 8.3 Pública: Sharding Determinístico por Hash

**Mecânica:**

- Cada nó tem `id` (hash). Cada peer ativo no grupo é responsável por uma faixa de hashes (ex: peer A guarda hashes 0x00-0x3F, peer B 0x40-0x7F, etc.).
- Quando peer entra/sai, faixas se rebalanceiam automaticamente via algoritmo determinístico (consistent hashing).
- Peer do sistema da rede pública sempre cobre 100% (é o garantidor de retomada).

**Vantagens:**

- Sem coordenador ativo.
- Matemática pura.
- Escala bem para muitos peers.

**Custos:**

- Rebalanceamento gera tráfego.
- Se um peer sai sem aviso, faixa fica órfã até rebalance (peer do sistema cobre o gap).

### 8.4 Pesos Dinâmicos por Nó

Em redes com "dono", o sistema pode atribuir pesos que influenciam replicação:

- Nó "muito quente" (acessado por muitos): replicação alta, redundância elevada.
- Nó "morno": replicação padrão.
- Nó "frio": replicação mínima, tendência ao podado.

Pesos podem mudar ao longo do tempo conforme padrões de acesso. Isso é gerido por SPECIFICATION dedicada da rede.

---

## 9. Snapshots e Bootstrap Acelerado

Sincronização inicial reconstruindo deltas individuais é viável mas pode ser lenta para volumes grandes. Snapshots oferecem fast-path.

### 9.1 O Que é um Snapshot

Snapshot é um **estado consolidado** de um grupo/contexto em determinado momento, em formato compacto, assinado pelo peer que o gerou.

Conteúdo típico:

- Conjunto de nós e arestas do contexto, em estado Podado (sem payloads).
- Manifest de IDs e hashes para verificação de integridade.
- Vetor de estado Y.js correspondente.
- Assinatura do gerador.
- Timestamp de geração.

### 9.2 Quem Gera

- **Rede corporativa**: super peer gera snapshots periódicos (frequência por SPECIFICATION — diário, semanal, conforme volume).
- **Rede pública**: peer do sistema gera snapshots dos contextos públicos.
- **P2P puro**: snapshots ficam fora do escopo inicial. Sem coordenador, gerar snapshots consensual é não-trivial. Peers individuais podem gerar snapshots privados para seu próprio uso, mas não há snapshot autoritativo do grupo.

### 9.3 Quando São Usados

- **Primeiro login em rede corporativa**: peer recebe snapshot do super peer como Onda 1, depois sincroniza apenas o delta desde o snapshot via Y.js. Drasticamente mais rápido que reconstruir via deltas individuais.
- **Recuperação após longa ausência**: idem.
- **Reidratação de Estado Expurgado**: snapshot indica quais IDs foram expurgados; peer pode requisitar reidratação seletiva.

### 9.4 Custos e Trade-offs

- Geração de snapshot consome recursos do gerador (super peer absorve isso).
- Snapshots ficam stale; sync incremental cobre o gap.
- Frequência ideal depende de volume de mudanças (mais mudanças = snapshots mais frequentes, mas mais custo).

### 9.5 Privacidade dos Snapshots

Snapshots gerados pelo super peer **não vazam payloads** que o peer requisitante não tem capability de acessar. O snapshot é por contexto/grupo; peer só recebe snapshot dos contextos a que pertence.

Mesmo assim, em estado Podado, snapshot revela metadados (existência de IDs, datas, autores). Esta é a postura padrão; SPECIFICATIONs sensíveis podem requerer encriptação adicional do próprio manifest do snapshot.

---

## 10. Hierarquia Criptográfica e Forward Secrecy

### 10.1 As Quatro Camadas de Chaves

| Camada | Tipo | Armazenamento | Função | Lifetime |
|--------|------|---------------|--------|----------|
| Chave Mestra | Ed25519 | Secure Enclave / Keychain / Keystore | Identidade do AUTHENTICATION; assinatura de operações | Permanente até revogação |
| Chave do Dispositivo | AES-256 | Derivada de chave mestra; cache em memória | Encriptação de índices locais e tabelas auxiliares (seção 4) | Permanente para o dispositivo |
| Chave de Conteúdo (por época) | AES-256 | KMS / Volátil em memória / Derivada via UCAN | Encriptação de payload de grupo/documento | Por época (rotação) |
| Cache Volátil | AES-256 (mesmo material) | Memória apenas | Chaves de conteúdo descriptografadas para uso ativo | TTL 4 horas |

### 10.2 Forward Secrecy por Época

Cada grupo/documento opera sob uma **chave de época**. Quando ocorre evento que justifica rotação (revogação de capability de membro, descoberta de potencial vazamento, intervalo periódico configurável), uma nova época é iniciada:

- Nova chave AES é gerada e distribuída aos peers que mantêm capability ativa.
- Conteúdo a partir do momento da rotação é encriptado com a nova chave.
- Peers cuja capability foi revogada **não recebem a nova chave** — ficam matematicamente cegos para conteúdo da nova época em diante.
- Conteúdo de épocas anteriores permanece acessível para quem tinha chaves anteriores (limitação inerente do local-first).

### 10.3 KMS Online-Optional

A distribuição de chaves de época é gerenciada por um **KMS (Key Management Service) online-optional**:

- **Modo online (rede com super peer disponível)**: KMS coordena rotação. Quando capability é revogada, KMS dispara rotação imediata; nova chave é distribuída via UCANs aos membros legítimos.
- **Modo offline (rede sem super peer ou super peer inacessível)**: rotação é adiada até reconexão. Janela de exposição residual é aceita.
- **Em P2P puro**: rotação pode ser feita por consenso entre peers ativos do grupo, com algum custo de latência.

KMS não é necessariamente um serviço único; pode ser implementado como conjunto de peers privilegiados (super peers) que coordenam via SPECIFICATION dedicada.

### 10.4 Modo Restrito de UCAN (Opcional)

Padrão: UCAN carrega chave AES; cache volátil retém por 4h; após expiração, peer precisa renovar UCAN.

Modo restrito (configurável por SPECIFICATION para domínios de alta sensibilidade):

- UCAN não carrega chave AES diretamente.
- UCAN dá direito a *requisitar* a chave de um KMS/peer autoritativo.
- KMS entrega chave provisória com TTL ainda mais curto (minutos).
- Trade-off: round-trip adicional, requer conectividade no momento de acesso.

Adequado para: dados de saúde, dados financeiros corporativos, dados pessoais sob LGPD estrita.

### 10.5 Detalhamento de Implementação

A implementação concreta de:

- Algoritmo de derivação de chave do dispositivo (provavelmente HKDF a partir da chave mestra).
- Esquema de transporte de chave AES via UCAN.
- Protocolo de rotação de época.
- Sincronização de épocas entre peers.

Está fora do escopo deste documento e será detalhada em especificação técnica de implementação criptográfica subsequente.

---

## 11. Cache Volátil e Modos de Acesso

### 11.1 Princípio

Chaves AES descriptografadas para uso ativo **nunca persistem em disco**. Vivem apenas em memória, com TTL de 4 horas (default; ajustável por SPECIFICATION para domínios mais ou menos sensíveis).

### 11.2 Comportamento

- Ao iniciar sessão, peer derruba cache anterior (limpeza implícita).
- Ao acessar conteúdo, cache é hidratado com chaves necessárias.
- Após 4h de não-uso, cache expira; conteúdo fica indisponível até nova autenticação.
- Em background prolongado, sistema operacional pode esvaziar memória (cache morre naturalmente).

### 11.3 Implicações Operacionais

- Usuário pode receber prompt de re-autenticação após 4h+ de uso contínuo.
- Re-autenticação biométrica é UX preferida em mobile (rápida, não-fricciónal).
- Em desktop com sessão longa, prompt aparece como diálogo do sistema.

### 11.4 Configurabilidade

SPECIFICATION da rede pode ajustar:

- TTL do cache (mais longo em rede corporativa interna; mais curto em modo restrito).
- Comportamento ao expirar (prompt automático vs. apenas bloquear acesso novo).
- Forçar re-auth em ações sensíveis específicas (ex: visualizar dados pessoais de outros, executar operações financeiras).

---

## 12. Web Workers e Processamento em Background

### 12.1 Por Que Workers

Vários trabalhos da camada de dados são pesados e não devem bloquear o thread principal da UI:

- **Decryption AES-GCM em volume** (sync inicial pode ter dezenas de milhares de payloads).
- **Cálculo de hash MFA-S** (cadeia de verificação ao receber deltas em massa).
- **Aplicação de deltas Y.js em batch**.
- **Indexação de novos conteúdos** (geração de entradas em índices em texto plano).
- **Compressão e descompressão de snapshots**.

Sem workers, mobile médio enfrenta lag perceptível durante sync, indexação inicial e operações em massa.

### 12.2 Arquitetura de Workers

A V3 inclui obrigatoriamente:

- **Sync Worker**: aplica deltas Y.js, decryption, validação MFA-S, escrita em SQLite via TinyBase.
- **Index Worker**: gera/atualiza índices em texto plano e estruturas FTS5 quando conteúdo novo chega.
- **Crypto Worker**: operações criptográficas pesadas em batch (rotação de época, geração de assinatura em massa).

Workers comunicam-se com main thread via mensagens estruturadas tipadas. TinyBase atua como interface: workers escrevem no SQLite via TinyBase, UI subscreve via TinyBase.

### 12.3 Comunicação Estruturada

```typescript
// Exemplo conceitual; API exata será definida na implementação
type WorkerMessage =
  | { type: 'apply_delta'; payload: { deltaBytes: Uint8Array; epoch: number } }
  | { type: 'index_node'; payload: { nodeId: string; fields: Record<string, unknown> } }
  | { type: 'rotate_epoch'; payload: { groupId: string; newEpochKey: CryptoKey } };

type WorkerResult =
  | { type: 'delta_applied'; payload: { affectedNodeIds: string[] } }
  | { type: 'indexing_complete'; payload: { nodeId: string } }
  | { type: 'error'; payload: { code: string; message: string } };
```

### 12.4 Trade-offs Aceitos

- Comunicação main↔worker via postMessage tem overhead. Mitigação: enviar batches, não mensagens individuais.
- Debugging é mais complexo. Mitigação: logs estruturados, ferramentas de debug worker do navegador.
- SharedArrayBuffer (que poderia eliminar overhead) tem requisitos de COOP/COEP que complicam deploy. Postura inicial: postMessage simples; SharedArrayBuffer como otimização posterior se necessário.

---

## 13. Performance e Tier-Aware Degradation

### 13.1 Detecção de Tier

Ao primeiro startup (e periodicamente revalidado), o sistema avalia capacidade do dispositivo:

- RAM disponível (`navigator.deviceMemory`, fallback heurístico em mobile).
- Suporte a WebGPU (relevante para IA local quando entrar no escopo).
- Número de cores lógicas (`navigator.hardwareConcurrency`).
- Performance de OPFS via benchmark inicial.
- Tipo de dispositivo (mobile / desktop / cloud).

Resultado: classificação em **tier** (low / medium / high), persistido localmente.

### 13.2 Comportamento por Tier

Cada feature da camada de dados declara seu tier mínimo. Em tier baixo, o sistema aplica degradação consciente:

| Feature | Low | Medium | High |
|---------|-----|--------|------|
| Buffer de virtualização | Reduzido (50%) | Padrão (100%) | Expandido (150%) |
| Pre-fetch de conteúdo "quente" | Conservador | Padrão | Agressivo |
| Tamanho de batch de sync | Pequeno | Padrão | Grande |
| Workers ativos simultâneos | 1 | 2 | 3+ |
| Animações spring | Simplificadas (CSS) | Spring com física padrão | Spring com física rica |
| Container Queries em re-renders frequentes | Adiados | Imediatos | Imediatos |
| MFA-S coalescing | Aceitável adiar bate-disco | Bate-disco em tempo real | Bate-disco em tempo real |

### 13.3 Princípio da Adequação Transparente Aplicado

Quando o sistema detecta degradação aplicada, ele **comunica ao usuário e oferece controle**:

- *"Detectamos que seu dispositivo tem capacidade limitada. Reduzimos algumas animações para manter o app fluido. Você pode reverter nas configurações."*
- *"Seu histórico de mensagens está consumindo mais espaço que o ideal. Liberar espaço com backup?"*
- *"Buscas estão lentas. Reduzir profundidade da busca federada?"*

Usuário pode override: priorizar funcionalidade sobre performance se desejar (princípio 2.2).

### 13.4 Configurabilidade

Configurações expostas:

- Tier detectado (visível, ajustável manualmente para testes).
- Override por feature individual.
- Profile geral: "Performance máxima", "Equilibrado", "Funcionalidade máxima".
- Em modo corporativo, admin pode definir defaults para a frota.

---

## 14. Quotas de Storage e Garbage Collection

### 14.1 Quota Explícita

Sistema explícito de quota por dispositivo, configurável por usuário, com defaults inteligentes baseados em capacidade detectada do dispositivo (ex: 1GB em mobile médio, 10GB em desktop).

### 14.2 Dashboard de Uso

Interface dedicada (parte do módulo Settings) mostrando:

- Uso por módulo (Chat, Marketplace, CRM, etc.).
- Uso por estado de retenção (Integral / Podado / Expurgado).
- Uso por tipo de nó.
- Uso de cache de mídia separadamente.
- Pin status (quanto está pinado e impede poda automática).

### 14.3 Garbage Collection Híbrido (G4)

Ao se aproximar do limite de quota:

1. Sistema notifica usuário com proposta proativa (princípio 2.2).
2. Usuário pode: aumentar quota, desfazer pins seletivos, autorizar poda agressiva, fazer backup externo.
3. Se nenhuma ação e quota estoura, sistema executa poda automática respeitando:
   - **Co-Compactação**: O Garbage Collector atua apagando o payload no SQLite e simultaneamente instrui o Y.js a compactar as operações do seu State Vector referentes àquela época.
   - **Pins do usuário** são intocáveis.
   - **Retenção legal forçada** é intocável (notifica que precisa expandir).
   - **Defaults por subtipo** (tabela 5.5) são respeitados.
   - **LRU dentro do que pode ser podado** decide ordem.

### 14.4 Pinning

Usuário pode pinar:

- Nó individual ("essa conversa é importante, nunca pode").
- Conjunto ("toda a thread deste projeto").
- Tipo dentro de contexto ("todos os documentos do Workspace X em Integral").

Pin é registrado como `ASSET:PIN` (ou aresta dedicada — a definir na implementação) e é local (não-replicável), mas persiste através de sync.

### 14.5 Override Corporativo

Em rede corporativa, admin pode:

- Definir quota mínima/máxima por funcionário.
- Forçar pinning de domínios críticos (ex: "todos os contratos sempre Integral").
- Definir políticas de backup automático.

Tudo via SPECIFICATION da rede.

---

**Fim do Documento 2.**

Próximos documentos:
- Documento 3: Modelo Operacional e Governança (incluirá detalhamento jurídico LGPD, ciclo de vida de specifications, recuperação de acesso, governança ontológica)
- Documento 4: Camada de UI e Engines (incluirá detalhamento técnico do sistema de temas Tailwind+shadcn)
