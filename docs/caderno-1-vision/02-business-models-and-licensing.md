# 02-business-models-and-licensing.md — Business Models & Licensing

## 1. Monetização da Rede Pública

A rede pública oficial da **Plataforma V3.1** monetiza-se de forma sustentável e descentralizada, sem recorrer a anúncios invasivos ou à exploração/venda de dados pessoais. O modelo de negócios apoia-se em três pilares:

### 1.1 Taxas de Serviço em Transações (Fintech/Marketplace)
* **Cobrança**: Micro-taxas cobradas em transações financeiras reguladas (via Banking-as-a-Service integrado) ou vendas concluídas no Marketplace primário de bens/serviços.
* **Distribuição**: Uma fração da taxa é destinada ao custeio do Super Peer público que provê a garantia de sincronização always-on e backups remotos dos payloads.

### 1.2 Assinaturas de Recursos Premium e Nuvem
* **Backups Ilimitados**: Armazenamento e reidratação ilimitados de histórico em estado Integral em nossos Super Peers dedicados.
* **Compute Peers**: Acesso facilitado a compute peers de alta performance para inferência de Inteligência Artificial local assistida/remota na nuvem da rede pública.

### 1.3 Marketplace de Customizações e Extensões
* **Taxas de Distribuição**: Criadores que disponibilizam temas (`CONTENT:THEME`), pacotes de tradução (`CONTENT:TRANSLATION`), templates de fluxos BPMN ou aplicações customizadas pagas no marketplace têm uma comissão retida pela plataforma (default: 15-30% conforme o tier de publicação).

---

## 2. Regras de Whitelabel Corporativo

As redes corporativas operam sob um modelo comercial e técnico próprio, permitindo que empresas licenciem a tecnologia da Plataforma V3.1 para criar seus ecossistemas de colaboração privada.

### 2.1 Licenciamento Whitelabel
* **Marca Própria**: A empresa pode alterar inteiramente a identidade visual (nome, logo, paleta de cores padrão) do aplicativo nos formatos Web, Desktop e Mobile.
* **Infraestrutura Própria**: Toda a infraestrutura de sincronização (Cloud Peers, signaling servers) e persistência em banco de dados reside sob controle da empresa licenciante.
* **Isolamento de Silo**: Por segurança de compliance, nenhuma conexão de dados é estabelecida entre a rede corporativa e a rede pública ou outras redes corporativas.

### 2.2 Modelos Comerciais
* **Self-Hosted (On-Premises)**: Licença de software anual baseada no volume de usuários ativos (`PROFILE:AUTHENTICATION` provisionados) ou computadores servidores na rede. A empresa cuida da custódia total das chaves de seus validadores e chaves de época.
* **Managed Cloud (SaaS Híbrido)**: A plataforma gerencia os Cloud Peers sob governança e isolamento lógico/físico restrito para a empresa, oferecendo garantias de SLA, backups estruturados e auditoria em tempo real.

---

## 3. Governança Open Source

A Plataforma V3.1 é orientada por uma governança que equilibra o dinamismo comercial e a soberania tecnológica da comunidade.

### 3.1 Licenciamento de Software
* **Core da Plataforma**: O núcleo do motor distribuído (banco SQLite, wrappers do Automerge Repo, criptografia, infraestrutura base do Sync Worker) é de código aberto sob licenças permissivas (como MIT ou Apache 2.0). Isso incentiva a comunidade a auditar as implementações de segurança e privacidade.
* **Módulos Comerciais Avançados**: Determinados módulos desenvolvidos pela equipe da plataforma (ex: ferramentas avançadas de fintech integrada, conformidade corporativa estrita) podem ser disponibilizados sob licenças comerciais ou licenças restritivas do tipo BSL (Business Source License), que garantem acesso ao código para fins não-comerciais mas exigem pagamento para uso corporativo em redes whitelabel.

### 3.2 Evolução Dirigida pela Comunidade
* **Roadmap de RFCs**: Propostas de alteração em specifications canônicas (`PROFILE:CORE`, `CONTENT:MESSAGE`, etc.) devem ser documentadas e submetidas a um processo público de aprovação (RFCs), impedindo a fragmentação da ontologia.
* **Soberania Tecnológica**: A compatibilidade matemática das arestas e nós garante que qualquer desenvolvedor possa implementar seus próprios clientes compatíveis em outras linguagens (Rust, Go, Swift) mantendo a rede pública interoperável.
