import { describe, it, expect } from "vitest";
import { parseSpec } from "./parser.js";

describe("Specification Parser & Validator", () => {
  it("should parse valid YAML content", () => {
    const yamlContent = `
meta:
  id: "SPECIFICATION:TEST_PO"
  type: "SPECIFICATION"
  name: "Test Purchase Order"
  version: "1.0.0"
  description: "Test description"
schema:
  fields:
    id:
      type: "ulid"
      required: true
    total:
      type: "number"
      required: true
`;
    const spec = parseSpec(yamlContent);
    expect(spec.meta.id).toBe("SPECIFICATION:TEST_PO");
    expect(spec.schema?.fields.id.type).toBe("ulid");
    expect(spec.schema?.fields.total.required).toBe(true);
  });

  it("should parse valid Markdown with YAML front-matter", () => {
    const markdownContent = `---
meta:
  id: "SPECIFICATION:TEST_MD"
  type: "SPECIFICATION"
  name: "Test Markdown Spec"
  version: "2.0.1"
schema:
  fields:
    name:
      type: "string"
      required: false
---
# Documentação da Especificação
Aqui vai algum texto livre documentando a especificação.
`;
    const spec = parseSpec(markdownContent);
    expect(spec.meta.id).toBe("SPECIFICATION:TEST_MD");
    expect(spec.schema?.fields.name.type).toBe("string");
    expect(spec.schema?.fields.name.required).toBe(false);
  });

  it("should throw error for invalid YAML", () => {
    const invalidYaml = `
meta:
  id: "TEST"
  type: "SPECIFICATION"
    invalid indentation
`;
    expect(() => parseSpec(invalidYaml)).toThrow();
  });

  it("should throw error for missing meta", () => {
    const noMeta = `
schema:
  fields:
    id:
      type: "ulid"
`;
    expect(() => parseSpec(noMeta)).toThrow("Missing 'meta' section in specification.");
  });

  it("should throw error for invalid field type", () => {
    const invalidType = `
meta:
  id: "TEST"
  type: "SPECIFICATION"
  name: "Test"
  version: "1.0.0"
schema:
  fields:
    id:
      type: "custom_type"
`;
    expect(() => parseSpec(invalidType)).toThrow(/invalid type 'custom_type'/);
  });
});
