# Projeto Superapp — Constituição do Sistema (Plataforma V3.0)

Esta constituição estabelece os princípios de arquitetura, padrões de código, regras de design visual e diretivas de segurança não-negociáveis para o desenvolvimento da **Plataforma V3.0 (Local-First & P2P)**. Toda e qualquer alteração de código realizada neste repositório deve se conformar estritamente a estas diretrizes.

---

## 1. Princípios Arquiteturais e Ontologia de Dados

1.  **Pragmatismo Topológico**: O sistema é P2P-first, mas não P2P-purista. Use centralização onde ela oferece garantias superiores (como snapshots de bootstrap, rotação/distribuição de chaves via KMS, backup online) e P2P/local-first onde a autonomia e resiliência offline forem necessárias.
2.  **O Substantivo e o Verbo (Ontologia)**:
    *   **Nós são substantivos**: `PROFILE:PERSONA`, `CONTENT:POST`, `ASSET:CAPABILITY`, `ASSET:ROLE`.
    *   **Arestas são verbos**: `AUTHORED`, `MEMBER_OF`, `MUTATES`, `DELEGATED_TO`, `RESOLVES`, `APPROVED_BY`.
    *   **Não existem nós de eventos** (como `EVENT`). Ações consumadas são novas versões de nós ligadas por arestas `MUTATES`.
3.  **Imutabilidade do Passado (Append-Only)**: O sistema não realiza `UPDATE` físico em registros replicáveis. Mudanças criam novas versões (novos nós) ligadas por arestas `MUTATES` (Linhagem de Versões). Remoções de relacionamentos são feitas por arestas equivalentes com `weight = 0` (lápides / tombstones).
4.  **Ponte Reativa Disciplinada**:
    *   A UI lê exclusivamente de projeções em memória no **TinyBase**.
    *   A UI nunca realiza queries SQL diretamente na Main Thread.
    *   O **Sync Worker** em background gerencia a sincronização P2P, mescla CRDT no Y.js e persiste na via rápida do SQLite. Os Triggers nativos do SQLite reagem às escritas e atualizam as projeções que a TinyBase reflete na tela.

---

## 2. Padrões de Design Visual & Acessibilidade (Padrão A)

Todas as interfaces e componentes React devem seguir a barra de qualidade estética premium (Padrão A):

1.  **Paleta de Cores Curada**:
    *   Proibido o uso de cores genéricas básicas (`bg-red-500`, `text-blue-600`).
    *   Use cores harmoniosas baseadas em HSL Custom Properties (derivadas do tema dinâmico `:root`).
    *   Estilos devem suportar temas claros/escuros e respeitar as preferências de acessibilidade do usuário.
2.  **Tipografia Moderna**: Use fontes estilizadas como *Outfit*, *Inter* ou *Roboto* de forma consistente através de tokens de tipografia (Headers com tracking-tight, parágrafos fluidos).
3.  **Micro-animações e Interatividade**:
    *   Interações físicas e transições de hover devem usar transições suaves e efeitos de escala ativos (`active:scale-95`).
    *   Use bibliotecas como `framer-motion` (ou equivalentes Spring físicas) moderadamente e com fallback para redução de movimento (`prefers-reduced-motion`).
4.  **Acessibilidade Semântica**:
    *   Todo elemento interativo deve ter um ID legível e único no DOM.
    *   Cumpra o padrão WCAG AA (contraste mínimo de 4.5:1, navegação por teclado correta e tags ARIA apropriadas).
5.  **Evitar Placeholder**: Ao criar UIs demonstrativas, use imagens de alta fidelidade geradas por IA ou ícones consistentes (como `lucide-react`).

---

## 3. Segurança, Identidade e Criptografia

1.  **Identidade Autônoma**: As identidades de personas são derivadas localmente via seeds BIP39 e chaves Ed25519 geradas nativamente com Web Crypto API.
2.  **Cifragem AES-256-GCM por Épocas**:
    *   Payloads e dados sensíveis nas tabelas `nodes` e `edges` são armazenados como BLOBs encriptados.
    *   Chaves de época expiram após 4 horas de inatividade na RAM do `CryptoWorker` e nunca são escritas em disco.
    *   A descriptografia ocorre em regime *lazy* (Lazy Decryption) no momento de exibição pela UI.
3.  **Autorização via UCAN**: O controle de acesso baseia-se em subgrafos de capabilities (`ASSET:CAPABILITY`) delegadas de forma criptográfica através de tokens UCAN autocontidos e verificáveis offline.
4.  **Recuperação via Shamir (SSS)**: Mecanismos de recuperação de chave mestra devem fracionar o segredo em esquema 2-de-3 (Dispositivo, Cofragem do Provedor e Canal Alternativo).

---

## 4. O Framework MFA-S (Auditoria Semântica Colaborativa)

Para edições de alta frequência de documentos, o log do Y.js é efêmero e o log de negócios é persistente. Siga estritamente o fluxo e a estrutura do MFA-S:

1.  **Trilhas Separadas**:
    *   *Trilha CRDT*: Sincroniza deltas binários em tempo real (SQLite: `yjs_updates` e `snapshots`).
    *   *Trilha Semântica*: Guarda logs legíveis e inteligíveis de mudanças lógicas (SQLite: `audit_logs`).
2.  **Resiliência (Staging Area)**: Toda mudança bruta do Y.js capturada por `observeDeep` deve ser gravada imediatamente e atomicamente na tabela `pending_staging`. Na inicialização do app, qualquer resíduo na `pending_staging` deve ser recuperado (Crash Recovery) pelo `Semantic Mapper`.
3.  **Coalescência com Vector Clock**:
    *   As edições do mesmo autor no mesmo nó são agrupadas (timeout de 10s) para evitar poluição da auditoria.
    *   Se um update recebido contiver um **Vector Clock** indicando edição concorrente de outro peer na mesma propriedade, a coalescência é quebrada imediatamente, salvando as versões concorrentes de forma distinta para rastreamento preciso.
4.  **Undo Semântico**: Permite desfazer modificações em nível de propriedade com base nos campos `before` da tabela `audit_logs`, independentemente de os deltas binários originais terem sido expurgados da rolling window.

---

## 5. Diretivas para Desenvolvimento Assistido por IA (Instruções para Agentes)

1.  **Desenvolvimento Orientado a Especificações (SDD)**: O agente não deve programar de forma exploratória (*vibe coding*). Deve consultar e respeitar as SPECIFICATIONs de design descritas nos documentos `docs/0X-*.md` e consolidar as ações em planos de implementação aprovados pelo usuário.
2.  **Preservação de Código**: Mantenha comentários, documentações internas e testes existentes nos arquivos modificados, a menos que a sua alteração exija explicitamente sua substituição.
3.  **Local-First Compliance**: Nunca proponha chamadas de API de rede síncronas bloqueantes na Thread de UI. Toda operação pesada de dados deve ser executada de forma assíncrona delegada ao Web Worker (`sync-worker.ts`).
4.  **Consistência de Módulos**:
    *   Core e utilitários residem em `packages/core`.
    *   O cliente web reside em `apps/web`.
    *   O servidor de sinalização e cloud peer residem em `apps/cloud`.
