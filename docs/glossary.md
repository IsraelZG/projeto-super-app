# Glossário — Plataforma V3.1 (Local-First & P2P)

Este documento centraliza a definição de termos e primitivas arquiteturais da Plataforma V3.1, servindo de referência comum para todos os cadernos de documentação do sistema.

---

**Aresta (Edge)** — Relação ou ação entre dois nós no grafo. Sempre representa um verbo.

**ASSET** — Tipo de nó que representa posse, saldo, permissão ou direito.

**ASSET:PERMISSION** — Subtipo de nó ASSET que representa um direito atômico de acesso (leitura via queries de traversal) ou mutação (criação/alteração de arestas). Substitui o antigo `ASSET:CAPABILITY` que foi aposentado na V3.1.

**ASSET:ROLE** — Subtipo de nó ASSET que representa uma função ou cargo organizacional, agregando múltiplas permissions concretas por meio de arestas `AGGREGATES`.

**AUTHENTICATION** — Subtipo de PROFILE que carrega credenciais; raiz da identidade humana em uma rede.

**CONTENT** — Tipo de nó passivo que carrega informação estruturada. Inclui o subtipo `CONTENT:INTENT`.

**CONTENT:INTENT** — Subtipo de CONTENT que materializa a intenção de uma ação que exige validação não-trivial. Não é um quinto tipo de nó; é um CONTENT.

**CRDT** — Conflict-free Replicated Data Type. Estrutura de dados que converge em múltiplos peers sem necessidade de coordenação central.

**entity_id** — Identificador ULID estável de uma entidade ao longo de todas as suas versões (sua linhagem).

**Fundador** — Pessoa ou board que dá bootstrap a uma rede. Pode dissolver superpoderes ao longo do tempo.

**Graph-Based Routing** — Mecanismo de descoberta de peers usando o próprio grafo como diretório topológico, em substituição a DHT global.

**id** — Identificador ULID único de uma versão específica de um nó.

**Linhagem de Versões (Version Lineage)** — Conjunto de todas as versões de uma entidade (mesmo `entity_id`), encadeadas por arestas `MUTATES`. É a auditoria universal do sistema, estruturada em duas camadas de imutabilidade: a do registro (via assinaturas Ed25519) e a da ordem de transição (via `previous_hash` gravado na aresta `MUTATES` apontando para a assinatura do elo anterior).

**Local-First** — Paradigma onde dados nascem e vivem no dispositivo do usuário; sincronização é secundária e oportunística.

**MFA-S (Semantic Mapper)** — Mecanismo de auditoria em nível de propriedade que, **apenas em documentos de edição colaborativa**, reconstrói antes/depois de deltas e gera diff semântico legível sob demanda. O cálculo é **lazy** e não-redundante com a Linhagem de Versões do grafo global.

**Modalidade de Rede** — Modelo de governança e infraestrutura: pública, corporativa whitelabel, P2P pura.

**Nó (Node)** — Entidade no grafo de dados. Sempre representa um substantivo. Quatro tipos: PROFILE, CONTENT, ASSET, SPECIFICATION. Não existe tipo EVENT.

**Peer** — Instância individual da plataforma, independente do formato (Cloud, Web, Desktop, Mobile).

**Peer do Sistema** — Peer especial operado pelo fundador da rede, com função de bootstrap, signaling e snapshot.

**PERSONA** — Subtipo de PROFILE que serve como máscara pública operacional do humano.

**PROFILE** — Tipo de nó que representa atores ativos com identidade criptográfica.

**SPECIFICATION** — Tipo de nó imutável que carrega regras, schemas e procedimentos que governam o sistema. Possui natureza dual: schema declarativo e procedimento executável determinístico (interpretado por Zen Engine).

**Substantivo/Verbo (Princípio)** — Nós são substantivos (entidades), arestas são verbos (relações/ações).

**Tier-aware Degradation** — Capacidade do sistema de adaptar comportamento conforme capacidade do dispositivo, com transparência ao usuário.

**TinyBase** — Biblioteca usada como camada reativa entre o sistema e a UI. Observa projeções do SQLite e documentos Automerge via Automerge Repo; conduz escrita local; nunca é a fonte de verdade.

