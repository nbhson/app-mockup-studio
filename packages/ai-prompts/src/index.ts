// ---------------------------------------------------------------------------
// Prompt templates (plan/12 GĐ 4.2 "Prompt Engineering").
// Keeping them in a dedicated package lets us tune prompts without touching
// business logic. Structured output (jsonMode) is used for both tasks.
// ---------------------------------------------------------------------------

import { SCHEMA_VERSION, type UiDocument, type UiNode } from "@ai-mockup-studio/ui-schema";

/**
 * A compact but precise summary of the component registry so the model only
 * emits known component types. Regenerated per call to stay in sync.
 */
export function buildComponentGuide(types: string[]): string {
  return types.length > 0 ? types.join(", ") : "(no components available)";
}

export interface GenerationSystemContext {
  availableTypes: string[];
  viewport: { width: number; height: number };
  themeName: string;
}

export function buildGenerationSystemPrompt(ctx: GenerationSystemContext): string {
  return [
    `You are the UI generation engine of AI Mockup Studio (schema v${SCHEMA_VERSION}).`,
    `Your only job is to produce a COMPLETE, VALID JSON "UiDocument" that matches the schema below.`,
    ``,
    `RULES:`,
    `- Respond with pure JSON only. No markdown fences, no commentary.`,
    `- Every node must have a non-empty "id" (unique across the tree) and a "type".`,
    `- Only use these component types: ${buildComponentGuide(ctx.availableTypes)}.`,
    `- Use "layout.*" for structure, "basic.*" for small widgets, "formal.*" for cards/forms.`,
    `- Prefer visual quality: sensible spacing, a coherent palette, readable typography.`,
    `- Do NOT invent component types; if a type is missing, choose the closest known one.`,
    `- Do NOT generate raw HTML or CSS anywhere in the output.`,
    ``,
    `SCHEMA (UiDocument):`,
    `{`,
    `  "schemaVersion": "${SCHEMA_VERSION}",`,
    `  "id": "<document id>",`,
    `  "pageId": "<page id>",`,
    `  "name": "<page name>",`,
    `  "viewport": { "width": ${ctx.viewport.width}, "height": ${ctx.viewport.height} },`,
    `  "theme": { "mode":"light", "primary":"#2563EB", "primaryForeground":"#ffffff",`,
    `             "background":"#ffffff", "foreground":"#0F172A", "muted":"#F1F5F9",`,
    `             "mutedForeground":"#64748B", "border":"#E2E8F0", "fontFamily":"Inter, sans-serif",`,
    `             "radius": 8 },`,
    `  "root": {`,
    `    "id": "root",`,
    `    "type": "layout.container",`,
    `    "props": {},`,
    `    "children": [ ... nested nodes of sizes above ... ]`,
    `  }`,
    `}`,
    ``,
    `NODE SHAPE: { "id": string, "type": string, "name"?: string,`,
    `  "props"?: Record<string,unknown>, "styles"?: {width?,height?,padding?,display?,flexDirection?,`,
    `  alignItems?,justifyContent?,backgroundColor?,color?,fontSize?,fontWeight?,gap?,borderRadius?},`,
    `  "children"?: UiNode[] }`,
  ].join("\n");
}

export interface GenerationUserContext {
  currentThemeName?: string;
}

export function buildGenerationUserPrompt(prompt: string, ctx: GenerationUserContext): string {
  const themeLine = ctx.currentThemeName
    ? `\nPrefer a theme consistent with: "${ctx.currentThemeName}".`
    : "";
  return [
    `Create a UI mockup for this request.`,
    ``,
    `USER REQUEST: "${prompt}"`,
    `Return the UiDocument JSON now.${themeLine}`,
  ].join("\n");
}

// --- Editing (patch generation) --------------------------------------------

