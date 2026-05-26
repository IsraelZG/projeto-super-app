# Plataforma V3.0 — Documento 4: Camada de UI e Engines

**Versão:** 3.0 (Consolidada)
**Status:** Especificação de Referência
**Pré-requisitos:** Documento 1 — Fundamentos Arquiteturais; Documento 2 — Camada de Dados e Sincronização; Documento 3 — Modelo Operacional e Governança

---

## Sumário

1. [Visão Geral da Camada de UI](#1-visão-geral-da-camada-de-ui)
2. [Princípios de UI](#2-princípios-de-ui)
3. [Sistema de Temas](#3-sistema-de-temas)
4. [Internacionalização (i18n)](#4-internacionalização-i18n)
5. [Acessibilidade](#5-acessibilidade)
6. [Padrão A Puro: Princípio de Composição de Engines](#6-padrão-a-puro-princípio-de-composição-de-engines)
7. [Catálogo de Engines](#7-catálogo-de-engines)
8. [Specifications Dirigindo a UI](#8-specifications-dirigindo-a-ui)
9. [Marketplace como Primitiva da Plataforma](#9-marketplace-como-primitiva-da-plataforma)
10. [Customização por Modalidade de Rede](#10-customização-por-modalidade-de-rede)
11. [UX de Sincronização e Estado de Dados](#11-ux-de-sincronização-e-estado-de-dados)
12. [Adequação Transparente na UI](#12-adequação-transparente-na-ui)
13. [Estrutura de Módulos e Code Splitting](#13-estrutura-de-módulos-e-code-splitting)

---

## 1. Visão Geral da Camada de UI

A camada de UI da plataforma é construída sobre quatro decisões fundacionais:

- **React + TypeScript + Tailwind + shadcn/ui** como stack base.
- **Engines como componentes-base reutilizáveis**, especializados via wrappers nomeados (Padrão A puro).
- **SPECIFICATIONs dirigem comportamento**, mas não estilos.
- **Temas e i18n são dados, não código** — distribuídos via marketplace, instalados pelo usuário, validados pela rede.

A relação com as camadas inferiores é estrita:

- UI consome dados via TinyBase (Documento 2, seção 3), nunca diretamente do SQLite.
- UI dispara intenções via API canônica que invoca o ciclo Intenção→Validação→Ação (Documento 3, seção 2).
- UI nunca embute lógica de negócio; consulta SPECIFICATIONs (pré-processadas em O(1) na Onda 0 e cacheadas em `specs_cache` no TinyBase) quando precisa de regras.

Esta separação garante que a UI possa ser substituída, repensada ou reestilizada sem afetar correção do sistema, e que diferentes modalidades de rede possam apresentar UIs distintas operando sobre o mesmo núcleo.

---

## 2. Princípios de UI

### 2.1 Princípio do Local-First na UX

A UI **celebra a velocidade do local-first**. Operações comuns devem ser instantâneas perceptivelmente:

- **Optimistic UI por padrão**: ações são refletidas na UI antes de validação completa quando possível. Se validação falha posteriormente, UI desfaz com feedback claro.
- **Skeleton states ao invés de spinners** quando carregando dados estruturados.
- **Indicadores discretos de sync** em background, não bloqueando interação.
- **Latência de rede tratada como exceção visível**, não como estado padrão.

### 2.2 Princípio da Reusabilidade Disciplinada

Conectado ao princípio 2.6 do Documento 1 (Forma Única): para cada problema de UI há **uma forma canônica de resolvê-lo**. A camada de UI não tem três formas de fazer um filtro, dois sistemas de modal, ou layouts duplicados.

Operacionalmente:

- Engines são as primitivas. Wrappers especializam.
- Componentes do design system cobrem o resto.
- Quando duas implementações começam a divergir cosmeticamente, a divergência é codificada via tokens de tema, não via componentes paralelos.

### 2.3 Princípio da Densidade Adaptativa

A mesma UI atende contextos com necessidades visuais opostas:

- **Densidade ampla** (rede social pessoal, marketplace de consumidor): muito espaço, tipografia generosa, foco em descoberta e prazer visual.
- **Densidade compacta** (ERP, CRM, dashboards corporativos): muita informação por área, eficiência operacional, redução de cliques.

Densidade é controlada via tokens de tema (seção 3) e por SPECIFICATIONs de módulo. Componentes consistentemente respeitam tokens; mudar densidade não exige rewriting.

### 2.4 Princípio Mobile-First Genuíno

A plataforma roda em quatro formatos (Documento 1, seção 4), mas a UI é projetada **mobile-first verdadeiro**: começamos pelo layout móvel e expandimos para desktop, não o contrário.

Implicações:

- Componentes funcionam corretamente em viewport pequeno antes de qualquer otimização desktop.
- Gestos (swipe, long-press, pinch) são primeira-classe, não bolt-on.
- Densidades compactas são opções para desktop, não defaults universais.
- Em desktop/tablet, layouts multi-coluna emergem como expansão natural do layout mobile.

### 2.5 Princípio do Contexto Paralelo na UI

Implementação visual do Princípio 2.3 do Documento 1: em layouts multi-coluna, **cada coluna pode ter persona, módulo e estado próprios**. Concretamente:

- Cada coluna é instância independente de um módulo.
- Persona ativa é controlada por coluna, não globalmente.
- Sincronização de dados é por persona+rede, então colunas com personas diferentes não interferem.
- Drag-and-drop entre colunas respeita capabilities de cada persona.

### 2.6 Princípio do Contexto Emergente do Grafo

A UI não navega por endereços de pasta rígidos nem por caminhos hierárquicos fixos. Não existem construtos do tipo `/projetos/alfa/documentos/` mapeados como estrutura de armazenamento — o grafo não é um filesystem.

O **contexto** de uma tela (ex: *"sala de chat do time Alpha"*, *"pasta de contratos do Projeto X"*) é calculado **dinamicamente** pela UI através de uma query estruturada local — uma CTE recursiva sobre as tabelas SQLite locais, baseada no predicado de pertencimento declarado na SPECIFICATION do contexto.

**Exemplo para o contexto "Projeto X":**

```sql
WITH RECURSIVE context AS (
  SELECT n.*
  FROM nodes n
  JOIN edges e ON e.target_id = n.entity_id
  WHERE e.type LIKE 'PARTICIPATES_IN:PROJECT%'
    AND e.source_id = <persona_entity_id>
  UNION ALL
  SELECT n.*
  FROM nodes n
  JOIN edges e ON e.source_id = context.entity_id
  WHERE e.type IN ('OWNS', 'GOVERNS', 'INTERACTS:CONTENT:CREATED')
)
SELECT * FROM context
WHERE type LIKE 'CONTENT:%';
```

O resultado dessa query **é** o contexto — dinâmico, consistente com o grafo local, recalculado automaticamente conforme arestas evoluem. Não há operação de "mover arquivo" ou "reorganizar pasta": alterar uma aresta `PARTICIPATES_IN` reposiciona o item em todos os contextos que o incluem.

**Implicações para o design de UI:**

- Cada engine de módulo recebe um `contextSpec` — a declaração de qual CTE deve ser executada para compor seu conteúdo.
- O módulo de navegação não gerencia uma árvore de pastas; gerencia um conjunto de `contextSpec`s ativos.
- A busca full-text e os filtros operam sobre o resultado da CTE, não sobre uma hierarquia.
- Um item pode pertencer a múltiplos contextos simultaneamente, sem cópias — apenas arestas distintas.

---

## 3. Sistema de Temas

### 3.1 Modelo Conceitual

O sistema de temas adota o modelo VSCode-like: **temas são arquivos de dados que injetam valores em um vocabulário fixo de tokens**, sem alterar comportamento ou estrutura.

Vantagens dessa escolha:

- Temas são seguros (não podem injetar código).
- Validação é estrutural (schema fixo).
- Distribuição é trivial (são apenas dados).
- Criação não requer conhecimento de implementação de UI.

### 3.2 Stack Técnico: Tailwind + shadcn + CSS Custom Properties

shadcn/ui já é construído sobre CSS Custom Properties. O Tailwind config referencia essas variáveis. Em runtime, o app injeta valores nas variáveis conforme o tema selecionado.

Exemplo conceitual:

```css
/* tailwind.config referencia variáveis */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  /* ... mais tokens */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... overrides para dark mode */
}
```

```typescript
// Aplicação de tema em runtime
function applyTheme(theme: ThemeContent) {
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
}
```

Trocar tema é instantâneo e não requer reload.

### 3.3 Vocabulário Canônico de Tokens

A plataforma define um conjunto fixo de tokens que temas podem ajustar. Componentes consistentemente referenciam esses tokens; tokens não declarados ficam ignorados.

**Categorias de tokens:**

**Cores semânticas (não cores absolutas):**
- `--background`, `--foreground` — fundo e texto principais.
- `--primary`, `--primary-foreground` — cor de destaque e texto sobre ela.
- `--secondary`, `--secondary-foreground`.
- `--muted`, `--muted-foreground` — elementos secundários.
- `--accent`, `--accent-foreground` — destaques pontuais.
- `--destructive`, `--destructive-foreground` — ações destrutivas, erros.
- `--success`, `--warning`, `--info` — estados semânticos.
- `--border`, `--input`, `--ring` — elementos de UI.

**Cores específicas de domínio (canônicas da plataforma):**
- `--success-payment` — confirmação de transação financeira.
- `--warning-stock-low` — estoque baixo no marketplace.
- `--accent-fintech`, `--accent-social`, `--accent-corporate` — destaques por domínio quando relevante.

**Espaçamento e raios:**
- `--radius` — raio padrão de borders.
- `--spacing-base` — unidade base de spacing (afeta densidade).

**Tipografia:**
- `--font-sans`, `--font-mono` — famílias de fonte.
- `--font-size-base` — tamanho base.

**Densidade:**
- `--density-modifier` — multiplicador que afeta padding e gap em componentes.

A lista acima é ilustrativa. O conjunto definitivo é declarado em SPECIFICATION canônica `THEME_VOCABULARY` e versionado.

### 3.4 Estrutura de um Tema

Tema é um nó `CONTENT:THEME` cujo payload segue schema definido pela SPECIFICATION canônica `THEME`:

```yaml
# Exemplo conceitual
content_theme:
  id: "theme_brazilian_sunset"
  type: "CONTENT:THEME"
  metadata:
    name: "Brazilian Sunset"
    author_did: "did:key:z6Mk..."
    version: "1.2.0"
    description: "Tons quentes de pôr-do-sol brasileiro"
    preview_image_id: "asset_thumb_xyz"
  base_mode: "dark"  # ou "light", "system"
  tokens:
    background: "20 30% 8%"
    foreground: "30 40% 96%"
    primary: "25 95% 55%"
    primary-foreground: "20 30% 8%"
    accent: "350 80% 60%"
    success: "120 60% 50%"
    warning: "45 100% 60%"
    radius: "0.5rem"
    spacing-base: "0.25rem"
    font-sans: "'Inter', system-ui, sans-serif"
```

### 3.5 Validação de Temas

Quando um tema é publicado (criado por usuário ou importado), o Validador de Domínio aplicável aplica:

- Schema válido conforme SPECIFICATION `THEME`.
- Todos os tokens obrigatórios presentes.
- Valores nas faixas válidas (cores em formato HSL/RGB, raios numéricos, etc.).
- Contraste mínimo entre pares relevantes (foreground vs. background) para acessibilidade WCAG.

Temas que falham na validação são rejeitados ou marcados como "experimentais" (depende da SPECIFICATION da rede).

### 3.6 Limites Intencionais do Sistema de Temas

O sistema de temas **pode** alterar:

- Cores em todo o vocabulário canônico.
- Espaçamentos (densidade compacta vs. ampla).
- Raios de borda.
- Famílias de fonte.
- Tamanho base de fonte.

O sistema de temas **não pode**:

- Reorganizar layouts.
- Adicionar comportamentos.
- Esconder ou modificar componentes específicos.
- Injetar código JavaScript.
- Adicionar novos tokens (apenas valores para tokens existentes).

Isso é segurança por design. Customizações além do tema requerem caminhos diferentes (componentes de design system para a plataforma; engines especializadas via wrappers para módulos).

### 3.7 Distribuição via Marketplace

Temas são distribuídos via Marketplace (seção 9). Em redes públicas, qualquer usuário pode publicar tema; outros usuários instalam livremente. Reputação e avaliações filtram qualidade naturalmente.

Em rede corporativa, política da rede define quais temas são permitidos:

- **Aberto**: funcionários instalam qualquer tema do marketplace.
- **Curado**: apenas temas aprovados pela empresa.
- **Forçado**: empresa força tema oficial; funcionários não podem alterar (exceto acessibilidade — seção 5).

### 3.8 Tema Local vs. Tema Sincronizado

Temas instalados ficam em **espaço local não-replicável** do dispositivo (Documento 1, seção 5.5). Não são sincronizados entre dispositivos do mesmo usuário automaticamente — preferência visual é tipicamente por dispositivo.

Usuário pode optar por sincronizar tema preferido entre dispositivos via mecanismo dedicado (tema selecionado vira parte de `CONTENT:PERSONAL_DATA` se usuário consentir).

---

## 4. Internacionalização (i18n)

### 4.1 Modelo Conceitual

i18n segue o mesmo princípio dos temas: **traduções são dados, não código**.

- Plataforma mantém **chaves canônicas** de strings em arquivos de fonte.
- Tradução é nó `CONTENT:TRANSLATION` cujo payload mapeia chaves para textos em uma língua.
- Em runtime, app carrega tradução ativa e substitui chaves por textos.

### 4.2 Estrutura de uma Tradução

```yaml
content_translation:
  id: "translation_pt_br_v3"
  type: "CONTENT:TRANSLATION"
  metadata:
    language: "pt-BR"
    region: "Brasil"
    author_did: "did:key:z6Mk..."
    version: "3.1.0"
    coverage_percentage: 98.7
  strings:
    "common.button.save": "Salvar"
    "common.button.cancel": "Cancelar"
    "chat.placeholder.message": "Digite uma mensagem..."
    "fintech.label.balance": "Saldo"
    "marketplace.action.buy": "Comprar"
    # ... milhares de chaves
```

### 4.3 Fluxo Comunitário

Em redes públicas/P2P puro, traduções são contribuição comunitária:

1. Plataforma publica chaves canônicas (em inglês como pivot ou em português brasileiro como base).
2. Tradutores criam `CONTENT:TRANSLATION` para outras línguas.
3. Validação por peers (regra customizável pela SPECIFICATION da rede): pode ser desde "qualquer um publica" até fluxo BPMN completo de revisão e aprovação.
4. Traduções aprovadas entram no marketplace.
5. Usuários instalam tradução desejada.

### 4.4 Validação de Traduções

Validações estruturais automáticas:

- Todas as chaves obrigatórias presentes (ou com fallback explícito para língua-pivot).
- Substring placeholders preservados (ex: se chave canônica é `"Olá, {nome}!"`, tradução deve manter `{nome}`).
- Comprimento aproximado dentro de limites razoáveis para preservar layout.

Validações qualitativas dependem de revisão humana (definida pela rede).

### 4.5 Pluralização e Contexto

Chaves de tradução podem expressar pluralização e contexto:

```yaml
strings:
  "notification.unread.count":
    one: "1 mensagem não lida"
    other: "{count} mensagens não lidas"
  "auth.greeting":
    morning: "Bom dia, {nome}!"
    afternoon: "Boa tarde, {nome}!"
    evening: "Boa noite, {nome}!"
```

### 4.6 Múltiplas Traduções Coexistindo

Em redes corporativas multinacionais, múltiplas traduções podem estar instaladas simultaneamente. Usuário escolhe sua preferência. Notificações sistêmicas podem ser geradas em múltiplas línguas e cada destinatário vê na sua.

### 4.7 Distribuição

Como temas: via marketplace de customizações (seção 9), com governança definida pela SPECIFICATION da rede.

### 4.8 Particularidades Técnicas

- **Timezone em event sourcing**: timestamps no MFA-S são UTC absoluto (Unix ms). Conversão para local é responsabilidade da camada de UI usando timezone do dispositivo.
- **Formatos de moeda, data, número**: usam APIs nativas (`Intl.NumberFormat`, `Intl.DateTimeFormat`) com locale apropriado.
- **RTL vs. LTR**: layouts respeitam direção via CSS lógico (`margin-inline-start` em vez de `margin-left`). Tema declara direção primária.
- **Regulação fiscal por país**: domínios fiscais (NF-e, etc.) têm SPECIFICATIONs específicas por jurisdição (Documento 3, seção 6.6 — caso limite "schemas diferentes").

---

## 5. Acessibilidade

### 5.1 Princípio Vinculativo

Acessibilidade **sempre fica destravada para o usuário, em qualquer modalidade de rede e qualquer política do dono da rede**. Mesmo em rede corporativa que força tema oficial, o usuário pode ajustar:

- Tamanho da fonte.
- Contraste alto.
- Modo escuro.
- Redução de movimento (desativa animações).
- Espessura de fonte.
- Foco visual aumentado.

Isso é **direito básico**, não preferência opcional. Codificado em SPECIFICATION canônica `ACCESSIBILITY` que toda rede herda obrigatoriamente.

### 5.2 Conformidade com WCAG

Componentes do design system aderem a WCAG 2.1 nível AA como mínimo:

- Contraste mínimo 4.5:1 para texto normal, 3:1 para texto grande.
- Navegação completa por teclado.
- ARIA labels e roles em componentes interativos.
- Focus management em modais e navegação.
- Alternativas textuais para conteúdo não-textual.

Validação de temas inclui verificação automática de contraste (seção 3.5).

### 5.3 Suporte a Tecnologias Assistivas

- **Screen readers**: componentes expõem semântica ARIA correta.
- **Voice control**: ações expostas têm labels descritivas.
- **Switch control / acessibilidade motora**: targets de toque mínimos de 44×44px em mobile.
- **Customização de gestos**: alternativas a gestos complexos (long-press, swipe) para usuários que não conseguem executá-los.

### 5.4 Modo de Foco

Para usuários com TDAH, autismo, ou preferência por menos estímulo visual:

- Modo de foco esconde elementos secundários (notificações, decoração).
- Reduz contraste de elementos não-críticos.
- Pode ser ativado por SPECIFICATION (rede corporativa pode forçar para certos contextos) ou por usuário.

---

## 6. Padrão A Puro: Princípio de Composição de Engines

### 6.1 A Regra Única

Toda especialização de uma engine é um **componente nomeado próprio**, vivendo no módulo que o usa, compondo internamente as engines base do core.

Exemplo:

```typescript
// Engine base, no core
function Timeline<T>({ items, renderItem, ...props }: TimelineProps<T>) {
  // Implementação genérica
}

// Wrapper especializado, no módulo de Mensagens
function ChatTimeline({ messages, onReply, onReact }: ChatTimelineProps) {
  return (
    <Timeline
      items={messages}
      renderItem={msg => <ChatBubble message={msg} onReply={onReply} onReact={onReact} />}
      layout="chat-vertical"
    />
  );
}

// Wrapper especializado, no módulo Fintech
function ExtractTimeline({ transactions, onItemTap }: ExtractTimelineProps) {
  return (
    <Timeline
      items={transactions}
      renderItem={tx => <TransactionLine transaction={tx} onTap={onItemTap} />}
      layout="financial-list"
    />
  );
}
```

### 6.2 Por Que Padrão A

A escolha entre padrões foi explicitada como **arquitetural** no Documento 1 (princípio 2.6):

- **Vantagem 1**: Uma forma única de fazer cada coisa. Sem ambiguidade entre "usar a base diretamente" ou "criar wrapper".
- **Vantagem 2**: Refatoração antifragil. Mudanças na engine base são absorvidas pelos wrappers, não vazam para consumidores.
- **Vantagem 3**: Tipagem mais limpa. APIs especializadas com nomes próprios.
- **Vantagem 4**: Cada wrapper é ponto natural de extensão futura.
- **Custo aceito**: boilerplate de wrappers triviais.

### 6.3 Acesso Direto à Engine Base

Quando o caso de uso é genuinamente o caso genérico, **importar a engine base diretamente é permitido**. Wrappers existem para reuso, não como obrigação burocrática.

Regra prática: se o uso é único e tem cara de "será descartado se mudar requisito", use base diretamente. Quando o uso se repete ou ganha estabilidade, vire wrapper.

### 6.4 Consequência: Estrutura de Pastas

```
core/
  engines/
    timeline/         # Engine base
    layout/
    super-card/
    composer/
    media-viewer/
    state-machine/
    geo-spatial/
    relation-graph/
    audit-trail/
    asset-card/
    smart-form/
    context-menu/
    bottom-sheet/
    entity-picker/
    filter/
  design-system/      # shadcn-based + tokens canônicos
  hooks/
  utils/

modules/
  chat/
    components/
      chat-timeline.tsx       # Wrapper de Timeline
      chat-bubble.tsx
      chat-composer.tsx       # Wrapper de Composer
    ...
  fintech/
    components/
      extract-timeline.tsx    # Wrapper de Timeline
      transaction-line.tsx
      payment-form.tsx        # Wrapper de SmartForm
    ...
  marketplace/
    components/
      product-card.tsx        # Wrapper de SuperCard
      marketplace-grid.tsx    # Wrapper de Layout
      filter-drawer.tsx       # Wrapper de Filter + BottomSheet
    ...
```

Cada módulo tem seus wrappers; engines base ficam no core.

---

## 7. Catálogo de Engines

A análise consolidou as 22 engines do blueprint original em um conjunto menor de **engines genuínas reusáveis**, agrupadas por categoria. A lista abaixo é descritiva, não exaustiva — APIs concretas são definidas em iteração de implementação.

### 7.1 Engines de Coleção

Trabalham com listas, grades, conjuntos de itens.

**Timeline** — Lista cronológica vertical de eventos imutáveis. Suporta agrupamento opcional (por data, por autor), virtualização integrada, polimorfismo de item via `renderItem`. Casos: chat, comentários, extrato financeiro, audit trail, tracking logístico, fórum.

**Layout** — Renderização de coleções em diferentes estruturas: Grid, Masonry, List, Tabela. Virtualização extrema para grandes volumes. Container queries para responsividade. Casos: feed social, marketplace, biblioteca de mídia, listas densas corporativas.

**Filter** — Schema-driven filtering. Recebe definição JSON dos filtros disponíveis (range, multiselect, date, search, etc.), gera UI correspondente, mantém estado, expõe query object. Casos: filtros de marketplace, refinamento de extrato, busca avançada CRM, filtros de dashboard.

**Entity Picker** — Busca + seleção de entidades existentes, com autocomplete. Conecta a índices locais (Documento 2, seção 4) e busca federada quando necessário. Suporta single e multi-select. Casos: @mentions, atribuição de responsáveis, seleção de produtos para proposta, autocomplete de endereços.

### 7.2 Engines de Entidade

Renderizam uma entidade individual.

**SuperCard** — Contêiner universal de entidade. Estrutura padronizada: header, body, media, footer, actions. Polimorfismo via slots configurados pela SPECIFICATION da entidade. Casos: post social, produto marketplace, deal CRM, perfil de usuário, contrato.

**AssetCard** — Wrapper especializado para arquivos e ativos com metadados de integridade. Ícone por MIME type, status de sincronização, badge de integridade criptográfica. Casos: PDFs em chat, lâminas de investimento, contratos assinados, anexos de propostas.

**SmartForm** — Construtor de formulários dirigido por SPECIFICATION (schema). Renderiza inputs apropriados por tipo de campo, valida em tempo real, suporta wizards multi-step, autosave em CRDT (drafts). Casos: criação de anúncio, emissão de nota fiscal, cadastro de cliente, configuração de contratos.

### 7.3 Engines de Mídia

Lidam com conteúdo multimídia.

**MediaViewer** — Visualizador universal de imagens e vídeos. Modos: grid de thumbnails, carrossel inline, lightbox imersivo. Gestos nativos (pinch, swipe, swipe-dismiss). Resolução de blobs P2P (CIDs, SQLite blobs). Blurhash para placeholders. Casos: galerias de feed, fotos de produto, stories, reels, mídia em chat.

**UniversalPlayer** — Reprodutor de áudio e vídeo contínuo. Controles padronizados (play/pause/seek/scrub), Picture-in-Picture global, integração com APIs do SO para reprodução em background. Distinto do MediaViewer porque foca em mídia temporal contínua. Casos: vídeos longos, podcasts, mini-player flutuante de música.

### 7.4 Engines de Interação

Capturam input do usuário.

**Composer** — Caixa de entrada rica e extensível. Plugins: menções, slash commands, anexos, formatação, autocomplete de IA. Estado temporário CRDT para drafts. Pode bloquear visualmente durante geração de IA. Casos: chat input, command palette, editor de comentário, editor de email.

**ContextMenu** — Menu contextual invocado via long-press (mobile) ou right-click (desktop). Collision detection automática para reposicionamento. Integração com haptics. Acessibilidade total via teclado. Casos: ações em mensagens, ações em itens de extrato, menu de post social, ações em arquivos.

**BottomSheet** — Container modal contextual que desliza de baixo para cima (mobile) ou aparece como drawer lateral (desktop). Snap points configuráveis. Stacking para drawers aninhados. Scroll lock externo. Casos: filtros avançados, detalhes de transação, comentários em vídeo curto, painel de negociação.

### 7.5 Engines de Processo

Visualizam estado e fluxo.

**StateMachine** — Renderiza máquina de estados em múltiplos layouts: Stepper horizontal, Tracker vertical, Kanban com colunas arrastáveis. SPECIFICATION declara estados e transições; engine renderiza. Validação de transições integrada com Validador de Domínio. Casos: checkout multi-step, tracking logístico, funil CRM, wizard de cadastro, BPMN simples.

**AuditTrail** — Consome diretamente `Automerge.getHistory(doc)` cruzado com as arestas `AUTHORED` (Opção B) para reconstruir a linha do tempo de edições de um documento colaborativo. Renderiza eventos com diff semântico calculado via Semantic Mapper **sob demanda** (lazy) — não pré-computados. Exibe badges de assinatura Ed25519 por commit e indicador de Linhagem de Versões via cadeia `MUTATES`. Suporta time-travel (visualizar estado em momento anterior). Para documentos cujo payload foi podado (`retention_state = 'pruned'`), aciona Automerge Repo para reconstrução em background via Graph-Based Routing antes de renderizar o diff solicitado. Casos: histórico de documento, auditoria de transação, log de mudanças de role, governança de specifications.

### 7.6 Engines Especializadas

**GeoSpatial** — Canvas espacial com camadas. Tem **duas variantes** com API comum mas implementações distintas:

- **GeoSpatial:Geographic** — sobre Mapbox/Leaflet, projeção esférica, tiles geográficos. Casos: navegação Uber-style, descoberta de lojas, mapas de eventos.
- **GeoSpatial:Cartesian** — coordenadas planas, sem projeção. Casos: planta de armazém WMS, mapas internos de prédio, diagramas espaciais.

A API comum cobre Camadas, Marcadores, Polígonos, Rotas. O backend de renderização varia.

**RelationGraph** — Visualização de grafo (force-directed, hierarchical, radial). Renderização escala automaticamente: DOM para grafos pequenos, Canvas/WebGL para grandes. Lazy expansion de nós via Graph-Based Routing. Casos: organograma, supply chain, rede de relações CRM, estrutura societária.

### 7.7 Shell de Workspace

Não é "engine" no sentido estrito; é layout reusável.

**WorkspaceShell** — Layout comum de ferramentas de produtividade complexas: header com colaboradores e título, sidebar(s) colapsáveis, canvas central, painel de propriedades. Casos: editor de documentos, construtor de Landing Page, editor de fluxograma.

O **canvas em si** é especializado por caso e não é parte do shell — Workspace original do blueprint era agrupamento conceitual; aqui separamos shell (reusável) de canvas (especializado).

### 7.8 Componentes do Design System (Não-Engines)

Pequenos demais para status de engine; vivem no design system:

- **SyncIndicator** — ícone discreto que reflete estado de sync no header ou em entidades específicas.
- **TrustBadge** — badge visual de assinatura/verificação criptográfica.
- **PresenceAvatar** — avatar com indicador de online/offline.
- **Toolbar**, **Avatar**, **Badge**, **Skeleton**, **Spinner**, **Toast** — primitivas usuais de design system.

### 7.9 Engines Eliminadas Do Blueprint Original

A análise consolidada removeu três engines que eram agrupamentos ou redundâncias:

- **Workspace Engine (16 do blueprint)**: era agrupamento conceitual. Refatorado em WorkspaceShell + canvas específicos por caso.
- **Micro-App Engine (17)**: era a combinação de quatro features (PiP, dock, state freezing, deep linking). Refatorado em primitivas separadas no shell global.
- **Communication Thread Engine (21)**: era pattern de uso do módulo Mensagens em outro contexto. Eliminado como engine separada; é configuração do módulo Chat.

### 7.10 Engine de Geração (IA)

**Generator** está no escopo conceitual da V3 mas a implementação é deferida (Documento 1, seção 3.4). Quando entrar, será engine que coordena prompts, contexto, streaming, e renderização de output via outras engines (texto via Composer, UI gerada via Layout, etc.).

---

## 8. Specifications Dirigindo a UI

### 8.1 O Princípio

Componentes de UI são **dirigidos por SPECIFICATION quando o que é exibido depende do tipo de entidade**. Concretamente, quando engines como SuperCard, SmartForm ou StateMachine recebem um nó, eles consultam a SPECIFICATION que governa aquele subtipo para determinar:

- Quais campos do payload exibir.
- Em qual slot (header, body, footer).
- Quais ações estão disponíveis.
- Quais validações aplicar (em forms).
- Qual fluxo de estados (em state machines).

Isso elimina necessidade de adapters por subtipo no código de UI: a SPECIFICATION é o adapter.

### 8.2 Limites do Spec-Driven UI

A escolha foi **A2 + A3 parcial** (do que foi explorado durante consolidação):

- **A2**: SPECIFICATION declara dados e layout abstrato (qual campo vai em qual slot semântico).
- **A3 parcial**: SPECIFICATION declara comportamento (ações, validações, fluxos), mas não estilos visuais.

Estilos visuais ficam no **tema** (seção 3), não na SPECIFICATION. Isso preserva a separação:

- SPECIFICATION = lógica e estrutura.
- TEMA = aparência.
- ENGINE = mecânica de UI.

### 8.3 Exemplo Concreto

Uma SPECIFICATION de produto declara:

```yaml
specification:
  type: "SPECIFICATION:PRODUCT_LISTING"
  version: "1.0.0"
  ui_hints:
    super_card:
      header:
        title_field: "name"
        subtitle_field: "category"
        avatar_field: "vendor.avatar_url"
      media:
        gallery_field: "images"
      body:
        primary_fields: ["price", "condition", "location"]
      footer:
        primary_action: "buy_now"
        secondary_actions: ["save_to_favorites", "ask_seller"]
    smart_form:
      sections:
        - title: "Informações Básicas"
          fields: ["name", "category", "description"]
        - title: "Precificação"
          fields: ["price", "promo_price"]
        - title: "Mídia"
          fields: ["images", "videos"]
```

Quando `<ProductCard product={node} />` (wrapper de SuperCard) é usado, ele lê essa SPECIFICATION para saber como organizar a renderização. Quando o vendedor cria/edita produto via `<ProductForm product={node} />` (wrapper de SmartForm), o mesmo schema dirige o formulário.

### 8.4 Variação por Rede

Como SPECIFICATIONs podem ser estendidas por rede (Documento 3, seção 5.4), redes corporativas podem customizar UI sem alterar código:

- Rede X estende `SPECIFICATION:PRODUCT_LISTING` adicionando campo `internal_sku`.
- ProductCard automaticamente exibe esse campo na rede X (se SPECIFICATION declara onde).
- Outras redes não veem o campo.

---

## 9. Marketplace como Primitiva da Plataforma

### 9.1 Reconhecimento Estrutural

O Marketplace não é apenas um módulo entre outros — é **primitiva arquitetural reusada para qualquer fluxo de "publicar conteúdo + validar + descobrir + avaliar"**. Casos de uso:

- Marketplace de produtos físicos (e-commerce clássico).
- Marketplace de serviços (entregadores, motoristas, prestadores).
- Marketplace de oportunidades financeiras (P2P lending, crowdfunding).
- **Marketplace de customizações** (temas, traduções, apps, landing pages, BPMNs reusáveis).
- Potencialmente: marketplace de specifications de rede, templates de workflow.

### 9.2 Engine de Catálogo Curado

A primitiva Marketplace é uma engine de catálogo **parametrizada por SPECIFICATION** que define o que é vendido/distribuído. Componentes essenciais:

- **Catálogo** (Layout engine com filtros).
- **Detalhe do item** (SuperCard especializado).
- **Reputação e avaliações** (`ASSET:REPUTATION` vinculável).
- **Validação de publicação** (Validador de Domínio conforme SPECIFICATION).
- **Negociação opcional** (Composer + chat thread).
- **Transação** (transferência de ASSETs validada).

### 9.3 Marketplace de Customizações

Esta sub-aplicação merece destaque porque é como temas, traduções e outras extensões da plataforma chegam aos usuários:

**Conteúdo distribuído**:

- Temas (`CONTENT:THEME`).
- Traduções (`CONTENT:TRANSLATION`).
- Landing pages reusáveis (`CONTENT:LANDING_PAGE_TEMPLATE`).
- Apps customizados internos (`CONTENT:CUSTOM_APP`).
- Templates BPMN (`CONTENT:BPMN_TEMPLATE`).
- SPECIFICATIONs de rede compartilháveis (em casos onde aplicável).

**Mecânica**:

- Criador publica nó CONTENT do tipo apropriado.
- SPECIFICATION da rede valida estrutura.
- Em redes públicas: Validador pode exigir reputação mínima do publicador, ou aprovação de curadores.
- Em redes corporativas: pode haver fluxo BPMN completo de revisão (aderência à identidade visual, conformidade de licenciamento, etc.).
- Itens validados aparecem no catálogo do marketplace.
- Usuários instalam (cria evento de instalação local + opcionalmente `ASSET:LICENSE` se for pago).

### 9.4 Reputação e Avaliações

Sistema nativo do Marketplace:

- `ASSET:REPUTATION` é vinculável a `PROFILE` (do vendedor) ou a `CONTENT` (do produto).
- Avaliações são nós CONTENT vinculando avaliador, alvo, estrelas e texto.
- Reputação acumulada é cálculo derivado, mantido em projeção via TinyBase.
- Validações anti-fraude: avaliador deve ter realizado transação real com o alvo.

### 9.5 Pagamento

Quando o item é pago:

- Em redes com BaaS/licença bancária: pagamento real via PSP integrado.
- Em redes corporativas: débito interno do funcionário, ou orçamento departamental.
- Em P2P puro: depende de mecanismo configurado (criptomoeda, créditos internos, off-system).

Detalhes em Documento 3, seção 13.

---

## 10. Customização por Modalidade de Rede

### 10.1 Rede P2P Pura

Liberdade máxima:

- Usuário cria temas livremente para si.
- Disponibiliza temas para outros peers se desejar.
- Tradução por comunidade aberta.
- Specifications privadas de usuário permitidas.
- UI altamente customizável dentro dos limites técnicos.

### 10.2 Rede Pública

Liberdade média, com governança:

- Usuários podem criar temas e traduções.
- Marketplace oferece catálogo curado por reputação.
- Validação por peers ou curadores definida por SPECIFICATION da rede.
- Personalização individual completa (cada usuário escolhe seu tema, sua língua).
- Specifications de usuário restritas a dados privados.

### 10.3 Rede Corporativa Whitelabel

Customização controlada:

- **Tema oficial pode ser forçado**, com acessibilidade sempre destravada.
- Traduções: política da empresa decide quais línguas estão disponíveis.
- Specifications de rede definidas pela empresa, não por funcionário.
- Marketplace de customizações pode ser fechado ou curado pela empresa.
- Identidade visual da rede pode ser totalmente customizada (whitelabel = nome próprio, logo próprio, paleta própria).

### 10.4 Configuração Granular

Cada item acima é configurável independentemente. Empresa pode:

- Forçar tema oficial mas permitir traduções comunitárias.
- Liberar temas mas restringir customização de UI individual.
- Etc.

Tudo via SPECIFICATIONs da rede.

---

## 11. UX de Sincronização e Estado de Dados

### 11.1 Princípio: Transparente Sem Intrusivo

O usuário deve **saber** o estado de sincronização sem ser **distraído** por ele. Indicadores são discretos por padrão; ficam proeminentes apenas quando relevante.

### 11.2 Estados Visíveis

**Cold start (Onda 0)**: skeleton screens explícitos. App ainda não está pronto; comunicar isso.

**Sync ativo em background (Onda 1, 2)**: ícone discreto no header (ex: pequena animação de nuvem/seta), não bloqueante. Tooltip ao hover/tap mostra detalhes.

**Estado offline**: banner discreto no topo (apenas quando há capability, mas não internet).

**Modo Restrito de UCAN**: O sistema aplica Honestidade Radical e não finge ser offline-first. Mostra um erro semântico claro: *"Modo de Alta Segurança: Acesso de leitura/escrita bloqueado sem conexão com o validador da rede."*

**Conteúdo sendo reidratado (Estado 3)**: skeleton específico ou shimmer no item solicitado, com mensagem contextual: *"Buscando arquivo do ano passado..."*

**Conflito de sync (raro)**: notificação ativa pedindo resolução manual. UI dedicada para visualizar versões conflitantes.

**Erro de sync persistente**: notificação não-modal, ação para tentar novamente.

**UX de Reidratação Arqueológica:** Quando o usuário navega pelo painel de histórico de revisões e solicita a visualização ou o Undo de uma versão cujo payload foi podado (`retention_state = 'pruned'`), o Automerge Repo aciona o Graph-Based Routing em background para buscar o snapshot Automerge do nó-versão em peers compatíveis. Durante esse round-trip, a UI exibe shimmers/skeletons com a mensagem contextual: *"Reconstruindo estado histórico do documento na rede..."*. Caso a rede esteja indisponível, a UI exibe o estado de erro semântico com opção de tentar novamente — não há fallback automático para reversão baseada em log, pois o modelo de auditoria é integralmente baseado no snapshot Automerge.

### 11.3 UX de Busca Federada (Two-Tier)

Quando usuário busca conteúdo via Entity Picker ou Command Palette:

1. **Resultados locais aparecem instantaneamente** (≤50ms).
2. UI mostra-os agrupados sob "Aqui" ou rótulo similar.
3. **Em paralelo, busca federada inicia** em background.
4. Após 300-800ms, resultados federados aparecem em seção separada: "Em outros peers" ou "Da rede".
5. Usuário entende que há diferença entre o que tem local e o que precisa buscar.

Esta UX honra o princípio do local-first (instantâneo no local) e da honestidade radical (rede tem custo perceptível).

### 11.4 Estados Otimistas em Ações

Para ações que vão passar por validação (Documento 3, seção 2):

- **Ação trivialmente válida** (curtir, comentar próprio): UI assume sucesso imediato, sem indicador de pendência.
- **Ação com validação rápida esperada** (envio de mensagem): UI mostra estado "enviando" por fração de segundo, depois "enviado" (check único), depois "entregue" (check duplo) à medida que delivery confirma.
- **Ação com validação demorada esperada** (transferência financeira que aguarda PSP): UI mostra estado "processando" claramente, com timeout esperado e ação para cancelar se ainda for possível.
- **Ação que pode ser rejeitada**: UI registra otimisticamente, mas se rejeição chega, desfaz com mensagem clara de motivo.

### 11.5 Indicador de Confiança Criptográfica

Para conteúdo sensível (transações, contratos, comunicações importantes), badge `TrustBadge` mostra:

- ✅ Verificado: assinatura válida, linhagem íntegra.
- ⚠️ Não verificado: assinatura ausente ou pendente.
- 🔴 Suspeito: linhagem rompida, assinatura inválida.

### 11.6 Hooks Reativos para Saldo via entity_heads e Renderização Dinâmica pelo 11º Caractere

#### 11.6.1 Leitura de Saldo via entity_heads (O(1))

O saldo financeiro — e qualquer estado encabeçado por um nó `ASSET:BALANCE_STATE` — é consultado pelo TinyBase exclusivamente via a tabela local não-replicável `entity_heads`, que aponta para a "cabeça" vigente da linhagem de cada entidade. Hooks de UI **nunca** recalculam saldo varrendo a Linhagem de Versões em tempo de renderização: esse cálculo seria O(n) e seria inconsistente com o modelo reativo de 60fps da plataforma.

**Hook canônico de saldo:**

```typescript
// Leitura de saldo em O(1) via entity_heads
// entity_heads é atualizada por Trigger SQLite a cada novo ASSET:BALANCE_STATE inserido
function useBalanceState(entityId: string) {
  // Obtém o head_id vigente a partir de entity_heads
  const headId = useCell('entity_heads', entityId, 'head_id');

  // Com o head_id, lê o payload já descriptografado do nó de saldo corrente
  const balanceNode = useRow('nodes_cache', headId ?? '');

  return {
    balance:   balanceNode?.payload?.balance   ?? null,
    currency:  balanceNode?.payload?.currency  ?? null,
    headId,
    isLoading: headId === undefined,
  };
}
```

O componente re-renderiza automaticamente quando o Trigger SQLite atualiza `entity_heads` após uma nova aresta `MUTATES` introduzir um nó `ASSET:BALANCE_STATE` mais recente — seja originado localmente (Optimistic UI) ou confirmado pelo Validador remoto e replicado via Automerge Repo.

**Integração com Optimistic UI para ações financeiras pendentes:**

```typescript
function useBalanceWithOptimism(entityId: string) {
  const confirmed = useBalanceState(entityId);

  // pending_intents é populado pelo TinyBase enquanto a intenção aguarda validação
  const pendingDelta = usePendingIntentDelta(entityId);

  return {
    ...confirmed,
    // Exibe saldo projetado durante o período de validação remota
    displayBalance: pendingDelta !== null
      ? (confirmed.balance ?? 0) + pendingDelta.expectedDelta
      : confirmed.balance,
    isPending: pendingDelta !== null,
  };
}
```

Quando o Validador confirma ou rejeita a intenção, `entity_heads` é atualizado e a projeção otimista é substituída automaticamente pelo saldo real.

#### 11.6.2 Roteamento Dinâmico pelo 11º Caractere para Renderização Polimórfica

Quando a UI precisa renderizar o destino de uma aresta (por exemplo, o `target_id` de uma aresta `RESULTED_FROM`, `WITNESSED_BY` ou `RESOLVED_BY`), ela usa o **11º caractere (index 10)** do ULID para decidir, em O(1) e sem lógica condicional por tipo de aresta, de qual tabela carregar o dado.

**Hook de resolução polimórfica de target_id:**

```typescript
// Resolve target_id para nó ou aresta usando o 11º caractere do ULID
function useTargetEntity(targetId: string | undefined) {
  const targetTable = useMemo(() => {
    if (!targetId || targetId.length < 11) return null;
    const typeChar = targetId[10]; // index 10 = 11º caractere
    if (typeChar === 'N') return 'nodes_cache';
    if (typeChar === 'E') return 'edges_cache';
    return null; // ULID malformado — não deve ocorrer em dados válidos
  }, [targetId]);

  const entity = useRow(targetTable ?? '', targetId ?? '');

  return {
    entity,
    targetTable,
    isNode: targetTable === 'nodes_cache',
    isEdge: targetTable === 'edges_cache',
  };
}
```

**Componente genérico de renderização de destino de aresta:**

```typescript
// Renderiza o destino de qualquer aresta — nó ou aresta — sem switch-case por tipo
function EdgeTargetRenderer({ targetId }: { targetId: string }) {
  const { entity, isNode, isEdge } = useTargetEntity(targetId);

  if (!entity) return <Skeleton />;

  if (isNode) {
    // Destino é um nó — renderiza conforme o type do nó (PROFILE, CONTENT, ASSET, SPECIFICATION)
    return <NodeRenderer node={entity} />;
  }

  if (isEdge) {
    // Destino é uma aresta — renderiza aresta
    // Caso canônico: WITNESSED_BY → TRANSFERRED_TO, ou RESULTED_FROM → TRANSFERRED_TO
    return <EdgeRenderer edge={entity} />;
  }

  return null;
}
```

Este padrão permite que engines genéricas (`AuditTrail`, `RelationGraph`, `ExtractTimeline`) trabalhem com o grafo polimórfico sem adapter por tipo de aresta, tornando a renderização de relações heterogêneas — arestas apontando para outras arestas — correta e eficiente por construção.

#### 11.6.3 Rastreamento Causal via RESULTED_FROM na UI do Extrato

Componentes de extrato financeiro usam a aresta `RESULTED_FROM` para navegar do nó de saldo atual diretamente à transação que o originou, sem varredura da Linhagem de Versões:

```typescript
function useBalanceOrigin(balanceNodeId: string) {
  // Busca a aresta RESULTED_FROM que parte deste nó de saldo
  const resultedFromEdges = useQuery('edges_cache', {
    filter: { source_id: balanceNodeId, type: 'RESULTED_FROM' },
    limit: 1,
  });

  const resultedFromEdge = resultedFromEdges?.[0];

  // target_id tem 11º char = 'E' → aponta para aresta TRANSFERRED_TO
  const { entity: causalEdge, isEdge } = useTargetEntity(resultedFromEdge?.target_id);

  return {
    causalEdge:       isEdge ? causalEdge : null,
    resultedFromEdge: resultedFromEdge ?? null,
  };
}
```

Isso permite que a UI do extrato exiba, ao lado de cada linha de saldo, um botão "Ver transação" que navega diretamente para a aresta `TRANSFERRED_TO` responsável — funcionalidade que existe na maioria dos aplicativos financeiros modernos, aqui implementada nativamente pelo grafo sem dados desnormalizados extras.

---

## 12. Adequação Transparente na UI

Implementação visual do Princípio 2.2 do Documento 1.

### 12.1 Detecção e Comunicação

Sistema detecta tier do dispositivo e aplica defaults adequados (Documento 2, seção 13). Quando degradação é aplicada, **comunica ao usuário**:

- Notificação não-modal na primeira detecção: *"Configuramos o app para melhor desempenho neste dispositivo. Você pode ajustar nas Configurações."*
- Configurações expõem o tier detectado e permitem override.

### 12.2 Propostas Ativas de Mitigação

Quando o sistema detecta padrões problemáticos durante uso, propõe ativamente:

**Cenários e propostas**:

- *"Manter histórico extenso no dispositivo está prejudicando o desempenho. Liberar espaço com backup?"*
- *"Buscas estão lentas. Reduzir profundidade de busca federada?"*
- *"IA local está consumindo bastante recurso. Usar IA remota da rede?"*
- *"Sincronização está demorando. Pausar pre-fetch agressivo?"*

Cada proposta:

- Não é modal (usuário pode ignorar).
- Tem ação primária clara (aceitar a proposta).
- Tem ação secundária ("Não agora", "Não mostrar mais").
- Persiste por tempo razoável até ser dispensada ou aceita.

### 12.3 Configurações Expostas

**Profile geral**:

- "Performance máxima": minimiza animações, reduz pre-fetch, foco em fluidez.
- "Equilibrado" (default): comportamento padrão tier-aware.
- "Funcionalidade máxima": prioriza features sobre fluidez.

**Configurações granulares por feature**:

- Animações: completas / simplificadas / desligadas.
- Pre-fetch agressivo de domínios: por módulo.
- Buffer de virtualização.
- Quota de storage: ajustável dentro de limites técnicos.
- Buscas federadas: profundidade, timeout.
- Cache de mídia: agressivo / moderado / mínimo.

### 12.4 Modo Corporativo

Em rede corporativa, admin pode:

- Definir defaults para a frota.
- Travar configurações específicas (ex: forçar pre-fetch para garantir disponibilidade).
- Receber telemetria de tier dos dispositivos da empresa.

---

## 13. Estrutura de Módulos e Code Splitting

### 13.1 Monorepo

A plataforma é organizada em monorepo com workspaces:

```
plataforma-v3/
├── apps/
│   ├── cloud/         # Build para servidor (signaling + API)
│   ├── desktop/       # Electron build
│   ├── mobile/        # Capacitor build
│   └── web/           # Build para servir via Cloud
├── core/
│   ├── engines/       # Engines base reusáveis
│   ├── design-system/ # Componentes shadcn-based + tokens
│   ├── data-layer/    # SQLite, TinyBase, Automerge Repo providers
│   ├── crypto/        # Criptografia, KMS, UCAN
│   ├── routing/       # Graph-Based Routing
│   ├── validators/    # Validador de Domínio + mecanismos
│   └── specs/         # Specifications canônicas
├── modules/
│   ├── chat/
│   ├── feed/
│   ├── short-video/
│   ├── long-video/
│   ├── audio/
│   ├── fintech/
│   ├── marketplace/
│   ├── services-marketplace/
│   ├── financial-marketplace/
│   ├── customizations-marketplace/
│   ├── workspace/
│   ├── landing-builder/
│   ├── geo/
│   ├── crm/
│   ├── hr/
│   ├── corporate-finance/
│   ├── scm/
│   └── auth/
└── shared/
    ├── types/
    └── utils/
```

### 13.2 Módulos Como Aplicações

Cada módulo é tratado como **mini-aplicação**:

- Tem suas próprias rotas internas.
- Importa engines e design system do core.
- Define seus wrappers especializados.
- Pode importar de outros módulos quando necessário (com peer dependency explícita).
- Carregado sob demanda via code splitting do Vite.

### 13.3 Code Splitting Default Vite

Vite oferece code splitting automático para imports dinâmicos. A V3 inicia usando essa capacidade nativa:

```typescript
// Carregamento dinâmico de módulo
const ChatModule = lazy(() => import('@plataforma/module-chat'));
```

Cada módulo vira um chunk separado. Core e design system ficam no bundle inicial (são compartilhados).

Otimizações posteriores (manual chunking, preload hints) ficam para iteração quando dados de produção indicarem necessidade.

### 13.4 Build por Formato

A configuração Vite varia por target:

- **Web**: build padrão para browser, sem capabilities de servidor.
- **Cloud**: inclui módulos de signaling server, API, WebSocket. Bundle maior, mas só roda em servidor.
- **Desktop**: inclui signaling server local, sem API pública. Empacotado via Electron Builder.
- **Mobile**: bundle minimalista, sem signaling server. Empacotado via Capacitor CLI.

Engines e módulos são compartilhados entre todos os builds; o que varia é o conjunto de capabilities de plataforma.

### 13.5 Versionamento

- **Core e design system**: SemVer rigoroso. Breaking changes são major versions com migração documentada.
- **Módulos**: versionamento independente, com peer dependency em versão major do core.
- **Plataforma como produto**: versão consolidada (V3.0, V3.1, etc.) garante que todos os pacotes sejam compatíveis.

---

**Fim do Documento 4.**

---

# Encerramento da Quarteta

Os quatro documentos consolidados substituem integralmente os quatro documentos originais (Especificação Técnica V3.0 original, Detalhamento de Engines, Detalhamento de Módulos, Componentes Polimórficos):

- **Documento 1 — Fundamentos Arquiteturais**: visão, princípios, stack, formatos, modalidades, ontologia, identidade, threat model.
- **Documento 2 — Camada de Dados e Sincronização**: schema físico, TinyBase, índices, retenção, Graph-Based Routing, sync em ondas, replicação, snapshots, criptografia, workers, performance, GC.
- **Documento 3 — Modelo Operacional e Governança**: ciclo intenção-validação-ação, MFA-S, validador de domínio, specifications, minimalismo ontológico, capabilities, recursos finitos, locks, recuperação, sucessão, LGPD, operações restritas.
- **Documento 4 — Camada de UI e Engines**: princípios de UI, temas, i18n, acessibilidade, padrão A puro, catálogo de engines, specifications dirigindo UI, marketplace como primitiva, customização por modalidade, UX de sync, adequação transparente, code splitting.

Tópicos referenciados como detalhamento futuro:

- Especificação técnica de implementação criptográfica (HKDF, protocolo de rotação de época, transporte UCAN).
- Especificação detalhada de cada engine (APIs concretas, contratos TypeScript).
- Especificação do motor BPMN integrado.
- Plano de implementação por sprints e marcos.
- Estratégia de testes de sistema P2P.
- Modelo de monetização da plataforma.
