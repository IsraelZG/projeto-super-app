# RFC — Camada de Transporte P2P e Malha de Reconciliação (Plataforma V3.1)

> **Status:** Proposta Consolidada (substitui a RFC de Transporte V3)
> **Escopo:** Camada de transporte, descoberta, reconciliação de conjuntos e ciclo de vida do swarm. **Não** cobre ontologia do grafo, modelo de chaves de conteúdo, eleição de committer de documentos colaborativos nem governança de validação — esses residem nos cadernos 2, 3 e 4 e são referenciados onde a fronteira é tocada (ver Apêndice A).
> **Convenção de leitura:** o documento aprofunda progressivamente. **§1 Visão** é para liderança de produto e arquitetura; **§2 Protocolo** é para engenheiros de protocolo; **§3 SDK** é para desenvolvedores de cliente; **§4 Governança** é para fundadores e operadores de rede.

---

## §1 — Visão (Liderança de Produto & Arquitetura)

### 1.1 Objetivo

Esta camada viabiliza um ecossistema de dados distribuído com filosofia **Local-First**, capaz de operar em modo **P2P oportunístico** (ou **P2P puro**, na modalidade que assim o exigir): descoberta de pares, sincronização de estado relacional complexo e transporte de arquivos pesados (BLOBs) sem dependência estrita de servidores centrais, preservando bateria e conexões de nós leves.

O transporte é tratado como uma **entidade autogerida separada dos peers**. Ao consentir com os termos da plataforma — mesmo em rede P2P pura — o peer concorda em dedicar parte de seus recursos (armazenamento, banda, uplink) à comunidade. A plataforma faz a autogestão desses recursos com base em telemetria de rede, ranking e score de cada peer, podendo fixar dados em peers específicos automaticamente. O peer é um nó de uma malha gerida, não um voluntário isolado.

### 1.2 Pragmatismo Topológico

O sistema é P2P-*first*, não P2P-purista. Forma malhas descentralizadas sempre que possível, mas usa instâncias de maior capacidade (Desktops, Super Peers, Cloud) de forma transparente para superar restrições físicas de rede (NATs, firewalls) e garantir disponibilidade. Centralizar onde a centralização serve melhor não torna o sistema "menos P2P" — torna-o honesto sobre o que cada topologia oferece. A escolha é decisão de `SPECIFICATION` da rede, não dogma da plataforma.

### 1.3 Honestidade Radical Aplicada ao Transporte

Limitações inerentes ao paradigma são declaradas, não escondidas. Em particular, esta RFC assume explicitamente três verdades desconfortáveis:

1. **Travessia de NAT simétrico falha com frequência.** Hole punching via STUN não resolve NAT simétrico de forma confiável; nesse caso o relay (TURN-like) **permanece** sendo o caminho, e a promoção para conexão direta só se concretiza nos casos não-simétricos. O sistema não promete uma malha 100% direta.
2. **Identidade é barata de criar, mas o acesso não é livre.** Derivar o `PeerId` da chave pública impede *spoofing*, mas **não** confere resistência a Sybil por si só. A resistência a Sybil vem do **custo de criação de identidade e do modelo de acesso por convite / web-of-trust** (§1.4), não da função de hash.
3. **A rede transacional tem liveness condicionada.** Operações não-comutativas dependem de validadores ativos. Sem eles, a rede **congela em read-only** — um *freeze* seguro, não um *crash* (§4.6).

### 1.4 Acesso por Convite e Web-of-Trust

Mesmo em P2P puro, a rede **não é, por padrão, de livre acesso**. A plataforma incentiva modelos de acesso por convite que formam uma **web-of-trust**: um novo `PeerId` entra na malha apresentando uma cadeia de credenciais (UCAN) emitida por quem já pertence. A criação de identidade tem custo deliberado (prova de trabalho leve, convite assinado, ou provisionamento corporativo, conforme a modalidade). Isso transforma um ataque Sybil de "gratuito e ilimitado" em "caro e rastreável", e dá ao mecanismo de eleição de emergência (§4.6) uma base de contagem de peers que não é trivialmente inflável.

### 1.5 As Três Modalidades e o Transporte

| Modalidade | Disponibilidade de dados | Travessia/Relay | Custódia |
| :--- | :--- | :--- | :--- |
| **P2P Puro** | Replication factor por gossip ($N$ peers) | Relays entre peers, sem garantia central | Anel de custódia distribuído (§4.2) |
| **Corporativa** | Super Peer mantém 100% íntegro | Super Peer como relay garantidor | Manifesto de retenção do Super Peer |
| **Pública** | Sharding determinístico (consistent hashing) + peer de sistema como fallback | Mix de relays e peer de sistema | Anel de custódia + fallback de sistema |

---

## §2 — Protocolo (Engenheiros de Protocolo)

### 2.1 Stack de Transporte

A camada de rede orquestra tecnologias especialistas em vez de um protocolo monolítico:

- **Storage local & grafo:** SQLite (fonte da verdade semântica e criptográfica).
- **Malha de roteamento e gossip:** Automerge Repo, usado **estritamente** por seus *Network Adapters* e pelo canal de *Ephemeral Messages* de baixa latência (não como armazenamento de CRDT do grafo).
- **Descoberta de swarms:** Mainline DHT (Kademlia) customizável via UDP, combinada com mDNS para LAN.
- **Sinalização WebRTC e túneis:** WebSockets e STUN integrados.
- **Transporte de BLOBs:** protocolo WebTorrent/BitTorrent isomórfico, isolado do grafo (§3.3).

### 2.2 Identidade Criptográfica Determinística

O identificador de rede de um usuário (`PeerId`) não é aleatório:

$$\text{PeerId} = \text{blake2s256}(\texttt{PROFILE:PERSONA\_PUB\_KEY})$$

Por ser derivado da chave pública Ed25519, o `PeerId` é **auto-certificável**: uma conexão entrante pode ser ligada matematicamente à sua chave, e o handshake de socket exige um **desafio-resposta** que prova posse da chave privada antes de qualquer troca de dados. Isso elimina *spoofing* de identidades existentes.

> **Importante — fronteira de segurança.** Auto-certificação resolve *spoofing*, não *Sybil*. A resistência a Sybil é responsabilidade do modelo de acesso (§1.4) e da contagem de peers ponderada por score (§4.1), **não** desta derivação.

#### 2.2.1 — Handshake Concreto: Noise Protocol Framework

