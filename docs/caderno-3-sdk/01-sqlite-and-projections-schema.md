# 01-sqlite-and-projections-schema.md — SQLite & Projections Schema

Este documento descreve o schema físico do banco de dados local da Plataforma V3.1 (SQLite WASM / Better-SQLite3) e as tabelas auxiliares não-replicadas mantidas por triggers de banco de dados.

---

## 1. Schema das Tabelas Replicáveis (`nodes` e `edges`)

As tabelas centrais do grafo armazenam todos os nós (substantivos) e arestas (verbos). O banco é append-only: atualizações geram novas linhas conectadas por arestas `MUTATES`.

```sql
-- Tabela física de Nós
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,            -- ULID com 11º caractere (index 10) fixado em 'N' (Node)
  entity_id TEXT NOT NULL,        -- ULID identificador estável da linhagem (11º caractere 'N')
  type TEXT NOT NULL,             -- Subtipo: "PROFILE:PERSONA", "CONTENT:DOCUMENT", etc.
  pub_key TEXT,                   -- Chave pública Ed25519 do criador (NULL se sem autoria explícita)
  payload BLOB,                   -- Payload binário encriptado com AES-256-GCM (chave de época)
  payload_iv BLOB,                -- Initialization Vector (IV) do GCM
  epoch INTEGER NOT NULL,         -- Índice da época da chave criptográfica usada
  created_at INTEGER NOT NULL,    -- Unix timestamp em ms (somente exibição / consulta temporal)
  hlc INTEGER NOT NULL,           -- Hybrid Logical Clock empacotado: (pt << 16) | c. Chave de ordenação causal.
  signature BLOB,                 -- Assinatura Ed25519 sobre o ciphertext + metadados + hlc
  retention_state TEXT NOT NULL DEFAULT 'integral'  -- 'integral' | 'pruned' | 'expunged'
);

-- Tabela física de Arestas (Relacionamentos)
CREATE TABLE edges (
  id TEXT PRIMARY KEY,            -- ULID com 11º caractere (index 10) fixado em 'E' (Edge)
  entity_id TEXT NOT NULL,        -- ULID da linhagem da aresta (11º caractere 'E')
  source_id TEXT NOT NULL,        -- ULID referenciando nodes(id) (11º caractere sempre 'N')
  target_id TEXT NOT NULL,        -- ULID polimórfico: referenciado por Virtual Foreign Key (VFK)
  type TEXT NOT NULL,             -- Subtipo: "AUTHORED", "MUTATES", "PARTICIPATES_IN", etc.
  previous_hash TEXT,             -- Hash da assinatura Ed25519 da aresta MUTATES anterior (Layer 2)
  payload BLOB,                   -- Metadados encriptados (peso, timestamps adicionais, etc.)
  payload_iv BLOB,                -- IV da encriptação do payload
  epoch INTEGER NOT NULL,         -- Índice da época da chave
  active INTEGER DEFAULT 1,       -- Estado da aresta: 1 (Ativa), 0 (Inativa / Lápide)
  created_at INTEGER NOT NULL,    -- Unix timestamp em ms (somente exibição / consulta temporal)
  hlc INTEGER NOT NULL,           -- Hybrid Logical Clock empacotado: (pt << 16) | c. Chave de ordenação causal.
  signature BLOB,                 -- Assinatura Ed25519 sobre metadados + payload encriptado + hlc
  retention_state TEXT NOT NULL DEFAULT 'integral'  -- 'integral' | 'pruned' | 'expunged' | 'orphan'
);

-- Índices de Performance
CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_pub_key ON nodes(pub_key);
CREATE INDEX idx_nodes_entity_hlc ON nodes(entity_id, hlc);  -- seleção de head em O(log n)
CREATE INDEX idx_edges_source ON edges(source_id, type);
CREATE INDEX idx_edges_target ON edges(target_id, type);
CREATE INDEX idx_edges_type ON edges(type);
CREATE INDEX idx_edges_previous_hash ON edges(previous_hash);
```

---

## 2. Decisões de Design do Schema