export function buildEditSystemPrompt(availableTypes: string[]): string {
  return [
    `You are the UI editing engine of AI Mockup Studio (schema v${SCHEMA_VERSION}).`,
    `You receive a full UiDocument and a natural-language edit request.`,
    `Your job: return a JSON array of PATCHES that apply the requested edits.`,
    ``,
    `RULES:`,
    `- Output pure JSON (an array), no markdown fences.`,
    `- Reuse existing node ids from the document. Never invent ids for existing nodes.`,
    `- Only use component types: ${buildComponentGuide(availableTypes)}.`,
    `- If a component type does not exist, use the closest known one.`,
    `- Prefer the least invasive change (fewer patches), matching the user intent.`,
    `- "op" must be one of: "add", "update", "remove", "move", "replace", "style".`,
    ``,
    `PATCH SHAPES:`,
    `- add:    { "op":"add", "parentId":"<container id>", "index"?: number,`,
    `           "node": <UiNode> }`,
    `- update: { "op":"update", "targetId":"<id>", "changes": { "props.width": 300, ... } }`,
    `           changes use dot-path keys (props.*, styles.*, name, ...).`,
    `- remove: { "op":"remove", "targetId":"<id>" }`,
    `- move:   { "op":"move", "targetId":"<id>", "newParentId":"<id>", "index"?: number }`,
    `- replace:{ "op":"replace", "targetId":"<id>", "node": <UiNode> }`,
    `- style:  { "op":"style", "targetId":"<id>", "styles": { width?: number, ... } }`,
    ``,
    `If the request cannot be fulfilled (e.g. unknown target), return an EMPTY array.`,
  ].join("\n");
}

export function buildEditUserPrompt(
  prompt: string,
  document: UiDocument,
  targetId: string | null | undefined,
): string {
  const targetLine = targetId
    ? `The user currently has node "${targetId}" selected. Prefer scoping changes to it.`
    : "No node is selected; interpret the request against the whole document.";
  return [
    `EDIT REQUEST: "${prompt}"`,
    ``,
    targetLine,
    ``,
    `CURRENT DOCUMENT (JSON):`,
    JSON.stringify(document, null, 2),
    ``,
    `Return the array of patches now.`,
  ].join("\n");
}

// --- Design critique (plan/07 3.5) -----------------------------------------

export function buildCritiqueSystemPrompt(): string {
  return [
    `You are a senior product designer reviewing a UI mockup built with AI Mockup Studio.`,
    `You receive a UiDocument JSON (structured UI schema, never HTML/CSS) and a viewport.`,
    `Evaluate the design like a design review: visual hierarchy, spacing rhythm, contrast,`,
    `consistency with the design tokens, accessibility and content quality.`,
    ``,
    `RULES:`,
    `- Respond with pure JSON only. No markdown fences, no commentary.`,
    `- Be specific and actionable. Reference node ids when a finding targets a component.`,
    `- Do not invent components that are not in the document.`,
    `- Prefer 3–8 findings; do not pad the list with trivial observations.`,
    `- "severity" is "high" (blocks usability), "medium" (noticeable quality issue) or "low" (polish).`,
    `- "score" is an overall design quality score from 0 to 100.`,
    `- Only include "fixStyles" when a style change on "nodeId" fully resolves the finding.`,
    `  Allowed keys: width, height, minWidth, minHeight, padding, margin, gap, display,`,
    `  flex, flexDirection, flexWrap, flexShrink, alignItems, justifyContent,`,
    `  backgroundColor, color, fontSize, fontWeight, borderWidth, borderColor,`,
    `  borderRadius, opacity. Values must be numbers or CSS strings already supported by the schema.`,
    ``,
    `RESPONSE SHAPE:`,
    `{`,
    `  "score": 0-100,`,
    `  "summary": "<2–4 sentence overall assessment in Vietnamese>",`,
    `  "findings": [`,
    `    { "id": "<stable id>", "category": "hierarchy|spacing|contrast|consistency|accessibility|content",`,
    `      "severity": "high|medium|low", "title": "<short Vietnamese title>",`,
    `      "detail": "<what is wrong and where>", "suggestion": "<concrete next action>",`,
    `      "nodeId": "<node id or null>", "fixStyles": { ... } | null }`,
    `  ]`,
    `}`,
  ].join("\n");
}

export function buildCritiqueUserPrompt(
  document: UiDocument,
  viewportMode: string = "desktop",
): string {
  return [
    `Review this UI mockup for the "${viewportMode}" breakpoint.`,
    `The theme tokens are part of the document ("theme"). Flag values that drift from them.`,
    ``,
    `DOCUMENT (JSON):`,
    JSON.stringify(document, null, 2),
    ``,
    `Return the critique JSON now.`,
  ].join("\n");
}

// --- Dummy data (plan/07 3.7) ----------------------------------------------

export interface DummyDataPromptContext {
  locale: "vi" | "en";
  context?: string;
  /** node id → allowed prop keys, so the model only fills real fields. */
  targets: Array<{ nodeId: string; nodeType: string; allowedProps: string[] }>;
}

