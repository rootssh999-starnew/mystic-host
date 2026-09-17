const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export type EggVariables = Record<string, string | number | boolean | null | undefined>;

export function renderEggTemplate(template: string, variables: EggVariables) {
  return template.replace(VARIABLE_PATTERN, (_, key: string) => {
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function missingEggVariables(template: string, variables: EggVariables) {
  const missing = new Set<string>();
  let match: RegExpExecArray | null;
  const matcher = new RegExp(VARIABLE_PATTERN.source, "g");
  while ((match = matcher.exec(template))) {
    const key = match[1];
    if (variables[key] === undefined || variables[key] === null) missing.add(key);
  }
  return Array.from(missing);
}

export function parseEggVariables(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value || "{}"); } catch { throw new Error("Egg variables must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Egg variables must be a JSON object");
  return parsed as EggVariables;
}