### 2.1 Virtual Foreign Keys (VFK) por Bitmasking de Caractere
O SQLite não oferece suporte a chaves estrangeiras polimórficas que possam apontar para tabelas distintas. No entanto, o campo `target_id` da tabela `edges` pode apontar para um nó (`nodes(id)`) ou para outra aresta (`edges(id)` - ex: aresta `WITNESSED_BY` apontando para aresta de transação).
* **Solução**: Remoção de FK física no campo `target_id` e aplicação de **Virtual Foreign Keys** pela camada do Sync Worker e TinyBase.
* **Mecanismo**: Inspeção em $O(1)$ do **11º caractere** do ULID (posição `index 10`, logo após o timestamp de 48 bits):
  * Letra **`N`**: Indica tabela `nodes`. Ex: `01J2X3Y4Z5N6Y7Z8A9BC...`
  * Letra **`E`**: Indica tabela `edges`. Ex: `01J2X3Y4Z5E6Y7Z8A9BC...`

### 2.2 Estado de Vitalidade (`active`) e Descarte do Somatório Físico
O campo `active` (anteriormente chamado de `weight`) assume uma semântica puramente de controle de estado e vitalidade de arestas.
A plataforma **não realiza o somatório de pesos de arestas (`SUM(weight)`)** para calcular saldos ou inventários locais. Como o saldo é representado por um nó físico (`ASSET:BALANCE_STATE`), o saldo vigente é obtido diretamente a partir do payload descriptografado da versão mais recente desse nó (o `head` da linhagem).
As arestas de movimentação (como `TRANSFERRED_TO`) registram apenas a causalidade e a autoria das transações. Seus volumes financeiros ficam criptografados com segurança dentro de seus payloads individuais, eliminando qualquer vazamento de privacidade na camada de banco de dados plano.

### 2.3 Ausência de `updated_at`
Como a plataforma é estritamente append-only, modificações nunca disparam comandos `UPDATE` nas linhas replicáveis. Alterações geram novas linhas com novos `id`s vinculados por arestas `MUTATES` compartilhando o mesmo `entity_id`.
O `hlc` é atribuído no momento da criação da linha, é imutável e coberto pela assinatura. Ele — e não o `created_at` — é a chave canônica de ordenação causal entre versões e entre linhagens. O `created_at` permanece apenas para exibição e consultas por janela temporal (ex.: Onda 1, "últimos 30 dias").

---

## 3. Projeções Estruturais Locais (Não-Replicadas)

Para garantir reatividade em $O(1)$ da interface de usuário, triggers locais interceptam inserções nas tabelas físicas e populam tabelas auxiliares que **nunca são sincronizadas via P2P/WebRTC**.

### 3.1 Tabela `entity_heads`
Aponta para o nó-versão vigente (`head_id`) de cada linhagem de entidade (`entity_id`). Elimina a necessidade de varredura recursiva de Linhagem de Versões em tempo de renderização.

```sql
CREATE TABLE entity_heads (
  entity_id TEXT PRIMARY KEY,
  head_id TEXT NOT NULL,
  type TEXT NOT NULL,
  head_hlc INTEGER NOT NULL,   -- HLC do head vigente (ordena a linhagem topologicamente)
  FOREIGN KEY (head_id) REFERENCES nodes(id)
);
```

#### Trigger do SQLite para Atualização:
```sql
-- Head = nó-versão de MAIOR HLC da linhagem.
-- Correto porque a invariante de monotonicidade de pai (caderno-2/02 §3.5) garante
-- HLC(filho) > HLC(pai). Logo o maior HLC é sempre a ponta (tip) da linhagem; em fork,
-- é o desempate determinístico até o nó de merge chegar (merge tem HLC > ambos os ramos
-- e assume a cabeça naturalmente). Como ON CONFLICT mantém o máximo, o resultado independe
-- da ordem de chegada dos nós no sync P2P.
CREATE TRIGGER trg_nodes_insert_entity_head
AFTER INSERT ON nodes
BEGIN
  INSERT INTO entity_heads (entity_id, head_id, type, head_hlc)
  VALUES (NEW.entity_id, NEW.id, NEW.type, NEW.hlc)
  ON CONFLICT(entity_id) DO UPDATE SET
    head_id  = CASE WHEN NEW.hlc > excluded.head_hlc THEN NEW.id  ELSE head_id  END,
    head_hlc = CASE WHEN NEW.hlc > excluded.head_hlc THEN NEW.hlc ELSE head_hlc END;
END;
```

