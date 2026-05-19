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

CRDT (Y.js) resolve naturalmente. Múltiplas intenções concorrentes são merged, todas se materializam.

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

Após a Etapa 3, Y.js sincroniza o sub-grafo (nova versão do CONTENT + arestas) pela rede. A Ordem de Compra passa a existir oficialmente para todos os membros que têm acesso de leitura.

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

### 2.6 Aprovações Concorrentes em Recursos Finitos

Quando múltiplos peers tentam consumir o mesmo recurso finito ao mesmo tempo:

- Todas as intenções são criadas localmente em cada peer.
- Validador autoritativo (dono do recurso) recebe todas.
- Aplica regra (FIFO, prioridade, sorteio — definido pela SPECIFICATION).
- Vencedora vira ação. Demais recebem REJECTED com motivo "recurso esgotado".

### 2.7 Falhas de Validação Online

Em P2P puro com validador offline:

- Intenção fica em estado pendente local (tabela auxiliar `pending_intents` no SQLite).
- Quando peer ou validador volta online, intenção é submetida.
- Se ainda válida, vira ação. Se não (recurso esgotado, capability revogada), recebe REJECTED.

UX: usuário vê estado "aguardando confirmação" claramente, com explicação de que ação depende de validador online.

---

## 3. MFA-S: Framework de Auditoria Semântica

### 3.1 Propósito e Filosofia (Trilhas Paralelas)

O **MFA-S (Multi-Factor Audit Semantic)** em domínios de edição colaborativa (documentos, planilhas) atua como uma ponte integradora entre o dinamismo em tempo real do **Y.js (CRDT)** e a persistência imutável e estruturada do **SQLite**. Em vez de manter logs de updates intermináveis ou diffs semânticos puros e isolados, o framework resolve os dilemas de sistemas local-first por meio de duas trilhas paralelas de dados:

1. **Trilha CRDT (Efêmera)**: Focada puramente na sincronização em tempo real de mudanças na rede e em prover suporte a mecanismos locais rápidos como o "Undo" nativo do Y.js.
2. **Trilha Semântica (Persistente)**: O histórico imutável e legível por humanos de eventos de negócio do sistema. Em vez de registrar "keystrokes" ou bytes brutos, armazena alterações lógicas de atributos do documento.

### 3.2 Estrutura Física de Armazenamento no SQLite

Para operacionalizar essas duas trilhas com eficiência de espaço e resiliência a crashes, o SQLite local gerencia quatro tabelas fundamentais:

* **`snapshots`**: Guarda o estado binário consolidado do documento (`Y.encodeStateAsUpdate`) e o último `State Vector`.
* **`yjs_updates`**: A janela deslizante (**Rolling Window**). Armazena os últimos $X$ updates binários brutos do Y.js para permitir ressincronização P2P acelerada e o "Undo" nativo do Y.js.
* **`pending_staging`**: Área de estágio temporária. Registra de forma atômica as mudanças brutas capturadas pelo observador profundo do Y.js (`observeDeep`) antes de passarem pela consolidação semântica, evitando perda de dados se o browser for fechado inesperadamente.
* **`audit_logs`**: O histórico imutável final. Contém JSONs legíveis estruturados, mapeando as alterações sob o seguinte formato:

```json
{
  "id": "event_998abc",
  "path": "sections[0].title",
  "userId": "did:key:z6Mk...",
  "before": "Título Antigo",
  "after": "Título Novo",
  "vector_clock": { "peer_alice": 12, "peer_bob": 8 },
  "created_at": 1747123456789
}
```

### 3.3 O Fluxo Operacional de Escrita

Toda alteração colaborativa segue este fluxo lógico:

1. **Edição**: O usuário altera a interface do documento (modificando nós ou propriedades).
2. **Captura por Deep Observer**: O `observeDeep` do Y.js captura a alteração, identificando o caminho lógico (`path`) e o `delta`.
3. **Commit Atômico Local**: O sistema grava simultaneamente o update binário correspondente do Y.js na tabela `yjs_updates` e insere o registro das alterações na tabela temporária `pending_staging`.
4. **Coalescência Semântica**: O framework inicia uma janela temporal (janela default: 10 segundos). Modificações subsequentes do mesmo autor sobre a mesma propriedade acumulam e são agrupadas em memória para consolidar um único evento.
   * **Regra de Quebra por Concorrência**: Se o **Vector Clock** contido no update recebido da rede indicar que outro usuário editou o mesmo nó/atributo concorrentemente, a coalescência é imediatamente interrompida. O agrupamento é quebrado e o conflito é gravado explicitamente em `audit_logs` para manter a rastreabilidade exata da divergência.
5. **Consolidação e Limpeza**: Expirado o timeout de coalescência, o **Semantic Mapper** compila o diff final em formato legível, insere o registro na tabela `audit_logs` de forma persistente, e limpa os registros correspondentes da tabela `pending_staging`.

### 3.4 Recuperação, Compactação e Recursos Avançados

* **Crash Recovery (Recuperação Pós-Falha)**: No startup de cada sessão do app, o `SyncWorker` escaneia a tabela `pending_staging`. Qualquer resíduo de edição inacabada da sessão anterior é imediatamente processado pelo `Semantic Mapper` e gravado na auditoria, eliminando lacunas de log causadas por fechamentos abruptos.
* **Snapshotting e Rotação**: Quando um documento é fechado ou atinge um limite crítico de updates binários em `yjs_updates`, o sistema gera um novo snapshot consolidado via `Y.encodeStateAsUpdate`, grava na tabela `snapshots`, limpa os updates mais antigos de `yjs_updates` (mantendo apenas o buffer de undo de tamanho $X$), e reinicia o ciclo de sincronização.
* **Undo Semântico**: Utilizando as informações históricas de `antes/depois` (valores `before` no JSON) na tabela `audit_logs`, o usuário consegue reverter campos específicos para estados passados no tempo, mesmo que o snapshot do Y.js já tenha descartado os deltas binários detalhados daquela alteração.
* **Publicação "Shadow"**: Para exibição estática e pública de conteúdos colaborativos, o framework exporta a projeção limpa do `Y.Doc` para Markdown (`yText.toString()`) ou JSON estruturado (`yMap.toJSON()`), salvando o resultado em uma tabela de visualização pública separada da área de rascunhos.

### 3.5 Validação de Linhagem ao Receber

Quando o peer recebe deltas de auditoria ou updates remotos da rede P2P:
1. Verifica a assinatura criptográfica Ed25519 do autor do evento.
2. Compara o `vector_clock` recebido contra o estado de causalidade local.
3. Se houver divergências ou se o log apresentar assinaturas rompidas, a transação é gravada na tabela `audit_logs` com status de rejeição (`REJECTED`) para auditoria futura e descartada do estado ativo. Se estiver correto, o update é fundido na trilha CRDT e refletido na interface através da TinyBase.

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

**Fim do Documento 3.**

Próximos documentos:
- Documento 4: Camada de UI e Engines (incluirá detalhamento técnico do sistema de temas Tailwind+shadcn, padrão A puro de engines, modalidades de customização, marketplace como primitiva)
