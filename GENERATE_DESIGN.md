# MCP Tools for Design Agent

Full list of MCP tools that need to be implemented on the client (server) side for the agent to work with canvas and content.

## Main Tools (14)

### Reading & Navigation

| Tool                                                        | Purpose                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `get_editor_state()`                                        | Current .pen file, selection, top-level nodes, reusable components |
| `open_document(filePathOrTemplate)`                         | Open .pen file or create new (`"new"`)                             |
| `batch_get(patterns, nodeIds, readDepth, searchDepth, ...)` | Read nodes by ID or search by patterns (type, name, reusable)      |
| `snapshot_layout(parentId, maxDepth, problemsOnly)`         | Computed layout rectangles (positions/sizes after layout engine)   |
| `get_screenshot(nodeId)`                                    | Screenshot of a node (visual verification)                         |
| `get_variables(filePath)`                                   | Read design tokens / variables / themes                            |

### Modification

| Tool                                                   | Purpose                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `batch_design(operations)`                             | Batch operations on nodes (core of everything)                    |
| `set_variables(filePath, variables, replace?)`         | Add/update variables and themes                                   |
| `replace_all_matching_properties(parents, properties)` | Recursive property replacement by match (colors, fonts, radii...) |

### Utility

| Tool                                                                     | Purpose                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `find_empty_space_on_canvas(direction, width, height, padding, nodeId?)` | Find free space for placing a new frame                                      |
| `search_all_unique_properties(parents, properties)`                      | Search for unique property values (for audit)                                |
| `get_guidelines(topic)`                                                  | Static content: `code`, `table`, `tailwind`, `landing-page`, `design-system` |
| `get_style_guide_tags()`                                                 | List of available style tags                                                 |
| `get_style_guide(tags?, name?)`                                          | Style guide for inspiration (by tags or name)                                |

## Operations Inside `batch_design`

`batch_design` accepts a string with a mini-script. Operations:

| Op              | Signature                                | Purpose                                                    |
| --------------- | ---------------------------------------- | ---------------------------------------------------------- |
| **I** (Insert)  | `binding=I(parent, nodeData)`            | Insert a new node                                          |
| **C** (Copy)    | `binding=C(sourceId, parent, overrides)` | Copy a node (+ `descendants`, `positionDirection/Padding`) |
| **U** (Update)  | `U(path, updateData)`                    | Update properties (no `children`, `id`, `type`, `ref`)     |
| **R** (Replace) | `binding=R(path, newNodeData)`           | Replace node entirely (for slots in components)            |
| **M** (Move)    | `M(nodeId, parent?, index?)`             | Move a node                                                |
| **D** (Delete)  | `D(nodeId)`                              | Delete a node                                              |
| **G** (Image)   | `G(nodeId, "ai"\|"stock", prompt)`       | Generate/find image and apply as fill                      |

## Node Types (.pen schema)

The agent works with these types: `frame`, `group`, `rectangle`, `ellipse`, `line`, `polygon`, `path`, `text`, `note`, `prompt`, `context`, `icon_font`, `ref` (component instance), `connection`.

## Key Implementation Notes

1. **`batch_design`** — the most complex tool. Needs a mini-script parser with bindings (`foo=I(...)`, then `U(foo+"/child", ...)`). Bindings live only within a single call.

2. **`G` operation** requires integration with AI image generation and stock photo API (Unsplash). Result is applied as `fill` on frame/rectangle.

3. **`get_screenshot`** — needs node rendering to image (returned to agent for visual verification).

4. **`batch_get`** must support `readDepth`, `searchDepth`, `resolveInstances`, `resolveVariables`, `includePathGeometry` — flexible tree unwinding.

5. **`snapshot_layout`** returns computed rectangles (after flexbox layout), not raw properties — needs access to layout engine.

6. **Tools `get_guidelines`, `get_style_guide_tags`, `get_style_guide`** — essentially static content/prompts injected into agent context. Implementation is just returning text.

---

## Detailed Tool Signatures

### `get_editor_state`

```
Parameters:
  include_schema: boolean  — whether to include .pen file schema

Returns:
  - Currently active .pen file path
  - Current user selection
  - Top-level nodes (document children)
  - Reusable components list
```

### `open_document`

```
Parameters:
  filePathOrTemplate: string  — file path to .pen file, or "new" for new document
```

