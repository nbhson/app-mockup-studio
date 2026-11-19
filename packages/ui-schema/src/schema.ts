// ---------------------------------------------------------------------------
// UI Schema v0.1 — the source of truth for a mockup document.
// Design rules (see plan/05-ui-schema.md):
//  - AI generates a JSON structure that follows this schema — never raw HTML.
//  - The renderer maps a UiNode to a registered component.
//  - Every node MUST have a stable, unique `id` so patches / version diffs work.
//  - All edits (manual or AI) go through PatchOperation + Command Manager.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = "0.1.0";

/** Categories used to validate which children a node may contain. */
export type ComponentCategory = "layout" | "dashboard" | "basic" | "formal";

export type ViewportMode = "desktop" | "tablet" | "mobile";
export type ThemeMode = "light" | "dark";

export interface Viewport {
  width: number;
  height: number;
}

export interface Theme {
  mode: ThemeMode;
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  fontFamily: string;
  radius: number;
}

/** Flat style overrides applied to a node (CSS-ish, camelCase keys). */
export interface UiStyles {
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  padding?: number | string;
  margin?: number | string;
  gap?: number | string;
  display?: string;
  /** Explicit CSS grid columns (used by `layout.grid` responsive overrides). */
  gridTemplateColumns?: string;
  flex?: number | string;
  flexDirection?: "row" | "column";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  flexShrink?: number;
  alignItems?: string;
  justifyContent?: string;
  backgroundColor?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number | string;
  fontWeight?: number | string;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
  opacity?: number;
}

/**
 * A single node in the UI tree. `props` are component-specific (kept opaque
 * here; the component registry gives them a concrete shape per type).
 */
export interface UiNode {
  id: string;
  type: string;
  name?: string;
  /** Layer visibility — hidden nodes stay in the document but are not rendered. */
  hidden?: boolean;
  /** Locked nodes cannot be selected/resized/moved from the canvas. */
  locked?: boolean;
  /** Per-breakpoint style overrides (desktop uses `styles` as the base). */
  responsive?: ResponsiveStyles;
  props?: Record<string, unknown>;
  styles?: UiStyles;
  children?: UiNode[];
}

/** Tablet/mobile overrides merged on top of the base (desktop) styles. */
export interface ResponsiveStyles {
  tablet?: UiStyles;
  mobile?: UiStyles;
}

/** The container/hierarchy rules per component type family. */
export interface ComponentDefinition {
  type: string;
  category: ComponentCategory;
  label: string;
  /** Whether this component can contain children. */
  isContainer: boolean;
  /** Allowed child categories (used by the validator). */
  allowedChildren?: ComponentCategory[];
  defaultProps: Record<string, unknown>;
  defaultStyles?: UiStyles;
}

/** A page document — the unit that is saved to DB (documents.jsonb). */
export interface UiDocument {
  schemaVersion: string;
  id: string;
  pageId: string;
  name: string;
  viewport: Viewport;
  theme: Theme;
  root: UiNode;
}

// ---------------------------------------------------------------------------
// Patch operations
// ---------------------------------------------------------------------------

export type PatchOperationKind =
  | "add"
  | "update"
  | "remove"
  | "move"
  | "replace"
  | "style";

export interface AddPatch {
  op: "add";
  parentId: string;
  /** Index inside parent.children (default: append at end). */
  index?: number;
  node: UiNode;
}

export interface UpdatePatch {
  op: "update";
  targetId: string;
  /** Deep-ish merge into node.props (dot-path keys supported, e.g. "props.width"). */
  changes: Record<string, unknown>;
}

export interface RemovePatch {
  op: "remove";
  targetId: string;
}

export interface MovePatch {
  op: "move";
  targetId: string;
  newParentId: string;
  index?: number;
}

export interface ReplacePatch {
  op: "replace";
  targetId: string;
  node: UiNode;
}

export interface StylePatch {
  op: "style";
  targetId: string;
  styles: UiStyles;
}

export type UiPatch =
  | AddPatch
  | UpdatePatch
  | RemovePatch
  | MovePatch
  | ReplacePatch
  | StylePatch;

/** A session carries the patch list so the client can replay / sync. */
export interface PatchBatch {
  documentId: string;
  patches: UiPatch[];
}
