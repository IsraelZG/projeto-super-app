import YAML from "yaml";
import { Specification } from "./types.js";

/**
 * Parses a specification content string (YAML or Markdown front-matter) and validates it.
 */
export function parseSpec(content: string): Specification {
  let yamlContent = content.trim();

  // If it starts with ---, extract front-matter
  if (yamlContent.startsWith("---")) {
    const parts = yamlContent.split("---");
    if (parts.length >= 3) {
      // Index 1 contains the YAML front-matter content
      yamlContent = parts[1].trim();
    }
  }

  const parsed = YAML.parse(yamlContent);
  if (!parsed) {
    throw new Error("Failed to parse specification: empty or invalid YAML content.");
  }

  return validateSpecStructure(parsed);
}

/**
 * Validates the parsed structure of a specification against non-negotiable architecture schemas.
 */
export function validateSpecStructure(spec: any): Specification {
  if (!spec || typeof spec !== "object") {
    throw new Error("Specification must be an object.");
  }

  // Spec-kit might structure the YAML under a top-level 'specification' key, or write it directly
  let target = spec;
  if (spec.specification && typeof spec.specification === "object") {
    target = spec.specification;
  }

  if (!target.meta) {
    throw new Error("Missing 'meta' section in specification.");
  }
  
  const meta = target.meta;
  if (!meta.id || typeof meta.id !== "string") {
    throw new Error("Specification meta must contain a valid string 'id'.");
  }
  if (!meta.type || typeof meta.type !== "string") {
    throw new Error("Specification meta must contain a valid string 'type'.");
  }
  if (!meta.name || typeof meta.name !== "string") {
    throw new Error("Specification meta must contain a valid string 'name'.");
  }
  if (!meta.version || typeof meta.version !== "string") {
    throw new Error("Specification meta must contain a valid string 'version'.");
  }

  // Validate fields schema if declared
  if (target.schema) {
    if (typeof target.schema !== "object" || !target.schema.fields) {
      throw new Error("Specification 'schema' section must contain a 'fields' map.");
    }
    const fields = target.schema.fields;
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      if (!fieldDef || typeof fieldDef !== "object") {
        throw new Error(`Field '${fieldName}' definition must be an object.`);
      }
      const fd = fieldDef as any;
      const validTypes = ["string", "number", "boolean", "array", "object", "ulid"];
      if (!fd.type || !validTypes.includes(fd.type)) {
        throw new Error(
          `Field '${fieldName}' has invalid type '${fd.type}'. Valid types are: ${validTypes.join(", ")}`
        );
      }
    }
  }

  // Validate security configuration
  if (target.security) {
    if (typeof target.security !== "object" || !Array.isArray(target.security.roles)) {
      throw new Error("Specification 'security' section must contain a 'roles' array.");
    }
  }

  // Validate validation mode rules
  if (target.validation) {
    if (typeof target.validation !== "object") {
      throw new Error("Specification 'validation' section must be an object.");
    }
    const mode = target.validation.mode;
    const validModes = ["auto_self", "single_validator", "quorum"];
    if (!mode || !validModes.includes(mode)) {
      throw new Error(`Specification validation mode must be one of: ${validModes.join(", ")}`);
    }
  }

  // Validate State Machine if present
  if (target.stateMachine) {
    if (typeof target.stateMachine !== "object") {
      throw new Error("Specification 'stateMachine' section must be an object.");
    }
    if (!target.stateMachine.initial || typeof target.stateMachine.initial !== "string") {
      throw new Error("Specification 'stateMachine' must contain an 'initial' state string.");
    }
    if (!target.stateMachine.states || typeof target.stateMachine.states !== "object") {
      throw new Error("Specification 'stateMachine' must contain a 'states' map.");
    }
  }

  return target as Specification;
}