### `batch_get`

```
Parameters:
  filePath?: string
  patterns?: Array<{ type?, name?, reusable? }>  — search patterns
  nodeIds?: string[]                               — specific node IDs to read
  parentId?: string                                — limit search scope
  readDepth?: number                               — how deep to read children (default 1)
  searchDepth?: number                             — how deep to search
  resolveInstances?: boolean                       — expand ref nodes fully
  resolveVariables?: boolean                       — resolve variable references to values
  includePathGeometry?: boolean                    — include full SVG path geometry

Returns:
  Matching nodes with children up to readDepth
```

### `batch_design`

```
Parameters:
  filePath?: string
  operations: string  — mini-script with I/C/U/R/M/D/G operations

Returns:
  List of created nodes with children (depth 2)
  List of potential issues

Rollback: if any operation fails, all previous operations in the batch are rolled back
Max operations per call: 25
```

### `snapshot_layout`

```
Parameters:
  filePath?: string
  parentId?: string        — subtree root (omit for whole document)
  maxDepth?: number        — depth limit (default: direct children only)
  problemsOnly?: boolean   — only return nodes with layout problems (clipping, overflow)

Returns:
  Computed layout rectangles for each node
```

### `get_screenshot`

```
Parameters:
  filePath?: string
  nodeId: string  — node to screenshot

Returns:
  Image (screenshot of the rendered node)
```

### `get_variables`

```
Parameters:
  filePath: string

Returns:
  Variables and themes defined in the .pen file
  Variable types: boolean, color, number, string
  Each variable can have themed values (different per theme axis)
```

### `set_variables`

```
Parameters:
  filePath: string
  variables: object    — variable definitions to add/merge
  replace?: boolean    — true = replace all, false = merge (default)
```

### `find_empty_space_on_canvas`

```
Parameters:
  filePath?: string
  nodeId?: string              — reference node (omit for entire canvas)
  direction: "top" | "right" | "bottom" | "left"
  width: number
  height: number
  padding: number              — minimum distance from other elements

Returns:
  Position { x, y } of available empty space
```

### `search_all_unique_properties`

```
Parameters:
  filePath?: string
  parents: string[]    — node IDs to search within
  properties: Array<"fillColor" | "textColor" | "strokeColor" | "strokeThickness" |
    "cornerRadius" | "padding" | "gap" | "fontSize" | "fontFamily" | "fontWeight">

Returns:
  Unique values found for each property
```

### `replace_all_matching_properties`

```
Parameters:
  filePath?: string
  parents: string[]    — node IDs to search within
  properties: {
    fillColor?:       Array<{ from: string, to: string }>
    textColor?:       Array<{ from: string, to: string }>
    strokeColor?:     Array<{ from: string, to: string }>
    strokeThickness?: Array<{ from: number, to: number }>
    cornerRadius?:    Array<{ from: number[], to: number[] }>
    padding?:         Array<{ from: number, to: number }>
    gap?:             Array<{ from: number, to: number }>
    fontSize?:        Array<{ from: number, to: number }>
    fontFamily?:      Array<{ from: string, to: string }>
    fontWeight?:      Array<{ from: string, to: string }>
  }
```

### `get_guidelines`

```
Parameters:
  topic: "code" | "table" | "tailwind" | "landing-page" | "design-system"

Returns:
  Static text with design guidelines for the topic
```

### `get_style_guide_tags`

```
Parameters: none

Returns:
  List of all available style guide tags
```

### `get_style_guide`

```
Parameters:
  tags?: string[]   — 5-10 tags for style search
  name?: string     — specific style guide name

Returns:
  Style guide with visual direction, colors, typography, etc.
```

---

## .pen File Schema (Node Types)

### Common Interfaces

```typescript
interface Position { x?: number; y?: number; }
interface Size { width?: NumberOrVariable | SizingBehavior; height?: NumberOrVariable | SizingBehavior; }

type SizingBehavior = string; // "fit_content", "fill_container", "fit_content(100)", "fill_container(500)"
type Fill = ColorOrVariable | { type: "color"; color: ColorOrVariable; } | { type: "gradient"; ... } | { type: "image"; url: string; mode?: "stretch"|"fill"|"fit"; } | { type: "mesh_gradient"; ... }

interface Layout {
  layout?: "none" | "vertical" | "horizontal";
  gap?: NumberOrVariable;
  padding?: NumberOrVariable | [h, v] | [top, right, bottom, left];
  justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
  alignItems?: "start" | "center" | "end";
}
```