O handshake de autenticação adota o Noise Protocol Framework, padrão **Noise_XX**:

1. O Noise_XX roda **após** o estabelecimento do WebRTC Data Channel (SDP exchange concluído), utilizando o data channel como transporte subjacente.
2. O handshake ocorre em **3 round-trips**, trocando:
   - `PeerId` = `blake2s256(PROFILE:PERSONA_PUB_KEY)`
   - `current_epoch_index` (índice da época criptográfica vigente)
   - Nonce assinado com a chave privada Ed25519
3. **Validação precoce de época:** Se o `current_epoch_index` trocado durante o Noise_XX divergir entre os peers, a conexão **não é descartada** — o data channel é imediatamente desviado para o pipeline de **Catch-up de Identidades (Onda 0)**, forçando a sincronização de chaves e UCANs atualizados antes de qualquer tráfego de domínio.
4. Concluído o Noise_XX com épocas alinhadas, o peer é registrado como **"conectado"** no SwarmRegistry.
5. Falhas criptográficas (assinatura inválida, chave incorreta) resultam em **shadowban de 24h** no RelayTrustModel do peer local.

> **Nota:** Noise_XX foi escolhido por ser o padrão de autenticação mútua do ecossistema libp2p, com implementações disponíveis em WASM (browser) e nativo (Electron/Node). A implementação de referência é `@noise-crypto/noise` ou `noise-c.wasm`.

### 2.3 Documentos Casca (Rendezvous) Derivados de Capability

A formação da malha WebRTC é orquestrada pelo Automerge Repo via "Documentos Casca" — salas de encontro em RAM, sem histórico de CRDT. O identificador do rendezvous **não** deve ser derivado de IDs previsíveis/enumeráveis (o que permitiria a qualquer um adivinhar a sala e vazar metadados de interesse). Em vez disso, deriva-se de um segredo de capability:

$$\text{RendezvousId} = \text{SHA-256}(\texttt{rendezvous\_secret} \mathbin{\Vert} \texttt{ASSET:PERMISSION\_ID})$$

onde `rendezvous_secret` é distribuído apenas a quem possui o UCAN correspondente. Conhecer o `PERMISSION_ID` sozinho não basta para entrar na sala. Ao conectar-se ao hash, o Automerge forja túneis WebRTC/WebSocket multiplexados entre os interessados daquele swarm.

### 2.4 Bootstrap Híbrido

O cliente não assume IPs estáticos. A ordem de tentativa é:

1. **LAN (mDNS):** localiza peers no segmento local.
2. **WAN (DHT Kademlia privada ou trackers):** consulta pelo hash de contexto.
3. **Fallback:** conecta-se à infraestrutura Cloud ou a um Super Peer via WebSocket.

### 2.5 Topologia Dinâmica e Travessia de NAT

#### 2.5.1 Promoção de Conexões (`ConnectionPromotionEngine`)

- **Nós leves (Mobile/Web):** não atuam como roteadores públicos; conectam-se preferencialmente ancorados, para poupar bateria e conexões restritas.
- **Super Peers (Desktop/Electron e Cloud):** atuam como **Relays de Circuito**. Se um Webapp não fala diretamente com um Mobile por NAT simétrico, ambos trafegam por um Desktop conectado a ambos.
- **Promoção oportunística:** em background, a engine tenta perfurar o NAT (STUN/hole punching). **Quando o NAT permite** (cone restrito/completo), a rota direta é confirmada e o fluxo migra do relay para o canal P2P direto de forma imperceptível. **Em NAT simétrico, a promoção tipicamente não ocorre e o relay permanece** — isso é esperado, não uma falha.

#### 2.5.2 Modelo de Confiança de Relays (`RelayTrustModel`)

Cada peer mantém um score local de seus relays baseado em uptime, latência e pacotes descartados. Relays com desempenho suspeito recebem **banimento silencioso local** (*shadowban*), forçando o `SwarmRegistry` a rotear por outros caminhos. Para mitigar falso-positivo (relay congestionado ≠ relay malicioso) e *badmouthing*, o score é **local e não-transitivo** (um peer nunca propaga reputação de relay como fato para outros) e usa janela deslizante com histerese antes do shadowban.

### 2.6 Reconciliação de Conjuntos (Range-Based Set Reconciliation)

A sincronização **não transfere bancos inteiros**: compara o estado local e busca apenas o delta. Opera sobre as tabelas físicas `nodes` e `edges`, independentemente do Automerge Repo.

#### 2.6.1 Fingerprints (256 bits, sem truncamento)

Cada elemento (nó $n$ ou aresta $e$) é o par $(id, signature)$, com `id` em ULID ordenável. O fingerprint individual é o SHA-256 **completo** (256 bits), e o fingerprint de um range $[A,B]$ ordenado lexicograficamente por `id` é o XOR cumulativo:

$$F(x) = \text{SHA-256}(id_x \mathbin{\Vert} \text{signature}_x)$$
$$F([A,B]) = \bigoplus_{x \in [A,B]} F(x)$$

O XOR continua linear, mas em **256 bits** a busca por colisão adversarial (forjar um conjunto cujo XOR de range iguale o do peer honesto, escondendo uma diferença) exige $\sim 2^{128}$ operações — computacionalmente inviável. Isso eleva a margem de $O(2^{32})$ (do antigo fingerprint truncado de 64 bits) para $O(2^{128})$.

> **Cacheabilidade.** O fingerprint de 256 bits é determinístico e **não** carrega nonce no caminho rápido, preservando o cache do *root fingerprint* usado no anti-entropy $O(1)$ da Onda 0 (§2.8). O nonce é reservado para rodadas de desafio (§2.6.3).

#### 2.6.2 Protocolo de Troca

Quando dois peers $P_1$ e $P_2$ reconciliam um escopo comum:

1. **Hash raiz:** $P_1$ envia o fingerprint total de seu range autorizado $[-\infty, +\infty]$.
2. **Igualdade:** se $F_1 = F_2$, os conjuntos coincidem; a sessão encerra em $O(1)$.
3. **Divisão:** se diferem, o range é subdividido em sub-ranges equilibrados da B-Tree; os XORs de cada sub-range são trocados.
4. **Recursão:** divide-e-compara até isolar os `id`s divergentes (ausentes ou com assinatura distinta).
5. **`REQUEST_NODES`:** o peer em falta solicita cirurgicamente os `id`s divergentes; o remoto responde com nós/arestas completos (payload cifrado, assinatura, IV).