### 3.2 Tabela `active_edges`
Contém os relacionamentos vigentes do grafo. Arestas revogadas (recebimento de aresta lápide com `active = 0`) são limpas da tabela pelo trigger, fornecendo um read model limpo do grafo social.

```sql
CREATE TABLE active_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  active INTEGER,
  created_at INTEGER NOT NULL
);
```

### 3.3 Tabela `asset_balances`
Tabela reativa que armazena os saldos consolidados de ativos. Ela é populada e atualizada reativamente na Thread de UI ou pelo Sync Worker sempre que o nó `ASSET:BALANCE_STATE` da linhagem correspondente é descriptografado e atualizado (através de triggers de aplicação sobre a tabela `entity_heads`), eliminando a necessidade de triggers de agregação física baseados em somatórios de arestas.

### 3.4 Tabela `local_permissions`
Materializa as permissões atualmente delegadas e válidas para o usuário do dispositivo local, calculadas a partir das arestas de delegação/composição e resoluções de pré-requisitos (`ASSET:PERMISSION` $\rightarrow$ `ASSET:PERMISSION`).

```sql
CREATE TABLE local_permissions (
  permission_id TEXT PRIMARY KEY,   -- ID da permissão atômica (ASSET:PERMISSION)
  entity_id TEXT NOT NULL,          -- entity_id estável do recurso associado
  persona_id TEXT NOT NULL,         -- PROFILE:PERSONA portadora do direito
  root_node_id TEXT,                -- Raiz autorizada da traversal query
  depth INTEGER DEFAULT 6,          -- Profundidade máxima de traversal (limite 6)
  direction TEXT,                   -- 'outbound' | 'inbound' | 'bidirectional'
  prerequisite_satisfied BOOLEAN NOT NULL DEFAULT 1, -- 0 se houver aresta REQUIRES não atendida
  expires_at INTEGER                -- Expirabilidade da permissão/role associada
);
```

#### Mecânica de Gatilho e Prerequisitos:
Ao inserir arestas `REQUIRES` (`ASSET:PERMISSION` $\rightarrow$ `ASSET:PERMISSION`), triggers locais recalculam se as permissões dependentes possuem a totalidade de seus requisitos satisfeitos:
1. Se uma permissão $A$ requer $B$ (`A REQUIRES B`), e $B$ não está presente no dispositivo local em `local_permissions`, a permissão $A$ é registrada com `prerequisite_satisfied = 0`.
2. Assim que a permissão $B$ é inserida, um trigger propaga a atualização definindo `prerequisite_satisfied = 1` para a permissão $A$.
3. Chamadas de sistema impedem a execução de mutações ou queries recursivas cuja permissão correspondente tenha `prerequisite_satisfied = 0`.

---

## 4. Índices de Texto (FTS5) e Busca Espacial (R*Tree)

Para viabilizar pesquisas por autocomplete e raio espacial sem vazar payloads descriptografados em arquivos desprotegidos:

* **Índice FTS5 local (`search_index_fts`)**: Preenchido apenas para campos marcados como `searchable: true` pela `SPECIFICATION` do nó no momento em que o payload é descriptografado pelo Crypto Worker.
* **Índice R*Tree local (`geo_index`)**: Permite buscas espaciais baseadas em coordenadas geográficas de texto plano para módulos com suporte geolocalizado.
* **Segurança do Índice**: Os arquivos dessas tabelas auxiliares são criptografados localmente no dispositivo via **Chave do Dispositivo**, sendo descriptografados na RAM durante a sessão ativa.