### Node Types

| Type         | Description                     | Key Properties                                                                             |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `frame`      | Rectangle with children, layout | `cornerRadius`, `clip`, `placeholder`, `slot`, `children`, Layout                          |
| `group`      | Container with children         | Layout, `children`                                                                         |
| `rectangle`  | Basic shape                     | `cornerRadius`, fill/stroke                                                                |
| `ellipse`    | Ellipse/arc/ring                | `innerRadius`, `startAngle`, `sweepAngle`                                                  |
| `line`       | Line                            | fill/stroke                                                                                |
| `polygon`    | Regular polygon                 | `polygonCount`, `cornerRadius`                                                             |
| `path`       | SVG path                        | `geometry` (SVG d), `fillRule`                                                             |
| `text`       | Text content                    | `content`, `textGrowth`, `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`, `textAlign` |
| `icon_font`  | Icon from font                  | `iconFontName`, `iconFontFamily`, `weight`                                                 |
| `ref`        | Component instance              | `ref` (component ID), `descendants` (overrides)                                            |
| `note`       | Sticky note                     | `content`                                                                                  |
| `prompt`     | AI prompt node                  | `content`, `model`                                                                         |
| `context`    | Context node                    | `content`                                                                                  |
| `connection` | Line between nodes              | `source`, `target` (with path + anchor)                                                    |

### Document Structure

```typescript
interface Document {
  version: string;
  fonts?: { name: string; url: string }[];
  themes?: { [axis: string]: string[] };
  variables?: {
    [name: string]: {
      type: "boolean" | "color" | "number" | "string";
      value: T | { value: T; theme?: Theme }[];
    }
  };
  children: (Frame | Group | Rectangle | ... | Connection)[];
}
```

---

## Agent Workflow

Typical agent workflow when designing:

1. `get_editor_state()` — understand current file, selection, available components
2. `get_style_guide_tags()` + `get_style_guide(tags)` — get design inspiration (for creative tasks)
3. `get_guidelines(topic)` — get relevant design rules
4. `get_variables()` — read design tokens (always use these, never hardcode)
5. `batch_get(componentIds, readDepth: 3)` — inspect component structure before using
6. `snapshot_layout(parentId, maxDepth)` — check existing layout
7. `batch_design(operations)` — generate layout using components (max 25 ops per call)
8. `get_screenshot(nodeId)` — verify changes visually
9. Repeat steps 7-8 for additional sections

### batch_design Mini-Script Examples

**Insert component and customize:**

```javascript
card = I("parentId", { type: "ref", ref: "CardComp" });
U(card + "/title", { content: "Account Details" });
U(card + "/description", { content: "Manage your settings" });
```

**Copy and modify:**

```javascript
dashboardV2 = C("Xk9f2", document, {
  name: "Dashboard V2",
  positionDirection: "right",
  positionPadding: 100,
});
D(dashboardV2 + "/sidebar");
U(dashboardV2 + "/stats/card1", { fill: "#E8F5E9" });
```

**Table row:**

```javascript
tableRow = I("tableId", { type: "frame", layout: "horizontal" });
cell1 = I(tableRow, { type: "frame", width: "fill_container" });
text1 = I(cell1, { type: "text", content: "John Doe" });
cell2 = I(tableRow, { type: "frame", width: "fill_container" });
text2 = I(cell2, { type: "text", content: "john@example.com" });
```

**Image generation:**

```javascript
heroImg = I("parentId", {
  type: "frame",
  name: "Hero Image",
  width: 400,
  height: 300,
});
G(heroImg, "ai", "modern office workspace bright");
```

### Key Rules

- `placeholder: true` must be set on frames being actively designed, removed when done
- Text has no color by default — must set `fill` property
- No "image" node type — images are fills on frame/rectangle via `G` operation
- `fill_container` only valid when parent has flexbox layout
- `x`/`y` ignored when parent uses flexbox layout
- Variables referenced with `$` prefix: `fill: "$primary-color"`
- Max 25 operations per `batch_design` call
- Bindings only live within one `batch_design` call
- Copy (C) creates new IDs for descendants — don't U() copied descendants, use `descendants` in C()
