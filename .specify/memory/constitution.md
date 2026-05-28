# Projeto Superapp — Constituição do Sistema (Plataforma V3.1)

Esta constituição estabelece os princípios de arquitetura, padrões de código, regras de design visual e diretivas de segurança não-negociáveis para o desenvolvimento da **Plataforma V3.1 (Local-First & P2P)**. Toda e qualquer alteração de código realizada neste repositório deve se conformar estritamente a estas diretrizes.

---

## 1. Princípios Arquiteturais e Ontologia de Dados

1.  **Pragmatismo Topológico**: O sistema é P2P-first, mas não P2P-purista. Use centralização onde ela oferece garantias superiores (como snapshots de bootstrap, rotação/distribuição de chaves via KMS, backup online) e P2P/local-first onde a autonomia e resiliência offline forem necessárias.
2.  **O Substantivo e o Verbo (A Restrição dos 4 Tipos)**:
    * **Nós são substantivos**: `PROFILE:PERSONA`, `CONTENT:POST`, `ASSET:CAPABILITY`, `ASSET:ROLE`, `SPECIFICATION`.
    * **Arestas são verbos**: `AUTHORED`, `MEMBER_OF`, `MUTATES`, `DELEGATED_TO`, `RESOLVES`, `APPROVED_BY`.
    * **RESTRIÇÃO ONTOLÓGICA ESTRITA**: Existem apenas QUATRO tipos canônicos de nós (`PROFILE`, `CONTENT`, `ASSET`, `SPECIFICATION`). É terminantemente proibido criar tabelas de domínio paralelas ou inventar um quinto tipo conceitual (como `EVENT`, `LOG` ou `TRANSACTION`). Ações consumadas são novas versões de nós existentes ligadas por arestas `MUTATES`.
3.  **Imutabilidade do Passado (Append-Only)**: O sistema não realiza `UPDATE` ou `DELETE` físico em registros replicáveis nas tabelas `nodes` e `edges`. Mudanças criam novas versões (novos nós) com o mesmo `entity_id` e `id` incremental, ligadas por arestas `MUTATES` (Linhagem de Versões). Remoções de relacionamentos são feitas por arestas equivalentes com `weight = 0` (lápides / tombstones).
4.  **Ponte Reativa Disciplinada**:
    * A UI lê exclusivamente de projeções em memória no **TinyBase**. NUNCA realize queries SQL diretamente na Main Thread ou a partir de componentes de UI.
    * O **Sync Worker** em background (Web Worker) gerencia a sincronização P2P, mescla CRDT no Y.js e persiste na via rápida do SQLite. Os Triggers nativos do SQLite reagem às escritas e atualizam as projeções estruturais locais que a TinyBase reflete na tela.
5.  **Fluxo Operacional Obrigatório**: Toda mutação de estado no sistema deve passar estritamente pelo pipeline: *Intenção (`CONTENT:INTENT` ou em memória para single-user) → Validação (Validador de Domínio local/remoto aplicando a SPECIFICATION) → Ação (Cristalização em nova versão via `MUTATES`)*.

---

## 2. Padrões de Design Visual, Acessibilidade e Composição (Padrão A)

Todas as interfaces e componentes React devem seguir a barra de qualidade estética premium (Padrão A):

1.  **Paleta de Cores Orientada a Tokens**:
    * PROIBIDO o uso de cores genéricas utilitárias do Tailwind (`bg-red-500`, `text-blue-600` ou hexadecimais hardcoded) no código de UI.
    * Use exclusivamente cores harmoniosas baseadas em CSS Custom Properties semânticas (derivadas do tema dinâmico `:root`, como `bg-background`, `text-foreground`, `text-destructive`).
    * Estilos devem suportar temas claros/escuros nativamente e respeitar as preferências de acessibilidade do usuário.
2.  **Composição de Engines (Padrão A Puro)**:
    * Toda especialização de interface deve ser um componente nomeado próprio (wrapper) localizado no módulo de negócio correspondente, compondo internamente as *Engines* genéricas reusáveis de `packages/core/engines/`.
    * NUNCA espalhe lógica complexa de listagem, formulários ou estados pelas telas. Use wrappers especializados (ex: `ChatTimeline` ou `ExtractTimeline` encapsulando a engine base `Timeline`).
3.  **Spec-Driven UI**: Componentes polimórficos (`SuperCard`, `SmartForm`, `StateMachine`) não devem embutir lógica de negócio. Eles DEVEM ler a `SPECIFICATION` aplicável da entidade para determinar dinamicamente os campos, slots estruturais, ações e fluxos de estado.
4.  **Tipografia e Interatividade**:
    * Use fontes modernas estilizadas de forma consistente através de tokens de tipografia (Headers com `tracking-tight`, parágrafos fluidos).
    * Interações físicas e transições de hover devem usar efeitos de escala ativos (`active:scale-95`). Use `framer-motion` (ou equivalentes Spring físicas) moderadamente e com fallback para redução de movimento (`prefers-reduced-motion`).
