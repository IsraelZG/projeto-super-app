# 02-cryptographic-lineage-and-auth.md — Cryptographic Lineage & Auth Specification

Este documento define os modelos de identidade criptográfica, atribuição causal, controle de acesso e recuperação de chaves na Plataforma V3.0.

---

## 1. Identidade e Modelo Multi-Persona

A identidade de um usuário humano na Plataforma V3.0 é estruturada em camadas independentes para assegurar a separação rigorosa de contextos e a privacidade de interações.

### 1.1 A Identidade-Âncora (`PROFILE:AUTHENTICATION`)
* **Definição**: É a raiz criptográfica do usuário humano dentro de uma rede específica. Carrega a chave privada mestra Ed25519 e os metadados de credencial.
* **Privacidade**: Nunca é diretamente exposto a outros peers em interações cotidianas (conversas, transações, posts). Funciona como o gerador interno de assinaturas.

### 1.2 Os Dados Pessoais (`CONTENT:PERSONAL_DATA`)
* **Definição**: Nó de conteúdo contendo dados civis privados do titular (nome real, e-mail, telefone, CPF/documentos).
* **Segurança**: Vinculado ao nó `PROFILE:AUTHENTICATION` correspondente e encriptado com chaves do usuário. O acesso de terceiros depende de consentimento explícito via `ASSET:CONSENT`.

### 1.3 As Máscaras Públicas (`PROFILE:PERSONA`)
* **Definição**: Identidades operacionais visíveis aos outros peers da rede (ex: Persona Pessoal, Persona Criador, Persona Profissional).
* **Segurança**: A ligação causal entre a `AUTHENTICATION` primária e a `PERSONA` correspondente tem visibilidade restrita no grafo local do usuário. Outros peers visualizam apenas a `PERSONA` ativa na coluna de layout.

### 1.4 Delegação de Persona Corporativa
Em redes corporativas, a empresa (`PROFILE:ORGANIZATION`) pode emitir um `PROFILE:PERSONA` persistente para um cargo (ex: "Gerente Financeiro") e delegar sua operação temporária a um funcionário.
1. A empresa cria o `PROFILE:PERSONA` do cargo corporativo e emite um `ASSET:ROLE` associado.
2. A empresa cria uma aresta `DELEGATED_TO` apontando o asset para a chave `PROFILE:AUTHENTICATION` do funcionário.
3. O funcionário assume a persona e assina transações corporativas em nome do cargo.
4. Ao desligar o funcionário, a empresa revoga o asset (aresta lápide com `weight = 0`). A persona corporativa e todo o histórico de mensagens permanecem sob a propriedade institucional da empresa.

---

## 2. Controle de Acesso Baseado em UCAN, ASSET:PERMISSION e ASSET:ROLE

A Plataforma V3.1 adota uma separação rigorosa entre **Fatos Sociais/Estruturais** (ex: pertencer a um grupo via aresta `PARTICIPATES_IN`) e **Autorizações Técnicas de Acesso**. A existência de uma aresta `PARTICIPATES_IN` não concede permissão criptográfica de leitura ou escrita.

### 2.1 ASSET:PERMISSION e ASSET:ROLE
* **`ASSET:PERMISSION`**: Representa um direito atômico e granular de acesso. É definido por:
  * **Query de Traversal (Leitura)**: Especifica o subgrafo acessível. Contém `root` (nó raiz), `depth` (profundidade limite $\le$ 6), `direction` (outbound, inbound ou bi-directional), além de filtros opcionais para tipos de `edges` (arestas) e `nodes` (nós).
  * **Restrições de Mutação (Escrita)**: Delimita as arestas e nós que o titular pode criar ou modificar no subgrafo autorizado (profundidade limite $\le$ 6).