#### 2.6.3 Fechamento de Range (`RangeFooter`) — defesa-em-profundidade

Quando um range divergente é isolado e transferido, ele é acompanhado de um rodapé que torna a colisão adversarial **detectável de forma determinística**, mesmo que (hipoteticamente) o fingerprint coincidisse por acidente ou ataque:

```
RangeFooter {
  count:    uint32,    // quantidade de registros no range
  checksum: bytes32    // SHA-256(id₁ ‖ id₂ ‖ ... ‖ idₙ), ordem lexicográfica
}
```

O receptor valida: recebeu `count` registros? O *rolling hash* dos IDs confere? **Se o fingerprint bateu mas o footer diverge → colisão/omissão detectada**, e o range é re-sincronizado em modo de desafio.

#### 2.6.4 Rodada de Desafio com Nonce (sob suspeita)

Se um `RangeFooter` falha, ou se uma `SPECIFICATION` marca o escopo como alto-risco, a re-sincronização daquele range usa um nonce por sessão para impedir pré-computação de fingerprints maliciosos:

$$F(\text{range}, \texttt{nonce}) = \bigoplus_{x} \text{SHA-256}(\texttt{nonce} \mathbin{\Vert} id_x \mathbin{\Vert} \text{signature}_x)$$

O nonce **não** é aplicado no caminho rápido geral (preservando o cache do §2.6.1); ele só entra na rodada de desafio do range afetado.

### 2.7 Sync Dirigido por Permissions (UCAN)

Não há canais globais nem tópicos corporativos de sync. Ao iniciar, o Sync Worker lê o UCAN ativo, extrai a *query de traversal* (`root`, `depth ≤ 6`, `direction`, filtros de arestas/nós) e a injeta como restrição na CTE recursiva do SQLite. Assim, a B-Tree e seus fingerprints são calculados **exclusivamente** sobre o subgrafo autorizado.

> **Enforcement bilateral.** A validação é feita pelo lado que **fornece** o dado: ele valida assinaturas e cadeia de delegação do UCAN anexado à requisição antes de servir qualquer delta. Um peer sem UCAN ativo sobre um subgrafo **nunca** recebe, transmite ou verifica fingerprints daquele subgrafo — blindando metadados na camada de transporte.

### 2.8 Sistema de Ondas (Waves)

A sincronização é segmentada para fluidez de UI:

- **Onda 0 (Bootstrap, < 100 ms *em malha quente*):** apenas troca do root fingerprint (anti-entropy $O(1)$). Em *cold start* (lookup DHT + travessia de NAT + handshake) o custo é de segundos, não de ms — a meta de 100 ms vale para o resume com malha já formada.
- **Onda 1 (Prioritária):** cabeçalhos críticos e nós ligados à tela ativa.
- **Onda 2 (Background):** B-Tree e histórico profundos, em estado **podado** (IDs, assinaturas, arestas; sem payloads pesados).
- **Onda 3 (Lazy/BLOBs):** reidratação sob demanda de payloads e anexos pesados via Graph-Based Routing.

### 2.9 Wire Protocol Consciente de Época e Relógio (Epoch + HLC)

Todo pacote de domínio carrega dois carimbos de ordenação no envelope **assinado**:

1. **`current_epoch_index`** — índice da chave criptográfica vigente. Se houver *drift* temporal (a permissão de um peer expirar/rotacionar durante a transferência), a conexão interrompe o RBSR com `STALE_EPOCH`, forçando o *catch-up* de identidades antes de enviar dados de domínio potencialmente não-legíveis.
2. **`hlc = (pt, c)`** — carimbo de Hybrid Logical Clock (componente físico `pt` em ms + contador lógico `c`). O transporte é responsável por **transmitir** e **validar** o HLC; a lógica de seleção de head e de merge de fork vive no caderno de protocolo do grafo (Apêndice A). Regras de validação na recepção:
   - **Monotonicidade de linhagem:** um nó que faz `MUTATES` de um pai $P$ é rejeitado como malformado se $\text{HLC}(\text{filho}) \le \text{HLC}(P)$.
   - **Limite de drift:** se `pt_remoto > wall_clock_local + MAX_DRIFT` (ex.: 5 min), o valor **não** é adotado no `max` do relógio local e o nó é posto em quarentena até entrar na janela. Isso limita o ataque de "HLC futuro-distante" a `MAX_DRIFT`, em vez de poluir o relógio de toda a malha.

> O algoritmo de atualização do HLC (eventos local/envio/recepção) e a função de ordem total são especificados no caderno de protocolo (Apêndice A, item 2). O transporte apenas serializa o par `(pt, c)` e aplica as duas regras de validação acima.

### 2.10 — Modelo de Dados e Concorrência

O grafo da Plataforma V3 segue o modelo event-sourcing (append-only). Nenhum registro em `nodes` ou `edges` é atualizado in-place; toda modificação gera novas linhas conectadas via arestas.

#### 2.10.1 — Imutabilidade e Linhagem

- Registros em `nodes` e `edges` são imutáveis após escritos.
- Atualizações lógicas são representadas por uma aresta `MUTATES` que aponta da nova versão para a versão anterior, formando uma cadeia de linhagem.
- O HLC (Hybrid Logical Clock) ordena eventos dentro de um peer, mas não detecta concorrência entre peers. A detecção de bifurcação (fork) é estrutural: existe fork quando duas ou mais arestas `MUTATES` ativas compartilham o mesmo `source_id` e nenhuma é ancestral da outra.

#### 2.10.2 — Resolução de Forks

Quando um fork é detectado estruturalmente:

1. O mergeador — idealmente `PROFILE:SYSTEM` ou, na ausência deste, o peer de menor `entity_id` ativo no ciclo — identifica ambas as pontas do fork.
2. O mergeador cria um nó de merge que contém duas arestas `MUTATES`: uma apontando para cada ponta do fork.
3. O merge é registrado como dado append-only no grafo. Ambos os caminhos divergentes permanecem imutáveis e auditáveis; o nó de merge é o novo estado convergente.
4. Quando a partição de rede que originou o fork é reconciliada, o lado que não presenciou o merge simplesmente recebe o nó de merge via RBSR, sem necessidade de reconciliação adicional.

> **Nota:** O critério determinístico de eleição (menor `entity_id`) garante que, mesmo sob partição, ambos os lados concordam sobre quem deveria executar o merge — embora apenas um lado tenha o peer eleito disponível naquele momento. Quando a partição é curada, o merge já existe em um lado e é sincronizado para o outro.

