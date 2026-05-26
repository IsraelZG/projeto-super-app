# Plataforma V3.0 — Documento 3: Modelo Operacional e Governança

**Versão:** 3.0 (Consolidada)
**Status:** Especificação de Referência
**Pré-requisitos:** Documento 1 (Fundamentos), Documento 2 (Camada de Dados)

---

## Sumário

1. [Visão Geral do Modelo Operacional](#1-visão-geral-do-modelo-operacional)
2. [O Ciclo Intenção → Validação → Ação](#2-o-ciclo-intenção--validação--ação)
3. [MFA-S: Framework de Auditoria Semântica](#3-mfa-s-framework-de-auditoria-semântica)
4. [Validador de Domínio](#4-validador-de-domínio)
5. [Specifications: Ciclo de Vida e Governança](#5-specifications-ciclo-de-vida-e-governança)
6. [Diretrizes de Minimalismo Ontológico](#6-diretrizes-de-minimalismo-ontológico)
7. [Recursos Finitos, Locks e Quóruns](#7-recursos-finitos-locks-e-quóruns)
8. [Capabilities, Roles e Modelo de Permissões](#8-capabilities-roles-e-modelo-de-permissões)
9. [Recuperação de Acesso](#9-recuperação-de-acesso)
10. [LGPD, GDPR e Compliance](#10-lgpd-gdpr-e-compliance)
11. [Governança da Rede](#11-governança-da-rede)
12. [Sucessão e Dissolução](#12-sucessão-e-dissolução)
13. [Audit Trail Universal](#13-audit-trail-universal)

---

## 1. Visão Geral do Modelo Operacional

A plataforma opera sob um modelo unificado: **toda mudança de estado segue o mesmo ciclo, em todo o sistema, em todas as modalidades**. Não há "API administrativa" separada, nem caminhos privilegiados que escapem auditoria.

O modelo é composto por:

- Um **ciclo canônico** (intenção → validação → ação) por onde todas as operações passam.
- Um **framework de auditoria** (MFA-S) que registra eventos imutavelmente.
- **Validadores de domínio** (definidos por SPECIFICATIONS) que aplicam regras.
- **SPECIFICATIONS** que governam todas as regras, evoluem versionadas e formam a "lei" do sistema.

Esta uniformidade é deliberada: simplifica o raciocínio sobre o sistema, garante auditoria universal, e elimina classes inteiras de bugs causados por caminhos paralelos.

### 1.1 Princípios Operacionais

- **Tudo é evento.** Estado não muda por mutação; estado é a projeção de eventos consolidados.
- **Toda ação é validada.** Mesmo ações triviais do próprio usuário passam por validação (frequentemente automática), porque a validação é o ponto de aplicação de SPECIFICATIONS.
- **Toda validação é auditável.** Sucesso ou falha gera registro no grafo.
- **A SPECIFICATION é a única fonte de regras.** Regras não vivem em código de UI, em scripts soltos, em configurações ad-hoc.

### 1.2 Domínios Comutativos vs. Não-Comutativos

A distinção mais importante para entender o modelo operacional:

**Domínios comutativos** (ordem das operações concorrentes não importa):
- Edição colaborativa de texto.
- Comentários em posts.
- Curtidas, reações, marcadores.
- Posts no feed social.

CRDT (Automerge) resolve naturalmente. Múltiplas intenções concorrentes são merged, todas se materializam.

**Domínios não-comutativos** (ordem importa, ou exclusividade é exigida):
- Transferências financeiras.
- Decremento de inventário.
- Transições de máquina de estado com pré-condições.
- Aprovações com quórum exato.
- Numeração sequencial fiscal.

CRDT não resolve. Exige árbitro autoritativo. Em P2P puro absoluto, algumas dessas operações simplesmente não estão disponíveis.

A **SPECIFICATION** de cada tipo de ação declara qual categoria a ação pertence e como deve ser tratada.

---

## 2. O Ciclo Intenção → Validação → Ação

Toda mudança de estado segue exatamente este ciclo.

### 2.1 Etapa 1: Intenção

A ação começa no dispositivo do peer, de forma isolada e provisória.

- O peer cria nós e arestas correspondentes à ação pretendida.
- A intenção é registrada localmente (no SQLite, via TinyBase).
- A intenção carrega referência à SPECIFICATION que a governa (aresta `GOVERNED_BY`).
- A intenção é assinada pela chave do peer.

Neste estágio, a intenção **não tem efeito no sistema global**. É um rascunho criptográfico não consolidado.

#### Exemplo Conceitual

Alice (PROFILE:PERSONA) quer criar uma Ordem de Compra (CONTENT) na rede da Empresa X.

```
Nó CONTENT criado: Ordem de Compra (estado: rascunho)
Aresta AUTHORED: Alice → Ordem de Compra
Aresta GOVERNED_BY: Ordem de Compra → SPECIFICATION:PURCHASE_ORDER
```

### 2.2 Etapa 2: Validação

O motor do banco de dados (local ou em peer validador remoto) intercepta a intenção e avalia a SPECIFICATION.

Validação consulta o grafo e aplica regras:

- O autor possui as capabilities exigidas? (ASSETs ligados ao perfil via `DELEGATED_TO`)
- Os campos do payload estão de acordo com o schema?
- As pré-condições da operação estão satisfeitas? (saldo suficiente, lock obtido, quórum atingido)
- A assinatura é válida?
- O estado anterior corresponde ao esperado? (relevante em máquinas de estado)

Se a validação **falha**, a intenção morre. Uma aresta `REJECTED` é registrada localmente, com motivo da rejeição. O peer recebe feedback de erro.

Se a validação **passa**, segue para Etapa 3.

#### Onde a Validação Acontece

Depende da SPECIFICATION:

- **Validação local automática**: SPECIFICATIONs simples e domínios comutativos (curtir, comentar, criar rascunho local). Validação roda no próprio dispositivo do autor; não exige rede.
- **Validação por peer autoritativo (single-validator)**: SPECIFICATIONs que exigem visão global (transferências financeiras, decremento de inventário). Validação roda em peer designado (super peer corporativo, peer dono do recurso, BaaS para fintech).
- **Validação por quórum (multi-sig)**: SPECIFICATIONs que exigem múltiplas aprovações (aprovação de pagamento corporativo > 10k, decisão de governança). Múltiplas validações compõem.
- **Validação por DPoS (caso especial)**: SPECIFICATIONs financeiras específicas que exigem validadores com stake; mecanismo invocável mas não default.

A SPECIFICATION declara qual mecanismo invocar.

### 2.3 Etapa 3: Ação

A intenção validada cristaliza em fato histórico na rede.

- Sistema consolida a ação criando uma **nova versão** do nó-alvo.
- Aresta `MUTATES` é traçada entre a nova versão e a versão anterior, alterando seu estado funcional.
- A aresta `MUTATES` (que já carrega o diff ou payload) serve como a ligação evolutiva, apontando para o `entity_id` e formando a Linhagem de Versões imutável.
- Aresta `APPROVED_BY` (opcional, conforme SPECIFICATION) é adicionada por validadores que atestaram o consenso.

Após a Etapa 3, o Automerge Repo sincroniza o sub-grafo (nova versão do CONTENT + arestas) pela rede. A Ordem de Compra passa a existir oficialmente para todos os membros que têm acesso de leitura.

### 2.4 Aprovações Single-User (Caso Trivial)

Para o usuário comum, a maioria das ações **parece instantânea**. O ciclo executa otimizado:

- A SPECIFICATION declara `validation: auto_self` (aprovação automática para o autor).
- A validação local roda em milissegundos na memória.
- **A intenção (`CONTENT:INTENT`) não é materializada no banco** para não inflar o grafo desnecessariamente.
- A nova versão (ação) é persistida e o ciclo encerra.

UI mostra resultado imediatamente. Auditoria existe, mas não é intrusiva.

### 2.5 Aprovações Coletivas e Quóruns

Para ações que exigem múltiplas aprovações:

- A intenção (`CONTENT:INTENT`) é materializada e propagada aos validadores designados.
- Cada validador emite uma aresta `APPROVED_BY` apontando para a intenção.
- Quando o número *N* exigido de aprovações é atingido, o **n-ésimo votante consolida** a ação, gerando a versão definitiva e fechando a intenção com uma aresta `RESOLVES`. 
- Há uma cláusula de `consolidation_timeout_ms` definida na SPECIFICATION. Se o n-ésimo votante ficar offline antes de consolidar e o timeout expirar, a autoridade de consolidação passa ao (n+1)-ésimo votante ou qualquer outro membro do quórum.
- Aprovações tardias são rejeitadas com `REJECTED`.

### 2.6 Commit Colaborativo em Documentos Compartilhados

Em documentos com múltiplos co-editores, as Changes acumuladas em `pending_changes` precisam ser consolidadas em um único nó-versão assinado. O responsável por assinar e emitir esse nó é o **Committer** — papel efêmero, distinto do proprietário institucional do documento.

A SPECIFICATION do documento declara o **modo de Committer** entre quatro opções canônicas:

1. **`first_proposer`** — O primeiro peer a detectar o gatilho de commit (heurística de inatividade ou limiar de operações acumuladas) assina e emite o nó-versão. Adequado para documentos com um editor principal habitual, onde disputas de concorrência são raras.
2. **`system_agent`** — Um `PROFILE:SYSTEM` designado na SPECIFICATION (ex: agente de automação local do criador do documento) é sempre o Committer. Elimina disputas de concorrência ao custo de depender da disponibilidade do agente.
3. **`deterministic`** — Um algoritmo determinístico (ex: menor `entity_id` lexicográfico entre os co-editores com edições ativas no ciclo corrente) seleciona o Committer sem necessidade de coordenação extra. Todos os peers chegam à mesma conclusão independentemente.
4. **`manual`** — O Committer é designado explicitamente por um peer com capability de governança (`GOVERNS`) sobre o documento. Adequado para documentos de alta governança onde a responsabilidade pelo commit deve ser auditável de forma explícita.

#### Coordenação de Assinaturas

Quando a SPECIFICATION exige co-assinatura de múltiplos peers antes da emissão do nó-versão (ex: modo de aprovação por quórum aplicado ao commit), a coleta de assinaturas ocorre via **Ephemeral Messages** do Automerge Repo na RAM — o candidato a Committer anuncia o snapshot proposto, os co-signatários respondem com suas assinaturas, e o Committer agrega todas antes de persistir o nó em `nodes`. Nenhuma mensagem de coordenação é gravada no grafo imutável.

#### Separação entre Committer e Proprietário

O **proprietário institucional** do documento (aresta estável `OWNS` de um `PROFILE` sobre o nó de conteúdo) é uma relação permanente e independente do Committer efêmero de cada ciclo. Trocar o Committer — por reconfiguração da SPECIFICATION ou por ausência do agente designado — não altera o ownership, não dispara transferência de capabilities, e não produz aresta no grafo além da atualização versionada da própria SPECIFICATION.

### 2.7 Convites e Aprovações de Acesso como CONTENT:INTENT

Convites para grupos, projetos, papéis corporativos e quaisquer fluxos de aprovação de acesso pendente **não são** materializados como `CONTENT:MESSAGE`. São instâncias do tipo universal `CONTENT:INTENT` com máquina de estados declarativa e atomicidade garantida no aceite.

#### Máquina de Estados do Convite

```
PENDING ──→ APPROVED
        ──→ REJECTED
        ──→ REVOKED
        ──→ EXPIRED
```

Cada transição é fechada com uma aresta `RESOLVES` apontando do nó que encerrou o fluxo de volta ao `CONTENT:INTENT` original, carregando `outcome` como atributo.

- **`APPROVED`**: o convidado aceita. A transição dispara **atomicamente**:
  1. Materialização de capabilities via UCAN condicional pré-assinado pelo admin na criação do convite.
  2. Criação de aresta de pertencimento estrutural (`PARTICIPATES_IN:DOMÍNIO:SPECIFIER`) ligando o perfil do convidado ao contexto alvo.
  3. Aresta `RESOLVES` com `outcome: "APPROVED"` encerrando o ciclo.
- **`REJECTED`**: o convidado recusa explicitamente. Aresta `RESOLVES` com `outcome: "REJECTED"`. Nenhuma capability é emitida.
- **`REVOKED`**: o emissor cancela antes do aceite. Aresta `RESOLVES` com `outcome: "REVOKED"`. Se o UCAN condicional já havia sido gerado, é revogado em cadeia.
- **`EXPIRED`**: o TTL configurado na SPECIFICATION do contexto alvo expira sem resposta. O Garbage Collector fecha o ciclo com aresta `RESOLVES` e `outcome: "EXPIRED"` automaticamente.

#### UCAN Condicional e Atomicidade Offline

O UCAN condicional é pré-assinado pelo administrador do contexto no momento da criação do convite — não no momento do aceite. Essa antecipação garante que o aceite seja **atômico e offline-capable**: o convidado não precisa de round-trip ao admin para completar a transição `APPROVED`. O UCAN carrega a condição `accepted_by: <entity_id do convidado>` e só se torna operacional após a aresta `RESOLVES` correspondente ser inserida no grafo local do convidado.

#### Separação de Semânticas

`CONTENT:MESSAGE` permanece reservado para comunicação entre peers (chat, notificações, queries de sistema). Qualquer fluxo com estado pendente, prazo de validade, e efeito colateral estruturado sobre o grafo (capabilities, arestas de pertencimento) deve ser modelado como `CONTENT:INTENT`, independente de ser coloquialmente chamado de "convite", "pedido de aprovação", ou "solicitação de acesso".

### 2.8 Aprovações Concorrentes em Recursos Finitos

Quando múltiplos peers tentam consumir o mesmo recurso finito ao mesmo tempo:

- Todas as intenções são criadas localmente em cada peer.
- Validador autoritativo (dono do recurso) recebe todas.
- Aplica regra (FIFO, prioridade, sorteio — definido pela SPECIFICATION).
- Vencedora vira ação. Demais recebem REJECTED com motivo "recurso esgotado".

### 2.9 Falhas de Validação Online

Em P2P puro com validador offline:

- Intenção fica em estado pendente local (tabela auxiliar `pending_intents` no SQLite).
- Quando peer ou validador volta online, intenção é submetida.
- Se ainda válida, vira ação. Se não (recurso esgotado, capability revogada), recebe REJECTED.

UX: usuário vê estado "aguardando confirmação" claramente, com explicação de que ação depende de validador online.

### 2.10 Coreografia Detalhada: Transferência Financeira (Alice → Bob)

Esta subseção detalha o ciclo completo de uma transferência financeira como exemplo canônico do domínio não-comutativo, integrando todos os elementos arquiteturais: nó `CONTENT:INTENT` assinado pelo usuário, validação pelo agente `PROFILE:SYSTEM`, emissão atômica da aresta factual `TRANSFERRED_TO`, fechamento do ciclo via `RESOLVES`, geração de nós `ASSET:BALANCE_STATE` com encadeamento linear por hash via `MUTATES` (com `previous_hash`), e rastreamento causal via `RESULTED_FROM`.

#### Pré-condições

- Alice possui um nó `ASSET:BALANCE_STATE` vigente ($V_{n-1}$) com saldo suficiente; sua cabeça está registrada em `entity_heads`.
- Bob possui seu próprio nó `ASSET:BALANCE_STATE` vigente ($V_{m-1}$); sua cabeça está em `entity_heads`.
- Existe um Validador de Domínio financeiro (`PROFILE:SYSTEM:FINANCIAL_VALIDATOR`) com capability declarada pela `SPECIFICATION:TRANSFER`.

#### Passo 1 — Criação e Assinatura do Nó CONTENT:INTENT

Alice cria e assina localmente o nó de intenção. **Nenhum saldo é alterado neste momento.**

```
Nó CONTENT:INTENT criado (assinado por Alice):
  id: "01J2X3Y4Z5N..."  (11º char = 'N' — é um nó)
  type: "CONTENT:INTENT"
  payload (criptografado):
    action:               "TRANSFER"
    amount:               100.00
    currency:             "BRL"
    from_entity_id:       <entity_id do ASSET:BALANCE_STATE de Alice>
    to_entity_id:         <entity_id do ASSET:BALANCE_STATE de Bob>
    from_balance_head_id: <id de V_{n-1} de Alice>  ← ancora em versão específica
  signature: <Ed25519 de Alice>

Aresta AUTHORED:    Alice.PROFILE → CONTENT:INTENT
Aresta GOVERNED_BY: CONTENT:INTENT → SPECIFICATION:TRANSFER
```

O nó `CONTENT:INTENT` é persistido localmente e propagado ao Validador via Automerge Repo/WebRTC como `CONTENT:MESSAGE` de `SYSTEM_QUERY` dirigido ao validador (aresta `DIRECTED_TO`).

#### Passo 2 — Validação pelo Agente PROFILE:SYSTEM

O `PROFILE:SYSTEM:FINANCIAL_VALIDATOR` recebe o `CONTENT:INTENT` e executa:

1. Decripta e valida o payload contra `SPECIFICATION:TRANSFER`.
2. Consulta `entity_heads` pelo `from_entity_id` de Alice → obtém o nó $V_{n-1}$ em O(1).
3. Verifica que o saldo em $V_{n-1}$ é ≥ 100,00 BRL.
4. Verifica que o `from_balance_head_id` declarado na intenção coincide com o `entity_heads` atual (proteção contra intenções obsoletas concorrentes).
5. Verifica que Alice tem capability de transferência ativa (UCAN válido, dentro do TTL).
6. Verifica ausência de `ASSET:LOCK` ativo sobre o recurso de Alice.

Se qualquer verificação falha: o Validador emite aresta `REJECTED` apontando para o `CONTENT:INTENT` com payload de motivo; ciclo encerrado.

Se todas passam: o Validador executa **atomicamente** os Passos 3 e 4.

#### Passo 3 — Emissão Atômica da Aresta Factual e do RESOLVES

O Validador emite e assina a aresta factual de transferência:

```
Aresta TRANSFERRED_TO criada (assinada pelo FINANCIAL_VALIDATOR):
  id: "01J2X3Y4Z5E..."  (11º char = 'E' — é uma aresta)
  source_id: <id de V_{n-1} de Alice>
  target_id: <entity_id do ASSET:BALANCE_STATE de Bob>  (char 'N')
  type: "TRANSFERRED_TO"
  payload (criptografado):
    amount:       100.00
    currency:     "BRL"
    intent_id:    <id do CONTENT:INTENT de Alice>
    validated_at: <unix_ms>
  weight: 100.0
  signature: <Ed25519 do FINANCIAL_VALIDATOR>
```

Imediatamente após, o Validador fecha o ciclo da intenção:

```
Aresta RESOLVES criada (assinada pelo FINANCIAL_VALIDATOR):
  source_id: <entity_id de PROFILE:SYSTEM:FINANCIAL_VALIDATOR>
  target_id: <id do CONTENT:INTENT de Alice>   ← aponta para versão específica da intenção
  type: "RESOLVES"
  payload: { outcome: "APPROVED", transferred_edge_id: <id da aresta TRANSFERRED_TO> }
  signature: <Ed25519 do FINANCIAL_VALIDATOR>
```

A aresta `RESOLVES` encerra o ciclo do `CONTENT:INTENT`: qualquer peer que observe esse nó de intenção pode verificar que ele foi consumado, por quem, e quando — sem ambiguidade.

#### Passo 4 — Geração de Nós ASSET:BALANCE_STATE com Encadeamento por Hash

O Validador gera dois novos nós de estado de saldo, encadeados linearmente com suas versões anteriores via `previous_hash`. O campo `previous_hash` no payload de cada aresta `MUTATES` contém o hash do `id` do nó predecessor, criando uma corrente verificável que detecta qualquer adulteração histórica.

**Alice — novo nó de saldo $V_n$ (débito):**

```
Nó ASSET:BALANCE_STATE criado:
  id: "01J2X3Y4Z5N..."  (11º char = 'N')
  entity_id: <mesmo entity_id de V_{n-1} de Alice>  ← mesma linhagem
  type: "ASSET:BALANCE_STATE"
  payload (criptografado):
    balance:       <saldo_anterior_alice - 100.00>
    currency:      "BRL"
    previous_hash: hash(id de V_{n-1})

Aresta MUTATES (encadeamento linear):
  source_id: <id de V_{n-1}>   ← versão anterior
  target_id: <id de V_n>       ← nova versão
  type: "MUTATES"
  payload: { previous_hash: hash(id de V_{n-1}), delta: "-100.00 BRL" }

Aresta RESULTED_FROM (atalho causal):
  source_id: <id de V_n de Alice>
  target_id: <id da aresta TRANSFERRED_TO>  (11º char = 'E' — aponta para aresta)
  type: "RESULTED_FROM"
```

**Bob — novo nó de saldo $V_m$ (crédito):**

```
Nó ASSET:BALANCE_STATE criado:
  id: "01J2X3Y4Z5N..."  (11º char = 'N')
  entity_id: <mesmo entity_id de V_{m-1} de Bob>   ← mesma linhagem
  type: "ASSET:BALANCE_STATE"
  payload (criptografado):
    balance:       <saldo_anterior_bob + 100.00>
    currency:      "BRL"
    previous_hash: hash(id de V_{m-1})

Aresta MUTATES (encadeamento linear):
  source_id: <id de V_{m-1}>  ← versão anterior
  target_id: <id de V_m>      ← nova versão
  type: "MUTATES"
  payload: { previous_hash: hash(id de V_{m-1}), delta: "+100.00 BRL" }

Aresta RESULTED_FROM (atalho causal):
  source_id: <id de V_m de Bob>
  target_id: <id da aresta TRANSFERRED_TO>  (11º char = 'E')
  type: "RESULTED_FROM"
```

#### Passo 5 — Atualização de entity_heads e Propagação

Triggers SQLite detectam os novos nós $V_n$ e $V_m$ e atualizam imediatamente `entity_heads`:

```
entity_heads[entity_id_alice_balance] = id de V_n
entity_heads[entity_id_bob_balance]   = id de V_m
```

O TinyBase observa `entity_heads` e re-renderiza o saldo de Alice e Bob na UI em O(1), sem recalcular a Linhagem de Versões. O Sync Worker propaga o sub-grafo resultante (novas arestas + novos nós de saldo) via Automerge Repo para os peers autorizados.

#### Garantias do Protocolo

**Encadeamento linear por hash:** o `previous_hash` na aresta `MUTATES` cria uma corrente verificável. Qualquer inserção, remoção ou modificação de nó intermediário na linhagem de saldo de Alice quebra a corrente de hashes. A verificação é local e não requer rede.

**Atalho causal via RESULTED_FROM:** a partir de qualquer nó `ASSET:BALANCE_STATE`, é possível chegar imediatamente — via a aresta `RESULTED_FROM` com `target_id` de tipo `'E'` — à aresta `TRANSFERRED_TO` que o originou. A UI do extrato financeiro usa este atalho para exibir o vínculo "ver transação" sem varrer a Linhagem de Versões.

**Idempotência garantida pelo ancoragem em `from_balance_head_id`:** o Validador rejeita qualquer `CONTENT:INTENT` cujo `from_balance_head_id` não corresponda ao `entity_heads` atual de Alice no momento da validação. Se Alice submeter duas intenções concorrentes sobre o mesmo estado $V_{n-1}$, apenas a primeira a chegar ao Validador será aceita; a segunda será `REJECTED` por head divergente.

---

## 3. MFA-S: Framework de Auditoria Semântica

### 3.1 Princípio: Auditoria Emergente da DAG

A infraestrutura de logs de auditoria como entidade física separada é eliminada. Não existem tabelas físicas `audit_logs` nem nós `CONTENT:AUDIT_LOG` emitidos por agentes de auditoria em paralelo ao fluxo principal.

A auditoria detalhada **emerge naturalmente** da combinação de duas fontes já inerentes ao modelo de dados:

1. A **DAG nativa do Automerge** (`Automerge.getHistory(doc)`) — que preserva cada Change com autor, timestamp e conteúdo exato da mutação, de forma imutável e criptograficamente encadeada dentro do documento.
2. As **arestas `AUTHORED`** no grafo — que ligam cada nó-versão ao peer que consolidou o commit correspondente, carregando prova criptográfica de autoria.

Essa convergência elimina a duplicação arquitetural e a necessidade de manter duas trilhas sincronizadas. O grafo *é* o audit trail.

### 3.2 Payload da Aresta AUTHORED

A aresta `AUTHORED` carrega um payload mínimo e verificável:

- **`change_hashes`**: lista dos hashes das Changes do Automerge incluídas neste commit e atribuídas a este autor (referência direta ao histórico `Automerge.getHistory(doc)`).
- **`author_signature`**: assinatura Ed25519 do autor sobre o conjunto `H(change_hashes || nó-versão-id)` — prova de autoria sobre as mudanças exatas desta versão.
- **`summary`**: sumário textual curto (ex: *"editou parágrafos 2–4, adicionou seção 3"*), gerado pelo Semantic Mapper no momento do commit. Serve como entrada de histórico legível sem exigir recálculo posterior.

A aresta **não armazena** mapeamentos de antes/depois (`before`/`after`). Esses mapeamentos são calculados **sob demanda** pelo Semantic Mapper quando um usuário explicitamente navega pelo histórico ou solicita um diff semântico.

### 3.3 Semantic Mapper (Lazy Diff)

O Semantic Mapper é um componente acionado sob demanda que calcula diffs estruturados entre duas versões de um documento colaborativo.

**Entradas:** dois identificadores do tipo `(entity_id, versão)`.

**Algoritmo:**
1. Carrega os documentos Automerge das duas versões via `Automerge.load(payload)` a partir dos nós na tabela `nodes`.
2. Calcula o diff estruturado: campos alterados, valores antes/depois, paths JSON, operações de inserção/remoção em listas.
3. Retorna JSON legível para renderização no engine `AuditTrail` da UI.

**Reidratação arqueológica:** Se a versão mais antiga tiver payload podado (`retention_state = 'pruned'`), o Semantic Mapper aciona o Graph-Based Routing para recuperar o snapshot Automerge do nó em peers compatíveis antes de calcular o diff. A UI exibe estado de carregamento durante o round-trip.

**Geração de summary no commit:** O mesmo Semantic Mapper é invocado pelo Committer durante o ciclo de commit para gerar o campo `summary` da aresta `AUTHORED`, calculando o diff entre a versão anterior e o novo snapshot.

### 3.4 Mecânica de Undo Entre Sessões

A sequência imutável de nós-versão encadeados via `MUTATES` garante nativamente o Undo de longo prazo entre sessões.

**Undo por Reconstrução Direta:** O sistema carrega o snapshot Automerge da versão alvo via `Automerge.load(payload)`, extrai o estado plano do documento naquele ponto temporal e emite um novo nó-versão com esse estado para a frente na linha do tempo — revertendo o documento sem adulterar o histórico imutável passado.

**Undo quando payload podado:** Se o dispositivo local aplicou a política de GC e o payload do nó-versão foi podado (`retention_state = 'pruned'`), o Automerge Repo aciona Graph-Based Routing em background para recuperar o snapshot de peers compatíveis. Durante o round-trip, a UI exibe estado de reconstrução. Se a rede estiver indisponível, o Undo não pode ser completado e a UI informa o usuário com opção de tentar novamente quando online.

### 3.5 Garantias de Auditoria

- **Integridade histórica:** Hash chaining via `MUTATES.previous_hash` detecta adulteração retroativa de qualquer nó na cadeia de versões.
- **Prova de autoria:** Assinaturas Ed25519 em nós-versão e no payload `author_signature` da aresta `AUTHORED` provam criptograficamente quem criou cada commit.
- **Rastreabilidade granular:** `Automerge.getHistory(doc)` fornece rastreabilidade Change-a-Change para edições colaborativas, correlacionável com as arestas `AUTHORED` por hash de Change.
- **Apresentabilidade jurídica:** Os hashes das Changes assinados pelo autor constituem prova criptográfica de autoria apresentável em contextos de auditoria regulatória. A trilha é imutável, pública dentro do escopo de capability, e não requer custódia central.

---

## 4. Validador de Domínio

### 4.1 Conceito

**Validador de Domínio** é o termo arquitetural para a autoridade que avalia intenções e decide se viram ações, conforme jurisdição definida pela SPECIFICATION.

Não é uma entidade fixa: é um papel preenchido por diferentes mecanismos conforme o domínio.

### 4.2 Mecanismos Invocáveis

A SPECIFICATION declara qual mecanismo o Validador de Domínio usa para aquela classe de ação:

#### 4.2.1 Validação Local Automática

- O próprio motor do dispositivo valida.
- Adequado para domínios comutativos e ações triviais.
- Sem latência de rede.
- Exemplos: criar rascunho local, curtir post, comentar.

#### 4.2.2 Single-Validator (Peer Autoritativo)

- Um peer designado é a autoridade.
- Adequado para recursos com dono claro (estoque do vendedor X, conta corrente do usuário Y).
- O dono do recurso (ou super peer da empresa em modo corporativo) é o validador.
- Em P2P puro, dono precisa estar online; senão intenção fica pendente.
- Exemplos: vender produto, transferir saldo, mover card de Kanban no projeto.

#### 4.2.3 Multi-Sig (Quórum)

- N assinaturas exigidas para consolidar.
- Adequado para decisões coletivas, aprovações corporativas.
- SPECIFICATION declara N e quem são os signatários elegíveis.
- Quando N assinaturas são coletadas, ação é consolidada.
- Exemplos: aprovação de pagamento corporativo, mudança de SPECIFICATION da rede, decisão de governança.

#### 4.2.4 DPoS (Delegated Proof of Stake)

- Conjunto de validadores com stake financeiro valida.
- Adequado para subdomínios financeiros que exigem validadores com pele em jogo.
- Mecanismo opcional, invocável por SPECIFICATIONs específicas.
- **Não é o mecanismo padrão da plataforma** — é uma das implementações possíveis de Validador de Domínio.

#### 4.2.5 BaaS (Banking-as-a-Service)

- Para fintech regulada, validação acontece em integração com PSP (Payment Service Provider) autorizado.
- A plataforma fornece a UI/UX/metadados; o backend regulado é provido pelo dono da rede via parceria com BaaS ou licença bancária própria.
- Sem isso, módulo Fintech tem funcionalidades limitadas (checkout via adquirente terceira, gestão de cashback, cartões virtuais via parceiro) — sem Pix real, sem transferência regulada.

### 4.3 Combinação de Mecanismos

Uma SPECIFICATION pode combinar mecanismos:

- *Exemplo*: Pagamento corporativo > R$ 10k exige multi-sig de 2 gerentes E single-validator do super peer financeiro da empresa.

A SPECIFICATION declara o pipeline de validação.

### 4.4 Falha do Validador

Se o validador designado está offline ou indisponível:

- Intenção fica pendente.
- UI mostra estado adequado ("aguardando aprovação", "aguardando validação financeira").
- Quando validador volta, processa fila de pendências.

Em modo corporativo, super peer always-on garante que validador esteja disponível. Em P2P puro, depende dos peers.

### 4.5 Honestidade de Operações Sem Validador Disponível

Algumas operações **simplesmente não funcionam offline**:

- NF-e sequencial (requisito legal de não ter buracos na numeração).
- Pix real (depende de PSP regulado).
- Aprovações corporativas que exigem validador online.

Para essas, em offline a intenção fica pendente e UI explica claramente: "Esta operação requer conexão com [serviço]. Será processada quando reconectar."

P2P puro tem essas operações ausentes ou degradadas. Honestidade radical (Princípio 2.4).

---

## 5. Specifications: Ciclo de Vida e Governança

SPECIFICATIONS são a "lei" do sistema. Esta seção detalha como elas nascem, evoluem e morrem.

### 5.1 Os Três Níveis (Recap)

- **Specifications canônicas**: mantidas pela plataforma. Governam tipos universais de interoperabilidade (PROFILE:CORE, CONTENT:MESSAGE, ASSET:CAPABILITY).
- **Specifications de rede**: definidas pelo dono da rede. Estendem ou complementam canônicas para o contexto da rede.
- **Specifications de usuário**: criadas por usuários para seus dados privados em redes que permitem.

### 5.2 Imutabilidade e Versionamento

SPECIFICATIONS **nunca são alteradas via UPDATE**. Evolução é sempre criação de novo nó, ligado ao anterior por aresta semântica.

Versionamento segue **SemVer** (Semantic Versioning):

- **Patch (1.0.0 → 1.0.1)**: correções que não afetam comportamento observável.
- **Minor (1.0.1 → 1.1.0)**: adições retrocompatíveis (campos opcionais novos, validações mais permissivas).
- **Major (1.1.0 → 2.0.0)**: breaking changes (campos removidos, validações mais restritivas, semântica alterada).

### 5.3 Evolução Minor/Patch

Para mudanças retrocompatíveis:

1. Sistema cria novo nó SPECIFICATION v1.1.0 (ou v1.0.1).
2. Aresta `SUPERSEDED_BY` liga v1.0.0 → v1.1.0.
3. Worker do Validador de Domínio cria arestas `MIGRATED_TO` em massa, movendo nós CONTENT existentes para a nova versão.
4. Migração é evento auditável (cada nó migrado tem seu evento `uma aresta `MIGRATED_TO``).

Dados antigos passam a ser governados pela nova versão sem necessidade de transformação de payload (porque mudança é compatível).

### 5.4 Evolução Major

Para breaking changes:

1. Sistema cria novo nó SPECIFICATION v2.0.0.
2. Aresta `SUPERSEDED_BY` liga v1.x → v2.0.0.
3. **Dados antigos permanecem governados pela v1.x** — preservando histórico, assinaturas e validade legal.
4. Novos dados criados após v2.0.0 são governados pela v2.0.0.
5. Migração de dados antigos para v2.0.0 é **opcional e explícita**: se desejável, um processo de conversão é executado, gerando eventos `uma aresta `MIGRATED_TO` com o payload de transformação` com transformação registrada.

Coexistência v1.x e v2.0.0 é permitida indefinidamente.

### 5.5 Depreciação

SPECIFICATIONS não são "deletadas" (imutabilidade do passado). São depreciadas:

- Nó SPECIFICATION recebe atributo de depreciação no payload da própria spec ou via aresta `DEPRECATED_AT`.
- Sistema bloqueia criação de novos dados sob spec depreciada.
- Dados existentes continuam governados normalmente.
- UI alerta usuários que estão tentando usar spec depreciada.

### 5.6 Extensão de Specifications

Specifications de rede podem **estender** canônicas:

```
SPECIFICATION:CORE_PRODUCT (canônica)
  └─ EXTENDS ←  SPECIFICATION:NETWORK_X_PRODUCT (de rede)
                  - Adiciona campo: warranty_period
                  - Adiciona validação: minimum_price > 0
```

Aresta `EXTENDS` indica relação. Spec de rede herda contrato base e adiciona refinamentos.

Quando canônica evolui:

- Mudança minor/patch na canônica: spec de rede continua válida (compatibilidade).
- Mudança major na canônica: spec de rede pode precisar adaptar; processo é deliberado pelo dono.

### 5.7 Governança das Canônicas (Plataforma)

Specifications canônicas são mantidas pela plataforma. Inicialmente, processo é **proprietário** (decisão centralizada da equipe que mantém a plataforma).

Transição planejada para modelo **RFC público** quando a plataforma atingir maturidade e abrir comunidade:

- Propostas via repositório público.
- Discussão aberta por período definido.
- Aprovação por board de mantenedores.
- Versionamento e changelog público.

Esta transição não é compromisso da V3.0; é roadmap.

### 5.8 Governança das Specifications de Rede

Em rede corporativa whitelabel, dono da rede modifica specifications livremente, mas:

- Toda mudança gera evento auditável.
- Mudanças que afetam funcionários/usuários ativos podem exigir notificação prévia (definido por SPECIFICATION:NETWORK_GOVERNANCE).
- Mudanças em specs sensíveis (autenticação, permissões críticas) podem exigir multi-sig.

Em rede pública, specs de rede são governadas pelo fundador/board, com regras que podem incluir consulta à comunidade conforme cultura da rede.

### 5.9 Governança das Specifications de Usuário

Usuários criam specs próprias para seus dados:

- Em P2P puro: livremente.
- Em rede pública: livremente para dados privados; specs que afetam interoperabilidade (ex: criar tipo novo de conteúdo público) podem exigir aprovação curatorial.
- Em rede corporativa: tipicamente bloqueado ou muito restrito.

---

## 6. Diretrizes de Minimalismo Ontológico

A ontologia de quatro tipos só funciona se houver disciplina. Esta seção detalha as diretrizes (Documento 1, seção 6.6) operacionalmente.

### 6.1 Quando Criar Subtipo de Nó

Critérios cumulativos (todos devem ser verdadeiros):

**1. Diferencia comportamento sistêmico, não apenas semântica humana.**

❌ Errado: criar `CONTENT:POST_BLOG` e `CONTENT:POST_NEWS` quando ambos são posts genéricos com layout diferente.

✅ Certo: criar `CONTENT:CHAT_MESSAGE` separado de `CONTENT:POST` se eles têm modelos de retenção, indexação e replicação distintos.

**2. Não pode ser expresso por payload + SPECIFICATION.**

❌ Errado: criar `CONTENT:URGENT_TASK` para diferenciar de `CONTENT:NORMAL_TASK`. Use payload `{ priority: "urgent" }` e SPECIFICATION que aplica regras conforme prioridade.

✅ Certo: criar `CONTENT:LIVE_STREAM` como subtipo distinto de `CONTENT:VIDEO_FILE` se eles têm comportamentos sistêmicos fundamentalmente diferentes (streaming vs. arquivo finito).

**3. Tem ao menos uma aresta ou validação sistêmica que só faz sentido para ele.**

❌ Errado: criar subtipo só para "ficar mais organizado" sem comportamento associado.

✅ Certo: criar subtipo se ele tem aresta canônica única (ex: `LIVE_STREAM` tem `BROADCASTING_TO` que outros tipos não usam).

**4. É reusável por múltiplos domínios ou fundamental a um único domínio crítico.**

❌ Errado: criar `CONTENT:RECEIPT_FROM_VENDOR_X` por causa de um caso específico.

✅ Certo: criar `CONTENT:RECEIPT` se forem reusados em fintech, marketplace, fiscal, etc.

### 6.2 Quando Criar Aresta Nova

Antes de criar aresta nova, perguntar:

**1. Existe aresta canônica que expressa essa relação semântica?**

Se sim, use-a com payload diferenciador.

❌ Errado: criar `COMMENT_ON_POST`, `REPLY_TO_MESSAGE`, `RESPONSE_TO_QUESTION` separadamente.

✅ Certo: usar `REPLIES_TO` para todas, com contexto via tipo dos nós conectados.

**2. A nova aresta é estruturalmente diferente?**

Cardinalidade, direcionalidade, semântica de lifecycle, validação. Se idêntica em estrutura a uma existente, não é nova.

**3. A nova aresta participa de pelo menos uma validação automática?**

Se não, talvez seja só metadado de payload.

### 6.3 Hierarquia de Adição

| Tipo de Adição | Quem Pode | Processo |
|----------------|-----------|----------|
| Novo subtipo canônico | Apenas plataforma | Versionamento, migração, comunicação ampla |
| Nova aresta canônica | Apenas plataforma | Idem |
| Subtipo de rede | Dono da rede | Auditável, comunicado aos usuários |
| Aresta de rede | Dono da rede | Idem |
| Subtipo de usuário | Usuário (em redes que permitem) | Local; sem impacto em interoperabilidade |
| Aresta de usuário | Geralmente bloqueado | Pode permitir em P2P puro |

### 6.4 Princípio de Descoberta-by-Grafo

Comportamentos do sistema **devem se basear em propriedades do grafo**, não em comparação direta de tipos.

❌ Errado:
```typescript
if (node.type === 'CONTENT:POST_BLOG' || node.type === 'CONTENT:POST_NEWS') {
  showInFeed(node);
}
```

✅ Certo:
```typescript
const showsInFeed = await graphHasEdge(node, 'GOVERNED_BY', 'SPECIFICATION:FEED_PUBLISHABLE');
if (showsInFeed) {
  showInFeed(node);
}
```

Isso permite que novos subtipos sejam adicionados sem mudar código consumidor — basta governá-los pela SPECIFICATION apropriada.

### 6.5 Catálogo Canônico

A plataforma mantém catálogo público de subtipos canônicos disponíveis, com:

- Documentação de cada subtipo.
- Schema de payload esperado.
- Arestas canônicas que se aplicam.
- SPECIFICATIONs canônicas associadas.
- Histórico de versões.

Acessível via documentação técnica e via query no próprio sistema (specifications são nós como qualquer outro).

### 6.6 Anti-padrões a Evitar

- **Subtipos por status**: `CONTENT:DRAFT_POST`, `CONTENT:PUBLISHED_POST`. Status é estado, não tipo. Use payload `{ status: "draft" }`.
- **Subtipos por contexto temporário**: `CONTENT:HOLIDAY_PROMO_POST`. Contextual. Use payload + tag.
- **Arestas por intenção do criador**: `URGENTLY_ASKED_FOR`, `CASUALLY_MENTIONED`. Intenção vai em payload.
- **Proliferação por departamento**: `CONTENT:HR_DOCUMENT`, `CONTENT:FINANCE_DOCUMENT`. Departamento vai em metadado/aresta de pertencimento, não em tipo.

---

## 7. Recursos Finitos, Locks e Quóruns

A ontologia trata recursos finitos como ASSETs com saldo. Esta seção detalha como.

### 7.1 Inventário, Slots, Vagas e Bilhetes

Todos seguem o mesmo padrão:

- Recurso é um nó `ASSET` com `weight` (quantidade disponível) em texto plano.
- Aquisição é aresta `TRANSFERRED_TO`: `weight` X é transferido do ASSET-pool para o ASSET-carrinho do comprador.
- SPECIFICATION valida saldo antes de permitir transferência (não pode ir negativo).
- Validador de Domínio é o `PROFILE` dono do recurso (ou super peer delegado).

#### Exemplo

Vendedor cria produto com 100 unidades:

```
Nó ASSET:INVENTORY criado, weight=100
Aresta OWNS: Vendedor → ASSET:INVENTORY
```

Cliente compra 1 unidade:

```
Intenção: TRANSFERRED_TO weight=1, ASSET:INVENTORY → ASSET:CART_DO_CLIENTE
Validação: validador (vendedor ou super peer) verifica weight>=1
Ação: weight do ASSET:INVENTORY decrementa para 99
```

Concorrência: validador serializa intenções. Última intenção quando weight=0 vira REJECTED.

### 7.2 Locks Distribuídos

Para casos onde aquisição precisa de tempo (checkout em marketplace pode levar minutos):

- `ASSET:LOCK` é nó temporário com TTL.
- Adquirir lock é aresta `GRANTED_TO` do lock para o adquirente.
- Lock impede outras aquisições do recurso enquanto válido.
- Se transação completa antes do TTL: lock é convertido em `TRANSFERRED_TO` real.
- Se TTL expira sem completar: lock é revogado, recurso volta ao pool.

### 7.3 Numeração Sequencial Estrita (NF-e e Similares)

Caso especial: numeração que não pode ter buracos por requisito legal.

- Não funciona offline (Princípio 2.4: honestidade).
- Validador de Domínio é o serviço fiscal (parte da infraestrutura do dono da rede).
- Em offline, peer apenas gera intenção; serialização da numeração só acontece quando reconectado.
- Em P2P puro: simplesmente não disponível.

### 7.4 Quóruns de Aprovação

Para decisões coletivas:

- SPECIFICATION declara: signatários elegíveis, número exigido (N), regras de tiebreak.
- Cada signatário cria sua intenção `aresta `APPROVED_BY`` localmente.
- Validador de Domínio coleta aprovações. Quando N atingido, ação principal é consolidada.

#### Aprovações Tardias

Quando uma aprovação chega após consolidação:

- Validador verifica: ação já foi consolidada? Se sim, rejeita a aprovação tardia.
- Aprovação tardia recebe `REJECTED` localmente do peer que tentou — auditoria preservada como "rascunho negado".
- Sem complexidade adicional: máquina de estados baseada em tempo de chegada.

### 7.5 Reservas de Agenda

Slots de tempo (sala de reunião, profissional, entrega):

- Cada slot é `ASSET` com weight=1 e atributo de tempo.
- Reserva é `TRANSFERRED_TO`.
- Conflito (dois reservando mesmo slot) é resolvido pelo Validador de Domínio (geralmente single-validator do dono do recurso).

### 7.6 Ordem em Filas

Filas de atendimento, posições sequenciais:

- Posição é `ASSET` emitido sequencialmente pelo Validador de Domínio.
- Validador é único garantidor da ordem.
- Sem validador online, fila confiável não existe.

---

## 8. Capabilities, Roles e Modelo de Permissões

O sistema unifica permissões sob a primitiva ASSET, com SPECIFICATION definindo regras.

### 8.1 ASSET:CAPABILITY

Capability técnica/sistêmica. Concede direito específico de operar.

Exemplos:
- Capability "ler grupo de chat X".
- Capability "escrever no documento Y".
- Capability "executar ação Z na SPECIFICATION W".

Estrutura:
- Nó `ASSET:CAPABILITY` com payload descrevendo escopo.
- Aresta `DELEGATED_TO` ligando capability ao perfil que a possui.
- TTL curto (minutos a dias).
- Implementado tipicamente como UCAN.

### 8.2 ASSET:ROLE

Cargo de negócio. Agrupa conjunto de capabilities sob nome semântico.

Exemplos:
- Role "Gerente Financeiro".
- Role "Administrador de Rede".
- Role "Auditor".

Estrutura:
- Nó `ASSET:ROLE` com payload descrevendo cargo.
- Aresta `DELEGATED_TO` ligando role ao perfil ocupante.
- Role **emite** capabilities efêmeras quando o ocupante as utiliza (lazy generation).

### 8.3 ASSET:CONSENT

Consentimento LGPD/GDPR para processamento de dados pessoais.

Exemplos:
- Consentimento para receber email marketing.
- Consentimento para compartilhamento de dados com terceiros específicos.
- Consentimento para uso de dados em treinamento de IA.

Estrutura:
- Nó `ASSET:CONSENT` com payload descrevendo escopo (qual dado, qual finalidade, qual destinatário).
- Aresta `GRANTED_TO` ligando consentimento ao destinatário (a empresa, parceiro, etc.).
- Revogação: emissão de uma lápide (tombstone) da aresta de consentimento, criando uma nova versão da aresta com `weight = 0`.
- Audit trail completo (quando concedido, quando revogado, qual o escopo).

### 8.4 Fluxo de Permissão

Quando uma ação é tentada:

1. SPECIFICATION da ação declara quais capabilities/roles são exigidos.
2. Validador verifica: o autor da intenção possui os ASSETs requeridos via aresta `DELEGATED_TO` válida?
3. Verifica TTL (capabilities expiradas não valem).
4. Verifica que capabilities não foram revogadas (aresta `REVOKED_FROM`).
5. Se tudo ok: ação prossegue.

### 8.5 Delegação Recursiva

UCAN permite delegação recursiva: A delega capability para B, que pode delegar para C dentro do escopo recebido.

A plataforma suporta isso, mas SPECIFICATIONs podem **bloquear** delegação para classes de capabilities que devam ser intransferíveis (ex: capability de "ser CEO" não delega).

### 8.6 Revogação

Revogação é nova ação que anula capability:

- Emissão de uma aresta de revogação explícita ou atualização da aresta original com `weight = 0` (lápide), o que instrui os Triggers a removerem a capacidade da tabela `active_edges`.
- Validadores de domínio passam a rejeitar capability revogada.
- Em P2P com latência, há janela de exposição: capability pode ser usada por peer offline antes de receber notícia da revogação. Validador online rejeita ao consolidar.

### 8.7 Forward Secrecy de Capabilities

Quando capability é revogada:

- Cache volátil do peer revogado é invalidado na próxima oportunidade (logout, expiração de 4h).
- Conteúdo encriptado por chave de época anterior ao acesso continuado pelo peer revogado fica acessível (limitação do local-first).
- Conteúdo de épocas posteriores fica matematicamente inacessível (forward secrecy — Documento 2, seção 10.2).

---

## 9. Recuperação de Acesso

Recuperação é configurável por SPECIFICATION da rede. Plataforma oferece três modelos canônicos.

### 9.1 Modelo "central"

Adequado para redes corporativas que exigem garantia de continuidade operacional.

**Mecânica:**

- Ao provisionar `PROFILE:AUTHENTICATION` do funcionário, empresa gera chave mestra do funcionário e a encripta com **chave-mestre-da-empresa**.
- Empresa mantém capacidade de derivar chave do funcionário a qualquer momento.
- Funcionário usa chave em operações normais; empresa pode reset/recovery sob demanda.

**Trade-off explicitamente comunicado:**

- A empresa tem capability técnica de acessar dados do funcionário.
- Modelo similar a Microsoft 365 corporativo, Google Workspace corporativo.
- Funcionário toma conhecimento via contrato de trabalho e termo de uso da plataforma corporativa.
- Não há "privacy do funcionário contra a empresa" criptograficamente garantida.

**Vantagens:**
- Zero perda de acesso por esquecimento de senha.
- Onboarding/offboarding administrativos.
- Conformidade com requisitos de compliance corporativo (auditoria, retenção legal).

### 9.2 Modelo "shamir"

Adequado para rede pública onde nem usuário nem operador devem ter controle absoluto.

**Mecânica:**

- Chave mestra do usuário é dividida em 3 partes via Shamir's Secret Sharing.
- 2 de 3 partes são necessárias para reconstruir.
- Partes alocadas para garantir **independência**:
  - **Parte 1 — Dispositivo do usuário**: protegida por biometria/PIN local. Atacante precisa do dispositivo desbloqueado.
  - **Parte 2 — Cofre do fundador da rede**: protegida por hash da senha do usuário. Atacante precisa autenticar no fundador (com proteção contra brute force).
  - **Parte 3 — Canal externo do usuário**: email/SMS/aplicativo authenticator. Atacante precisa comprometer canal externo.

**Operação normal:** usuário faz login com senha. Dispositivo destrava parte 1; senha (validada no fundador) libera parte 2; combinadas reconstroem chave.

**Recuperação por perda de dispositivo:** usuário autentica no fundador com senha (parte 2 + canal externo via parte 3 = duas partes = chave reconstruída, novo dispositivo configurado).

**Recuperação por esquecimento de senha:** usuário usa parte 1 (biometria no dispositivo antigo) + parte 3 (canal externo). Permite definir nova senha.

**Garantia:** comprometimento de qualquer **uma** das partes não destrava a chave. Atacante precisa comprometer no mínimo duas partes independentes.

### 9.3 Modelo "user_only"

Adequado para P2P puro e usuários que priorizam soberania.

**Mecânica:**

- Usuário gera chave mestra localmente.
- Chave é derivada de **seed phrase** (12 ou 24 palavras BIP39).
- Usuário é único responsável por guardar a seed phrase (offline, em local seguro).
- Sem cofre central, sem fundador, sem canal de recuperação automática.

**Garantia:** soberania absoluta. Nenhuma entidade pode acessar a chave sem ação explícita do usuário.

**Risco:** perda de seed phrase + perda de dispositivo = perda permanente de acesso.

**Mitigações opcionais (não automáticas):**

- Backup criptografado da seed em provedor de nuvem do usuário (Google Drive pessoal, iCloud).
- Esquema de "guardiões": amigos de confiança detêm partes da seed (Shamir entre peers de confiança do usuário).

Esses são extensões implementadas pelo próprio usuário, não automáticas pela plataforma.

### 9.4 Configuração por SPECIFICATION

A SPECIFICATION:NETWORK_GOVERNANCE da rede declara o modelo padrão:

```json
{
  "key_recovery": {
    "model": "shamir",
    "config": {
      "scheme": "2-of-3",
      "vault_holder": "founder",
      "external_channel_methods": ["email", "sms", "totp"]
    }
  }
}
```

Em algumas redes, usuário pode escolher modelo (rede pública pode oferecer "shamir" como default e "user_only" como opt-in para usuários avançados).

### 9.5 Mudança de Modelo

Em rede com fundador, mudar modelo de recuperação para usuários existentes é mudança sensível:

- Pode exigir multi-sig.
- Cada usuário precisa explicitamente migrar (re-encriptar chave sob novo modelo).
- Notificações claras sobre implicações.

### 9.6 Recuperação em Caso de Comprometimento

Se usuário suspeita comprometimento da chave:

- Inicia processo de **rotação de chave mestra**.
- Nova chave é gerada; antiga é marcada como revogada.
- Dados antigos (encriptados sob chave antiga) são re-encriptados sob nova quando reidratados (lazy).
- Capabilities (UCANs emitidos pela chave antiga) são revogadas; novas são emitidas pela nova chave.

Em rede corporativa com modelo "central", admin pode forçar rotação para qualquer funcionário em caso de incidente de segurança.

---

## 10. LGPD, GDPR e Compliance

Esta seção é detalhada porque compliance é responsabilidade legal não-negociável e a abordagem da plataforma precisa ser bem comunicada.

### 10.1 Quem É o Controlador de Dados

A LGPD/GDPR distingue **controlador** (define propósito e meios do tratamento) de **operador** (processa dados em nome do controlador).

Na plataforma:

- **Rede corporativa whitelabel**: a empresa que opera a rede é o **controlador**. A plataforma (software) é apenas ferramenta. Empresa cumpre LGPD/GDPR para dados de seus funcionários, clientes, parceiros tratados na rede.
- **Rede pública**: o operador da rede pública (fundador/board) é o **controlador**. Cumpre LGPD/GDPR para dados dos usuários da rede.
- **P2P puro**: cada usuário é **controlador de seus próprios dados**. Sem entidade central. Aviso explícito no onboarding.
- **A plataforma como software/produto**: pode atuar como operador para o controlador (provendo ferramentas). Termos de uso entre plataforma e dono de rede definem essa relação.

### 10.2 Direitos do Titular

LGPD (art. 18) garante ao titular:

- Confirmação de existência de tratamento.
- Acesso aos dados.
- Correção de dados incompletos/inexatos.
- Anonimização, bloqueio ou eliminação.
- Portabilidade.
- Eliminação de dados tratados com consentimento.
- Informação sobre compartilhamento.
- Revogação de consentimento.

### 10.3 Primitivas Nativas para Compliance

A plataforma fornece primitivas; o controlador as usa para construir compliance:

#### `ASSET:CONSENT`

Já documentado (seção 8.3). Permite:

- Granularidade de consentimento (por finalidade, por destinatário).
- Audit trail completo (quando concedido, quando revogado).
- Revogação a qualquer momento.

#### `CONTENT:INTENT de Portabilidade`

Quando titular requisita exportação:

- Cria evento de requisição.
- Trigger automático de exportação dos dados governados pelo titular.
- Formato: JSON estruturado contendo nós CONTENT vinculados ao titular, decriptados.
- Geração assinada para autenticidade.
- Audit trail da entrega.

#### `CONTENT:INTENT de Deleção`

Quando titular requisita eliminação:

- Cria evento de requisição.
- Trigger de processo de exclusão configurado pela rede:
  - Specifications que governam dados do titular determinam o que pode ser apagado.
  - Dados sob retenção legal (fiscais, financeiros) não podem ser apagados — informação é fornecida ao titular sobre essa limitação.
  - Para o que pode: revogação de capabilities, marcação para expurgo, propagação aos peers ativos.

#### Fluxos BPMN-Template

A plataforma fornece templates de fluxos BPMN para os processos comuns:

- "Atender requisição de acesso"
- "Atender requisição de portabilidade"
- "Atender requisição de exclusão"
- "Notificar incidente de segurança"

Donos de rede customizam conforme suas políticas.

### 10.4 A Limitação Fundamental Comunicada

Conforme Documento 1, seção 8.2: o sistema não pode garantidamente destruir cópias offline em dispositivos de terceiros. Isso é limitação **comum à indústria**.

**O que o sistema faz quando exclusão é requisitada:**

1. Apaga dados dos sistemas centrais do controlador (super peer corporativo, Cloud, snapshots).
2. Revoga capabilities, iniciando rotação de chave de época. Conteúdo futuro fica inacessível.
3. Propaga revogação para peers ativos no grupo. Peers honestos honram a revogação.
4. Invalida cache volátil em peers ativos.
5. Documenta o esforço (audit trail).
6. Comunica ao titular o que foi feito e quais são as limitações remanescentes.

**O que o sistema reconhece como fora de seu controle:**

- Cópias locais já feitas por peers (especialmente peers que extraíram dados via API ou exportação).
- Backups offline de usuários que não estão online no momento da revogação.
- Dados extraídos via screenshot, scraping, etc.

**Comparação honesta com indústria:**

- Mercado Livre: vendedor que extraiu lista de clientes para CRM próprio se torna controlador secundário. ML cumpriu sua parte; vendedor é responsável.
- Instagram: usuário que fez print de foto que outro depois apagou tem cópia fora do controle do Meta.
- Microsoft 365: backup local do usuário com Outlook desconectado não é apagado por exclusão no servidor.
- WhatsApp: mensagem apagada "para todos" em cliente offline pode permanecer até cliente reconectar; backup local pode preservar indefinidamente.

A plataforma está em **paridade ou melhor** que esses concorrentes.

### 10.5 Vantagens da Plataforma para Compliance

Onde a plataforma é tecnicamente superior à média:

- **Forward secrecy por época**: revogação realmente bloqueia conteúdo futuro, não só "esconde". Concorrentes raramente fazem isso.
- **Cache volátil de 4h**: limita exposição residual mesmo em dispositivo legítimo.
- **Audit trail criptográfico**: capacidade de demonstrar conformidade com prova matemática.
- **Consent como primitiva**: granularidade nativa, não bolt-on.
- **Specifications imutáveis**: histórico de regras é preservado para compliance retrospectivo.

### 10.6 Desvantagens / Áreas de Atenção

- **Surface area maior**: dados em múltiplos peers é mais "lugares onde podem estar" do que SaaS centralizado.
- **Comunicação de limitações ao titular**: precisa ser clara, sem subestimar nem dramatizar. Templates de comunicação serão fornecidos.
- **P2P puro especialmente**: usuário é controlador de seus próprios dados; plataforma não tem mecanismo de ajudá-lo a cumprir LGPD em interações com terceiros.

### 10.7 Comunicação ao Titular

Modelo de resposta a requisição de exclusão (template, customizável):

> *"Recebemos sua solicitação de exclusão de dados. Em conformidade com a LGPD, executamos as seguintes ações:*
>
> *1. Removemos seus dados de nossos sistemas centrais.*
> *2. Iniciamos processo de revogação de acesso, propagando aos sistemas ativos da rede.*
> *3. Bloqueamos qualquer leitura futura por terceiros.*
>
> *Como ocorre em qualquer plataforma da indústria, dados que foram legitimamente acessados por outros usuários antes da revogação podem ter sido copiados localmente em dispositivos fora de nosso controle. Esses dados são responsabilidade dos terceiros que os mantêm; orientamos que, caso identifique uso indevido, você acione diretamente esses controladores secundários, conforme art. 18 da LGPD.*
>
> *Mantemos audit trail criptográfico das ações executadas, disponível para apresentação à ANPD se requerido."*

### 10.8 Specifications de Compliance

Specifications dedicadas governam compliance:

- `SPECIFICATION:LGPD_RIGHTS` declara como cada direito é atendido na rede.
- `SPECIFICATION:CONSENT_FRAMEWORK` declara escopos e finalidades possíveis.
- `SPECIFICATION:DATA_RETENTION` declara políticas de retenção por tipo de dado.

Donos de rede instanciam essas specifications conforme contexto (LGPD para Brasil, GDPR para Europa, etc.).

---

## 11. Governança da Rede

### 11.1 Specification de Governança

Toda rede corporativa/whitelabel deve possuir um nó **`SPECIFICATION:NETWORK_GOVERNANCE`** no momento da gênese (bootstrap). Esta spec define:

- Quem é o(s) Validador(es) de Domínio.
- Linha de sucessão (M-de-N assinaturas, herdeiros designados, board).
- Modelo de recuperação de chaves (seção 9).
- Políticas de quota e retenção.
- Regras de criação de specifications de rede.
- Processos de mudança de configuração.
- Primitivas de compliance ativas.

### 11.2 Mudanças na Spec de Governança

Mudanças na própria SPECIFICATION:NETWORK_GOVERNANCE são **especialmente sensíveis** e tipicamente exigem multi-sig:

- Novo nó SPECIFICATION:NETWORK_GOVERNANCE v_n+1 é criado.
- Aresta SUPERSEDED_BY liga versões.
- Mudança requer N assinaturas conforme regra atual.

Isso cria autoreferencialidade controlada: a rede só muda suas próprias regras conforme as próprias regras permitem.

### 11.3 Governança Inicial vs. Madura

Redes corporativas tendem a iniciar com governança simples (fundador único valida tudo) e evoluir para mais distribuída (board, comitês) conforme amadurecem. A SPECIFICATION suporta essa evolução via versionamento.

### 11.4 Governança de Redes Públicas

Em rede pública, governança pode ser:

- **Top-down**: fundador/board controla tudo (como Twitter pré-Musk).
- **Comunitária**: votação dos peers ativos para mudanças (modelo open source).
- **Híbrida**: fundador/board controla decisões executivas, comunidade vota em mudanças que afetam todos.

Plataforma suporta os três; SPECIFICATION declara qual modelo a rede adota.

---

## 12. Sucessão e Dissolução

### 12.1 Sucessão Planejada

A SPECIFICATION:NETWORK_GOVERNANCE declara linha de sucessão na criação. Modelos típicos:

- **Single founder com chave de recuperação SSS**: fundador único, chave protegida por SSS distribuído entre pessoas de confiança. Em caso de morte/incapacidade, board de confiança reconstrói chave.
- **Board de M-de-N**: rede já nasce com board distribuído. Decisões críticas requerem M assinaturas; sucessão por entrada/saída de membros é decidida pelo próprio board.
- **Sucessão por votação de peers ativos**: peers da rede votam em líderes/board.
- **Sucessão hereditária declarada**: fundador declara herdeiros (corporativo: COO assume se CEO sair; familiar: filho herda em caso de morte).

### 12.2 Dissolução de Superpoderes

O fundador pode optar por **dissolver superpoderes** ao longo do tempo, transitando a rede para mais P2P-pura:

- Mudança na SPECIFICATION:NETWORK_GOVERNANCE remove fundador como autoridade central.
- Validação passa a ser distribuída entre peers via mecanismos como consenso ou multi-sig.
- KMS centralizado pode dar lugar a esquemas de chave de grupo distribuída.

Esta transição é **gradual e auditável**. Cada etapa é evento registrado.

### 12.3 Fallback por Física

**Decisão importante:** não é necessário programar "estado read-only artificial" para casos de fundador desaparecido sem sucessão.

Pela arquitetura: se Validador de Domínio desaparece e não há sucessores definidos, **operações não-comutativas falham nativamente na validação**. A rede torna-se arquivo morto (read-only) por leis da física da arquitetura, sem código especial.

Operações comutativas (chat, posts, edição colaborativa) continuam funcionando entre peers — porque não dependem de validador autoritativo.

### 12.4 Recuperação de Rede Inerte

Se rede ficou read-only por desaparecimento de fundador:

- Peers ativos podem se organizar para criar SPECIFICATION:NETWORK_GOVERNANCE sucessora via consenso comunitário.
- Multi-sig de N peers ativos cria nova autoridade.
- Antiga `SUPERSEDED_BY` nova.
- Operações voltam a fluir.

Este processo não é automático; requer ação coordenada da comunidade.

### 12.5 Encerramento Voluntário

Empresa decide encerrar a rede:

- Comunicação aos usuários.
- Período de transição declarado (ex: 90 dias).
- Exportação de dados oferecida a todos (atendimento massivo de portabilidade).
- Após período, super peer é desligado.

Dados que foram replicados a peers ativos continuam acessíveis entre eles (P2P puro residual). Cloud central deixa de operar; sem fundador, rede entra em modo read-only por física (12.3) ou comunidade pode tentar recuperação (12.4).

### 12.6 Migração de Dados

Em encerramento ou para usuário que sai da rede:

- Exportação de dados pessoais (CONTENT:PERSONAL_DATA + dados criados/recebidos sob consentimento) em formato padronizado (JSON estruturado).
- Exportação não é "portabilidade da identidade": redes são silos (Documento 1, seção 5.4). Dados podem ser importados para outra rede mas como dados novos, com nova identidade.

---

## 13. Audit Trail Universal

### 13.1 Princípio

Toda operação no sistema gera audit trail via MFA-S. Sem exceções:

- Operação de usuário comum: registrada.
- Operação administrativa de fundador: registrada.
- Mudança de SPECIFICATION: registrada.
- Atribuição de role: registrada.
- Revogação de capability: registrada.
- Tentativa de operação rejeitada: registrada (REJECTED).

### 13.2 Diferença Entre Modalidades

A natureza do audit trail é a mesma. A diferença está em **quem pode lê-lo**:

- **Rede corporativa**: trail completo é acessível ao admin/auditor da empresa, conforme governança. Funcionários veem trail de suas próprias ações.
- **Rede pública**: trail por escopo de capability. Cada usuário vê seu próprio trail. Trail global existe mas é restrito a curadores/admins da rede.
- **P2P puro**: cada peer vê o que tem capability de ver. Não há trail "global" centralizado.

### 13.3 Garantias Criptográficas

- Hash chaining (MFA-S) detecta qualquer alteração retroativa.
- Assinaturas Ed25519 garantem autoria.
- Audit trail é fonte juridicamente apresentável (ANPD, justiça) com prova de integridade.

### 13.4 Compliance via Audit Trail

Capacidade de demonstrar:

- Quando consentimento foi concedido e por quem.
- Quando dado foi acessado e por quem.
- Quando exclusão foi solicitada e como foi atendida.
- Quem alterou política X em qual data.
- Quem tinha acesso a dado Y em momento Z.

Tudo extraível via queries no grafo, com integridade matemática garantida.

### 13.5 Privacidade do Audit Trail

Trail em si pode conter dados sensíveis. Aplicam-se as mesmas regras de capability:

- Trail é encriptado em payload.
- Visibilidade requer capability adequada.
- Em rede corporativa, capability de auditoria é role específica (ASSET:ROLE "Auditor") delegada conforme governança.

### 13.6 Retenção do Audit Trail

Audit trail tem regras de retenção próprias:

- Por padrão, **nunca expurgado** (princípio de imutabilidade do passado).
- Em domínios fiscais/regulados, retenção legal forçada (5+ anos).
- Em domínios casuais, pode ter retenção mais curta (chat: trail de mensagens segue retenção das mensagens).

---

## 14. Arquitetura de Onboarding Seguro por Acolhimento Causal

O onboarding seguro é um requisito arquitetural crítico: um dispositivo novo não pode simplesmente criar nós no grafo global sem validação prévia, pois isso abriria brechas para identidades forjadas, ocupação de `entity_id`s alheios e injeção de dados maliciosos. A plataforma adota o padrão de **Acolhimento Causal** gerenciado por um Agente de Sistema (`PROFILE:SYSTEM`) rodando em um Super Peer confiável.

### 14.1 Princípio: O Dispositivo Não Publica Diretamente

Durante o onboarding, o dispositivo local é tratado como entidade não-autenticada. Ele gera o par de chaves Ed25519 (a chave mestra futura) localmente, mas **não publica nenhum nó no grafo global** antes de receber validação do Agente de Acolhimento.

Isso evita:
- *Bootstrap race conditions*: dois dispositivos tentando criar o mesmo `PROFILE:AUTHENTICATION` com chaves distintas.
- *Sybil attacks em massa*: identidades criadas em lote sem verificação humana ou prova de intenção.
- *Corrupção do grafo*: nós mal-formados oriundos de clientes bugados ou adversariais que não passaram pelo ciclo de validação canônico.
- *Vazamento prematuro de chave pública*: a `pub_key` do dispositivo não fica exposta na rede antes de estar vinculada a um `PROFILE:AUTHENTICATION` legitimamente emitido.

### 14.2 Fluxo de Acolhimento Causal

#### Fase 1 — Geração Local de Par de Chaves (Off-line)

```
[Dispositivo Local — sem conexão com a rede ainda]

(ChavePrivada, ChavePublica) ← Ed25519.generateKeyPair()
ChavePrivada → armazenada no Secure Enclave / Keychain / OPFS criptografado
ChavePublica → será enviada na requisição de acolhimento
```

A chave privada **jamais é transmitida** para qualquer peer em qualquer etapa do fluxo.

#### Fase 2 — Envio do CONTENT:MESSAGE:ONBOARDING_REQUEST

O dispositivo cria e envia ao Super Peer um nó de requisição de acolhimento. Como não há chave de época ainda, o payload viaja em texto plano (ou sob TLS do canal WebRTC), assinado pela chave privada local para provar posse:

```
Nó CONTENT:MESSAGE criado:
  type: "CONTENT:MESSAGE"
  subtype: "ONBOARDING_REQUEST"
  payload (texto plano ou TLS do canal):
    candidate_pub_key: <ChavePublica do dispositivo>
    network_id:        <identificador da rede de destino>
    invitation_token:  <token de convite, se exigido pela rede>
    device_info:       { platform, app_version, timestamp_ms }
    self_signature:    Ed25519.sign(
                         hash(candidate_pub_key || network_id || timestamp_ms),
                         ChavePrivada
                       )
                       ← prova que o dispositivo controla a ChavePrivada
                         correspondente à candidate_pub_key, sem revelar a chave

Aresta DIRECTED_TO:
  source_id: <id do CONTENT:MESSAGE>
  target_id: <entity_id do PROFILE:SYSTEM Agente de Acolhimento>
```

A `self_signature` inclui `timestamp_ms` e `network_id` para prevenir replay attacks: a mesma requisição não pode ser reutilizada em outra rede ou em momento posterior.

#### Fase 3 — Validação pelo Agente de Acolhimento (PROFILE:SYSTEM)

O Super Peer recebe o `CONTENT:MESSAGE:ONBOARDING_REQUEST` e o Agente de Acolhimento executa:

1. **Verificação da `self_signature`**: confirma que o dispositivo controla a chave privada correspondente à `candidate_pub_key`.
2. **Verificação de unicidade da chave pública**: `candidate_pub_key` não pode estar associada a nenhum `PROFILE:AUTHENTICATION` existente na rede (prevenção de reutilização de chaves comprometidas).
3. **Verificação do `invitation_token`** (se a rede exigir): token válido, não expirado, não consumido por outro onboarding.
4. **Verificação de quotas e políticas da rede**: `SPECIFICATION:NETWORK_GOVERNANCE` pode limitar taxa de onboarding (rate limiting), exigir KYC, ou restringir por tipo de convite.
5. **Verificação de sanidade de `device_info`**: versão mínima do app suportada, plataforma permitida.

Se qualquer verificação falha: o Agente emite `CONTENT:MESSAGE` (subtipo `ONBOARDING_REJECTED`) com motivo estruturado, via aresta `REPLIES_TO` apontando para o `CONTENT:MESSAGE` original.

#### Fase 4 — Emissão e Assinatura do PROFILE:AUTHENTICATION pelo Agente

Se a validação passa, o Agente de Acolhimento emite **atomicamente** e assina o grafo de identidade inicial:

```
[Emitido e assinado pelo PROFILE:SYSTEM Agente de Acolhimento]

Nó PROFILE:AUTHENTICATION criado:
  id: "01J2X3Y4Z5N..."  (11º char = 'N')
  entity_id: <novo ULID estável — identidade permanente na rede>
  type: "PROFILE:AUTHENTICATION"
  pub_key: <candidate_pub_key do dispositivo>
  payload (criptografado com chave de época da rede):
    network_id:         <id da rede>
    onboarded_at:       <unix_ms>
    onboarding_agent:   <entity_id do Agente de Acolhimento>
    invitation_origin:  <hash do invitation_token, se aplicável>
  signature: <Ed25519 do Agente de Acolhimento>  ← autentica a criação

Aresta AUTHORED:
  source_id: <entity_id do Agente de Acolhimento>
  target_id: <id do PROFILE:AUTHENTICATION>

Aresta PARTICIPATES_IN:
  source_id: <id do PROFILE:AUTHENTICATION>
  target_id: <entity_id da NETWORK_ROOT>

Nó ASSET:CAPABILITY (capabilities de Onda 0):
  [capabilities mínimas — leitura de conteúdo público, criação de PROFILE:PERSONA]

Aresta DELEGATED_TO:
  source_id: <id do ASSET:CAPABILITY>
  target_id: <id do PROFILE:AUTHENTICATION>

CONTENT:MESSAGE de resposta (subtipo: ONBOARDING_ACCEPTED):
  payload: { auth_entity_id: <entity_id do novo PROFILE:AUTH>, epoch_key_hint: ... }
  assinado pelo Agente de Acolhimento

Aresta REPLIES_TO:
  source_id: <id do CONTENT:MESSAGE:ONBOARDING_ACCEPTED>
  target_id: <id do CONTENT:MESSAGE:ONBOARDING_REQUEST original>
```

#### Fase 5 — Replicação do Grafo de Onboarding para o Peer Local

O Super Peer replica o sub-grafo resultante — `PROFILE:AUTHENTICATION`, suas arestas de vínculo, as capabilities iniciais e a mensagem de aceite — de volta ao dispositivo do usuário via Automerge Repo/WebRTC. O dispositivo recebe seu nó de identidade já vinculado à rede, assinado por uma autoridade confiável, e pode então operar como peer autenticado.

A partir deste ponto, o dispositivo usa sua chave privada local para assinar operações, e os demais peers da rede verificam a autenticidade contra a `pub_key` do `PROFILE:AUTHENTICATION` persistido no grafo.

### 14.3 Propriedades de Segurança do Protocolo

**Privacidade da chave privada:** a chave privada jamais é transmitida. Apenas `candidate_pub_key` e a `self_signature` trafegam. Comprometer o canal de comunicação não expõe a chave privada do usuário.

**Causalidade verificável:** o `PROFILE:AUTHENTICATION` foi criado *por* um agente confiável *em resposta a* uma requisição específica. A aresta `AUTHORED` e o par `ONBOARDING_REQUEST` ↔ `ONBOARDING_ACCEPTED` (ligados por `REPLIES_TO`) registram isso imutavelmente no grafo.

**Não-forjabilidade:** o Agente de Acolhimento assina o `PROFILE:AUTHENTICATION` com sua própria chave (do Super Peer). Qualquer peer da rede pode verificar que este perfil foi legitimamente emitido, sem depender de um servidor de verificação central separado.

**Proteção contra replay:** a `self_signature` cobre `timestamp_ms` e `network_id`. Reutilizar a mesma requisição em outra rede ou após o timestamp expirar falha na verificação do Agente.

**Auditabilidade completa:** toda concessão de identidade é rastreável via o par de `CONTENT:MESSAGE` imutáveis no grafo. Auditorias podem verificar *quando*, *por quem* e *sob qual invitation_token* cada `PROFILE:AUTH` foi criado.

### 14.4 Variações por Modalidade de Rede

**Rede pública:**
O Agente de Acolhimento é o `PROFILE:SYSTEM` do fundador. Políticas definidas pela `SPECIFICATION:NETWORK_GOVERNANCE` (ex: cadastro livre, por convite, com KYC). Taxa de onboarding pode ser limitada para prevenir ataques de criação em massa.

**Rede corporativa whitelabel:**
O Agente de Acolhimento é integrado ao sistema de SSO/LDAP da empresa (materializado como `PROFILE:SYSTEM`). O `PROFILE:AUTHENTICATION` é provisionado com base no registro do funcionário no AD/Okta; o `invitation_token` é substituído pelo token de SSO da empresa. O `CONTENT:PERSONAL_DATA` do funcionário pode ser pré-preenchido a partir do diretório corporativo durante o onboarding.

**Rede P2P pura:**
Não há Super Peer central. O bootstrap ocorre por convite direto de peer existente: o peer convidante assume o papel de Agente de Acolhimento local, assina o `PROFILE:AUTH` do novo membro com sua própria chave. O modelo de confiança é transitivo (confio no membro A que acolheu B, portanto B tem presença no meu grafo). O onboarding P2P puro é comunicado explicitamente ao usuário: a identidade não tem validação de autoridade central; é tão confiável quanto o peer que a acolheu.

### 14.5 Relação com o Modelo de Recuperação de Acesso (Seção 9)

O processo de onboarding por Acolhimento Causal é **estruturalmente idêntico** ao processo de recuperação de acesso descrito na Seção 9: em ambos os casos, um dispositivo sem identidade ativa solicita ao Super Peer que emita ou reative um `PROFILE:AUTHENTICATION`. A diferença semântica está no subtipo do `CONTENT:MESSAGE` (`ONBOARDING_REQUEST` vs. `RECOVERY_REQUEST`) e nas verificações adicionais do Agente (ex: verificação Shamir em recuperação, verificação de invitation_token e unicidade de chave em onboarding).

Este design unificado elimina código de caminho especial: o mesmo mecanismo de mensageria baseado em nós, o mesmo agente, o mesmo protocolo criptográfico, aplicado a dois contextos operacionais semanticamente distintos mas mecanicamente equivalentes.

---

**Fim do Documento 3.**

Próximos documentos:
- Documento 4: Camada de UI e Engines (incluirá detalhamento técnico do sistema de temas Tailwind+shadcn, padrão A puro de engines, modalidades de customização, marketplace como primitiva)
