---
specification:
  meta:
    id: "SPECIFICATION:PURCHASE_ORDER"
    type: "SPECIFICATION"
    name: "Purchase Order"
    version: "1.0.0"
    description: "Especificação de validação, segurança e estados para ordens de compra na plataforma."
  schema:
    fields:
      id:
        type: "ulid"
        required: true
      buyer_id:
        type: "ulid"
        required: true
      seller_id:
        type: "ulid"
        required: true
      total_amount:
        type: "number"
        required: true
      status:
        type: "string"
        required: true
  security:
    roles:
      - "buyer"
      - "seller"
      - "validator"
    requiredCapabilities:
      - "purchase-order:create"
      - "purchase-order:approve"
      - "purchase-order:reject"
  validation:
    mode: "single_validator"
  stateMachine:
    initial: "draft"
    states:
      draft:
        on:
          SUBMIT: "submitted"
      submitted:
        on:
          APPROVE: "approved"
          REJECT: "rejected"
      approved:
        on:
          COMPLETE: "completed"
      rejected: {}
      completed: {}
  ui_hints:
    super_card:
      header:
        title_field: "id"
        subtitle_field: "status"
      body:
        primary_fields:
          - "buyer_id"
          - "seller_id"
          - "total_amount"
---

# Especificação Lógica de Pedidos de Compra (Purchase Order)

Esta especificação define as regras operacionais, de segurança e de estado para a emissão e processamento de Pedidos de Compra (`PURCHASE_ORDER`) locais e federados.

## 1. Regras de Negócio e Estados

1. **Abertura**: O fluxo sempre inicia no estado `draft`, pertencente ao comprador (`buyer`).
2. **Submissão**: Ao transicionar para `submitted`, a ordem é apresentada ao vendedor (`seller`) e ao validador designado.
3. **Validação**: O validador da rede deve aprovar a transição para `approved` ou rejeitar para `rejected`.
4. **Fechamento**: Uma vez aprovada, a transição para `completed` ocorre após a liquidação do pagamento.