#### 2.10.3 — Deleções (Tombstones)

No modelo append-only, deleção não remove registros fisicamente. O protocolo:

- Uma deleção é representada marcando a aresta como inativa (`active = 0` / lápide).
- Isto aciona um trigger local que remove a relação da projeção de leitura `active_edges`, tornando o registro invisível para consultas da aplicação.
- O registro original e a lápide permanecem no grafo para fins de auditabilidade.
- A coleta de tombstones expirados é tratada pelo Garbage Collection (G4 — §4.5), que pode podar registros marcados como inativos há mais de N ciclos de auditoria, desde que respeitados os requisitos de retenção legal de cada modalidade.

### 2.11 — Matriz de Classificação de Transporte (As 3 Perguntas)

O destino físico, o protocolo de rede e a criptografia de um dado não são escolhas arbitrárias. Eles são determinados pelas respostas às 3 perguntas fundamentais de modelagem:

1. **Outro peer precisa observar este estado?**
2. **A integridade histórica deste estado precisa ser auditada?**
3. **O estado precisa sobreviver ao encerramento da sessão?**

O cruzamento dessas respostas dita o comportamento exato na camada de transporte:

| Q1 (Ver) | Q2/Q3 | Classificação Lógica | Destino Físico | Transporte / Sync | Cifra |
| :--- | :--- | :--- | :--- | :--- | :--- |
| SIM | (Q2) SIM | Replicável + Auditável | `nodes`/`edges` (SQLite) | RBSR (Onda 1/2) | Chave de Época |
| SIM | (Q2) NÃO | Replicável + Não-Auditável | `pending_changes` (RAM→RAM) | Ephemeral Msg (WebRTC) | Chave de Época |
| NÃO | (Q3) SIM | Local + Persistente (mesmo usuário) | OPFS isolado (`user_local.db`) | Private Swarm (Túnel dedicado, §4.7) | Chave do Dispositivo (HKDF) |
| NÃO | (Q3) NÃO | Local + Transiente / Efêmero | TinyBase / RAM | Nenhum (não trafega) | N/A |

**Exemplos de Enquadramento:**

| Classificação | Exemplo |
| :--- | :--- |
| Replicável + Auditável | `ASSET:BALANCE_STATE`, Documento Automerge pós-commit |
| Replicável + Não-Auditável | Digitação em tempo real (Changes), posições de cursor |
| Local + Persistente (mesmo usuário) | Rascunhos não publicados, cache de prefetch, preferências de UI |
| Local + Transiente / Efêmero | Estado de rolagem, abas abertas, heartbeat, indicador de "digitando" |

**Transições de Estado:**

A camada de aplicação pode promover dados entre classificações. Uma edição colaborativa em tempo real começa como "Local + Persistente" (rascunho não publicado) ou "Replicável + Não-Auditável" (cursor, changes trafegando via WebRTC). Quando o gatilho de inatividade ou consolidação dispara, o validador promove o dado a "Replicável + Auditável", inserindo um nó no grafo e adicionando-o à B-Tree do RBSR.

```
┌──────────────────┐       ┌──────────────────────┐       ┌─────────────────────┐
│ Local +           │  ──►  │ Replicável +          │  ──►  │ Replicável +         │
│ Persistente       │       │ Não-Auditável         │       │ Auditável            │
│ (Rascunho)        │       │ (digitação ao vivo)   │       │ (documento salvo)    │
│ Private Swarm     │       │ Ephemeral WebRTC      │       │ RBSR Onda 1/2        │
└──────────────────┘       └──────────────────────┘       └─────────────────────┘
```

#### 2.11.1 — Inversão de Controle e Roteamento (Implementação)

A classificação detalhada acima não deve ser invocada manualmente pelo desenvolvedor de front-end durante a submissão de dados. A arquitetura adota a **Inversão de Controle**: o desenvolvedor declara as leis do dado, e a infraestrutura deduz o roteamento de forma transparente.

**1. A Declaração na SPECIFICATION:**
Quem responde às três perguntas é o criador do módulo de negócio, diretamente no payload da `SPECIFICATION` que governa o nó. A UI não sabe sobre transporte.

Exemplo de declaração no schema:
`yaml
specification:
  type: "SPECIFICATION:DOCUMENT_DRAFT"
  transport_hints:
    observable_by_peers: false
    is_auditable: false
    survives_disconnection: true
`

**2. O Fluxo de Roteamento Arquitetural:**
Quando uma ação ocorre na UI, o sistema segue um fluxo estrito de 5 etapas:
1. **Intenção (UI):** O componente visual dispara uma mutação genérica no cache em RAM (TinyBase).
2. **Interceptação (Ponte Reativa):** O *Persister* intercepta a intenção e verifica o `type` do nó.
3. **Consulta à Lei:** O sistema busca a `SPECIFICATION` associada e extrai os `transport_hints`.
4. **Classificação Estrita:** As flags são passadas para o classificador interno do Sync Worker, que retorna um tipo algébrico (*Discriminated Union*) blindando o destino físico contra protocolos incompatíveis.
5. **Execução:** O Sync Worker despacha os bytes para a fila de SQLite ou WebRTC correspondente.

**3. O Contrato de Tipos (TypeScript):**
Para evitar que dados com configurações incompatíveis sejam processados, o núcleo de domínio define as regras de roteamento através da seguinte estrutura:

`typescript
// Tipagem garantindo que Destino e Protocolo andem sempre juntos
type TransportBehavior =
  | { 
      category: 'REPLICABLE_AUDITABLE'; 
      destination: 'sqlite_nodes_edges'; 
      protocol: 'RBSR'; 
      requiresLineage: true;
    }
  | { 
      category: 'REPLICABLE_VOLATILE'; 
      destination: 'sqlite_pending_changes'; 
      protocol: 'EPHEMERAL_WEBRTC'; 
      requiresLineage: false;
    }
  | { 
      category: 'LOCAL_PERSISTENT'; 
      destination: 'sqlite_user_local'; 
      protocol: 'PRIVATE_SWARM'; 
      requiresLineage: false;
    }
  | { 
      category: 'LOCAL_TRANSIENT'; 
      destination: 'ram_tinybase'; 
      protocol: 'NONE'; 
      requiresLineage: false;
    };

// A função pura de avaliação executada pela infraestrutura
function evaluateTransportHints(
  isObservableByOtherPeers: boolean, 
  isAuditable: boolean, 
  mustSurviveDisconnection: boolean
): TransportBehavior {
  
  if (isObservableByOtherPeers) {
    return isAuditable 
      ? { category: 'REPLICABLE_AUDITABLE', destination: 'sqlite_nodes_edges', protocol: 'RBSR', requiresLineage: true }
      : { category: 'REPLICABLE_VOLATILE', destination: 'sqlite_pending_changes', protocol: 'EPHEMERAL_WEBRTC', requiresLineage: false };
  } else {
    return mustSurviveDisconnection
      ? { category: 'LOCAL_PERSISTENT', destination: 'sqlite_user_local', protocol: 'PRIVATE_SWARM', requiresLineage: false }
      : { category: 'LOCAL_TRANSIENT', destination: 'ram_tinybase', protocol: 'NONE', requiresLineage: false };
  }
}
`

