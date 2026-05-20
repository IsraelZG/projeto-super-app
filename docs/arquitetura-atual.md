# Arquitetura e Fluxo de Dados — Plataforma V3.0 (Local-First)

Este documento descreve a topologia de camadas, o fluxo de dados reativo e o nível de acoplamento/desacoplamento das peças do sistema. Ele serve de guia para garantir a intercambiabilidade dos componentes (como bancos de dados, conexões de rede e engines visuais).

---

## Diagrama de Arquitetura e Acoplamento

O diagrama abaixo divide o sistema em **Camadas Físicas (Threads/Processos)** e destaca os **Pontos de Desacoplamento (Interfaces)** que permitem a substituição de componentes sem impacto no restante da aplicação.

```mermaid
graph TD
    %% Estilos e Classes
    classDef ui fill:#e0f7fa,stroke:#006064,stroke-width:2px;
    classDef worker fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px;
    classDef cloud fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef core fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;
    classDef interface fill:#eceff1,stroke:#37474f,stroke-width:2px,stroke-dasharray: 5 5;

    %% ---------------------------------------------------------------
    %% CAMADA DE INTERFACE (MAIN THREAD - BROWSER)
    %% ---------------------------------------------------------------
    subgraph MainThread ["Main Thread (Browser UI)"]
        ReactUI["Componentes React (Timeline, SuperCard)"]:::ui
        TinyBaseStore["TinyBase Store (Memória)"]:::ui
        TinyBaseQueries["TinyBase Queries (Projeções UI)"]:::ui
        
        %% Ponto de Desacoplamento da UI
        Persister["TinyBase Custom Persister"]:::interface
    end

    %% ---------------------------------------------------------------
    %% CAMADA DE MOTOR LOCAL (WEB WORKER THREAD)
    %% ---------------------------------------------------------------
    subgraph WebWorker ["Web Worker Thread (Sync Worker)"]
        ComlinkExpose["Comlink RPC Wrapper"]:::worker
        
        %% Motor Cripto (A ser criado na Fase 1)
        IdentityCrypto["Identity & Crypto Manager (Pendente)"]:::worker
        
        %% Motor de Consistência
        MFAS["MFA-S Staging & Coalescence"]:::worker
        
        %% Sincronização CRDT
        CRDTManager["Y.js CRDT Manager"]:::worker
        
        %% Interfaces do Worker
        NetBridge["networkBridge (Interface)"]:::interface
        CRDTPersist["crdtPersistence (Interface)"]:::interface
        DBAdapterWorker["DatabaseAdapter (Interface)"]:::interface
        
        %% Implementações Concretas do Worker
        WebRTC["WebRTC Manager"]:::worker
        WASQLite["wa-sqlite (OPFS Driver)"]:::worker
    end

    %% ---------------------------------------------------------------
    %% CAMADA COMPARTILHADA (CORE PACKAGE)
    %% ---------------------------------------------------------------
    subgraph CorePackage ["packages/core (Biblioteca Compartilhada)"]
        DbSchema["Schema & Triggers SQL"]:::core
        SpecParser["Specification Parser"]:::core
        ModelMappers["Mappers (Row <-> Obj)"]:::core
        SSSModule["SSS (Shamir's Secret Sharing K-de-N)"]:::core
    end

    %% ---------------------------------------------------------------
    %% CAMADA CLOUD / REDE
    %% ---------------------------------------------------------------
    subgraph CloudEnv ["Ambiente Cloud / Sinalização"]
        WebSocketSignaling["Signaling Server (WebSockets)"]:::cloud
        CloudPeer["Cloud Peer (Replicador Ativo)"]:::cloud
        
        %% Interfaces/Drivers da Nuvem
        DBAdapterCloud["DatabaseAdapter (Interface)"]:::interface
        BetterSQLite["Better-SQLite3 Driver"]:::cloud
    end

    %% ---------------------------------------------------------------
    %% FLUXOS E ACOPLAMENTOS
    %% ---------------------------------------------------------------
    
    %% UI -> Persistência -> Worker
    ReactUI -.->|Leitura Reativa| TinyBaseQueries
    TinyBaseQueries -.->|Projeta sobre| TinyBaseStore
    TinyBaseStore <==>|Carrega & Salva| Persister
    Persister <==>|Chamadas RPC via Comlink| ComlinkExpose
    
    %% Fluxos no Sync Worker
    ComlinkExpose -->|Mutações locais / Intent| WASQLite
    ComlinkExpose -->|Staging granular| MFAS
    MFAS -->|Coalesce e gera log| IdentityCrypto
    IdentityCrypto -->|Cifra logs/nós e insere| WASQLite
    
    %% SQLite e Core Schema
    WASQLite ===|Aplica| DbSchema
    BetterSQLite ===|Aplica| DbSchema
    
    %% Isolamento do Driver de Banco
    WASQLite -.->|Implementa| DBAdapterWorker
    BetterSQLite -.->|Implementa| DBAdapterCloud
    
    %% CRDT Sincronização e Isolamento
    CRDTManager -.->|Persiste deltas via| CRDTPersist
    CRDTPersist --> WASQLite
    CRDTManager -.->|Abstrai rede via| NetBridge
    NetBridge --> WebRTC
    
    %% Fluxo de Rede e P2P
    WebRTC <==>|Handshake via WS| WebSocketSignaling
    WebRTC <==>|Canal de Dados P2P| CloudPeer
    CloudPeer <==>|Sincroniza CRDT| CRDTManager
    CloudPeer ===|Persiste via| BetterSQLite

    %% Dependências para o Core
    WASQLite -.->|Usa mappers| ModelMappers
    ComlinkExpose -.->|Lê Specs| SpecParser
```