* **`ASSET:ROLE`**: Representa um papel ou função de negócio. É um agrupamento lógico que conecta múltiplos nós `ASSET:PERMISSION` através de arestas estruturais do tipo `AGGREGATES` (indicando composição).
* **Relacionamento `REQUIRES`**: Nós `ASSET:PERMISSION` podem se relacionar com outras permissões via arestas `REQUIRES`, modelando pré-requisitos lógicos de acesso. Ambas as arestas (`AGGREGATES` e `REQUIRES`) apontam para o `entity_id` estável das entidades.
* **Inline Templates nas Especificações**: Para simplificar o grafo e manter o ciclo de vida unificado, os moldes/templates de papéis e permissões não flutuam como nós isolados no grafo; eles residem no payload das especificações (`SPECIFICATION`) sob as propriedades `permission_templates` e `role_templates`, compartilhando a mesma versão e SemVer da especificação que as rege.

### 2.2 UCAN e Separação do Cofre de Chaves (Key Vault)
* A autenticação e a cadeia de delegação de acesso baseiam-se em tokens **UCAN (User Controlled Authorization Networks)**.
* **Separação Criptográfica**: Ao contrário de modelos em que tokens carregam chaves de conteúdo diretamente, os UCANs na Plataforma V3.1 funcionam estritamente como **provas de autorização de tráfego**. O payload de um UCAN *nunca* contém material de chaves criptográficas (como chaves AES ou privadas).
* **Fluxo de Acesso**:
  1. O peer apresenta o UCAN para provar que possui um direito (`ASSET:PERMISSION` ou `ASSET:ROLE`) ativo e válido.
  2. O **Cofre de Chaves (Key Vault)** — um subsistema isolado acoplado ao Crypto Worker — valida o UCAN e as restrições associadas.
  3. Caso o UCAN seja válido, o Key Vault entrega a **Chave de Época** (AES-256) correspondente, cujo ciclo de vida e expiração (TTL) são governados pelo tempo de vida do papel ou consentimento associado.
* **Delegação Recursiva**: UCANs permitem delegação em cascata (A delega para B, que delega para C, dentro dos mesmos limites de traversal). O criador do recurso ou a especificação governante pode desativar a delegação recursiva via atributo `delegatable: false`.
* **Revogação**: Realizada gravando-se uma lápide (aresta de revogação com `weight = 0` ou aresta de expiração) no grafo.

---

## 3. Hierarquia Criptográfica e Imutabilidade Dupla

Para assegurar a soberania dos dados locais e forward secrecy contra revogações, o sistema adota chaves de época integradas a um modelo rigoroso de imutabilidade.

### 3.1 As Camadas de Chaves
* **Chave Mestra (Ed25519)**: Armazenada de forma inviolável no Secure Enclave ou Keychain do dispositivo local. Usada para assinar nós/arestas emitidos e assinar tokens UCAN locais.
* **Chave do Dispositivo (AES-256)**: Derivada localmente via KDF (Key Derivation Function). Usada para encriptar localmente tabelas de projeção de texto plano (como índices de busca SQLite FTS5) e metadados. Nunca é exposta na rede.
* **Chave de Conteúdo por Época (AES-256-GCM)**: Custodiada no Cofre de Chaves (Key Vault). Cifra payloads binários de nós e payloads sensíveis de arestas de um grupo ou documento.
* **Cache de RAM (Volátil)**: Cache em memória RAM da chave de época descriptografada pelo Key Vault, com expiração padrão (TTL) de 4 horas, para evitar chamadas de descriptografia contínuas na projeção reativa do TinyBase.

