# 04-theme-and-i18n-data-structures.md — Theme & i18n Data Structures

Este documento especifica a estrutura de dados e as propriedades de tematização visual e internacionalização reativa na Plataforma V3.1. Ambas as customizações são tratadas estritamente como **dados no grafo** e não como código.

---

## 1. Sistema de Temas Dinâmicos (`CONTENT:THEME`)

Os temas na plataforma baseiam-se em arquivos de dados estruturados YAML ou JSON salvos em nós do tipo `CONTENT:THEME`. O sistema injeta esses valores diretamente em variáveis CSS Custom Properties no `:root` HTML em tempo de execução, sem necessidade de recarregar a aplicação.

### 1.1 Vocabulário Canônico de Tokens
Para manter a compatibilidade e a acessibilidade, o Tailwind CSS está configurado para ler exclusivamente as seguintes variáveis CSS customizáveis:

```yaml
# Exemplo de Payload de um nó CONTENT:THEME
content_theme:
  id: "theme_ocean_breeze"
  type: "CONTENT:THEME"
  metadata:
    name: "Ocean Breeze"
    version: "1.0.0"
    description: "Tons azulados inspirados no oceano"
  base_mode: "light"             # 'light' | 'dark' | 'system'
  tokens:
    # Cores de Fundo e Texto
    background: "210 40% 98%"     # Formato HSL: H S% L%
    foreground: "222 47% 11%"
    
    # Cores de Destaque Semântico
    primary: "221 83% 53%"
    primary-foreground: "210 40% 98%"
    secondary: "210 40% 96.1%"
    secondary-foreground: "222 47% 11%"
    accent: "199 89% 48%"
    accent-foreground: "210 40% 98%"
    destructive: "0 84.2% 60.2%"
    destructive-foreground: "210 40% 98%"
    
    # Estados de Negócios/Plataforma
    success-payment: "142 76% 36%"
    warning-stock-low: "38 92% 50%"
    
    # Bordas e Raios
    border: "214.3 31.8% 91.4%"
    input: "214.3 31.8% 91.4%"
    ring: "221.2 83.2% 53.3%"
    radius: "0.5rem"
    
    # Espaçamento e Densidade
    spacing-base: "0.25rem"
    density-modifier: "1.0"      # Multiplicador decimal de paddings
```

### 1.2 Validação de Temas no Upload
Quando um usuário cria ou importa um tema no marketplace corporativo ou público, o Validador de Domínio aplica o schema de conformidade da `SPECIFICATION:THEME`:
* **Presença de Tokens Obrigatórios**: Verifica a integridade de todas as chaves básicas de cores e fontes.
* **Validação de Contraste WCAG**: O validador calcula a razão de contraste entre pares críticos (ex: `background` vs `foreground`, `primary` vs `primary-foreground`). Se o contraste calculado for inferior a **4.5:1** para textos normais, a publicação é bloqueada ou marcada como incompatível.

---

## 2. Internacionalização como Dados (`CONTENT:TRANSLATION`)

Todas as strings e rótulos de interface na plataforma são internacionalizados reativamente consumindo nós do tipo `CONTENT:TRANSLATION`. O TinyBase observa a tradução selecionada pelo usuário e atualiza a interface dinamicamente.

### 2.1 Estrutura do Nó de Tradução
O payload do nó contém metadados de idioma/região e o dicionário plano mapeando chaves de tradução:

```yaml
content_translation:
  id: "translation_pt_br"
  type: "CONTENT:TRANSLATION"
  metadata:
    language: "pt"
    region: "BR"
    version: "2.1.0"
    coverage_percentage: 100.0
  strings:
    # Rótulos Genéricos
    "common.actions.save": "Salvar"
    "common.actions.cancel": "Cancelar"
    
    # Rótulos do Chat
    "chat.placeholders.input": "Digite uma mensagem..."
    
    # Rótulos de Ativos e Financeiro
    "fintech.balance.label": "Saldo Disponível"
    
    # Pluralização estruturada
    "notification.unread.count":
      one: "Você tem 1 mensagem não lida"
      other: "Você tem {count} mensagens não lidas"
```

### 2.2 Validação de chaves
O validador garante que:
* Os placeholders (ex: `{count}`, `{name}`) presentes nas strings canônicas sejam preservados na string traduzida.
* Não existam injeções de scripts maliciosos nos payloads textuais.

---

## 3. Distribuição via Marketplace de Customizações

Os nós do tipo `CONTENT:THEME` e `CONTENT:TRANSLATION` são catalogados e descobertos por meio do **Marketplace de Customizações**.
* Em redes públicas, a instalação é livre e regulada pela reputação dos publicadores.
* Em redes corporativas, os administradores podem forçar temas corporativos específicos via `SPECIFICATION:NETWORK_GOVERNANCE`, mas o usuário sempre retém o direito de forçar o contraste e o modo de acessibilidade localmente.
