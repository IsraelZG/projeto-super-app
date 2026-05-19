# Plataforma V3.0 — Documento 1: Fundamentos Arquiteturais

**Versão:** 3.0 (Consolidada — revisão 3)
**Status:** Especificação de Referência
**Substitui:** Especificação Técnica V3.0 original, seção conceitual; Detalhamento de Módulos; Componentes Polimórficos; Detalhamento de Engines (parcial)

---

## Sumário

1. [Visão e Posicionamento](#1-visão-e-posicionamento)
2. [Princípios Arquiteturais Fundamentais](#2-princípios-arquiteturais-fundamentais)
3. [Stack Tecnológica](#3-stack-tecnológica)
4. [Formatos de Distribuição do Software](#4-formatos-de-distribuição-do-software)
5. [Modalidades de Rede](#5-modalidades-de-rede)
6. [A Ontologia: Os Quatro Tipos de Nó](#6-a-ontologia-os-quatro-tipos-de-nó)
7. [Identidade, Autenticação e Personas](#7-identidade-autenticação-e-personas)
8. [Threat Model e Princípios de Segurança](#8-threat-model-e-princípios-de-segurança)
9. [Glossário](#9-glossário)

---

## 1. Visão e Posicionamento

A Plataforma V3.0 é um sistema operacional de dados distribuído, projetado para construir aplicações local-first, offline-first e P2P-oportunístico. Sua ambição é unificar, sob uma mesma fundação técnica, três modalidades de uso historicamente atendidas por sistemas separados:

- **Redes públicas de larga escala**, equivalentes funcionais a combinações de Google Workspace, Mercado Livre e Instagram, com livre adesão de usuários e foco em descoberta, transação e interação social.
- **Redes corporativas whitelabel**, substituindo intranets, ERPs, CRMs e sistemas de produtividade interna de empresas, com identidade gerenciada centralmente e dados isolados.
- **Redes P2P puras**, operadas sem qualquer infraestrutura central, voltadas a usuários que priorizam soberania absoluta sobre dados e identidade.

A plataforma não escolhe entre essas modalidades: ela **as suporta nativamente** através de configuração, mantendo o mesmo núcleo arquitetural. As diferenças entre uma instância pública e uma corporativa não estão em código separado, mas em SPECIFICATIONS distintas que governam comportamento, regras de validação e políticas de governança.

O foco prioritário de desenvolvimento e investimento é a rede pública. A rede corporativa é foco secundário, viabilizada pela mesma arquitetura. A rede P2P pura é prioridade terciária, valiosa estrategicamente como exercício de limites técnicos (segurança, privacidade, autonomia) e como veículo para comunidade open source contribuir, mais do que como produto comercial autônomo.

---

## 2. Princípios Arquiteturais Fundamentais

Esta seção estabelece os princípios que governam todas as decisões técnicas subsequentes. Eles são vinculativos: novas features e componentes devem se conformar a eles, e desvios exigem justificativa explícita.

### 2.1 Princípio do Pragmatismo Topológico

O sistema é P2P-first, mas não P2P-purista. Apenas a modalidade "P2P puro" opera com restrição estrita ao paradigma descentralizado. Todas as demais modalidades adotam P2P **oportunisticamente**: usam suas qualidades onde elas são superiores (resiliência, custo operacional, privacidade local, capacidade offline), mas substituem por mecanismos centralizados onde estes oferecem qualidade superior (recuperação de senha via servidor, snapshots de bootstrap, garantia de disponibilidade de dados, validação trusted, BaaS para fintech regulada).

O sistema não é "menos P2P" por usar centralização onde ela serve melhor — é mais honesto sobre o que cada topologia oferece. A escolha entre paradigmas é decisão de SPECIFICATION da rede, não dogma da plataforma.

### 2.2 Princípio da Adequação Transparente

O sistema adapta-se às capacidades do dispositivo automaticamente, mas comunica essas adaptações ao usuário e oferece controle. Usuários informados podem optar por funcionalidade sobre performance, ou vice-versa, com base em seu próprio julgamento.

O sistema nunca silenciosamente reduz qualidade sem oferecer alternativas, nem força configurações degradadas sem consentimento. Quando a degradação é necessária, ela é proposta ativamente: *"Manter histórico extenso no dispositivo está prejudicando o desempenho. Liberar espaço com backup?"*, *"IA local está consumindo bastante recurso. Usar IA remota da rede?"*

### 2.3 Princípio do Contexto Paralelo

O sistema permite que o usuário opere simultaneamente em múltiplos contextos identitários sem trocar de aplicação ou perder estado. Personas diferentes podem coexistir em colunas diferentes da interface, cada uma com suas capabilities, módulos e dados ativos. Isso reflete a realidade contemporânea de identidades fluidas: a mesma pessoa é simultaneamente profissional, consumidor, criador e cidadão.

### 2.4 Princípio da Honestidade Radical

Limitações arquiteturais inerentes ao paradigma local-first são reconhecidas e comunicadas explicitamente, não escondidas atrás de marketing técnico. Em particular:

- **Revogação de acesso ≠ exclusão retroativa.** Como ocorre em qualquer sistema distribuído da indústria — incluindo redes sociais, marketplaces, plataformas de mensagens e suítes corporativas —, dados que foram legitimamente acessados em dispositivos de terceiros não podem ser garantidamente destruídos pelo operador. O sistema cumpre suas obrigações através de mecanismos efetivos (revogação propagada, forward secrecy por época, cache volátil, Linhagem de Versões criptográfica) e delimita responsabilidades claramente entre operador e controladores secundários (detalhamento jurídico no Documento 3).
- **P2P puro tem custos.** Bootstrap inicial pode ser pesado; dados podem eventualmente ficar inacessíveis se peers do grupo desaparecerem; algumas operações simplesmente não funcionam sem infraestrutura.
- **Centralização traz garantias que descentralização não traz.** O sistema oferece ambas, e o usuário/dono escolhe o trade-off informado.
- **Modo Restrito não finge offline-first.** Quando uma rede opera em Modo Restrito de UCAN e a chave expira com o dispositivo offline, o sistema exibe um estado de erro semântico claro ("Modo de Alta Segurança: acesso de leitura bloqueado sem conexão com o validador") em vez de simular comportamento offline-first que não pode cumprir.

### 2.5 Princípio do Substantivo e do Verbo

Na ontologia do sistema, **nós são substantivos e arestas são verbos**. Esta disciplina linguística é vinculativa para todo desenho conceitual:

- O ato de delegar não é um nó — é uma aresta (`DELEGATED_TO`). O nó é o objeto delegado: a capability ou role em si (`ASSET:CAPABILITY`, `ASSET:ROLE`).
- O ato de consentir não é um nó — é uma aresta (`GRANTED_TO`). O nó é o consentimento como objeto que circula no grafo (`ASSET:CONSENT`).
- O ato de aprovar não é um nó — é uma aresta (`APPROVED_BY`). O ato de mutar não é um nó — é uma aresta (`MUTATES`).

**Não existe tipo de nó `EVENT`.** A ação consumada não é um nó próprio: ela é a nova versão do nó-alvo (ou um nó novo, no caso de criação) e/ou uma aresta relacional. A "intenção" de uma ação, por outro lado, é um dado real com conteúdo próprio, e portanto é um nó `CONTENT:INTENT` — um subtipo de CONTENT, não um quinto tipo. A distinção é precisa: **eventos não são nós; intenções são `CONTENT`**.

Esta regra previne uma classe inteira de bugs conceituais e mantém a ontologia coerente. Ela atua em conjunto com o princípio do minimalismo ontológico (seção 6.7), que regula quando criar novos subtipos.

### 2.6 Princípio da Forma Única

Para cada problema, há **uma forma canônica de resolvê-lo** no sistema. Comportamentos não são especificados em três lugares possíveis; são especificados em um lugar definido pela natureza do comportamento:

- Regras de negócio vivem em SPECIFICATIONS.
- Comportamento de UI vive em componentes do design system ou engines.
- Estilos visuais vivem em temas (não em SPECIFICATIONS, não em componentes — detalhamento técnico no Documento 4).
- Permissões vivem em ASSETs validados por SPECIFICATIONS.

Quando há ambiguidade sobre onde algo deve viver, prevalece a forma que minimiza duplicação e maximiza coesão. A flexibilidade arquitetural não justifica caos: liberdade para o desenvolvedor é menos valiosa que previsibilidade do sistema.

### 2.7 Princípio da Imutabilidade do Passado

O sistema é fundamentalmente append-only. SPECIFICATIONS, versões de nós e estados consolidados nunca são alterados via UPDATE. Mudanças geram novos nós ligados aos antigos por arestas semânticas (`SUPERSEDED_BY`, `MIGRATED_TO`, `MUTATES`). Relacionamentos não são deletados: são revogados pela emissão de uma nova aresta do mesmo tipo com `weight = 0` (lápide / tombstone).

Isso garante:

- Auditoria criptográfica perfeita via Linhagem de Versões.
- Capacidade de "viajar no tempo" para qualquer estado anterior.
- Resolução de conflitos por evidência, não por sobrescrita.
- Compatibilidade com criptografia de assinatura (não há "assinatura mutável").
- Nós antigos nunca são re-encriptados: o histórico permanece selado criptograficamente na época em que foi criado.

---

## 3. Stack Tecnológica

### 3.1 Tecnologias Obrigatórias

**Persistência:**
- **SQLite WASM** com persistência em **Origin Private File System (OPFS)**. Banco único como fonte de verdade no dispositivo.
- Apenas duas tabelas físicas replicáveis: `nodes` e `edges`.
- **Triggers SQLite** mantêm tabelas auxiliares de projeção (read models) não-replicáveis. Ver Documento 2.

**Reatividade e Cache:**
- **TinyBase** como camada reativa entre o sistema e a UI. Observa projeções mantidas pelo SQLite, observa o documento Y.js, conduz a escrita local, e expõe APIs reativas granulares para a UI.
- A UI consome do TinyBase, nunca diretamente do SQLite ou do Y.js.

**Sincronização P2P:**
- **Y.js** (CRDT) com providers customizados. O motor Y.js roda no contexto de um Web Worker.
- Comunicação entre peers via **WebRTC** (data channels), com signaling via servidores federados ou Cloud da própria plataforma.

**Identificadores:**
- **ULID** em todo o sistema. Escolhido sobre UUID v7 por: representação textual mais compacta (26 vs. 36 caracteres, economia relevante no tráfego P2P de bilhões de IDs ao longo da vida do sistema), maior legibilidade em logs e auditoria (sem hífens, case-insensitive em Crockford Base32), e ordenação lexicográfica nativa por timestamp embutido (essencial para indexação eficiente em SQLite, evitando fragmentação de B-tree). Ambos têm 128 bits e timestamp nos 48 bits iniciais; o ganho de ULID é prático, não estrutural.

**Criptografia:**
- **WebCrypto API** para AES-256-GCM (encriptação de payload, com authentication tag interno) e Ed25519 (assinaturas).
- Plataformas com **Secure Enclave / Keystore / Keychain** usam-no para chave mestra; fallback em Origin Private File System para plataformas sem.

**Runtime:**
- **Web (browsers modernos)**: navegadores com suporte a WASM, OPFS e WebRTC.
- **Mobile (Capacitor)**: iOS via WKWebView, Android via Chrome WebView. Plugins nativos quando necessário (FileOpener, Haptics, BiometricAuth).
- **Desktop (Electron)**: empacotamento para Windows, macOS, Linux.

### 3.2 Tecnologias de UI

- **React** + **TypeScript** como base.
- **Tailwind CSS** para estilização utilitária, configurado com referência a CSS Custom Properties para suportar tematização dinâmica em runtime.
- **shadcn/ui** como ponto de partida para componentes do design system, naturalmente compatível com o modelo de tokens variáveis.
- Animações via Framer Motion ou equivalente (usar API spring para gestos mobile).
- Virtualização via TanStack Virtual ou equivalente.

A combinação Tailwind + shadcn suporta nativamente o modelo de temas como dados (`CONTENT:THEME`) que injeta valores em CSS Custom Properties em runtime. Detalhamento técnico, vocabulário canônico de tokens e validação de temas no Documento 4.

### 3.3 Tecnologias de Build e Distribuição

- **Vite** como bundler. Code splitting nativo do Vite atende necessidades iniciais de modularização.
- **Monorepo com workspaces**: core (engines + design system + camada de dados) + módulos (chat, marketplace, fintech, etc.) + apps (cloud, desktop, mobile, web).
- **Capacitor CLI** para builds mobile.
- **Electron Builder** para builds desktop.

### 3.4 Tecnologias de IA (Mapeamento, Não Compromisso)

A arquitetura de IA está formalmente fora do escopo da V3.0. As tecnologias abaixo são mapeamento de possibilidades para iteração futura:

- **Web/Browser**: WebGPU + Transformers.js para inferência local em runtime web.
- **Desktop**: integração com Ollama via plugin local.
- **Mobile**: solução não definida; investigar Google AI Edge Gallery e equivalentes.
- **Fallback federado**: peer com hardware potente atua como compute peer para o grupo (via aresta semântica de oferta de compute).
- **Fallback cloud**: serviço pago externo, provido pelo dono da rede em modalidades não-puras.

O capítulo de IA deve ser entendido como mapeamento de casos de uso e possibilidades de implementação, não arquitetura comprometida.

---

## 4. Formatos de Distribuição do Software

A plataforma é distribuída em quatro formatos, cada um com características técnicas distintas. **Formato é dimensão diferente de modalidade de rede** (seção 5): qualquer formato pode operar em qualquer modalidade, com adaptações.

### 4.1 Cloud

Versão executada em servidores e acessível via URL. Capacidades:

- **Signaling server WebRTC embutido**, servindo como ponto de bootstrap para peers da rede.
- **API pública** para integrações server-to-server (BaaS, parceiros, ERPs externos).
- **WebSocket** para conexões persistentes de clientes.
- Peer always-on: atua como nó da rede com características especiais (sempre disponível, alta capacidade de armazenamento, snapshots periódicos).
- Múltiplas instâncias podem rodar em paralelo para alta disponibilidade, comportando-se como cluster.

Quando um usuário acessa a URL de uma instância Cloud, seu navegador recebe a aplicação completa em formato Web (4.2). A partir daí, o navegador opera como peer local-first/offline-first, podendo trocar dados P2P diretamente com outros peers, sem necessariamente passar pela Cloud. Isso reduz drasticamente custo operacional comparado a SaaS tradicional.

### 4.2 Web (Browser)

Aplicação local-first/offline-first executada no navegador do usuário. É o que o navegador recebe ao acessar uma instância Cloud. Capacidades:

- Banco SQLite WASM persistente via OPFS no domínio do navegador.
- Operação offline completa após carga inicial.
- Comunicação P2P direta com outros peers via WebRTC.
- Sem signaling server embutido (depende de Cloud ou trackers federados externos).
- Sem API pública e sem WebSocket server.

### 4.3 Desktop

Aplicação empacotada via Electron para Windows, macOS e Linux. Características técnicas similares à Cloud com diferenças importantes:

- **Signaling server WebRTC embutido**, com escopo geralmente local/LAN.
- **Sem API pública** exposta externamente.
- **WebSocket limitado** a contextos específicos (LAN corporativa, webhooks internos).
- Peer com capacidades elevadas: storage abundante, processamento robusto, conexão estável.
- Adequada a ambientes corporativos com workstations fixas e a power users em P2P puro.

### 4.4 Mobile

Aplicação empacotada via Capacitor para iOS e Android. Características:

- **Sem signaling server** (limitações de conectividade móvel, bateria, e regras das stores).
- Limitações de performance e recursos comparado a Desktop/Cloud.
- Foco em consumo, criação e interação móvel.
- Tier-aware degradation (Princípio 2.2) é especialmente relevante neste formato.

### 4.5 Distribuição em Lojas de Apps

A versão "vanilla" disponibilizada em Apple App Store e Google Play será a versão da rede pública oficial.

Versões corporativas e P2P puro são, idealmente, customizadas e distribuídas com nome próprio e identidade visual própria, como apps separados nas lojas. Esta é a postura padrão.

Possibilidade futura, dependendo de validação de mercado: campo no login para o usuário escolher a rede de destino dentro do mesmo app. Esta possibilidade fica registrada como evolução, não como compromisso da V3.

### 4.6 Implicações Arquiteturais dos Formatos

A existência de quatro formatos com capacidades diferentes implica:

- **Code splitting é obrigatório.** Cada formato carrega apenas o que precisa. Capabilities específicas (signaling server, API server) são módulos opcionais.
- **Mesmo codebase, builds diferentes.** Monorepo com configuração por target. Lógica de negócio e engines são compartilhadas; capabilities de plataforma variam.
- **Defaults arquiteturais otimizam para o caso prioritário.** Como o foco é rede pública distribuída em Cloud + Web + Mobile, defaults de hydration, replication factor, tier de IA e similares assumem esse cenário. Outros cenários ajustam via configuração.

---

## 5. Modalidades de Rede

Modalidade de rede é dimensão ortogonal a formato de software. A modalidade define o **modelo de governança, identidade e infraestrutura** da rede; o formato define **onde o código executa**.

### 5.1 Rede Pública

Rede de livre adesão, equivalente funcional a combinações de redes sociais, marketplaces e plataformas de produtividade compartilhada. Características:

- Fundador inicial (pessoa ou board) opera o "peer do sistema" e mantém infraestrutura Cloud para signaling, snapshots e disponibilidade.
- Usuários se cadastram livremente, criando seu próprio `PROFILE:AUTHENTICATION`.
- Verificação de identidade combinada (auto-atestação + reputação como ASSET nativo + KYC opcional + atestação por curadores), com SPECIFICATION definindo qual nível é exigido para qual ação.
- Specifications canônicas (da plataforma) governam tipos universais; specifications de rede (do fundador) podem estendê-las para adicionar campos ou ajustar regras.
- Foco prioritário de desenvolvimento.

### 5.2 Rede Corporativa Whitelabel

Rede fechada operada por uma empresa, equivalente funcional a intranet + ERP + CRM + colaboração interna. Características:

- Empresa é fundadora; geralmente opera infraestrutura própria (Cloud em servidores próprios ou nuvem privada). Frequentemente mais de um peer é configurado como storage de alta disponibilidade (servidores, máquinas de escritório).
- Identidade dos funcionários é provisionada centralmente (SSO, AD, Okta), com `PROFILE:AUTHENTICATION` criado pela empresa.
- Personas profissionais (`PROFILE:PERSONA`) podem ser pessoais do funcionário ou disponibilizadas pela empresa via delegação (`ASSET:CAPABILITY` ou `ASSET:ROLE` com aresta `DELEGATED_TO`).
- Geralmente não há atividade pessoal na rede: ela é equivalente a intranet, focada em trabalho. Todos os perfis são profissionais.
- Specifications de rede são extensas, refletindo regras de negócio específicas da empresa (workflows BPMN, roles, fluxos de aprovação).
- Convidados externos (terceirizados, auditoria, prestadores) recebem capabilities limitadas.
- Foco secundário de desenvolvimento.

### 5.3 Rede P2P Pura

Rede sem infraestrutura central, operada exclusivamente entre dispositivos de usuários. Características:

- Sem fundador permanente ou com fundador que dissolveu superpoderes.
- Identidade é totalmente soberana do usuário; sem provisionamento centralizado.
- Bootstrap por convite (QR code, link compartilhado) ou por trackers federados públicos comunitários.
- Operações que dependem de árbitro autoritativo (fintech regulada, NF-e sequencial, validação de quórum corporativo) **não estão disponíveis** ou estão muito limitadas.
- Onboarding inclui aviso explícito de responsabilidade: o usuário é o único detentor e responsável pelos seus dados; não existe administrador central para repor histórico ou apagar dados.
- Foco terciário de desenvolvimento; valor estratégico para comunidade open source e exploração de limites de privacidade.

### 5.4 Redes São Silos

**Decisão arquitetural firme:** redes não se comunicam entre si. Um usuário pode ter contas em múltiplas redes, mas cada rede tem seu próprio `PROFILE:AUTHENTICATION` separado, seu próprio banco SQLite, seus próprios peers, suas próprias capabilities.

Implicações:

- Não há "identidade única globalmente". Identidade é por rede.
- Não há sync de dados entre redes.
- Migração de uma rede para outra é exportação manual de dados, não portabilidade de identidade.
- Privacidade entre contextos é garantida por **arquitetura** (silos completos), não por criptografia complexa de derivação.

### 5.5 Múltiplas Redes no Mesmo Dispositivo

O mesmo app pode gerenciar múltiplas redes simultâneas:

- Banco SQLite separado por rede.
- Sync Y.js separado por rede.
- Peers separados por rede.
- Sidebar de redes na UI permite trocar contexto.

Preferências globais do dispositivo (temas instalados, idioma do app, configurações de acessibilidade) ficam em **espaço local não-replicável** do app, fora dos bancos de rede.

Em casos onde a complexidade dessa coexistência se prove problemática durante implementação, há fallback aceitável: forçar que cada rede seja um app/URL separado, com gerenciamento manual pelo usuário. Esta possibilidade é registrada como contingência, não como plano.

### 5.6 Toda Rede Tem um Fundador

Toda rede nasce de um ato de bootstrap. O fundador é um peer único (uma pessoa) ou um board (múltiplos peers em governança coletiva). O fundador opera o "peer do sistema" inicial, que serve como ponto de entrada para conteúdo público da rede e como bootstrap para novos peers.

O fundador pode, ao longo do tempo, dissolver parcial ou totalmente seus superpoderes em favor de governança mais distribuída ou de P2P mais puro. Essa dissolução é registrada na Linhagem de Versões da `SPECIFICATION:NETWORK_GOVERNANCE` e é irreversível (princípio da imutabilidade). Detalhes de sucessão e dissolução no Documento 3.

---

## 6. A Ontologia: Os Quatro Tipos de Nó

A fundação radical do sistema reside em uma decisão de minimalismo: toda entidade do mundo, independente de domínio, é representada por um de quatro tipos de nó. As relações entre nós são representadas por arestas. Não existem outras tabelas de domínio, e não existe um quinto tipo `EVENT`.

### 6.1 PROFILE — O Ator

Entidades ativas que possuem identidade criptográfica (par de chaves pública/privada). Atuam como sujeitos de ações no sistema.

**Exemplos concretos:**
- Pessoa física (usuário humano).
- Pessoa jurídica (empresa, departamento).
- Bot ou agente automatizado.
- "Peer do sistema" / Cloud instance.

**Subtipos canônicos iniciais:**
- `PROFILE:AUTHENTICATION` — a identidade-âncora do humano dentro de uma rede. Carrega credenciais e chave mestra. Único por humano por rede.
- `PROFILE:PERSONA` — máscaras públicas do humano para interação. Múltiplas por humano são permitidas.
- `PROFILE:ORGANIZATION` — entidade jurídica ou departamento.
- `PROFILE:SYSTEM` — peer do sistema, bot autorizado, cloud instance.

**Relação com arestas:**
- *Emitem* ações: `AUTHORED`, `APPROVED_BY`, `SIGNED_BY`.
- *Recebem* pertencimento ou ativos: `MEMBER_OF`, `DELEGATED_TO`, `OWNS`.

### 6.2 CONTENT — A Informação

Dados passivos e estruturados. Não executam regras nem possuem saldo. São o "material" do sistema.

**Exemplos concretos:**
- Posts de feed social, comentários, mensagens de chat.
- Documentos de texto, planilhas, apresentações.
- Faturas, contratos, ordens de compra.
- Cadastros de produto, fichas de cliente.
- Dados pessoais (`CONTENT:PERSONAL_DATA`), temas (`CONTENT:THEME`), traduções (`CONTENT:TRANSLATION`).
- **Intenções de ação (`CONTENT:INTENT`)** — ver 6.2.1.

**Relação com arestas:**
- São *alvos* de criação: `AUTHORED`.
- São *modificados* por novas versões ligadas via `MUTATES`.
- São *governados* por regras: `GOVERNED_BY`.
- Podem *referenciar* outros conteúdos: `REPLIES_TO`, `MENTIONS`, `ATTACHES`.

#### 6.2.1 CONTENT:INTENT — A Intenção como Conteúdo de Primeira Classe

Quando uma ação exige validação não-trivial (multi-sig, quórum, árbitro externo, aprovação humana), a "intenção" dessa ação não é uma requisição efêmera nem uma aresta flutuante: é um nó real, do subtipo `CONTENT:INTENT`. Ele tem payload (os dados propostos para a ação), nasce já governado pela SPECIFICATION da ação que deseja invocar (aresta `GOVERNED_BY`), e trafega pela rede até os validadores.

Isso é coerente com os quatro tipos: a intenção é informação passiva (uma proposta), e portanto é CONTENT. Não há quinto tipo `EVENT`.

Ações **auto-aprovadas single-user** (specification declara mecanismo de validação `auto_self`, ex: curtir um post, escrever nota privada) **não materializam** um `CONTENT:INTENT`: a intenção é transitória em memória, a validação local é instantânea, e o que é persistido é diretamente a ação (nova versão do nó-alvo, ou nó novo, ou aresta). O ciclo completo de intenção materializada é detalhado no Documento 3.

### 6.3 ASSET — O Valor e a Permissão

Qualquer elemento que denota posse, saldo, capacidade ou direito. Atravessa múltiplos domínios sob uma única abstração.

**Exemplos concretos:**
- Saldo financeiro (em moeda fiduciária ou interna).
- Inventário de estoque (quantidade de SKU).
- Vagas, slots, bilhetes (recursos finitos).
- Capabilities técnicas (`ASSET:CAPABILITY`): direito de operar, ler, escrever.
- Roles corporativos (`ASSET:ROLE`): "Gerente Financeiro", "Diretor de Vendas".
- Consentimentos (`ASSET:CONSENT`): autorizações LGPD.
- Locks temporários (`ASSET:LOCK`): reservas com TTL.
- Reputação e avaliações (`ASSET:REPUTATION`).

**Relação com arestas:**
- São *transacionados* entre profiles: `TRANSFERRED_TO`.
- São *delegados* (capabilities, roles): `DELEGATED_TO`.
- São *garantidos* a profiles (consentimentos): `GRANTED_TO`.
- São *vinculados* a contents (reputação a um produto): `VINCULATED_TO`.

**Insight estrutural:** ao tratar inventário, locks, capabilities e dinheiro todos como ASSETs com a mesma mecânica de transferência validada, o sistema cria um mecanismo unificado de gestão de recursos escassos. Um único motor de validação serve todos os domínios escassos; uma única auditoria; uma única garantia anti-double-spend.

### 6.4 SPECIFICATION — A Lei

Contratos formais que definem como o sistema deve se comportar. Podem ser esquemas de validação (JSONSchema, JSONLogic), código executável (WASM), fluxos BPMN, ou combinações.

**Exemplos concretos:**
- Esquema de "Ordem de Compra" definindo campos obrigatórios.
- Regra de validação "Transferências acima de 10k exigem 2 aprovações".
- Contrato RBAC corporativo definindo hierarquia.
- Spec de governança da rede definindo sucessão.
- Spec de tema definindo tokens visuais.
- Spec de tradução definindo chaves de i18n.

**Relação com arestas:**
- *Governam* outros nós: `GOVERNED_BY`.
- *Sucedem* versões anteriores: `SUPERSEDED_BY`.
- *Estendem* specs canônicas: `EXTENDS`.
- *Migram* dados de outras specs: `MIGRATED_TO`.

**Imutabilidade:** SPECIFICATIONS nunca são alteradas via UPDATE. Evolução é sempre criação de novo nó com aresta semântica para o anterior. Isso preserva auditoria criptográfica e permite que dados antigos continuem governados pela versão sob a qual foram criados.

### 6.5 Linhagem e Versão: entity_id vs. id

Todo nó possui **dois identificadores ULID distintos**:

- **`id`** — identificador único desta versão específica do nó.
- **`entity_id`** — identificador estável da entidade ao longo do tempo (sua linhagem). Igual ao `id` na primeira versão; mantido constante em todas as versões subsequentes da mesma entidade.

Quando uma entidade muda, **não há UPDATE**: nasce um novo nó-versão com `id` novo, mesmo `entity_id`, e uma aresta `MUTATES` ligando a versão anterior à nova. O conjunto de todas as versões de um mesmo `entity_id`, encadeadas por `MUTATES`, forma a **Linhagem de Versões** da entidade (ver 6.6).

Os quatro tipos de nó possuem `entity_id` por uniformidade. PROFILE e CONTENT usam versionamento intensivamente (perfis evoluem, documentos são editados). ASSET e SPECIFICATION usam de forma mais esparsa, mas a coluna existe e permite versionamento quando aplicável (rascunhos de roles, iterações de uma specification antes da publicação). Quando uma entidade não tem semântica de versionamento ativa, `entity_id` simplesmente permanece igual ao `id`.

Para SPECIFICATIONs há uma nota de coerência: coexistem dois mecanismos de versionamento que não conflitam. O `entity_id` agrupa a **linhagem de edição** de uma spec, incluindo seus rascunhos não publicados. A aresta `SUPERSEDED_BY` liga **versões publicadas distintas** (evolução SemVer formal e governada). Um rascunho da spec v2.0 sendo trabalhado compartilha `entity_id` com suas iterações de rascunho; quando publicado, recebe aresta `SUPERSEDED_BY` vinda da v1.0. Detalhes no Documento 3.

### 6.6 Linhagem de Versões — A Auditoria Universal Emergente

A auditoria do sistema não é um subsistema separado: ela **emerge da estrutura**. Como toda escrita cristaliza num nó-versão assinado, e cada transição é registrada por uma aresta `MUTATES` que carrega o diff e o hash da versão anterior, o histórico completo de qualquer entidade é a sua Linhagem de Versões — verificável criptograficamente, sem necessidade de mecanismo dedicado.

A Linhagem de Versões é tecnicamente uma DAG (grafo acíclico dirigido), não uma cadeia estritamente linear: em domínios de edição colaborativa, edições concorrentes offline podem ramificar a linhagem em branches que depois reconvergem num merge. O termo "Linhagem" (e não "Cadeia") foi escolhido justamente por acomodar naturalmente ramificação e reconciliação, como uma árvore genealógica.

A Linhagem de Versões vale para todos os quatro tipos de nó e todas as modalidades de rede. Ela é a auditoria universal. O **MFA-S** (ver glossário e Documento 3) é um mecanismo distinto e de escopo restrito: ele atua **apenas em documentos de edição colaborativa**, analisando os diffs binários do CRDT e produzindo um diff semântico legível ("parágrafo 3 reescrito"). MFA-S não é a auditoria da plataforma — é o tradutor semântico do caso colaborativo.

### 6.7 Edges (Arestas) — Os Verbos

Arestas representam relações e ações no grafo. Toda aresta tem `id`, `entity_id`, `source_id`, `target_id`, `type`, e pode carregar payload metadado. Detalhes de schema no Documento 2.

**Divisão semântica de alvos.** O alvo de uma aresta aponta para `entity_id` ou para `id` específico conforme a natureza do tipo de aresta:

- **Arestas estruturais permanentes** (`OWNS`, `MEMBER_OF`, `DELEGATED_TO`, `BELONGS_TO`) apontam para `entity_id`. Assim, quando a entidade ganha nova versão, a aresta não fica órfã.
- **Arestas de interação transacional** (`APPROVED_BY`, `MUTATES`, `RESOLVES`) apontam para o `id` da versão específica que estão afetando ou aprovando.

A SPECIFICATION de cada tipo de aresta declara qual comportamento ela segue.

**Lápides (tombstones).** Como o banco é append-only, relacionamentos não são deletados. São revogados pela emissão de uma nova aresta do mesmo tipo, ligando as mesmas entidades, com payload `weight = 0`. Triggers SQLite tratam a desativação na camada de projeção local (Documento 2).

**Categorias de arestas (não exaustivas):**

*Autoria e modificação:* `AUTHORED`, `MUTATES`, `SIGNED_BY`.

*Validação e consolidação:* `APPROVED_BY`, `RESOLVES`, `WITNESSED_BY`.

*Pertencimento e estrutura:* `MEMBER_OF`, `OWNS`, `BELONGS_TO`, `CONTAINS`.

*Transferência e delegação:* `TRANSFERRED_TO`, `DELEGATED_TO`, `GRANTED_TO`, `REVOKED_FROM`.

*Governança:* `GOVERNED_BY`, `SUPERSEDED_BY`, `EXTENDS`, `MIGRATED_TO`.

*Referência e relação:* `REPLIES_TO`, `MENTIONS`, `ATTACHES`, `VINCULATED_TO`, `RELATES_TO`.

A nomenclatura completa de arestas é definida nas SPECIFICATIONS canônicas e pode ser estendida por specs de rede, sob as diretrizes da seção 6.8.

### 6.8 Diretrizes de Minimalismo Ontológico

A ontologia de quatro tipos cobre todo o sistema apenas se for disciplinada. Sem regras claras, há risco de proliferação descontrolada de subtipos e arestas, fragmentando o ecossistema. Esta subseção estabelece o framework conciso; o detalhamento operacional, processo de criação de subtipos canônicos versus de rede e exemplos extensivos estão no Documento 3.

**Princípio do minimalismo ontológico:** um novo subtipo de nó ou aresta só é justificado quando atende **todos** os critérios:

1. **Diferencia comportamento sistêmico**, não apenas semântica humana. Se a única diferença entre dois subtipos é nome, eles são o mesmo subtipo.
2. **Não pode ser expresso por payload + SPECIFICATION.** Subtipo é último recurso, não primeiro.
3. **Tem ao menos uma aresta ou validação que só faz sentido para ele.**
4. **É reusável por múltiplos domínios** ou é fundamental para um único domínio crítico.

**Hierarquia de adição:**

- *Subtipos canônicos* (impactam todo o ecossistema): só pela plataforma, via processo de governança formal, versionados e com migração explícita.
- *Subtipos de rede*: pelo dono da rede, devendo estender canônicos quando possível.
- *Subtipos de usuário*: raros, tipicamente em P2P puro ou em redes que permitam explicitamente.

**Princípio de descoberta-by-grafo:** comportamentos do sistema baseiam-se em propriedades do grafo (existe aresta de tipo X? nó está governado por qual SPECIFICATION?), não em comparação direta de tipos. Isso mantém o sistema flexível e desencoraja proliferação.

---

## 7. Identidade, Autenticação e Personas

Em qualquer rede, todo humano tem três tipos de nós associados à sua identidade. Esta separação é arquitetural e atende simultaneamente a privacidade, governança corporativa e flexibilidade de uso.

### 7.1 Os Três Nós da Identidade Humana

**`PROFILE:AUTHENTICATION`** — A identidade-âncora dentro de uma rede:
- Carrega credenciais (chave mestra, fatores de autenticação).
- Único por humano por rede.
- Não é diretamente exposto a outros peers como interlocutor; é a "raiz" da identidade.
- Em rede corporativa, é provisionado pela empresa.
- Em rede pública/P2P puro, é criado pelo usuário no cadastro.

**`CONTENT:PERSONAL_DATA`** — Dados pessoais privados:
- Nome real, contatos, preferências individuais, dados sensíveis (CPF, etc.).
- Vinculado ao `AUTHENTICATION` correspondente.
- Por padrão, privado; compartilhamento é explícito via `ASSET:CONSENT`.
- Sujeito a obrigações LGPD/GDPR, com primitivas dedicadas (detalhamento no Documento 3).

**`PROFILE:PERSONA`** — Máscaras públicas operacionais:
- Como o humano aparece para outros peers em interações.
- Múltiplas por humano (gaming, profissional, vendedor, família, etc.).
- Cada persona tem seu próprio nome de exibição, avatar, biografia.
- Aresta `AUTHENTICATION → PERSONA` tem **visibilidade restrita**, permitindo operação multi-persona sem exposição da ligação subjacente.

### 7.2 Login Único Por Rede

Dentro de uma rede, o usuário tem um login único (credencial + senha ou equivalente) que destrava o `AUTHENTICATION` daquela rede e dá acesso a todas as personas associadas.

**Entre redes**, credenciais são separadas. Como redes são silos (5.4), não há single sign-on entre elas. O usuário gerencia múltiplos logins, um por rede.

### 7.3 Switch de Persona e Contexto Paralelo

Em rede pública, o usuário tem múltiplas personas e troca entre elas conforme o contexto:

- **Persona Pessoal**: para uso social, fintech pessoal, marketplace de consumidor.
- **Persona Vendedor**: para gestão de produtos, marketplace business, fintech business.
- **Persona Criador**: para publicação de conteúdo, recebimento de monetização.
- **Persona Profissional**: para uso em contextos de trabalho.

O switch é **contextual**, não fundamental: muda capabilities ativas, módulos visíveis, dados acessíveis — mas não muda identidade nem rede. A `AUTHENTICATION` é a mesma, o banco é o mesmo, o dispositivo é o mesmo.

**Multi-coluna com personas distintas (Princípio 2.3):** em layouts multi-coluna (Desktop, Tablet), cada coluna pode ter uma persona ativa diferente. Usuário pode ter persona pessoal num player de vídeo numa coluna e persona profissional no email em outra coluna, simultaneamente.

### 7.4 Delegação de Persona Corporativa

Padrão arquitetural formalizado para rede corporativa: a empresa pode criar uma persona vinculada ao seu `PROFILE:ORGANIZATION` (ex: "Gerente Financeiro") e delegar sua operação a um funcionário via aresta `DELEGATED_TO`, transportada por `ASSET:CAPABILITY` ou `ASSET:ROLE`.

Mecânica:

1. Empresa cria `PROFILE:PERSONA` "Gerente Financeiro" (persistente, parte da estrutura organizacional).
2. Empresa emite `ASSET:ROLE` correspondente.
3. Empresa cria aresta `DELEGATED_TO` ligando o asset ao `PROFILE:AUTHENTICATION` do funcionário.
4. Funcionário, ao operar, seleciona a persona corporativa no switch e acessa históricos, comunicações e capacidades vinculadas àquela persona.
5. Quando funcionário sai, asset é revogado (aresta de revogação / lápide): persona corporativa persiste para continuidade e auditoria, funcionário não opera mais ela, outro funcionário pode receber delegação.

Esta mecânica reaproveita a ontologia: persona é nó como qualquer outro, delegação é aresta padrão, role é asset padrão.

### 7.5 Verificação de Identidade

A necessidade de verificar que um peer é quem diz ser varia por modalidade:

**Rede corporativa:** trivial. Empresa atesta. UCAN emitida pela empresa via SSO já carrega atestação suficiente.

**Rede pública:** modelo combinado, com SPECIFICATION da rede definindo qual nível é exigido para qual ação:

- *Auto-atestação*: usuário declara identidade, ninguém valida (suficiente para postagem casual).
- *Reputação*: `ASSET:REPUTATION` acumula via interações, vinculável a `PROFILE:PERSONA`. Reputação alta funciona como atestação implícita pelos peers.
- *KYC opcional*: integração com parceiro de verificação documental gera `ASSET:VERIFIED_IDENTITY`. Exigido para ações de alto valor (transações grandes, vendas em massa).
- *Atestação curada*: fundadores ou peers selecionados emitem `ASSET:VERIFIED_BY_CURATOR`. Modelo similar a "blue checkmark".

**Rede P2P pura:** sem mecanismo central. Verificação é responsabilidade do usuário (convida quem confia, valida via canais externos). Reputação ainda funciona, mas é mais frágil.

### 7.6 Recuperação de Acesso (Visão Geral)

A recuperação de acesso à conta é configurável por SPECIFICATION da rede. A plataforma oferece três modelos canônicos:

**Modelo "central"** — recomendado para redes corporativas que exigem garantia de continuidade operacional. A empresa detém capability de restaurar acesso de funcionário independentemente de ele possuir o dispositivo original. Trade-off honesto: a empresa tem capability técnica de acessar dados do funcionário se desejar (similar a Microsoft 365 corporativo). Funcionário sabe disso via contrato de trabalho.

**Modelo "shamir"** — Shamir's Secret Sharing 2-de-3 com partes em (1) dispositivo do usuário, (2) cofre do fundador da rede, (3) canal externo do usuário (email/SMS). Adequado para rede pública. As três partes devem ser independentes para garantir que comprometimento de uma única não destrava a chave.

**Modelo "user_only"** — usuário é único responsável pela recuperação, via seed phrase ou backup que ele mesmo guarda. Adequado para P2P puro e para usuários que priorizam soberania. Perda do dispositivo e do backup significa perda genuína de acesso.

A SPECIFICATION da rede define o modelo padrão e pode permitir customização por usuário onde fizer sentido. Detalhamento técnico de implementação, opções intermediárias e operacionalização da recuperação no Documento 3.

### 7.7 Múltiplas Redes Simultâneas

Reiterando 5.5: cada rede é instância isolada com banco próprio. App orquestra. Preferências globais do dispositivo ficam em espaço local não-replicável.

---

## 8. Threat Model e Princípios de Segurança

### 8.1 O Que o Sistema Protege

- **Confidencialidade de payload em repouso e em trânsito.** Encriptação AES-256-GCM em payload de nodes/edges; canais WebRTC encriptados.
- **Integridade e autenticidade verificáveis por qualquer peer.** A assinatura Ed25519 do autor cobre o hash do **ciphertext** concatenado com metadados (`hash(id || entity_id || type || payload_ciphertext || payload_iv || epoch || created_at)`). Isso permite que qualquer peer — mesmo sem capability de leitura — verifique autoria e integridade do nó, e portanto se recuse a propagar dados corrompidos ou forjados. Como nós antigos nunca são re-encriptados (princípio 2.7), a assinatura sobre ciphertext é permanente e não precisa ser refeita.
- **Integridade do conteúdo descriptografado.** O authentication tag interno do AES-256-GCM detecta qualquer modificação no ciphertext; metadados que precisam ser autenticados sem serem encriptados ficam no `payload_aad` (Additional Authenticated Data), que o GCM também autentica.
- **Integridade do histórico.** A Linhagem de Versões (arestas `MUTATES` com hash da versão anterior) detecta qualquer tentativa de alteração retroativa.
- **Autorização granular.** Capabilities (UCAN-style) com TTL curto; revogação propaga rapidamente em redes com validador online.
- **Forward secrecy parcial.** Rotação de chaves por época previne acesso a conteúdo novo após revogação (detalhado em Documento 2).

### 8.2 O Que o Sistema Não Protege (Limitações Honestas)

Honestidade radical (Princípio 2.4) exige enumeração explícita de limitações. Estas limitações são **comuns à indústria de sistemas distribuídos** e refletem a natureza de qualquer plataforma onde dados são legitimamente acessados em dispositivos fora do controle do operador.

- **Cópias offline antigas após revogação.** Como ocorre em redes sociais, marketplaces, plataformas de mensagens e suítes corporativas concorrentes (Mercado Livre, Instagram, WhatsApp, Microsoft 365, Google Workspace), quem teve acesso legítimo a dados em algum momento e fez cópia local mantém essa cópia mesmo após revogação. A LGPD/GDPR não exige destruição mágica retroativa; exige melhores esforços do controlador, que o sistema implementa: revogação efetiva, propagação para peers ativos, forward secrecy, Linhagem de Versões demonstrável. Detalhamento jurídico e responsabilidades do controlador no Documento 3.
- **Acesso runtime ao app desbloqueado.** Se o atacante tem acesso ao dispositivo desbloqueado e ao app aberto, ele vê o que o usuário vê. Encriptação em repouso protege contra backups e apps de terceiros, não contra screen capture com app aberto. Os índices locais em texto plano (Documento 2) compartilham essa limitação: são encriptados em arquivo, descriptografados apenas em memória ativa.
- **Correlacionamento de metadados em rede pública.** Mesmo com personas separadas, padrões temporais e relações podem revelar ligações. Mitigação parcial via personas múltiplas, não absoluta. Em rede corporativa este risco é menor (silo fechado); em P2P puro depende da disciplina do usuário.
- **Disponibilidade em P2P puro.** Se peers do grupo desaparecem, dados ficam inacessíveis. Não é "perda" no sentido criptográfico, mas é perda funcional para o usuário, comunicada explicitamente no onboarding.
- **Consenso global sob particionamento prolongado.** Sem validador online, operações não-comutativas (transferências, decrementos de inventário) não se materializam. Sistema permanece consistente, mas inerte para essas classes de operação.

### 8.3 Hierarquia de Chaves

| Camada | Tipo | Armazenamento | Função | Lifetime |
|--------|------|---------------|--------|----------|
| Chave Mestra | Ed25519 | Secure Enclave / Keychain / Keystore | Identidade do AUTHENTICATION; assinatura de operações | Permanente até revogação |
| Chave do Dispositivo | AES-256 | Derivada da chave mestra; cache em memória | Encriptação de índices locais e tabelas auxiliares (Documento 2) | Permanente para o dispositivo |
| Chave de Conteúdo (por época) | AES-256 | KMS / volátil em memória / derivada via UCAN | Encriptação de payload de grupo/documento | Por época (rotação) |
| Cache Volátil | AES-256 (mesmo material) | Memória apenas | Chaves de conteúdo descriptografadas para uso ativo | TTL 4 horas (default, ajustável por SPECIFICATION) |
| UCAN Token | Nó `ASSET:CAPABILITY` no grafo | Delegação de capability, transporte de chave | TTL curto definido pela emissão (minutos a dias) |

Detalhes de rotação por época, KMS online-optional e modo restrito de UCAN estão no Documento 2.

### 8.4 Princípios de Privacidade

- **Privacidade por arquitetura, não apenas por criptografia.** Redes são silos (5.4), reduzindo correlacionamento a quase zero entre contextos diferentes.
- **Mínimo conhecimento por padrão.** Peers só descobrem conteúdo a que têm capability; Graph-Based Routing (Documento 2) restringe descoberta de peers a relações de grafo já estabelecidas.
- **Transparência de coleta.** Telemetria, quando existe, é explícita e configurável. Em P2P puro, é desativada por padrão.
- **Consentimento como primitiva.** `ASSET:CONSENT` é mecanismo nativo para autorização granular de processamento de dados pessoais.

---

## 9. Glossário

**Aresta (Edge)** — Relação ou ação entre dois nós no grafo. Sempre representa um verbo.

**ASSET** — Tipo de nó que representa posse, saldo, capacidade ou direito.

**AUTHENTICATION** — Subtipo de PROFILE que carrega credenciais; raiz da identidade humana em uma rede.

**CONTENT** — Tipo de nó passivo que carrega informação estruturada. Inclui o subtipo `CONTENT:INTENT`.

**CONTENT:INTENT** — Subtipo de CONTENT que materializa a intenção de uma ação que exige validação não-trivial. Não é um quinto tipo de nó; é um CONTENT.

**CRDT** — Conflict-free Replicated Data Type. Estrutura de dados que converge em múltiplos peers sem necessidade de coordenação central.

**entity_id** — Identificador ULID estável de uma entidade ao longo de todas as suas versões (sua linhagem).

**Fundador** — Pessoa ou board que dá bootstrap a uma rede. Pode dissolver superpoderes ao longo do tempo.

**Graph-Based Routing** — Mecanismo de descoberta de peers usando o próprio grafo como diretório topológico, em substituição a DHT global.

**id** — Identificador ULID único de uma versão específica de um nó.

**Linhagem de Versões (Version Lineage)** — Conjunto de todas as versões de uma entidade (mesmo `entity_id`), encadeadas por arestas `MUTATES`. É a auditoria universal emergente do sistema. Tecnicamente uma DAG, pois acomoda ramificação e reconciliação em domínios colaborativos.

**Local-First** — Paradigma onde dados nascem e vivem no dispositivo do usuário; sincronização é secundária e oportunística.

**MFA-S** — Mecanismo de escopo restrito que, **apenas em documentos de edição colaborativa**, analisa diffs binários do CRDT e produz diff semântico legível. Não é a auditoria da plataforma; a auditoria universal é a Linhagem de Versões.

**Modalidade de Rede** — Modelo de governança e infraestrutura: pública, corporativa whitelabel, P2P pura.

**Nó (Node)** — Entidade no grafo de dados. Sempre representa um substantivo. Quatro tipos: PROFILE, CONTENT, ASSET, SPECIFICATION. Não existe tipo EVENT.

**Peer** — Instância individual da plataforma, independente do formato (Cloud, Web, Desktop, Mobile).

**Peer do Sistema** — Peer especial operado pelo fundador da rede, com função de bootstrap, signaling e snapshot.

**PERSONA** — Subtipo de PROFILE que serve como máscara pública operacional do humano.

**PROFILE** — Tipo de nó que representa atores ativos com identidade criptográfica.

**SPECIFICATION** — Tipo de nó que carrega regras, esquemas e contratos que governam o sistema. Imutável.

**Substantivo/Verbo (Princípio)** — Nós são substantivos (entidades), arestas são verbos (relações/ações).

**Tier-aware Degradation** — Capacidade do sistema de adaptar comportamento conforme capacidade do dispositivo, com transparência ao usuário.

**TinyBase** — Biblioteca usada como camada reativa entre o sistema e a UI. Observa projeções do SQLite e o documento Y.js; conduz escrita local; nunca é a fonte de verdade.

**ULID** — Universally Unique Lexicographically Sortable Identifier. Identificador de 128 bits usado em todo o sistema.

**UCAN** — User Controlled Authorization Network. Token de capability delegável usado para autorização e transporte de chaves. Materializado como `ASSET:CAPABILITY`.

**Validador de Domínio** — Termo geral para autoridade com jurisdição sobre um domínio de negócio específico, conforme definido pela SPECIFICATION. Mecanismos invocáveis incluem validação local automática, single-validator, multi-sig, DPoS, oracle externo, consenso de quórum.

**Whitelabel** — Modalidade onde uma empresa opera sua própria instância da plataforma sob marca própria.

**Y.js** — Implementação de CRDT usada como motor de sincronização entre peers. Roda no contexto de um Web Worker.

---

**Fim do Documento 1 (revisão 3).**

Próximos documentos:
- Documento 2: Camada de Dados e Sincronização
- Documento 3: Modelo Operacional e Governança
- Documento 4: Camada de UI e Engines
