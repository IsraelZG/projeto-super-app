# 03-set-reconciliation-protocol.md — Range-Based Set Reconciliation Protocol

Este documento especifica o protocolo matemático de reconciliação de dados estruturados do grafo (nós e arestas das tabelas física `nodes` e `edges`) utilizado pela Plataforma V3.1. Este protocolo opera independentemente do Automerge Repo, que gerencia apenas documentos colaborativos.

---

## 1. Range-Based Set Reconciliation

Para sincronizar de forma eficiente conjuntos de nós e arestas entre dois peers sem transferir logs inteiros ou chaves redundantes, a plataforma adota o algoritmo de **Range-Based Set Reconciliation** executado em memória pelo Sync Worker.

### 1.1 Modelo Matemático e Fingerprints
* **Conjunto de Elementos**: Cada nó $n$ ou aresta $e$ é representado por um par $(id, signature)$, onde ambos os IDs são ULIDs ordenáveis.
* **Fingerprint**: Cada elemento possui um fingerprint de 256 bits (SHA-256 completo, sem truncamento):
  $$F(x) = \text{SHA-256}(id_x \mathbin{\Vert} \text{signature}_x)$$
  > O XOR de ranges permanece linear, mas em 256 bits a busca por colisão adversarial (forjar um conjunto cujo XOR de range iguale o do peer honesto, escondendo uma diferença) exige ~$2^{128}$ operações — vs. ~$2^{32}$ do truncamento de 64 bits. O fingerprint é determinístico e **sem nonce** no caminho rápido, preservando o cache do root fingerprint usado no anti-entropy $O(1)$ da Onda 0.
* **Fingerprint do Range**: O fingerprint de um range de elementos $[A, B]$ ordenado lexicograficamente por $id$ é o XOR cumulativo de seus fingerprints individuais:
  $$F([A, B]) = \bigoplus_{x \in [A, B]} F(x)$$
* **B-Tree em Memória**: Os Sync Workers de ambos os peers mantêm uma B-Tree em memória contendo as chaves $id$ ordenadas e seus respectivos fingerprints individuais.

### 1.2 Protocolo de Troca e Reconciliação
Quando dois peers $P_1$ e $P_2$ iniciam a reconciliação de um escopo de dados comum:
1. **Troca do Hash Raiz**: $P_1$ envia a $P_2$ o fingerprint total de todo o seu range de dados autorizado $[-\infty, +\infty]$.
2. **Avaliação de Igualdade**: Se os fingerprints coincidem ($F_1 = F_2$), os conjuntos estão sincronizados. A sessão encerra em $O(1)$.
3. **Divisão de Ranges**: Se os fingerprints diferem, o range é subdividido em sub-ranges baseados em partições equilibradas da B-Tree (ex: dividindo ao meio). Os XORs de cada sub-range são trocados.
4. **Resolução Recursiva**: As etapas de divisão e comparação repetem-se recursivamente nos sub-ranges divergentes até que os IDs específicos em falta ou com assinaturas distintas em cada peer sejam individualizados.
5. **Solicitação via REQUEST_NODES**: O peer em falta emite uma requisição cirúrgica `REQUEST_NODES` enviando os IDs divergentes identificados. O peer remoto responde com os nós/arestas completos (payloads encriptados, assinaturas e IVs).
6. **Fechamento com RangeFooter**: junto à resposta de cada range, o emissor anexa um rodapé que torna colisão/omissão adversarial detectável de forma determinística:
   ```
   RangeFooter {
     count:    uint32,    // quantidade de registros no range
     checksum: bytes32    // SHA-256(id₁ ‖ id₂ ‖ ... ‖ idₙ), IDs em ordem lexicográfica
   }
   ```
   O receptor valida `count` e `checksum`. **Se o fingerprint do range havia coincidido mas o footer diverge → colisão detectada**, e o range é re-sincronizado em modo de desafio (§1.3).

### 1.3 Rodada de Desafio com Nonce (sob suspeita)

Se um `RangeFooter` falha, ou se a `SPECIFICATION` marca o escopo como alto-risco, a re-sincronização **daquele range** usa um nonce por sessão para impedir pré-computação de fingerprints maliciosos:

$$F(\text{range}, \texttt{nonce}) = \bigoplus_{x} \text{SHA-256}(\texttt{nonce} \mathbin{\Vert} id_x \mathbin{\Vert} \text{signature}_x)$$

O nonce **não** é aplicado no caminho rápido geral (preserva a cacheabilidade de §1.1); entra apenas na rodada de desafio do range afetado. O atacante passa a precisar recalcular para cada sessão e cada peer, inviabilizando ataques pré-computados.

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

## 4. Sistema de Ondas (Waves)

A sincronização é segmentada em quatro fases para garantir fluidez da UI. A sequência é executada pelo Sync Worker em cada conexão a um swarm:

| Onda | Nome | Conteúdo | Meta de tempo |
| :--- | :--- | :--- | :--- |
| **0** | Bootstrap / Anti-Entropy | Apenas troca do root fingerprint (`F[-∞,+∞]`). Se coincidir, a sessão encerra em $O(1)$ sem nenhum dado adicional. | < 100 ms (malha quente); segundos em *cold start* (DHT + NAT traversal + handshake) |
| **1** | Prioritária | Cabeçalhos críticos e nós ligados à tela ativa do usuário. | Interativa (bloqueante para renderização) |
| **2** | Background | B-Tree completa e histórico profundo em estado **podado** (IDs, assinaturas, arestas; sem payloads pesados). | Background, não bloqueante |
| **3** | Lazy / BLOBs | Reidratação sob demanda de payloads e anexos multimídia pesados via WebTorrent. | Lazy, disparado pelo contexto de visualização |

> **Meta de 100 ms da Onda 0.** Vale apenas para o *resume* com malha já formada. No *cold start* (lookup DHT + travessia de NAT + handshake TLS) o custo total é de segundos — a Onda 0 mede apenas o RTT do fingerprint após o canal estar estabelecido.

---

## 5. Snapshots de Bootstrap

Para evitar a reconciliação sub-linear de arquivos de histórico extensos que gerariam latência excessiva no primeiro onboarding de novos peers, a plataforma adota pacotes compactados de snapshots.

* **Snapshot de Bootstrap**: É um arquivo estático compactado gerado pelo super peer ou peer do sistema que consolida as tabelas `nodes` e `edges` de um grupo/contexto específico em estado **Podado** (apenas metadados e assinaturas, sem payloads pesados ou sensíveis).
* **Uso**: No login inicial de um novo dispositivo, o Sync Worker baixa o snapshot de bootstrap do contexto (Onda 1) para obter instantaneamente a estrutura topológica das arestas. O sync incremental posterior (Onda 2 e 3) reidrata os payloads necessários via chamadas pontuais `REQUEST_NODES`.
