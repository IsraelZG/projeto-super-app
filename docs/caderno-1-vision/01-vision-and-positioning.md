# 01-vision-and-positioning.md — The Vision & Product Manifesto

## 1. Visão e Posicionamento

A **Plataforma V3.1** é um sistema operacional de dados distribuído, projetado para construir aplicações local-first, offline-first e P2P-oportunístico. Sua ambição é unificar, sob uma mesma fundação técnica, três modalidades de uso historicamente atendidas por sistemas separados:

- **Redes públicas de larga escala**, equivalentes funcionais a combinações de Google Workspace, Mercado Livre e Instagram, com livre adesão de usuários e foco em descoberta, transação e interação social.
- **Redes corporativas whitelabel**, substituindo intranets, ERPs, CRMs e sistemas de produtividade interna de empresas, com identidade gerenciada centralmente e dados isolados.
- **Redes P2P puras**, operadas sem qualquer infraestrutura central, voltadas a usuários que priorizam soberania absoluta sobre dados e identidade.

A plataforma não escolhe entre essas modalidades: ela **as suporta nativamente** através de configuração, mantendo o mesmo núcleo arquitetural. As diferenças entre uma instância pública e uma corporativa não estão em código separado, mas em `SPECIFICATION`s distintas que governam comportamento, regras de validação e políticas de governança.

O foco prioritário de desenvolvimento e investimento é a rede pública. A rede corporativa é foco secundário, viabilizada pela mesma arquitetura. A rede P2P pura é prioridade terciária, valiosa estrategicamente como exercício de limites técnicos (segurança, privacidade, autonomia) e como veículo para comunidade open source contribuir, mais do que como produto comercial autônomo.

---

## 2. Princípios Arquiteturais e Filosofia de Design

Esta seção estabelece os princípios de alto nível que governam a visão do produto.

### 2.1 Princípio do Pragmatismo Topológico
O sistema é P2P-first, mas não P2P-purista. Apenas a modalidade "P2P puro" opera com restrição estrita ao paradigma descentralizado. Todas as demais modalidades adotam P2P **oportunisticamente**: usam suas qualidades onde elas são superiores (resiliência, custo operacional, privacidade local, capacidade offline), mas substituem por mecanismos centralizados onde estes oferecem qualidade superior (recuperação de senha via servidor, snapshots de bootstrap, garantia de disponibilidade de dados, validação trusted, BaaS para fintech regulada).

O sistema não é "menos P2P" por usar centralização onde ela serve melhor — é mais honesto sobre o que cada topologia oferece. A escolha entre paradigmas é decisão de `SPECIFICATION` da rede, não dogma da plataforma.

### 2.2 Princípio da Adequação Transparente
O sistema adapta-se às capacidades do dispositivo automaticamente, mas comunica essas adaptações ao usuário e oferece controle. Usuários informados podem optar por funcionalidade sobre performance, ou vice-versa, com base em seu próprio julgamento.

O sistema nunca silenciosamente reduz qualidade sem oferecer alternativas, nem força configurações degradadas sem consentimento. Quando a degradação é necessária, ela é proposta ativamente: 
> "Manter histórico extenso no dispositivo está prejudicando o desempenho. Liberar espaço com backup?"
> "IA local está consumindo bastante recurso. Usar IA remota da rede?"

### 2.3 Princípio do Contexto Paralelo
O sistema permite que o usuário opere simultaneamente em múltiplos contextos identitários sem trocar de aplicação ou perder estado. Personas diferentes podem coexistir em colunas diferentes da interface, cada uma com suas permissions, roles, módulos e dados ativos. Isso reflete a realidade contemporânea de identidades fluidas: a mesma pessoa é simultaneamente profissional, consumidor, criador e cidadão.
### 2.4 Princípio da Honestidade Radical
Limitações arquiteturais inerentes ao paradigma local-first são reconhecidas e comunicadas explicitamente, não escondidas atrás de marketing técnico. Em particular:

- **Revogação de acesso ≠ exclusão retroativa.** Como ocorre em qualquer sistema distribuído da indústria — incluindo redes sociais, marketplaces, plataformas de mensagens e suítes corporativas —, dados que foram legitimamente acessados em dispositivos de terceiros não podem ser garantidamente destruídos pelo operador. O sistema cumpre suas obrigações através de mecanismos efetivos (revogação propagada, forward secrecy por época, cache volátil, Linhagem de Versões criptográfica) e delimita responsabilidades claramente entre operador e controladores secundários.
- **P2P puro tem custos.** Bootstrap inicial pode ser pesado; dados podem eventualmente ficar inacessíveis se peers do grupo desaparecerem; algumas operações simplesmente não funcionam sem infraestrutura.
- **Centralização traz garantias que descentralização não traz.** O sistema oferece ambas, e o usuário/dono escolhe o trade-off informado.
- **Modo Restrito não finge offline-first.** Quando uma rede opera em Modo Restrito de UCAN e a chave expira com o dispositivo offline, o sistema exibe um estado de erro semântico claro ("Modo de Alta Segurança: acesso de leitura bloqueado sem conexão com o validador") em vez de simular comportamento offline-first que não pode cumprir.