---

## §3 — SDK (Desenvolvedores de Cliente)

### 3.1 Orquestração de Workers

A lógica de transporte roda fora da Main Thread, em web workers, comunicando-se via Comlink:

- **Sync Worker:** orquestra o Automerge Repo (snapshots, Changes, conexões WebRTC), mantém o loop de RBSR, gerencia o `SwarmRegistry` em memória (quem está online, latências, capacidades) e executa as transações no SQLite WASM (OPFS).
- **Crypto Worker:** valida assinaturas Ed25519 em lote durante Ondas 1/2 e decifra payloads (AES-256-GCM). Hospeda o Key Vault com TTL rígido de 4 h em RAM.
- **Index Worker:** reconstrói projeções locais (FTS5, R*Tree) a partir de payloads decifrados.

### 3.2 Estruturas em Memória

#### 3.2.1 B-Tree de Reconciliação

Cada Sync Worker mantém uma B-Tree em memória com os `id`s ordenados e seus fingerprints individuais (256 bits). O *root fingerprint* é cacheado para o anti-entropy $O(1)$ e invalidado incrementalmente a cada escrita local durável.

#### 3.2.2 `SwarmRegistry`

Mapa em RAM de peers ativos com latência, capacidades (tier), score de relay e estado de promoção de conexão. É a fonte para roteamento, shadowban de relay e eleição oportunística de líder de sync.

**Heartbeat e Health Check:**

O SwarmRegistry mantém a vivacidade dos peers através de um protocolo de heartbeat implícito com fallback explícito:

- **Heartbeat implícito:** Qualquer tráfego recebido no canal de dados (frames do RBSR, Automerge ephemeral messages, ou WebTorrent) zera o timer de inatividade do peer remetente no SwarmRegistry. Não há necessidade de mensagens de keep-alive adicionais enquanto o canal estiver ativo.
- **Heartbeat explícito (PING/PONG):** Se o canal permanecer ocioso por 15 segundos sem tráfego detectado, um PING de 8 bytes é disparado. O peer destino responde com um PONG de 8 bytes + timestamp local.
- **Evicção:** Três falhas consecutivas (45s sem resposta) marcam o peer como inativo:
  - Removido da lista de candidatos do SyncCoordinator
  - Removido como relay elegível no RelayTrustModel
  - Evitado para novas conexões por 5 minutos (cool-off)
  - Se era o líder eleito do sync, re-eleição imediata (§3.2.3)
- **Degradação em economia de energia:** Em dispositivos mobile com bateria < 15%, o heartbeat explícito é desativado. O sistema confia exclusivamente nos timeouts de aplicação (inatividade do RBSR) para limpeza de conexões fantasma.

#### 3.2.3 Coordenação de Sync (anti-*thundering herd*)

Um peer entrando num swarm grande **não** reconcilia com todos. Ele elege oportunisticamente o peer mais capaz/atualizado (o "líder" local) e faz RBSR apenas com ele, deixando o gossip propagar mudanças menores depois. Em malha sem Super Peer, a eleição é **determinística** (ex.: menor `entity_id` ativo no ciclo), evitando mensagens de coordenação; sob partição, cada partição reconcilia internamente e o estado converge na reunificação via RBSR.

**Failover — Timeout e Re-eleição:**

Se o líder eleito falhar durante uma sessão RBSR ativa:

1. **Monitoramento:** Um timer de inatividade de 5 segundos é iniciado para cada sessão RBSR ativa. Cada mensagem RBSR recebida zera o timer.
2. **Desconfiança e PING:** Se o timer expirar sem mensagens, um PING é enviado ao líder. Sem resposta em 2 segundos, o líder é declarado inativo e recebe shadowban temporário no SwarmRegistry.
3. **Rollback da transação WAL:** O `ConcurrentReconciliationGuard` (§3.3) aborta imediatamente a transação de leitura `DEFERRED` aberta no SQLite e executa `PRAGMA wal_checkpoint(TRUNCATE)` para liberar o arquivo `-wal`, prevenindo crescimento infinito.
4. **Re-eleição:** A função determinística (menor `entity_id` ativo) é reaplicada excluindo o líder falho. O próximo da lista é eleito.
5. **Retomada:** Uma nova transação de leitura `DEFERRED` é aberta e o RBSR retoma do último sub-range não resolvido da B-Tree (checkpoint salvo antes do timeout).

#### 3.2.4 — Gênese da Rede (First Peer Protocol)

Quando um peer tenta entrar em um swarm e não encontra ninguém, ele não pode simplesmente ficar esperando indefinidamente. O SwarmRegistry implementa uma máquina de estados:

```
                 ┌──────────────┐
                 │   JOINING    │
                 └──────┬───────┘
                        │
                   join(topic)
                        │
                        ▼
                 ┌──────────────┐
                 │ WAITING_FOR_ │
                 │    SWARM     │
                 │  (timer: 8s) │
                 └──────┬───────┘
                        │
            ┌───────────┴───────────┐
            │                       │
       Peer encontrado         Timer expirou
            │                       │
            ▼                  ┌─────┴──────┐
     ┌──────────────┐          │            │
     │  CONNECTED   │   Possui token   Não possui
     │   (normal)   │   de fundação?    token?
     └──────────────┘          │            │
                          ┌────┴────┐       │
                          ▼         ▼       ▼
                   ┌──────────┐  ┌──────────────┐
                   │ GENESIS  │  │ OFFLINE_RETRY │
                   │ (fundar) │  │  (esperar)    │
                   └──────────┘  └──────────────┘
```