export function buildDummyDataSystemPrompt(ctx: DummyDataPromptContext): string {
  return [
    `You generate realistic demo content for a UI mockup built with AI Mockup Studio.`,
    `You receive a UiDocument JSON (structured UI schema, never HTML/CSS) and a list of target nodes.`,
    `Fill the target nodes with believable, coherent sample data that matches each component type.`,
    ``,
    `RULES:`,
    `- Respond with pure JSON only. No markdown fences, no commentary.`,
    `- Only touch nodes from the target list and only the allowed prop keys for each node.`,
    `- Never change the node type, layout, styles or ids.`,
    `- Keep data internally consistent (a table's rows match its headers; stats labels match values).`,
    `- Use realistic ${ctx.locale === "vi" ? "Vietnamese" : "English"} names, currency and dates.`,
    `- Do not use placeholder words such as "Lorem ipsum", "TODO", "Sample" or "—".`,
    `- Amounts should be formatted strings (e.g. "₫1.240.000"), not raw numbers, unless the schema expects numbers.`,
    `- Tables: headers is string[], rows is an array of arrays; every row must have the same length as headers.`,
    `- Stats: items and values are parallel string arrays of equal length (3–4 items).`,
    ``,
    `TARGETS (JSON):`,
    JSON.stringify(ctx.targets, null, 2),
    ``,
    `RESPONSE SHAPE:`,
    `{`,
    `  "summary": "<1–2 sentence Vietnamese summary of what data was generated>",`,
    `  "changes": [`,
    `    { "nodeId": "<existing node id>", "props": { "<allowed prop>": <value> } }`,
    `  ]`,
    `}`,
  ].join("\n");
}

export function buildDummyDataUserPrompt(
  document: UiDocument,
  context?: string,
): string {
  return [
    context ? `USER CONTEXT: ${context}` : `USER CONTEXT: (none — infer from the document)`,
    ``,
    `DOCUMENT (JSON):`,
    JSON.stringify(document, null, 2),
    ``,
    `Return the dummy-data JSON now.`,
  ].join("\n");
}

// --- Responsive optimization (plan/07 3.8) --------------------------------

export function buildResponsiveSystemPrompt(breakpoints: string[]): string {
  return [
    `You are a responsive design expert reviewing a UI mockup built with AI Mockup Studio.`,
    `You receive a UiDocument JSON (structured UI schema, never HTML/CSS) and the breakpoints to optimize: ${breakpoints.join(", ")}.`,
    `Propose safe breakpoint overrides that make the layout work on smaller screens without changing the desktop design.`,
    ``,
    `RULES:`,
    `- Respond with pure JSON only. No markdown fences, no commentary.`,
    `- Only propose overrides for existing node ids; never invent nodes.`,
    `- Only use UiStyles keys: width, height, minWidth, minHeight, padding, margin, gap,`,
    `  display, flex, flexDirection, flexWrap, flexShrink, alignItems, justifyContent,`,
    `  backgroundColor, color, fontSize, fontWeight, borderWidth, borderColor, borderRadius, opacity.`,
    `- Never change node types, text content or the base (desktop) styles.`,
    `- Prefer the smallest change that fixes the problem: stack horizontal rows on mobile,`,
    `  let fixed widths shrink to 100%, reduce oversized padding/type, keep tap targets ≥ 40px.`,
    `- Do not propose a property that is already overridden for that breakpoint.`,
    `- Keep the list focused: at most one suggestion per node per breakpoint.`,
    `- "detail" must explain the mobile/tablet problem in Vietnamese.`,
    ``,
    `RESPONSE SHAPE:`,
    `{`,
    `  "summary": "<1–2 sentence Vietnamese summary>",`,
    `  "suggestions": [`,
    `    { "nodeId": "<existing id>", "breakpoint": "tablet|mobile",`,
    `      "title": "<short Vietnamese title>", "detail": "<why>",`,
    `      "styles": { "<UiStyles key>": <value> } }`,
    `  ]`,
    `}`,
  ].join("\n");
}

export function buildResponsiveUserPrompt(
  document: UiDocument,
  breakpoints: string[],
): string {
  return [
    `Optimize this document for: ${breakpoints.join(", ")}.`,
    `Tablet width ≈ 768px, mobile width ≈ 390px. Existing responsive overrides are part of each node.`,
    ``,
    `DOCUMENT (JSON):`,
    JSON.stringify(document, null, 2),
    ``,
    `Return the responsive suggestions JSON now.`,
  ].join("\n");
}

export function summarizeDocumentBrief(doc: UiDocument): string {
  const types = new Set<string>();
  const collect = (node: UiNode) => {
    types.add(node.type);
    node.children?.forEach(collect);
  };
  collect(doc.root);
  return `Document "${doc.name}" (${doc.schemaVersion}) with node types: ${[...types].join(", ")}.`;
}
