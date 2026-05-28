# 04-automerge-integration-spec.md — Automerge Integration Specification

Este documento descreve como a DAG de conflitos e histórico do **Automerge** se acopla à Linhagem de Versões do Grafo de dados na Plataforma V3.1, bem como as regras e modos de coordenação de commits colaborativos.

---

## 1. O Acoplamento Automerge e Grafo de Versões

A plataforma opera sob duas trilhas de dados complementares para edição colaborativa (como documentos de texto, planilhas e quadros de tarefas):

1. **A DAG Nativa do Automerge**: Gerencia a concorrência granular baseada em CRDT. O histórico completo de alterações (Changes) e a resolução matemática de concorrência ocorrem em memória e em tabelas locais temporárias.
2. **A Linhagem de Versões do Grafo**: Representa a auditoria semântica formal do sistema. Cada "commit" do documento gera um nó-versão `nodes` imutável, assinado por um autor e conectado ao predecessor por uma aresta `MUTATES`.

### 1.1 Consolidação do Snapshot (O Commit)
* O payload de um nó-versão do tipo `CONTENT:DOCUMENT` no grafo contém o snapshot binário integral e consolidado gerado via `Automerge.save(doc)`.
* Desta forma, o nó-versão no grafo é totalmente autossuficiente. A reidratação do documento por qualquer peer requer apenas a leitura do payload do nó e o comando `Automerge.load(payload)`, dispensando o processamento histórico de milhares de micro-updates de digitação em tempo de abertura.

---

## 2. O Ciclo de Commit Colaborativo

As edições granulares realizadas na UI pelos usuários alimentam o Automerge Repo em tempo real. O Sync Worker orquestra o ciclo de vida dessas edições por meio do seguinte fluxo:

### 2.1 Captura de Changes (Escrita em Staging)
* As alterações em tempo real são salvas na tabela local não-replicada `pending_changes` no SQLite.
* O Automerge Repo propaga essas alterações como **ephemeral messages** via canais WebRTC na RAM para todos os peers co-editores conectados ao documento. Isso garante feedback visual instantâneo e colaboração em tempo real (digitação simultânea) sem inflar a tabela física central `nodes` com micro-versões.

### 2.2 Gatilho de Commit
O Sync Worker monitora o acúmulo de Changes em `pending_changes`. O gatilho de consolidação é disparado sob duas heurísticas configuráveis pela `SPECIFICATION` do documento:
* **Inatividade**: Ex. 3 segundos consecutivos sem novas alterações locais ou de peers co-editores.
* **Limiar de Operações**: Ex. acúmulo de 100 micro-changes pendentes.

### 2.3 Consolidação e Emissão de Nó-Versão
Disparado o gatilho:
1. O Sync Worker designa ou atua como o **Committer** do ciclo.
2. Compila as Changes pendentes e gera o snapshot binário consolidado (`Automerge.save(doc)`).
3. Insere o nó-versão na tabela física replicada `nodes` assinado com sua chave Ed25519 (Layer 1 - Imutabilidade do Registro).
4. Traça uma aresta `MUTATES` apontando do nó-versão anterior para o novo. Esta aresta grava na coluna plana (não criptografada e indexada) `previous_hash` o hash da assinatura Ed25519 da aresta `MUTATES` anterior, estabelecendo a Layer 2 (Imutabilidade da Ordem).
5. Traça uma aresta `AUTHORED` ligando o autor do commit (`PROFILE`) ao novo nó-versão, inserindo em seu payload a lista de hashes das Changes consolidadas e um sumário curto (ex: *"editou tabela de custos, atualizou cabeçalho"*).
6. Limpa as Changes consolidadas da tabela `pending_changes`.

---

## 3. Modos de Eleição de Committer

Para evitar conflitos de concorrência e a criação desnecessária de bifurcações (branches) na Linhagem de Versões do grafo ao consolidar edições de múltiplos co-editores ativos ao mesmo tempo, a `SPECIFICATION` do documento declara um entre quatro modos de eleição do **Committer**:

| Modo | Mecânica de Seleção | Caso de Uso Recomendado |
| :--- | :--- | :--- |
| **`first_proposer`** | O primeiro peer a atingir a heurística do gatilho assina e insere o nó-versão. Outros peers abortam e tratam o commit como histórico de entrada. | Documentos com edição assíncrona ou apenas um editor principal habitual. |
| **`system_agent`** | Um agente automatizado `PROFILE:SYSTEM` designado na especificação atua como o Committer exclusivo. Peers enviam suas Changes ao agente. | Documentos corporativos de alta concorrência ou fluxos estruturados. |
| **`deterministic`** | Um algoritmo determinístico (ex: peer com o menor `entity_id` lexicográfico ativo no ciclo corrente) é eleito Committer por todos sem mensagens de coordenação. | Colaboração densa P2P sem dependência de conexões de super peers. |
| **`manual`** | O Committer é designado explicitamente por um peer que possua permissão (`ASSET:PERMISSION`) de governança ativa sobre o nó. | Quadros e documentos de governança restrita. |

### 3.1 Co-assinatura via Ephemeral Messages
Caso a `SPECIFICATION` exija aprovação/assinatura conjunta de múltiplos co-editores antes de publicar a nova versão, o Committer proposto envia o hash do snapshot binário como mensagem efêmera na RAM (via WebRTC) para os peers legítimos. Estes respondem com suas assinaturas Ed25519. O Committer reúne as assinaturas e as persiste no nó final na tabela `nodes`. Nenhuma mensagem de coordenação é gravada permanentemente no grafo. reúne as assinaturas e as persiste no nó final na tabela `nodes`. Nenhuma mensagem de coordenação é gravada permanentemente no grafo.
