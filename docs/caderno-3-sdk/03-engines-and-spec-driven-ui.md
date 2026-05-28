# 03-engines-and-spec-driven-ui.md — Engines & Spec-Driven UI Reference

Este documento descreve as diretrizes de composição visual (Padrão A Puro), o catálogo de Engines reutilizáveis e as especificações que orientam dinamicamente a renderização na Plataforma V3.1.

---

## 1. O Padrão A Puro (Composição por Wrappers)

Para assegurar previsibilidade de código e legibilidade, a camada de interface segue rigorosamente o **Padrão A Puro**:
* **Motores Genéricos (Core Engines)**: Vivem no core compartilhado da aplicação (`packages/core/src/engines/`). São polimórficos, genéricos e totalmente agnósticos a regras de negócios específicas (não conhecem os tipos de chat, transações ou marketplaces).
* **Wrappers Nomeados (Application Components)**: Vivem nos respectivos módulos de negócio (ex: `modules/chat/components/`). Eles instanciam a core engine genérica passando renderizadores especializados para os nós de negócio.

*Exemplo de Composição:*
```typescript
// Core Engine (packages/core/src/engines/timeline.tsx)
export function Timeline<T>({ items, renderItem, layout }: TimelineProps<T>) {
  // Gerenciamento genérico de virtualização e scroll
  return <div className={layout}>{items.map(renderItem)}</div>;
}

// Wrapper do Módulo Chat (modules/chat/components/chat-timeline.tsx)
import { Timeline } from 'core/engines/timeline';

export function ChatTimeline({ messages }: { messages: ChatMessage[] }) {
  return (
    <Timeline
      items={messages}
      layout="chat-vertical-feed"
      renderItem={msg => <ChatBubble message={msg} />}
    />
  );
}
```

---

## 2. Catálogo de UI Engines Genuínas

A plataforma consolida a interface em um conjunto enxuto de engines polimórficas de alto desempenho:

### 2.1 Coleção e Entidade
* **Timeline**: Lista cronológica vertical com suporte nativo a virtualização extrema (`react-window`/`tanstack-virtual`) e agrupamento por blocos de data. Usado em: chats, logs de auditoria, extratos financeiros.
* **Layout**: Renderizador adaptativo baseado em Tailwind CSS (Grid, Masonry ou List). Trata redimensionamentos via container queries. Usado em: feeds sociais, listagem de produtos.
* **Filter**: interpretador JSON de especificações de busca. Renderiza os componentes de filtro correspondentes (range, datas, checklist) e monta a query SQL formatada.
* **SuperCard**: Contêiner visual padronizado para entidades estruturadas (slots: header, media, body, footer, actions). O conteúdo de cada slot é determinado em tempo de execução pela `SPECIFICATION` do nó que está sendo renderizado.
* **AssetCard**: Componente especializado para arquivos, mídias e chaves, exibindo o MIME type, tamanho e badges criptográficos de integridade (`signature` verificada).
* **SmartForm**: Formulário dinâmico gerado a partir do schema de campos de uma `SPECIFICATION`. Valida dados localmente e suporta autosave automático como rascunhos temporários no Automerge.

### 2.2 Interação e Processos
* **Composer**: Caixa de entrada de texto rica (rich-text) com plugins integrados para suporte a autocomplete de menções (`@`), comandos de sistema (`/`) e upload assíncrono de arquivos.
* **ContextMenu & BottomSheet**: Componentes modais mobile-first com animações spring baseadas em gestos físicos de arraste (drag-to-dismiss) e integração com feedback háptico dos dispositivos móveis.
* **StateMachine**: Renderizador de processos estruturados exibido como Kanban de colunas arrastáveis ou Stepper de etapas. As transações são validadas contra as regras declaradas na especificação do workflow antes de executarem localmente.
* **AuditTrail**: Visualizador especializado na Linhagem de Versões MFA-S de um documento Automerge. Reconstrói os diffs semânticos e permite a viagem no tempo (Time Travel) carregando e reidratando snapshots passados via Graph-Based Routing.

### 2.3 Motores Especializados
* **GeoSpatial**: Componente de visualização espacial com duas variantes compartilhando a mesma API abstrata:
  * `GeoSpatial:Geographic`: Mapas globais clássicos integrados com Mapbox/Leaflet.
  * `GeoSpatial:Cartesian`: Coordenadas planas e bidimensionais para representação de plantas baixas, estoques de galpões e diagramas industriais.
* **RelationGraph**: Visualizador de grafos (Webgl/Canvas) para exibir diagramas de relacionamentos de governança, organogramas ou rastreabilidade de cadeias de suprimentos.
* **WorkspaceShell**: Shell de layout contendo sidebars colapsáveis, lista de colaboradores online e área de trabalho estruturada.

---

## 3. Lógica de Spec-Driven UI

A plataforma adota o padrão de **Layout Abstrato (A2) + Comportamento Dinâmico (A3 parcial)**. A `SPECIFICATION` que governa uma entidade declara a estrutura de exibição dos campos, mas nunca define detalhes de estilo visual (como cores ou fontes, que pertencem estritamente aos Temas).

*Exemplo de Configuração de UI em SPECIFICATION:*
```yaml
specification:
  type: "SPECIFICATION:PRODUCT_LISTING"
  version: "1.0.0"
  ui_hints:
    super_card:
      header:
        title_field: "name"
        subtitle_field: "sku"
      media:
        gallery_field: "images"
      body:
        primary_fields: ["price", "location"]
      footer:
        primary_action: "buy_now"
        secondary_actions: ["ask_question"]
```

Quando um `SuperCard` genérico recebe um nó de produto, ele consulta a especificação associada para renderizar os campos nos slots semânticos adequados sem compilar código rígido (hardcoded).

### 3.1 Hooks de Reatividade Criptográfica e Permissões
Para habilitar, ocultar ou modificar ações e renderizações baseando-se no modelo de segurança, os componentes da SDK consomem hooks integrados à reatividade do TinyBase e à tabela `local_permissions`:
* `usePermission(permissionId: string)`: Retorna um booleano indicando se o usuário possui a permissão atômica especificada e se todos os pré-requisitos (`prerequisite_satisfied = 1`) estão atendidos.
* `useRole(roleId: string)`: Verifica se o papel (`ASSET:ROLE`) que engloba as permissões está ativo no ciclo corrente.
* **Ocultação Segura**: Ações restritas (como botões de escrita ou menus de moderação) consultam estes hooks antes da renderização. Caso o usuário não tenha o UCAN correspondente ou seus requisitos não estejam satisfeitos, a UI oculta proativamente a opção, impedindo a submissão de transações que de qualquer forma seriam rejeitadas pelo Sync Worker e pelo validador.

---

## 4. Acessibilidade (WCAG AA)

Todas as core engines e componentes gerados são obrigados a satisfazer os requisitos de acessibilidade da WCAG 2.1 nível AA:
* **Autonomia de Ajuste**: Parâmetros de acessibilidade (tamanho de fonte ampliado, contraste aumentado, redução de animações e modo leitor de tela) **sempre permanecem liberados para alteração pelo usuário**, ignorando qualquer restrição ou tema forçado por administradores de redes corporativas.
* **Navegação Física**: Suporte total a navegação por teclado (focus loops em modais) e targets mínimos de toque de 44x44 pixels em dispositivos móveis.
