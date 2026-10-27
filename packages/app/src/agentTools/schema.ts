/**
 * The small part of JSON Schema the Tool directory uses to describe and
 * check Tool parameters. `checkArgs` returns the first problem, or null.
 */

export type ParamSchema =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | { type: "number" | "integer" | "boolean"; description?: string }
  | { type: "array"; description?: string; items: ParamSchema }
  | {
      type: "object";
      description?: string;
      properties?: Record<string, ParamSchema>;
      required?: readonly string[];
      /** Free-form object (an Import operation, a Prayer): only "is an object". */
      additionalProperties?: boolean;
    };

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function checkArgs(schema: ParamSchema, value: unknown, path = "arguments"): string | null {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return `${path} must be a string`;
      if (schema.enum && !schema.enum.includes(value)) {
        return `${path} must be one of ${schema.enum.join(", ")}`;
      }
      return null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} must be a number`;
    case "integer":
      return Number.isInteger(value) ? null : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be true or false`;
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      for (const [i, item] of value.entries()) {
        const problem = checkArgs(schema.items, item, `${path}[${i}]`);
        if (problem) return problem;
      }
      return null;
    }
    case "object": {
      if (typeOf(value) !== "object") return `${path} must be an object`;
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined) return `${path}.${key} is required`;
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (obj[key] === undefined) continue;
        const problem = checkArgs(sub, obj[key], `${path}.${key}`);
        if (problem) return problem;
      }
      if (schema.properties && schema.additionalProperties === false) {
        const extra = Object.keys(obj).find((k) => !(k in schema.properties!));
        if (extra) return `${path}.${extra} is not a parameter`;
      }
      return null;
    }
  }
}