5.  **Acessibilidade Semântica e Fidelidade**:
    * Todo elemento interativo deve ter um ID legível e único no DOM.
    * Cumpra o padrão WCAG AA (contraste mínimo de 4.5:1, navegação por teclado correta e tags ARIA apropriadas).
    * Evite placeholders genéricos. Use imagens de alta fidelidade ou ícones consistentes (`lucide-react`).

---

## 3. Segurança, Identidade e Criptografia

1.  **Identidade Autônoma**: As identidades de personas são derivadas localmente via chaves Ed25519 e seeds BIP39 geradas nativamente com a Web Crypto API.
2.  **Cifragem AES-256-GCM por Épocas**:
    * Payloads e dados sensíveis nas tabelas `nodes` e `edges` são armazenados como BLOBs encriptados.
    * Chaves de época expiram após 4 horas de inatividade na RAM do `CryptoWorker` e NUNCA são escritas em disco ou persistidas.
    * A descriptografia ocorre estritamente em regime *lazy* (Lazy Decryption) no momento de exibição pela UI.
3.  **Autorização via UCAN**: O controle de acesso baseia-se em subgrafos de capabilities (`ASSET:CAPABILITY`) delegadas de forma criptográfica através de tokens UCAN autocontidos e verificáveis offline.
4.  **Recuperação via Shamir (SSS)**: Mecanismos de recuperação de chave mestra devem fracionar o segredo em esquema 2-de-3 independente (Dispositivo local, Cofragem do Provedor da rede e Canal Alternativo externo).

---

## 4. O Framework MFA-S (Auditoria Semântica Colaborativa)

Para edições de alta frequência de documentos, o log do Y.js é efêmero e o log de negócios é permanente. Siga estritamente o fluxo e a estrutura do MFA-S:

1.  **Trilhas Separadas**:
    * *Trilha CRDT (Efêmera)*: Sincroniza deltas binários em tempo real no SQLite (`yjs_updates` e `snapshots`).
    * *Trilha Semântica (Persistente)*: Guarda logs legíveis e inteligíveis de mudanças lógicas no SQLite (`audit_logs`) contendo estados `before/after` e caminhos lógicos.
2.  **Resiliência (Staging Area)**: Toda mudança bruta do Y.js capturada por `observeDeep` deve ser gravada imediatamente e de forma atômica na tabela `pending_staging`. Na inicialização do app, qualquer resíduo na `pending_staging` deve ser obrigatoriamente recuperado (Crash Recovery) pelo `Semantic Mapper`.
3.  **Coalescência com Vector Clock**:
    * As edições do mesmo autor no mesmo nó são agrupadas temporalmente (timeout de 10s) para evitar poluição da auditoria.
    * Se um update recebido contiver um **Vector Clock** indicando edição concorrente de outro peer na mesma propriedade, a coalescência é quebrada IMEDIATAMENTE, salvando as versões concorrentes de forma distinta para rastreamento preciso.
4.  **Undo Semântico**: Permite desfazer modificações em nível de propriedade com base nos campos `before` da tabela `audit_logs`, mesmo que os deltas binários originais já tenham sido expurgados da rolling window de sincronização.

---

## 5. Diretivas para Desenvolvimento Assistido por IA (Instruções para Agentes)

1.  **Desenvolvimento Orientado a Especificações (SDD)**: Você (Agente de IA) está proibido de programar de forma exploratória ou baseada em suposições (*vibe coding*). Você deve consultar e respeitar as SPECIFICATIONs de design descritas na documentação técnica e consolidar as ações em planos de implementação aprovados pelo usuário antes de alterar código.
2.  **Identificadores Criptográficos**: Use obrigatoriamente identificadores **ULID** para chaves primárias e relacionamentos em todo o ecossistema. Não utilize UUID (v4 ou v7) ou IDs sequenciais inteiros.
3.  **Preservação de Código**: Mantenha comentários, documentações internas e testes existentes nos arquivos modificados, a menos que a alteração exija explicitamente sua substituição.
4.  **Local-First Compliance**: Nunca proponha chamadas de API de rede síncronas ou bloqueantes na Thread de UI. Toda operação pesada de processamento de dados, criptografia ou sync deve ser executada de forma assíncrona delegada aos respectivos Web Workers (`sync-worker.ts`, `crypto-worker.ts`, `index-worker.ts`).
5.  **Consistência de Módulos e Escopo**:
    * Core, design system, engines e utilitários residem estritamente em `packages/core`.
    * O cliente web local-first reside em `apps/web`.
    * O servidor de sinalização WebRTC e cloud peer residem em `apps/cloud`.
6.  **Backlog Geral de Pendências**: Antes de iniciar qualquer nova feature ou correção, consulte o status de implementação e as tarefas pendentes do projeto em [backlog-geral.md](file:///c:/Dev2026/Projeto%20Superapp/docs/backlog-geral.md) para manter a consistência com o planejamento das fases da plataforma.