---

## Modelos de Identidade e Recuperação Previstos

O sistema suporta três modelos distintos de custódia e recuperação de identidade, garantindo flexibilidade e segurança para diferentes tipos de usuários:

```mermaid
graph TD
    A[Criação de Conta / Identidade] --> B{Escolha de Custódia}
    
    %% Método A
    B -->|1. Autônomo Puro| C[Frase Mnemônica BIP39]
    C --> C1[Responsabilidade exclusiva do usuário de salvar offline]
    
    %% Método B
    B -->|2. Shamir SSS Flexível| D[Compartilhamento SSS K-de-N]
    D --> D1[Fragmento 1: Dispositivo Local]
    D --> D2[Fragmento 2: Cloud Peer Custodian]
    D --> D3[Fragmentos 3..N: E-mail, Impresso, Amigos]
    
    %% Método C
    B -->|3. Convencional Nuvem| E[Custódia Zero-Knowledge]
    E --> E1[Mnemônico cifrado via PBKDF2 com e-mail/senha]
    E1 --> E2[Enviado para armazenamento no Cloud Peer]
```

### 1. Recuperação Autônoma (Mnemônico BIP39)
* **Fluxo:** O usuário gera uma frase semente de 12 ou 24 palavras (BIP39). O par de chaves Ed25519 de identidade é derivado deterministicamente a partir dessa seed no navegador.
* **Segurança:** O segredo não sai do dispositivo. Se perdido sem backup anotado, o acesso é irrecuperável.

### 2. Recuperação com Shamir Parametrizável ($K$-de-$N$)
* **Fluxo:** O mnemônico é dividido matematicamente em $N$ frações (shards) usando o algoritmo *Shamir's Secret Sharing (SSS)* em um corpo finito $GF(2^8)$. São necessários qualquer subconjunto de $K$ frações para reconstruir a identidade.
* **Distribuição:** Cada fração é armazenada em um nó `PROFILE:AUTHENTICATION` na tabela `nodes`. O fragmento do provedor (Nuvem) é replicado de forma controlada apenas para o Cloud Peer.