### 3.2 Duas Camadas de Imutabilidade (Linhagem de Versões)
Toda entidade no grafo (linha temporal de modificações conectada pelo mesmo `entity_id`) é auditada em dois níveis:
1. **Imutabilidade do Registro (Layer 1)**: Cada nó e aresta individual possui uma assinatura digital Ed25519 universal cobrindo todos os seus campos planos e o payload cifrado.
2. **Imutabilidade da Ordem (Layer 2)**: Para impedir ataques de reordenação histórica ou exclusão silenciosa de elos da linhagem, toda aresta `MUTATES` que conecta uma versão nova à anterior carrega uma coluna unencriptada chamada **`previous_hash`**.
   * O `previous_hash` aponta diretamente para o hash da assinatura Ed25519 da aresta `MUTATES` anterior.
   * O `previous_hash` é uma coluna plana, plana indexada, permitindo auditorias topológicas rápidas em $O(1)$ sem a necessidade de descriptografar os payloads cifrados dos nós.
   * Esse campo reside exclusivamente na estrutura da aresta `MUTATES`, tendo sido removido de dentro dos payloads dos nós-versão para evitar redundância e contaminação de escopo.

### 3.3 Rotação de Épocas e Forward Secrecy
Quando um membro ou papel é revogado de um grupo/documento:
1. O Cofre de Chaves (Key Vault) do grupo (gerido cooperativamente pelos validadores ou via KMS online-optional) gera uma nova chave AES para uma **nova época**.
2. A nova chave é encapsulada em envelopes criptográficos distribuídos exclusivamente aos participantes cujos UCANs correspondentes à `ASSET:PERMISSION` ou `ASSET:ROLE` continuam ativos.
3. Quaisquer novos nós ou arestas gravados a partir desse instante usam a chave da nova época.
4. O membro excluído perde o acesso às chaves das novas épocas. Contudo, mantém acesso aos dados históricos cifrados com chaves das épocas em que era participante (preservando o forward secrecy pragmático).

### 3.4 KMS Online-Optional e Conectividade
* **Modo Online**: Com conectividade ativa, a rotação de chaves e revogação de UCANs se propagam instantaneamente na rede.
* **Modo Offline**: Em redes P2P puras ou dispositivos temporariamente isolados, a rotação de chaves é enfileirada localmente e as chaves de nova época são geradas de forma descentralizada e consolidadas de forma assíncrona assim que ocorre a reconexão e reconciliação de estado.

---

## 4. Modelos de Recuperação de Chaves (Custódia e Backup)

A plataforma disponibiliza três modelos de recuperação de acesso à conta, configuráveis na `SPECIFICATION:NETWORK_GOVERNANCE` de cada rede:

### 4.1 Modelo Centralizado (Central Custody)
* **Público**: Recomendado para Redes Corporativas Whitelabel.
* **Funcionamento**: A chave mestra do funcionário é gerada no provisionamento e encriptada com a chave mestra da empresa. O administrador da empresa pode resetar credenciais e restaurar acesso sob demanda.
* **Limitação**: A empresa possui a capacidade técnica de ler e auditar as mensagens assinadas pelo funcionário, fato comunicado contratualmente no onboarding.

### 4.2 Modelo Shamir (SSS 2-de-3)
* **Público**: Recomendado para Redes Públicas.
* **Funcionamento**: A chave mestra do usuário é dividida matematicamente em 3 shards usando Shamir's Secret Sharing (SSS) sobre $GF(2^8)$. São necessários no mínimo 2 shards para reconstruir a chave.
  * **Shard 1 (Dispositivo)**: Salvo no storage seguro local do celular/workstation.
  * **Shard 2 (Cofre do Provedor)**: Protegido pelo hash da senha do usuário nos servidores do fundador.
  * **Shard 3 (Canal Externo)**: Token ou segredo enviado via e-mail/SMS/Authenticator externo.
* **Segurança**: O comprometimento isolado de um único canal ou dispositivo não compromete a identidade do usuário.

### 4.3 Modelo Soberano (User Only)
* **Público**: Recomendado para Redes P2P Puras.
* **Funcionamento**: A chave é gerada a partir de uma semente mnemônica de 12 ou 24 palavras (BIP39). O usuário é o único detentor do segredo.
* **Risco**: A perda da semente resulta em perda definitiva da identidade e dos dados encriptados.
