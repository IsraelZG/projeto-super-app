# 01-graph-ontology.md — Graph Ontology Specification

Este documento descreve a ontologia unificada do grafo de dados da Plataforma V3.1. A decisão fundamental do sistema reside no minimalismo ontológico: toda entidade física ou abstrata do mundo é representada por um de quatro tipos de nós, e os relacionamentos ou ações são representados por arestas.

---

## 1. O Princípio do Substantivo e do Verbo

Toda a modelagem semântica no sistema deve conformar-se à seguinte regra linguística vinculativa: **nós são substantivos e arestas são verbos**.

* O ato de delegar não é um nó — é uma aresta (`DELEGATED_TO`). O nó é a permissão ou papel delegado (`ASSET:PERMISSION` ou `ASSET:ROLE`).
* O ato de consentir não é um nó — é uma aresta (`GRANTED_TO`). O nó é a declaração de consentimento (`ASSET:CONSENT`).
* O ato de aprovar não é um nó — é uma aresta (`APPROVED_BY`).
* O ato de mutar/alterar não é um nó — é uma aresta (`MUTATES`).
* **Não existe o tipo de nó `EVENT`**. Eventos consolidados são representados por novos nós-versão (na tabela `nodes`) e arestas relacionais. A intenção de uma ação é representada pelo nó `CONTENT:INTENT` (um subtipo de `CONTENT`, não uma primitiva separada).

---

## 2. Convenção de Nomenclatura de Arestas

As arestas de alto grau semântico — especialmente relações contínuas entre entidades — seguem o padrão formal:

```
VERBO:DOMÍNIO:SPECIFIER
```

Onde `VERBO` é a raiz verbal no presente contínuo, `DOMÍNIO` é a categoria ontológica da relação e `SPECIFIER` é o refinamento opcional dentro do domínio. Exemplos canônicos:

| Aresta | Significado Semântico |
| :--- | :--- |
| `INTERACTS:CONTENT:LIKES` | Peer curte um nó de conteúdo. |
| `INTERACTS:CONTENT:SHARES` | Peer compartilha um nó de conteúdo. |
| `RELATES:FAMILY:PARENT_OF` | Relação familiar de maternidade/paternidade. |
| `RELATES:SOCIAL:FOLLOWS` | Relação social de seguimento. |
| `PARTICIPATES_IN:GROUP:MEMBER` | Pertencimento a grupo como membro simples. |
| `PARTICIPATES_IN:PROJECT:CONTRIBUTOR` | Pertencimento a projeto como contribuidor de código. |

*Nota: A aresta `PARTICIPATES_IN` substitui permanentemente a antiga aresta `MEMBER_OF` em toda a ontologia da plataforma.*

### 2.1 Verbos Raiz Canônicos e Relacionais
Os verbos raiz canônicos aceitos na plataforma são:
* `RELATES` — Relações sociais, familiares e interpessoais.
* `OWNS` — Posse estável de ativos, recursos e documentos.
* `GOVERNS` — Governança, regulação e especificações.
* `INTERACTS` — Interações temporárias ou casuais com conteúdos.
* `PARTICIPATES_IN` — Pertencimento contínuo a grupos, projetos e contextos.

Para expressar a estrutura e composição interna do modelo de permissões, a plataforma define duas arestas estruturais permanentes que apontam para o `entity_id` dos nós:
* **`AGGREGATES`** — Liga uma `ASSET:ROLE` a uma `ASSET:PERMISSION`, indicando que o papel engloba aquela permissão.
* **`REQUIRES`** — Liga uma `ASSET:PERMISSION` a outra, indicando uma dependência ou pré-requisito de acesso.

---

## 3. Os Quatro Tipos de Nós

### 3.1 PROFILE (O Ator)
Representa entidades ativas e dotadas de identidade criptográfica (par de chaves pública/privada Ed25519) que atuam como sujeitos de ações.
* **Subtipos Canônicos**:
  * `PROFILE:AUTHENTICATION` — A identidade-âncora do humano dentro de uma rede. Única por rede, carrega as credenciais primárias.
  * `PROFILE:PERSONA` — Máscaras de exibição e interação pública do usuário. Múltiplas personas por humano são permitidas.
  * `PROFILE:ORGANIZATION` — Representação de empresa, departamento, consórcio ou grupos com fins de moderação (ver §3.5).
  * `PROFILE:SYSTEM` — Entidades robotizadas que executam funções de infraestrutura (Sync Workers, validadores, etc.).
* **Comportamento**: Emitem ações (arestas `AUTHORED`, `APPROVED_BY`, `SIGNED_BY`) e recebem pertences (arestas `PARTICIPATES_IN`, `OWNS`).

### 3.2 CONTENT (A Informação)
Dados estruturados passivos e versionados. São a matéria-prima informativa que circula no grafo.
* **Subtipos Canônicos**:
  * `CONTENT:DOCUMENT` — Workspace de texto, planilhas e commits Automerge.
  * `CONTENT:MESSAGE` — Mensagens de chat ou instruções internas de microsserviços.
  * `CONTENT:INTENT` — Registro assinado de uma intenção de modificação não-trivial.
  * `CONTENT:THEME` — Variáveis de tematização visual.
  * `CONTENT:TRANSLATION` — Dicionário de strings i18n.
