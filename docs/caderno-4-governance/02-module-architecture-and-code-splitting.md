# 02-module-architecture-and-code-splitting.md — Module Architecture & Code Splitting

Este documento descreve a organização física do monorepo da Plataforma V3.1, as políticas de code-splitting de novos módulos e os contratos de extensibilidade de negócios no Superapp.

---

## 1. Estrutura do Monorepo

O código da plataforma está organizado em workspaces no monorepo para separar as preocupações do núcleo de infraestrutura, os aplicativos clientes e os módulos comerciais.

```
plataforma-v3/
├── apps/
│   ├── cloud/         # Build para servidor (signaling + API)
│   ├── desktop/       # Electron build
│   ├── mobile/        # Capacitor build
│   └── web/           # Build para servir via Cloud
├── core/
│   ├── engines/       # Engines base reusáveis (Padrão A)
│   ├── design-system/ # Componentes shadcn-based + tokens
│   ├── data-layer/    # SQLite, TinyBase, Automerge Repo providers
│   ├── crypto/        # Criptografia, Key Vault, UCAN
│   ├── routing/       # Graph-Based Routing
│   ├── validators/    # Validador de Domínio (Zen Engine)
│   └── specs/         # Specifications canônicas
├── modules/
│   ├── chat/          # Comunicação em tempo real
│   ├── feed/          # Redes sociais e feed dinâmico
│   ├── fintech/       # Saldos e transações reguladas
│   ├── marketplace/   # Produtos físicos/serviços
│   ├── workspace/     # Colaboração estruturada
│   └── auth/          # Autenticação local e multi-persona
└── shared/
    ├── types/         # Definições comuns de tipo
    └── utils/         # Helpers globais
```

---

## 2. Estrutura de Módulo e Code Splitting

Cada pasta em `modules/` é tratada como uma mini-aplicação autocontida:
* **Rotas Internas**: Cada módulo define seus fluxos de tela e rotas internas.
* **Composição do Padrão A**: Importa as core engines genéricas e define seus wrappers especializados dentro da subpasta `components/` do módulo.
* **Carregamento Dinâmico (Code Splitting)**: Para acelerar a Onda 0 do primeiro carregamento, todos os módulos secundários são empacotados pelo bundler **Vite** e carregados de forma assíncrona na Main Thread do React:

```typescript
// Importação dinâmica do módulo de chat na rota
const ChatModule = React.lazy(() => import('@plataforma/module-chat'));
```

---

## 3. Configuração de Build por Formato

A compilação via Vite adapta o bundle conforme o formato físico de distribuição, ativando ou removendo pacotes na árvore de dependências (tree-shaking):

* **Web**: Build leve para navegadores. Exclui suporte a plugins nativos do celular e servidores locais.
* **Cloud**: Inclui as dependências de signaling server WebRTC, REST API corporativa, WebSocket e banco físico Better-SQLite3.
* **Desktop (Electron)**: Carrega signaling server LAN local e OPFS adapters nativos.
* **Mobile (Capacitor)**: Bundle minimalista sem signaling server local.

---

## 4. Acoplamento de Novos Módulos e Extensibilidade

Módulos novos são desacoplados do núcleo de dados e UI através de contratos dirigidos por especificações:
* **Marketplaces Parametrizados**: Módulos de comércio (ex: Marketplace de Produtos, Marketplace Financeiro) utilizam a mesma engine de catálogo genérica, sendo particularizados unicamente pela `SPECIFICATION` de schema do item transacionado.
* **Polimorfismo Visual**: Novas features de exibição de dados devem ser acopladas via slots abstratos no `SuperCard` ou formulários no `SmartForm` declarados na especificação do nó de negócio, mantendo o core visual do monorepo intacto e livre de switch-cases por tipo.
* **Sem Contratos Rígidos**: As fronteiras de importação de um módulo para outro devem ser mediadas por interfaces declaradas em `shared/types/`, evitando imports cruzados circulares.
