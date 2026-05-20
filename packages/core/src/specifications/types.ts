export interface SpecMeta {
  id: string;
  type: string;
  name: string;
  version: string;
  description?: string;
}

export interface FieldDefinition {
  type: "string" | "number" | "boolean" | "array" | "object" | "ulid";
  required?: boolean;
  min?: number;
  max?: number;
  regex?: string;
  itemsType?: "string" | "number" | "boolean" | "ulid" | "object";
  properties?: Record<string, FieldDefinition>;
  description?: string;
}

export interface SpecSchema {
  fields: Record<string, FieldDefinition>;
}

export interface SpecSecurity {
  roles: string[];
  requiredCapabilities?: string[];
  requireSignature?: boolean;
}

export interface SpecValidation {
  mode: "auto_self" | "single_validator" | "quorum";
  rules?: {
    name: string;
    expression: string;
  }[];
}

export interface StateTransition {
  target: string;
  roles?: string[];
  conditions?: string[];
}

export interface StateDefinition {
  on?: Record<string, string | StateTransition>;
}

export interface SpecStateMachine {
  initial: string;
  states: Record<string, StateDefinition>;
}

export interface Specification {
  meta: SpecMeta;
  schema?: SpecSchema;
  security?: SpecSecurity;
  validation?: SpecValidation;
  stateMachine?: SpecStateMachine;
  ui_hints?: Record<string, any>;
}
