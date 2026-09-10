/**
 * A deliberately small YAML reader.
 *
 * The contract file is configuration a person writes by hand, and YAML is what
 * they expect. Pulling in a full YAML library would break the "no runtime
 * dependencies" promise the rest of the engine keeps, and a full YAML library
 * is a large attack surface for a tool that asks to be trusted.
 *
 * So this reads a restricted subset and refuses everything else with a line
 * number:
 *
 *   - two-space indentation, no tabs
 *   - `key: value` and `key:` followed by an indented block
 *   - `- item` lists and `- key: value` lists of maps
 *   - `#` comments, on their own line or trailing
 *   - single and double quoted scalars, and bare scalars
 *   - `|` and `>` block scalars for multi-line prose (the attests line)
 *   - a single inline flow list of simple scalars: `[money, date, url]`
 *   - `true`, `false`, `null`, integers and decimals are typed; everything else
 *     is a string
 *
 * No inline maps (`{}`), no nested flow, no anchors, no multi-document files.
 * If a contract needs those, it can be written as JSON instead.
 */
export type YamlValue = string | number | boolean | null | YamlValue[] | {
    [k: string]: YamlValue;
};
export interface YamlResult {
    readonly value: YamlValue | undefined;
    readonly errors: readonly string[];
}
export declare function parseYaml(text: string): YamlResult;