### 3. Recuperação Convencional via Nuvem (Custódia Zero-Knowledge no Cloud Peer)
* **Fluxo:** O mnemônico é encriptado via AES-256-GCM usando uma chave derivada via PBKDF2 a partir da senha do usuário.
* **Persistência no Grafo:** O backup resultante é salvo na tabela `nodes` como um nó de tipo **`PROFILE:AUTHENTICATION`** (respeitando a restrição ontológica estrita).
* **Isolamento de Replicação:** O nó `PROFILE:AUTHENTICATION` reside fisicamente na tabela `nodes` do cliente e do servidor Cloud Peer. No entanto, ele é excluído da sala pública Y.js (`global-room`), impedindo que outros peers na malha WebRTC o visualizem ou copiem. A sincronização dessa credencial ocorre exclusivamente através de uma sala de sync privada (ex: `auth-room:<hash>`) onde apenas o dono da identidade e o Cloud Peer estão autorizados a se conectar.

---

## Análise de Acoplamento e Modularidade

A arquitetura do projeto foi projetada seguindo o princípio da **Inversão de Dependência (DIP)**. Abaixo estão listados os conectores estruturais que garantem que as partes sejam altamente intercambiáveis:

### 1. Desacoplamento da Interface de Banco de Dados (`DatabaseAdapter`)
* **Onde:** Definido em `packages/core/src/database/adapter.ts`.
* **Como funciona:** O motor principal não conhece os detalhes de drivers físicos. Ele faz consultas através da interface `DatabaseAdapter`.
* **Intercambiabilidade:**
  * No **Browser (Worker)**: O `WASQLiteAdapter` encapsula o `wa-sqlite` gravando no Origin Private File System (OPFS).
  * No **Node.js (Cloud Peer)**: O `BetterSQLite3Adapter` encapsula o `better-sqlite3` gravando no disco do servidor.

### 2. Desacoplamento da UI Thread (`TinyBase Custom Persister` + `Comlink`)
* **Onde:** Definido em `apps/web/src/store/tinybase.ts` e `apps/web/src/worker/sync-worker.ts`.
* **Como funciona:** A UI thread é totalmente agnóstica em relação ao SQL. Ela lê e grava em uma store em memória (TinyBase). O `Custom Persister` intercepta as escritas e as envia de forma assíncrona ao `SyncWorker` via RPC (Comlink).

### 3. Desacoplamento da Rede no CRDT (`networkBridge`)
* **Onde:** Definido em `apps/web/src/worker/network/crdt-manager.ts`.
* **Como funciona:** O `CRDTManager` gerencia o estado do Y.js e a aplicação de deltas locais/remotos. Ele não faz chamadas diretas a WebSockets ou WebRTC. Em vez disso, comunica-se através do objeto de interface `networkBridge`.

### 4. Desacoplamento do Schema Visual (`Spec-Driven UI`)
* **Onde:** Definido pelas especificações em `packages/core/src/specifications/` e consumido pelas engines da UI.

---

## Sincronização Controlada de Nós Sensíveis

O diagrama abaixo ilustra como os dados de autenticação e os dados de aplicação comuns compartilham a mesma tabela física `nodes`, mas são roteados por canais lógicos diferentes de sincronização para garantir privacidade total:

```mermaid
sequenceDiagram
    autonumber
    participant LocalDB as SQLite Local (Cliente)
    participant SyncW as Sync Worker (CRDT)
    participant CloudDB as SQLite Cloud Peer
    participant Peer as Outros Peers (P2P Mesh)

    Note over LocalDB,SyncW: Mudança nos nós da tabela nodes
    
    alt Nó de Aplicação (CONTENT:MESSAGE, PROFILE:CORE, etc.)
        SyncW->>SyncW: Encapsula no Y.Doc 'global-room'
        SyncW->>Peer: Propaga via WebRTC DataChannel (P2P)
        SyncW->>CloudDB: Propaga via WebSocket (Replicador)
    else Nó Sensível (PROFILE:AUTHENTICATION)
        SyncW->>SyncW: Filtra (bloqueia envio na sala global)
        SyncW->>SyncW: Encapsula no Y.Doc 'auth-room:user-hash'
        SyncW->>CloudDB: Sincroniza exclusivamente com o Cloud Peer
        Note over SyncW,Peer: Outros peers nunca recebem este Y.Doc
    end
```