**Estados:**

- **JOINING:** Estado inicial. O peer chama `join(topic)` no Automerge Repo e inicia a busca ativa (mDNS paralelo + DHT + fallback WebSocket).
- **WAITING_FOR_SWARM:** Timer de 8 segundos. Em LAN, mDNS responde em < 1s. Em WAN, DHT responde em < 3s. Fallback WebSocket em < 5s. 8s é conservador o suficiente para cobrir todos os mecanismos sem falso-positivo.
- **CONNECTED:** Peer encontrou a rede. Operação normal.
- **GENESIS (transição condicional):** Ocorre **apenas** se o timer de 8s expirou sem encontrar peers **e** o peer detém o bootstrap token (chave de fundação gerada no momento da criação do workspace) ou o usuário manifestou explicitamente a intenção "Criar Nova Rede". Neste estado, o peer:
  1. Cria os registros de bootstrap: `PROFILE` do admin, `SPECIFICATION` do workspace, `SPECIFICATION:NETWORK_BIRTH` (registro de fundação com timestamp imutável).
  2. Anuncia-se na DHT como seed do tópico.
  3. Marca-se como `PROVISIONAL_SYSTEM_PEER` no SwarmRegistry.
  4. Aceita conexões entrantes normalmente.
- **OFFLINE_RETRY:** Se o timer expirou sem token de fundação (ex.: usuário convidado com internet lenta):
  - A UI exibe "Aguardando conexão com a rede…"
  - O Sync Worker suspende a busca ativa — não anuncia na DHT, não cria registros, não faz gossip.
  - Realiza pings exponenciais no fallback WebSocket (intervalo iniciando em 10s, dobrando até 60s, com backoff).
  - Quando um peer real do sistema (ou outro peer ativo) aparecer, transita para CONNECTED e sincroniza via RBSR.

**Transição GENESIS → CONNECTED:** Quando um segundo peer se conecta ao genesis, este perde o status `PROVISIONAL_SYSTEM_PEER` e passa a operar como peer normal. O registro `NETWORK_BIRTH` permanece imutável no grafo como prova de fundação.

#### 3.2.5 — Global Network Throttle (Alocação de Banda entre Swarms)

Um mesmo peer pode pertencer a múltiplos swarms simultaneamente (ex.: workspaces abertos em abas diferentes). O GlobalThrottle governa a disputa por recursos de rede entre eles:

**Alocação por Visibilidade:**

| Prioridade | Estado da Aba/Swarm | Quota de Banda | Sockets |
| :--- | :--- | :--- | :--- |
| 1 | Aba ativa (foco do usuário) | 70% da banda | Conexão direta (STUN/WebRTC) |
| 2 | Aba visível (não ativa) | 20% da banda | Relay ancorado (Super Peer) |
| 3 | Abas em background | 10% (dividido) | Relay ancorado |

**Topologia Dinâmica (fechamento de túneis diretos):**

Swarms transferidos para background disparam o `ConnectionPromotionEngine` no modo reverso: o peer local fecha voluntariamente túneis P2P diretos (STUN) e migra o tráfego de background inteiramente para conexões ancoradas em Super Peers (Relays). Isso economiza soquetes do SO — cada túnel WebRTC direto consome um socket, e navegadores têm limite de ~30 conexões simultâneas.

**Degradação Extrema (Mobile):**

- Bateria < 30%: swarms em background são pausados (0% de banda, fechamento de sockets).
- Dados móveis (4G/5G): mesma política — apenas o swarm da aba ativa sincroniza.
- O throttle é reavaliado a cada ciclo de sync (ou a cada 30s, o que ocorrer primeiro).

**Implementação:** Token bucket por swarm, recarregado proporcionalmente à quota. Swarms sem divergência (fingerprint já sincronizado) consomem 0 tokens — a banda só é consumida durante RBSR ativo.

### 3.3 Guarda de Concorrência (`ConcurrentReconciliationGuard`)

Ao calcular a B-Tree para o RBSR, o SQLite abre `BEGIN DEFERRED TRANSACTION` sob **WAL (Write-Ahead Logging)**, obtendo um snapshot consistente e evitando *phantom reads*. Se o usuário modificar algo localmente durante o sync, o Guard detecta a variação do ponteiro de estado e engatilha a emissão de um **"Diff Complementar"** assim que o túnel reporta equivalência.

> **Mitigação de crescimento de WAL.** Transações de leitura longas em WAL impedem o checkpoint/truncamento do arquivo `-wal`. Para evitar crescimento ilimitado em syncs lentos, o Guard impõe um *budget* de tempo: ao excedê-lo, aborta a transação de leitura, executa um checkpoint e reinicia o cálculo do range pendente em uma nova transação.

### 3.4 Transporte de BLOBs (WebTorrent Isolado)

Metadados (grafo) e arquivos multimídia pesados são radicalmente desassociados. O payload relacional armazena **apenas** a chave de decifragem AES e o `Magnet Link`/`InfoHash` correspondente.

- **Transporte físico:** ocorre na camada nativa (Processo Principal do Node no Electron) ou via WebRTC puro no browser, em protocolos derivados do BitTorrent.
- **Reidratação na UI:**
  - **Electron:** download imperceptível no disco e *streaming* nativo local (ex.: `localhost/blobs/<hash>`) direto para `<video>`/`<img>`.
  - **Browser (non-Electron):** Sem `localhost` disponível, o fluxo de reidratação segue:
    1. A tag `<video src="/blobs/{infohash}">` faz uma requisição HTTP interceptada pelo Service Worker via evento `fetch`.
    2. O Service Worker abre um `MessageChannel` com o Sync Worker: `SW → Sync Worker: REQUEST_CHUNK(infohash, range)` → `Sync Worker → WebTorrent` → busca o chunk na rede P2P → `Sync Worker → Crypto Worker` → descriptografa com AES-256-GCM (chave vinda do nó `ASSET:FILE` sincronizado via RBSR).
    3. **Transferable Objects (zero-copy):** Para evitar congelamentos do GC do motor JavaScript, o Crypto Worker devolve os bytes descriptografados usando `postMessage(buffer, [buffer])`, transferindo a propriedade da memória sem cópia.
    4. **Backpressure:** O Service Worker monitora o tamanho do buffer interno. Se o buffer de leitura antecipada exceder 20MB à frente do consumo da tag `<video>`, o SW envia `PAUSE_STREAM` ao Sync Worker, interrompendo temporariamente o download via WebTorrent. Quando o buffer cair para 5MB, envia `RESUME_STREAM`.
    5. Os chunks são entregues ao navegador via `ReadableStream` (resposta do fetch interceptado) e anexados ao `SourceBuffer` do MediaSource, que gerencia a ordenação correta. Chunks fora de ordem (comum no WebTorrent) são bufferizados até que o chunk anterior seja recebido.
    6. **Segurança:** Chunks descriptografados residem **apenas** no `ReadableStream`/`SourceBuffer` — nunca são expostos ao contexto da página (nem ao JavaScript da UI). O Service Worker é o único ponto de manipulação de dados descriptografados.
