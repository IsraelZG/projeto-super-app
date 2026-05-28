# 03-set-reconciliation-protocol.md — Range-Based Set Reconciliation Protocol

Este documento especifica o protocolo matemático de reconciliação de dados estruturados do grafo (nós e arestas das tabelas física `nodes` e `edges`) utilizado pela Plataforma V3.1. Este protocolo opera independentemente do Automerge Repo, que gerencia apenas documentos colaborativos.

---

## 1. Range-Based Set Reconciliation

Para sincronizar de forma eficiente conjuntos de nós e arestas entre dois peers sem transferir logs inteiros ou chaves redundantes, a plataforma adota o algoritmo de **Range-Based Set Reconciliation** executado em memória pelo Sync Worker.

### 1.1 Modelo Matemático e Fingerprints
* **Conjunto de Elementos**: Cada nó $n$ ou aresta $e$ é representado por um par $(id, signature)$, onde ambos os IDs são ULIDs ordenáveis.
* **Fingerprint**: Cada elemento possui um fingerprint de 64 bits calculado como:
  $$F(x) = \text{Truncate}_{64}(\text{SHA-256}(id_x \mathbin{\Vert} \text{signature}_x))$$
* **Fingerprint do Range**: O fingerprint de um range de elementos $[A, B]$ ordenado lexicograficamente por $id$ é o XOR cumulativo de seus fingerprints individuais:
  $$F([A, B]) = \bigoplus_{x \in [A, B]} F(x)$$
* **B-Tree em Memória**: Os Sync Workers de ambos os peers mantêm uma B-Tree em memória contendo as chaves $id$ ordenadas e seus respectivos fingerprints individuais.

### 1.2 Protocolo de Troca e Reconciliação
Quando dois peers $P_1$ e $P_2$ iniciam a reconciliação de um escopo de dados comum:
1. **Troca do Hash Raiz**: $P_1$ envia a $P_2$ o fingerprint total de todo o seu range de dados autorizado $[-\infty, +\infty]$.
2. **Avaliação de Igualdade**: Se os fingerprints coincidem ($F_1 = F_2$), os conjuntos estão sincronizados. A sessão encerra em $O(1)$.
3. **Divisão de Ranges**: Se os fingerprints diferem, o range é subdividido em sub-ranges baseados em partições equilibradas da B-Tree (ex: dividindo ao meio). Os XORs de cada sub-range são trocados.
4. **Resolução Recursiva**: As etapas de divisão e comparação repetem-se recursivamente nos sub-ranges divergentes até que os IDs específicos em falta ou com assinaturas distintas em cada peer sejam individualizados.
5. **Solicitação via REQUEST_NODES**: O peer em falta emite uma requisição cirúrgica `REQUEST_NODES` enviando os IDs divergentes identificados. O peer remoto responde com os nós/arestas completos ( payloads encriptados, assinaturas e IVs).

---

## 2. Sync Dirigido por Permissions e UCAN

Diferente de barramentos de Pub/Sub tradicionais, a plataforma **não possui canais globais ou tópicos de sincronização corporativos**.

* **Filtragem por UCAN**: Ao iniciar a sincronização, o Sync Worker local lê o token UCAN de autorização ativo, extrai a query de traversal (que define `root`, `depth`, `direction` e filtros de arestas/nós da `ASSET:PERMISSION` correspondente) e a injeta como uma restrição de filtragem na consulta recursiva (Common Table Expressions - CTE) local do SQLite. Isso garante que a B-Tree de sincronização e seus respectivos fingerprints de ranges sejam calculados e expostos exclusivamente sobre o subgrafo explicitamente autorizado.
* **Execução Restrita**: A troca de XORs de ranges da B-Tree ocorre estritamente nos escopos autorizados comuns. Um peer sem um UCAN ativo contendo permissão de acesso sobre um subgrafo nunca receberá, transmitirá ou verificará fingerprints de ranges pertencentes a esse subgrafo, blindando metadados na camada de transporte.

---

## 3. Replicação Coordenada e Replication Factor

A disponibilidade de dados do grafo é mantida por meio de diferentes estratégias de replicação com base nas Modalidades de Rede:

### 3.1 P2P Puro: Replication Factor por Gossip
* **Replication Factor ($N$)**: Cada nó ou aresta deve estar replicado de forma integral em pelo menos $N$ dispositivos do grupo (default: $N=3$).
* **Gossip de Poda**: Antes de um peer podar localmente o payload de um nó (transição Integral $\rightarrow$ Podado), ele executa uma verificação rápida via protocolo de gossip no grupo. Se menos de $N-1$ peers ativos confirmarem que possuem o nó em estado Integral, a poda local é adiada para evitar perda de dados.

### 3.2 Corporativo: Coordenador no Super Peer
* **Super Peer Garantidor**: O super peer corporativo mantém e sincroniza 100% de todo o grafo em estado Integral.
* **Manifesto de Retenção**: O super peer atua como coordenador lógico, emitindo instruções de sincronização baseadas em pesos dinâmicos dos nós (relevância de data, frequência de leitura, prioridade de cargo). Dispositivos de menor capacidade realizam podas agressivas autorizadas pelo manifesto do super peer.

### 3.3 Pública: Sharding Determinístico por Consistent Hashing
* **Mapeamento de Faixa**: Cada nó possui um ID hash. Peers ativos no grupo dividem a responsabilidade de armazenamento de faixas de hashes baseados em um algoritmo de consistent hashing.
* **Resiliência**: O peer do sistema da rede pública garante redundância mantendo o grafo integral como fallback definitivo de bootstrap.

---

## 4. Snapshots de Bootstrap

Para evitar a reconciliação sub-linear de arquivos de histórico extensos que gerariam latência excessiva no primeiro onboarding de novos peers, a plataforma adota pacotes compactados de snapshots.

* **Snapshot de Bootstrap**: É um arquivo estático compactado gerado pelo super peer ou peer do sistema que consolida as tabelas `nodes` e `edges` de um grupo/contexto específico em estado **Podado** (apenas metadados e assinaturas, sem payloads pesados ou sensíveis).
* **Uso**: No login inicial de um novo dispositivo, o Sync Worker baixa o snapshot de bootstrap do contexto (Onda 1) para obter instantaneamente a estrutura topológica das arestas. O sync incremental posterior (Onda 2 e 3) reidrata os payloads necessários via chamadas pontuais `REQUEST_NODES`.