**ULID** — Universally Unique Lexicographically Sortable Identifier. Identificador de 128 bits usado em todo o sistema.

**UCAN** — User Controlled Authorization Network. Token de autorização delegável usado para provar direitos e solicitar chaves de época do cofre de chaves. Não carrega material de chaves em seu payload.

**Validador de Domínio** — Termo geral para autoridade com jurisdição sobre um domínio de negócio específico, implementado como uma SPECIFICATION procedural interpretada pelo motor de regras genérico (Zen Engine).

**Whitelabel** — Modalidade onde uma empresa opera sua própria instância da plataforma sob marca própria.

**Automerge** — Implementação de CRDT usada como motor de edição colaborativa. Cada documento é uma estrutura de dados com histórico imutável de Changes. `Automerge.save(doc)` produz snapshot binário integral e autossuficiente; `Automerge.getHistory(doc)` expõe a DAG completa de mudanças para auditoria e diff semântico.

**Automerge Repo** — Camada de orquestração sobre Automerge. Gerencia ciclo de vida de documentos, persistência local via OPFS, sincronização incremental de Changes entre peers, e Ephemeral Messages via WebRTC para coordenação de committers.

**Changes** — Operações elementares registradas pelo Automerge ao editar um documento. São as unidades atômicas de mudança capturadas pelo Sync Worker na RAM pré-commit e persistidas na tabela local `pending_changes`. Após o commit, as Changes são consolidadas no snapshot do nó-versão e removidas de `pending_changes`.

**Ephemeral Messages** — Canal de mensagens voláteis provido pelo Automerge Repo via WebRTC. Não são persistidas no grafo. Usadas para coordenação de curto prazo: eleição de committer, coleta de assinaturas em commit colaborativo, negociação de epoch key.

**PARTICIPATES_IN** — Substitui permanentemente `MEMBER_OF`. Aresta de pertencimento contínuo, no padrão `PARTICIPATES_IN:DOMÍNIO:SPECIFIER`. Expressão de fato social/estrutural; **não implica** `ASSET:PERMISSION` sobre o conteúdo do contexto. Ver Princípio 2.6.

**Verbos Raiz Canônicos** — Conjunto de verbos base para nomenclatura de arestas no padrão `VERBO:DOMÍNIO:SPECIFIER`: `RELATES` (relações sociais/estruturais), `OWNS` (posse de ativos), `GOVERNS` (governança e especificação), `INTERACTS` (interações com conteúdo), `PARTICIPATES_IN` (pertencimento contínuo a grupos/contextos). Ver Princípio 2.5.

**AGGREGATES** — Aresta estrutural permanente que liga um `ASSET:ROLE` a uma `ASSET:PERMISSION`, indicando composição de papel.

**REQUIRES** — Aresta estrutural permanente que liga uma `ASSET:PERMISSION` a outra, indicando dependência ou pré-requisito de acesso.

**RESULTED_FROM** — Aresta estrutural que liga um nó consequente (ex: nó de saldo de ativos) ao evento ou aresta causal que o originou (ex: aresta `TRANSFERRED_TO`), permitindo rastreabilidade causal em $O(1)$.

**RESOLVES** — Aresta de transição que fecha o ciclo de uma intenção materializada. Emitida pelo validador em direção ao `CONTENT:INTENT` correspondente, indicando que a intenção foi consumada como fato histórico.

**Virtual Foreign Key (VFK)** — Constraint de integridade referencial condicionada aplicada em $O(1)$ na camada de aplicação, usando o **11º caractere (index 10)** do ULID (`N` = nodes, `E` = edges) para determinar a tabela-alvo da aresta.

**PROFILE:SYSTEM** — Subtipo de PROFILE dotado de chaves Ed25519 que executa funções de infraestrutura, validação (Validadores de Domínio), auditoria ou comunicação interna do sistema via nós `CONTENT:MESSAGE` roteados por arestas `DIRECTED_TO`.

**CONTENT:INTENT** — Subtipo de CONTENT que materializa a intenção de uma ação que exige validação não-trivial.

**CONTENT:MESSAGE** — Subtipo de CONTENT usado para toda comunicação interna de infraestrutura (como `SYSTEM_QUERY` ou `SYSTEM_RESPONSE`) e notificações entre agentes do sistema, operando de modo offline-first.