* **Comportamento**: Alvos de criação (`AUTHORED`), mutação (`MUTATES`), governança (`GOVERNED_BY`) ou referência (`REPLIES_TO`, `ATTACHES`).

### 3.3 ASSET (O Valor e a Permissão)
Qualquer recurso finito, direito, saldo ou autorização no sistema.
* **Subtipos Canônicos**:
  * `ASSET:BALANCE_STATE` — Saldo consolidado (débito/crédito) em moeda interna ou fiduciária.
  * `ASSET:INVENTORY` — Estoque físico ou quantidade de SKUs.
  * `ASSET:PERMISSION` — Direito atômico de acesso e mutação, definido por query de traversal e restrições (substitui `ASSET:CAPABILITY`).
  * `ASSET:ROLE` — Cargo ou papel de negócio que agrega permissões via arestas `AGGREGATES`.
  * `ASSET:CONSENT` — Consentimentos para processamento sob a LGPD/GDPR.
  * `ASSET:LOCK` — Reserva temporária de recurso com TTL.
* **Comportamento**: Transacionados via arestas `TRANSFERRED_TO`, delegados via `DELEGATED_TO` ou concedidos via `GRANTED_TO`.

### 3.4 SPECIFICATION (A Lei)
Contratos formais imutáveis que definem regras de validação de schemas, comportamento de UI, permissões e governança.
* **Subtipos Canônicos**:
  * `SPECIFICATION:SCHEMA` — JSONSchema ou JSONLogic definindo campos obrigatórios e lógicas.
  * `SPECIFICATION:WORKFLOW` — Máquina de estados ou diagrama BPMN para processos.
  * `SPECIFICATION:NETWORK_GOVERNANCE` — Regras de bootstrap, sucessão e dissolução da rede.
* **Natureza Dual das Especificações**: Cada `SPECIFICATION` pode expressar duas naturezas (sendo ao menos uma obrigatória):
  1. **Schema Declarativo**: Define a estrutura válida (propriedades) para os nós/arestas associados.
  2. **Procedimento Executável**: Define uma transformação determinística de inputs em novos nós/arestas (Zen Engine).
* **Comportamento**: Governam nós (`GOVERNED_BY`), estendem canônicas (`EXTENDS`) e são sucedidas via `SUPERSEDED_BY`.

### 3.5 Moderação via Grupos-como-PROFILE
Para viabilizar a moderação em ambientes colaborativos sem violar a autoria individual, grupos moderados são instanciados como um **`PROFILE:ORGANIZATION`** (e não como `CONTENT`), possuindo seu próprio par de chaves criptográficas (custodiadas pelo cofre de chaves do grupo).
* **Estrutura de Postagem**: Os posts pertencem à pessoa criadora (aresta `AUTHORED`), mas indicam pertença ao grupo através de uma aresta `BELONGS_TO` apontando para o `PROFILE:ORGANIZATION` do grupo.
* **Mecânica de Moderação**: Moderadores autorizados comandam a emissão de uma lápide (tombstone com `weight = 0`) sobre a aresta `BELONGS_TO`. O post é desvinculado visualmente do feed do grupo sem que a assinatura original do autor no nó-conteúdo seja corrompida.

---

## 4. Diretrizes de Minimalismo Ontológico

A proliferação descontrolada de subtipos ou arestas fragmenta a interoperabilidade da rede. Para adicionar qualquer novo tipo ou aresta no catálogo de `SPECIFICATION`s da plataforma, todos os seguintes critérios de minimalismo devem ser satisfeitos:

1. **Diferenciação de Comportamento Sistêmico**: O novo tipo não deve servir apenas como "marcação semântica para humanos". Se dois tipos possuem regras idênticas de validação, criptografia e sincronização, eles devem ser o mesmo tipo, diferenciados apenas por payload.
2. **Impossibilidade de Resolução por Payload + SPECIFICATION**: A distinção deve ser o último recurso estrutural, não o primeiro.
3. **Existência de Arestas Exclusivas**: O tipo deve participar de pelo menos uma relação ou validação que não faça sentido para nenhum outro tipo.
4. **Reusabilidade Multidomínio**: O tipo deve ser útil em múltiplos módulos ou ser de importância crucial para um domínio central (ex: Financeiro).

### 4.1 Descoberta por Grafo (Discovery-by-Graph)
Os componentes de software devem programar comportamentos com base nas conexões e contratos do grafo, e não por comparações de strings brutas de tipos.

*❌ Código Antipatrono:*
```typescript
if (node.type === 'CONTENT:POST_BLOG' || node.type === 'CONTENT:POST_NEWS') {
  showInFeed(node);
}
```

*✅ Código Correto:*
```typescript
const isPublishable = await checkGraphRelation(node, 'GOVERNED_BY', 'SPECIFICATION:FEED_PUBLISHABLE');
if (isPublishable) {
  showInFeed(node);
}
```