---

## 3. Formatos de Distribuição do Software

A plataforma é distribuída em quatro formatos, cada um com características técnicas distintas. **Formato é dimensão diferente de modalidade de rede**: qualquer formato pode operar em qualquer modalidade, com adaptações.

### 3.1 Cloud
Versão executada em servidores e acessível via URL. 
* **Função principal**: Signaling server WebRTC embutido (bootstrap para peers), API pública para integrações, WebSocket para conexões persistentes, e replicador/peer always-on (snapshots periódicos e garantia de disponibilidade).
* **Comportamento**: Quando um usuário acessa a URL de uma instância Cloud, seu navegador recebe a aplicação completa em formato Web. A partir daí, o navegador opera como peer local-first/offline-first, trocando dados P2P com outros peers sem necessariamente passar pela Cloud, reduzindo drasticamente custos de infraestrutura.

### 3.2 Web (Browser)
Aplicação local-first/offline-first executada no navegador do usuário.
* **Comportamento**: Utiliza SQLite WASM com persistência em Origin Private File System (OPFS) no domínio do navegador. Opera offline após carga inicial. Comunica-se P2P via WebRTC (necessita de Cloud ou tracker de sinalização externo).

### 3.3 Desktop
Aplicação empacotada via Electron para Windows, macOS e Linux.
* **Comportamento**: Características similares à Cloud (possui signaling server embutido para LAN, conexões de storage elevadas e storage local abundante). Ideal para workstations corporativas fixas e power users em P2P puro.

### 3.4 Mobile
Aplicação empacotada via Capacitor para iOS e Android.
* **Comportamento**: Sem signaling server local (devido a restrições de bateria/rede do SO). Aplica ativamente a degradação de tier para economia de recursos.

---

## 4. Modalidades de Rede

Modalidade de rede define o modelo de governança, identidade e infraestrutura da rede; o formato de software define onde o código executa.

### 4.1 Rede Pública
Rede de livre adesão, com livre criação de contas.
* **Infraestrutura**: O fundador inicial mantém infraestrutura Cloud para sinalização, snapshots e disponibilidade.
* **Identidade**: Usuários criam livremente seu `PROFILE:AUTHENTICATION`. A verificação combina auto-atestação, reputação (`ASSET:REPUTATION`), KYC opcional e curadoria.

### 4.2 Rede Corporativa Whitelabel
Rede fechada operada por uma empresa (intranet + ERP + CRM).
* **Infraestrutura**: A empresa opera infraestrutura própria (servidores locais ou nuvem privada) com armazenamento redundante de alta disponibilidade.
* **Identidade**: Provisionada centralmente (SSO/AD/Okta). Personas profissionais são delegadas pela empresa aos funcionários. As `SPECIFICATION`s de rede governam regras complexas e fluxos BPMN corporativos.

### 4.3 Rede P2P Pura
Rede sem qualquer infraestrutura central, de soberania absoluta do usuário.
* **Infraestrutura**: Sem fundador permanente. Descoberta via QR code / convite físico ou trackers comunitários.
* **Limitações**: Funções não-comutativas (fintech regulada, quórum corporativo sequencial) não estão disponíveis ou são fortemente degradadas.

### 4.4 Redes São Silos
**Decisão arquitetural firme:** redes não se comunicam entre si. Um usuário pode ter contas em múltiplas redes, mas cada rede tem seu próprio `PROFILE:AUTHENTICATION` separado, seu próprio banco SQLite local, seus próprios peers e seus próprios direitos de acesso (permissions e roles). Não há identidade única global nem sync de dados inter-redes.

---

## 5. Relações de Governança e Fundador

Toda rede nasce de um ato de bootstrap conduzido por um fundador (um peer único ou um consórcio/board). O fundador opera o "peer do sistema" inicial que auxilia no onboarding seguro de novos peers. Ao longo do tempo, o fundador pode dissolver de forma irreversível seus poderes regulatórios em favor de um modelo descentralizado de quórum ou P2P puro.