- **Implicação de dedup:** como o BLOB é cifrado antes de entrar no swarm, o `InfoHash` depende da chave/IV; arquivos idênticos cifrados com chaves diferentes **não** deduplicam entre usuários. A disponibilidade do BLOB é responsabilidade da custódia gerida (§4), não do seeder original (que, sendo mobile, pode dormir a qualquer momento).

---

## §4 — Governança & Operações (Fundadores e Operadores de Rede)

### 4.1 Transporte como Recurso Comum Gerido

O peer, ao aceitar os termos, dedica recursos à comunidade. A plataforma autogere esse pool com base em **telemetria** (uptime, banda, espaço livre) e no **score/ranking** de cada peer. A partir disso, o sistema **fixa dados em peers específicos automaticamente**: a custódia não é puramente altruísta-voluntária, é alocação gerida.

### 4.2 Replicação e Custódia

#### 4.2.1 P2P Puro — Replication Factor por Gossip

Cada nó/aresta deve estar íntegro em ao menos $N$ dispositivos do grupo (default $N=3$). A custódia primária de cada `chunk`/registro é determinada por **consistent hashing**:

```
custodians(chunkId) = {
  primary:           top-K peers no anel de hash(chunkId),
  replicationFactor: N
}
```

#### 4.2.2 Corporativo

O Super Peer mantém 100% do grafo íntegro e emite um **Manifesto de Retenção** (pesos por relevância, frequência de leitura, prioridade de cargo) que autoriza podas agressivas nos dispositivos menores.

#### 4.2.3 Público

Sharding determinístico por consistent hashing entre peers ativos, com o **peer de sistema** mantendo o grafo íntegro como fallback definitivo de bootstrap.

### 4.3 Protocolo de Poda Segura (sem perda de dados)

A poda (transição Integral → Podado) **nunca** é imediata. Combina três camadas para eliminar a condição de corrida em que todos os $N$ custódios podam ao mesmo tempo confiando uns nos outros:

1. **Jitter aleatório:** ao atingir o limiar, o peer agenda `delay = random(30, 300) s`. Ao despertar, **reverifica** se $\ge N$ peers ainda têm o dado íntegro. Se outros já podaram, reinicia o timer. (O jitter sozinho já reduz a probabilidade de corrida a $\sim 1/N!$.)
2. **Custódia designada (RELEASE/ACK):** o custódio primário do anel **nunca** poda sem repassar a posse:
   - `A` quer podar → envia `RELEASE(chunkId)` ao próximo do anel `B`;
   - `B` assume custódia primária → responde `ACK(chunkId)`;
   - **só então** `A` poda;
   - se `B` falha, `A` retenta com `C` (próximo no anel).
3. **Health-check pré-poda:** antes de podar, `PING` aos $N-1$ peers. Se `< N-1` respondem confirmando posse → **não poda** (redução de rede detectada).

### 4.4 Saída de Peers

- **Saída Graciosa:** ao fechar, o peer despacha um sinal efêmero `peer-leaving: { cacheAvailableForMs: 30000 }`, dando 30 s para *leeching* em andamento finalizar sem corrupção.
- **Robustez a saída abrupta:** crashes, queda de rede e *kill* de app em background (comum no mobile) fazem o peer sumir **sem** sinal. O sistema é projetado para ser robusto a isso por padrão (custódia §4.2/§4.3, replication factor, health-check) — a saída graciosa é **otimização**, jamais premissa.

### 4.5 Coleta de Lixo (G4) — Pools Segmentados

O cache altruísta é vigiado no limite de OPFS/Disco, com cotas em **pools de expulsão distintos**:

- **Grafo:** algoritmo **LRU** (*Least Recently Used*).
- **BLOBs de vídeo/mídia:** **Rarest-First** — protege sementes raras na malha antes de excluí-las (inversão do rarest-first de *download* do BitTorrent). A raridade é **estimada** via contagem de peers no DHT/tracker; por ser estimável e potencialmente manipulável, a decisão final de expulsão de um BLOB raro é cruzada com o ranking de custódia (§4.1) antes de efetivar.

### 4.6 Tradeoff de Liveness dos Validadores

O modelo de "morte da rede por leis da física" é **intencional e defensável**. Não é mitigado — é documentado.

**Propriedades:**

- ✅ **Operações comutativas** (leitura, gossip, RBSR, navegação, chats, rascunhos): funcionam **independentemente** de validadores. A rede nunca perde a capacidade de ler e disseminar dados.
- ⚠️ **Operações não-comutativas transacionais** (commits governados, transferências de `ASSET`): exigem ao menos **1 validador ativo** dentre o conjunto $K$-de-$N$. Se todos desaparecerem, a parte transacional torna-se **read-only** até que (a) um validador retorne, ou (b) novos validadores sejam eleitos por **consenso de emergência** — ex.: acordo de $2/3$ dos peers com `PROFILE:AUTHENTICATION` ativo (contagem amparada pela web-of-trust de §1.4, que torna a contagem não-trivialmente inflável).
- 🔒 **Segurança:** a degradação para read-only **não corrompe dados, não permite operações inválidas e não perde auditabilidade**. É um *freeze*, não um *crash*.
- 📐 **Projetado para:** redes onde auditabilidade e integridade importam mais que disponibilidade transacional de 100% em cenário de desastre (corporativas, financeiras, reguladas).

**Esclarecimento sobre o "SPOF":** validadores **não** são uma unidade singular. A arquitetura especifica um conjunto $K$-de-$N$ de entidades independentes (Super Peers, Cloud, Desktops de alta disponibilidade). A liveness exige apenas **1** online, não todos. O cenário de extinção total é, por definição, a morte natural da rede prevista na governança.

