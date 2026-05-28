# Backlog Geral de Implementação — Plataforma V3.1 (Local-First & P2P)

Este documento centraliza e descreve todas as funcionalidades pendentes, lacunas e status de implementação da Plataforma V3.1 do Superapp. Ele serve como o ponto de verdade para desenvolvedores e agentes de IA sobre o que falta ser codificado no projeto.

---

## Painel de Controle das Fases (Resumo)

| Fase | Título | Status Geral |
| :--- | :--- | :--- |
| **Fase 1** | [Infraestrutura Criptográfica & Identidade](#fase-1-infraestrutura-criptográfica--identidade) | 🔴 Não Iniciado |
| **Fase 2** | [Motor Operacional & MFA-S](#fase-2-motor-operacional--mfa-s) | 🟡 Parcialmente Implementado |
| **Fase 3** | [Dados Avançados & Sincronização em Ondas](#fase-3-dados-avançados--sincronização-em-ondas) | 🟡 Parcialmente Implementado |
| **Fase 4** | [Core de Motores Visuais (Engines do Padrão A)](#fase-4-core-de-motores-visuais-engines-do-padrão-a) | 🟡 Parcialmente Implementado (Timeline/SuperCard básicos) |
| **Fase 5** | [Extensibilidade Dinâmica (Temas, i18n & Marketplace)](#fase-5-extensibilidade-dinâmica-temas-i18n--marketplace) | 🔴 Não Iniciado |

---

## Detalhamento Técnico das Lacunas e Tarefas Pendentes

### Fase 1: Infraestrutura Criptográfica & Identidade
*Foco: Garantir que a identidade do usuário, chaves e permissões de acesso existam de forma matematicamente segura antes de sincronizar ou exibir dados.*

* **Status:** 🔴 **Não Iniciado**
* **Arquivos Chave:**
  * [NEW] `packages/core/src/security/identity.ts` (ou similar) — Para gerenciar geração de chaves Ed25519 e PBKDF2 local.
  * [NEW] `apps/web/src/worker/crypto-worker.ts` — Web worker para chaves temporárias em memória (TTL de 4h) e criptografia AES-GCM em segundo plano, contendo o Key Vault.
  * [NEW] `packages/core/src/security/ucan.ts` — Modelagem e validação dos tokens UCAN.
  * [NEW] `packages/core/src/security/sss.ts` — Implementação da divisão de segredo Shamir 2-de-3.

#### Checklist de Tarefas:
- [ ] **Identidade Local & BIP39**: Implementar derivação de chaves Ed25519 a partir de sementes BIP39 de 12/24 palavras. Cifrar localmente usando PBKDF2 com a senha do usuário.
- [ ] **Cifragem AES-256-GCM por Épocas**: Armazenar payloads de nós e arestas como BLOBs criptografados com IVs. Indexar coluna `epoch` nas tabelas do SQLite.
- [ ] **Separação UCAN / Key Vault**: Implementar o fluxo de tokens UCAN estritamente como provas de autorização (sem material de chaves no payload) e o subsistema Key Vault no Crypto Worker para entrega de chaves de época baseada no TTL do papel ativo.
- [ ] **Ontologia de Permissões V3.1**: Modelar `ASSET:PERMISSION` (com queries de traversal com profundidade limite $\le$ 6 e restrições de mutação) e `ASSET:ROLE` com as arestas estruturais `AGGREGATES` e `REQUIRES` conectadas ao `entity_id` estável.
- [ ] **Recuperação de Chave Mestra**: Fluxo Shamir's Secret Sharing (SSS) com 3 partes (dispositivo, provedor/fundador, canal externo).

---

### Fase 2: Motor Operacional & MFA-S
*Foco: Estruturar as regras que governam como o estado muda de forma imutável, auditável e segura.*

* **Status:** 🟡 **Parcialmente Implementado**
* **O que já está feito:**
  * Criação física e testes de coalescência em segundo plano da tabela `pending_staging` para compilar edições colaborativas granulares em nós do tipo `CONTENT:AUDIT` na tabela física central `nodes`.
  * Persistência de deltas de sincronização do Y.js (`yjs_updates` e snapshots periódicos compactados em `snapshots`).
  * Recuperação automática de staging entries residuais no boot (Crash Recovery).
  * Persistência de intenções locais na tabela temporária `pending_intents` via `SyncWorkerAPI.saveIntent`.
* **Lacunas / O que falta fazer:**
  * [MODIFY] [sync-worker.ts](file:///c:/Dev2026/Projeto%20Superapp/apps/web/src/worker/sync-worker.ts) / [NEW] `packages/core/src/specifications/validator.ts` — Pipeline de validação de intenções baseado em specifications.
  * Lógica de Undo Semântico (reversão de valores baseando-se nos diffs de `before_value` e `after_value` em `CONTENT:AUDIT`).
  * Suporte a múltiplos validadores externos (multi-sig ou quórum) via transição de intenção pendente para nó final no grafo após recebimento de arestas `APPROVED_BY`.

#### Checklist de Tarefas:
- [ ] **Validador de Domínio**: Criar um interpretador genérico que lê a `SPECIFICATION` vinculada ao nó e executa validações lógicas (JSONSchema / JSONLogic / WASM) sobre os campos propostos.
- [ ] **Pipeline de Intenções Completo**: Integrar a escrita otimista (quando a spec declara `validation: auto_self`) com a escrita suspensa (que cria `CONTENT:INTENT` e aguarda quórum de validadores externos antes de emitir o nó final).
- [ ] **Undo Semântico**: Criar interface e lógica de banco de dados para viajar no tempo e desfazer modificações em nível de propriedade usando os logs históricos do MFA-S.
- [ ] **Publicação Shadow**: Implementar rotina para exportar o grafo limpo/descriptografado para estruturas Markdown ou JSON estáticas.

---

### Fase 3: Dados Avançados & Sincronização em Ondas
*Foco: Elevar a performance da persistência local, do tráfego de rede e do gerenciamento de armazenamento do dispositivo.*

* **Status:** 🟡 **Parcialmente Implementado**
* **O que já está feito:**
  * Triggers físicos no SQLite mantendo projeções estruturais locais reativas: `entity_heads` (aponta para a versão mais recente do nó daquela linhagem) e `active_edges` (filtra arestas ativas expurgando lápides onde `weight = 0`).
* **Lacunas / O que falta fazer:**
  * [MODIFY] `packages/core/src/database/schema.ts` — Triggers adicionais para FTS5, Geo-Index (R\*Tree) e balanços de ativos.
  * [NEW] `apps/web/src/worker/network/wave-scheduler.ts` — Gerenciar scheduling de sincronização em ondas (Ondas 0, 1, 2 e 3).
  * [MODIFY] `apps/web/src/worker/network/crdt-manager.ts` — Sincronização por grupos/tópicos orientada ao subgrafo de capabilities em vez de uma sala global única.
  * [NEW] `apps/web/src/worker/database/gc.ts` — Algoritmo G4 de Garbage Collection e compactação Y.js local.

#### Checklist de Tarefas:
- [ ] **Busca com FTS5 & Geolocalização (R\*Tree)**: Escrever triggers nativos no SQLite para preencher indexadores FTS5 (`search_index_fts`) apenas para campos indexáveis descriptografados e configurar busca espacial com módulo R\*Tree do SQLite WASM.
- [ ] **Agregação de Ativos (`asset_balances`)**: Criar tabela local e triggers para manter balanços consolidados agregando débitos/créditos de arestas de transação.
- [ ] **Sincronização em Ondas (Waves)**: Schedule de downloads Y.js:
  * **Onda 0**: Identidade, chaves e specifications de rede (imediato, segundos).
  * **Onda 1**: Conversas recentes (últimos 30 dias), notificações e saldos quentes (minutos).
  * **Onda 2**: Histórico antigo como nós de metadados "casca" (background).
- [ ] **Reidratação Dinâmica (Graph-Based Routing)**: Ao renderizar um nó podado ("casca"), solicitar sob demanda o payload criptografado aos peers do mesmo grupo via delta WebRTC.
- [ ] **GC Híbrido (G4) & Compactação**: Notificar usuário ao atingir 90% da quota OPFS e podar nós antigos (Integral -> Casca) respeitando nós prioritários (`ASSET:PIN`) e limites regulatórios. Disparar GC correspondente no Y.js.

---

### Fase 4: Core de Motores Visuais (Engines do Padrão A)
*Foco: Desenvolver as 13 engines fundamentais especificadas no Documento 4, garantindo a reusabilidade disciplinada.*

* **Status:** 🟡 **Parcialmente Implementado**
  * Apenas `Timeline` e `SuperCard` existem em versões extremamente simples sob [apps/web/src/core/engines/](file:///c:/Dev2026/Projeto%20Superapp/apps/web/src/core/engines/).
* **Lacunas / O que falta fazer:**
  * Migrar/refatorar as engines para `packages/core/src/engines/` para torná-las compartilháveis (web, desktop, mobile, etc.).
  * Implementar as outras 11 engines sob o **Padrão A** (motores polimórficos de core configurados por Specifications e especializados nos módulos de negócio).

#### Checklist de Motores Visuais Pendentes:
- [ ] **Coleção e Entidade**:
  * **Layout Engine**: Motor reativo baseado em Tailwind para renderizar grades, listas densas ou tabelas com virtualização.
  * **Filter Engine**: Interpretador de filtros em JSON gerando inputs de busca dinâmicos para a query SQLite.
  * **Entity Picker**: Input de autocomplete integrado ao FTS5.
  * **SmartForm**: Formulário renderizado dinamicamente a partir da `SPECIFICATION` do nó, validando campos e salvando rascunhos de forma otimista.
- [ ] **Interação e Processos**:
  * **Composer**: Input enriquecido com slash-commands (`/`), @mentions e upload de ativos.
  * **ContextMenu & BottomSheet**: Componentes mobile-first baseados em Radix com gestos de arrastar.
  * **StateMachine**: Kanban/Stepper que lê as especificações de transição de estado da regra de negócio.
  * **AuditTrail**: Visualizador da Linhagem de Versões do MFA-S com diffs semânticos e time travel.
- [ ] **Motores Especializados**:
  * **GeoSpatial**: Componentes Geographic (Mapbox/Leaflet) e Cartesian (plantas/coordenadas planas) sob a mesma API.
  * **RelationGraph**: Visualizador de grafos em WebGL/Canvas para organogramas e relações estruturais.
  * **WorkspaceShell**: Shell de sidebar colapsável, canvas flutuante e cabeçalho colaborativo.

---

### Fase 5: Extensibilidade Dinâmica (Temas, i18n & Marketplace)
*Foco: Transformar a customização visual e de linguagem em dados dinâmicos governados e sincronizados pelo próprio grafo.*

* **Status:** 🔴 **Não Iniciado**
* **Arquivos Chave:**
  * [NEW] `packages/core/src/theme/theme-manager.ts` — Injetor dinâmico de variáveis CSS HSL no `:root`.

#### Checklist de Tarefas:
- [ ] **Temas como Dados (`CONTENT:THEME`)**: Criar especificação de temas contendo dicionários de variáveis CSS Custom Properties. Injetar dinamicamente na página web sem reload de runtime.
- [ ] **Tradutor i18n Reativo (`CONTENT:TRANSLATION`)**: Carregar chaves de tradução a partir de nós no grafo SQLite de forma cooperativa.
- [ ] **Marketplace Primitivo**: Engine especializada para buscar e registrar extensões (`CONTENT:THEME`, `CONTENT:TRANSLATION`, `CONTENT:BPMN_TEMPLATE`).

---

## 🛠️ Notas de Resolução e Correções de Bugs Recentes

### 1. Correção de Instabilidade nos Testes de Integração TinyBase (20/05/2026)
* **Arquivo Modificado:** [tinybase.test.ts](file:///c:/Dev2026/Projeto%20Superapp/apps/web/src/store/tinybase.test.ts)
* **Bug Resolvido:** Os testes que validavam a reatividade entre as escritas do `SyncWorker` no SQLite e o carregamento automático no TinyBase falhavam intermitentemente. Isso ocorria porque usavam timeouts estáticos curtos (`setTimeout` de 100ms), insuficientes para garantir a finalização da transação SQLite assíncrona, a notificação assíncrona do Comlink Proxy e o reload interno do TinyBase.
* **Resolução:** Introduzida a função helper de polling `waitForTableRecord` que monitora a store do TinyBase a cada 50ms até que o ID esperado seja populado (com timeout de 3000ms), tornando a suíte de testes 100% determinística e resiliente.