**Reconciliação de forks sob partição:** O modelo de fork descrito em §2.10.2 é compatível com o cenário de validadores ausentes. Mesmo na ausência total de validadores (modo read-only), a detecção estrutural de forks continua operacional — o RBSR identifica duas arestas `MUTATES` concorrentes. O merge, no entanto, exige a presença de ao menos um peer capaz de criar o nó de merge (idealmente um validador ou Super Peer). Sem validadores, os forks ficam registrados mas não resolvidos até que um validador retorne. Isso é consistente com o tradeoff de liveness: operações comutativas (leitura, RBSR) progridem; operações não-comutativas (merge de fork), não.

### 4.7 — Private Swarm (Sincronização Cross-Device do Mesmo Usuário)

Dados que não são replicáveis para outros peers mas precisam sobreviver à sessão e estar disponíveis em todos os dispositivos do mesmo dono (ex.: rascunhos não publicados, cache de prefetch, preferências de UI) trafegam por um canal separado e invisível: o **Private Swarm**.

#### 4.7.1 — Derivação Segura do RendezvousId

O RendezvousId do Private Swarm **não** é derivado via hash simples da Chave Mestra. Em vez disso:

```
Device_Sync_Key = HKDF-Expand(master_key, "device-sync-v1", 32 bytes)
RendezvousId    = blake2s256(Device_Sync_Key)
```

Isso protege o segredo principal contra ataques de análise de tráfego na DHT: mesmo que o `RendezvousId` seja observado, a Chave Mestra não pode ser derivada dele.

#### 4.7.2 — Banco Sincronizado

O Private Swarm sincroniza um banco SQLite secundário isolado (`device_state.db`), contendo exclusivamente dados classificados como "Local + Persistente (mesmo usuário)" conforme a matriz em §2.11:

- Rascunhos não publicados
- Cache de prefetch (evita baixar o mesmo BLOB em cada dispositivo)
- Preferências de UI (tema, layout, idioma)
- Histórico de peers já sincronizados

#### 4.7.3 — Resolução de Conflitos

Como não há um Validador de Domínio no Private Swarm:

- **Preferências de UI:** Last-Write-Wins (LWW) baseado no HLC. Perder uma alteração de tema não é catastrófico.
- **Rascunhos de documentos:** Operam nativamente como CRDTs do Automerge. Texto digitado offline no celular e no desktop é mesclado sem perda quando os dispositivos se encontram.
- **Cache de prefetch:** Merge union-based — a lista completa de chunks cacheados é unificada. Se cada dispositivo baixou chunks diferentes, ambos passam a ter os chunks do outro.

#### 4.7.4 — Operação e Priorização

- Usa o mesmo mecanismo de Documento Casca (§2.3) do Automerge Repo.
- Tráfego criptografado ponta-a-ponta com a `Device_Sync_Key`.
- Não passa pelo RBSR do swarm principal.
- Prioridade: maior que swarms em background, menor que o swarm da aba ativa e que tráfego de replicação auditável.

#### 4.7.5 — Relação com as Modalidades

| Modalidade | Private Swarm opera? | Notas |
| :--- | :--- | :--- |
| P2P Puro | ✅ Sim | Roteado via relay ou direto, indistintamente |
| Corporativa | ✅ Sim | Isolado do grafo corporativo; a empresa não tem acesso |
| Pública | ✅ Sim | A Chave Mestra é do usuário, não da plataforma |

---

## Apêndice A — Fronteiras com Outros Cadernos (alterações de suporte)

Esta RFC é autocontida no transporte, mas depende de mudanças pontuais nos cadernos abaixo (entregues separadamente na "Peça 2 — Lista de Alterações Pontuais"):

1. **`caderno-3-sdk/01-sqlite-and-projections-schema.md`** — adicionar coluna `hlc` (coberta pela `signature`) às tabelas `nodes` e `edges`; substituir a comparação por `created_at` no trigger `entity_heads` por comparação de `hlc`; índice `(entity_id, hlc)`.
2. **`caderno-2-protocol/02-cryptographic-lineage-and-auth.md`** — corrigir a definição de *head* (ponta da linhagem via `MUTATES` sem filho ativo, **não** o maior `created_at`); especificar o algoritmo HLC (eventos local/envio/recepção), a ordem total `(pt, c, author_pubkey)`, a monotonicidade de pai e o limite de drift.
3. **`caderno-2-protocol/03-set-reconciliation-protocol.md`** — substituir `Truncate₆₄(SHA-256(...))` pelo fingerprint de 256 bits; adicionar `RangeFooter` (count + checksum) e a rodada de desafio com nonce.
4. **`caderno-2-protocol/04-automerge-integration-spec.md`** — regra de merge de fork de `MUTATES` herdando a eleição determinística de committer (`PROFILE:SYSTEM` preferencial), criando nó de merge com dois `MUTATES` e `HLC` superior aos dois ramos.
5. **`caderno-4-governance/`** — formalizar a seção de liveness dos validadores (§4.6 desta RFC) como regra de governança.
6. **Modelo de Concorrência e Merge:** A detecção estrutural de forks (duas `MUTATES` do mesmo `source_id` sem ancestralidade) e o merge por nó de merge estão especificados no Caderno 2 §4 (Automerge Integration Spec) e referenciados neste RFC em §2.10. A política de deleção via `active = 0` com trigger local está no Caderno 3 §1 (SQLite & Projections Schema). Este RFC não redefine esses mecanismos; apenas os invoca como contrato da camada de transporte.

## Apêndice B — Glossário de Termos de Transporte

- **Anti-Entropy $O(1)$:** troca apenas do root fingerprint no resume; se coincide, encerra sem sync.
- **ConnectionPromotionEngine:** migra fluxo de relay para P2P direto quando o NAT permite.
- **Documento Casca / Rendezvous:** sala WebRTC em RAM, sem histórico, derivada de capability.
- **HLC (Hybrid Logical Clock):** carimbo `(pt, c)` que respeita happens-before e fica colado ao tempo real.
- **RangeFooter:** rodapé `{count, checksum}` que torna colisão de fingerprint detectável.
- **RBSR (Range-Based Set Reconciliation):** reconciliação por XOR de ranges, recursiva até isolar diferenças.
- **RelayTrustModel:** score local e não-transitivo de relays, com shadowban por histerese.
- **SwarmRegistry:** mapa em RAM de peers ativos, latências, capacidades e estado de promoção.
- **STALE_EPOCH:** erro que interrompe o RBSR quando a época da chave muda durante a transferência.
