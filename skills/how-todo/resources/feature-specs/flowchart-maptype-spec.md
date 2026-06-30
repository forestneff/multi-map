Feature Specification: Flowchart Maptype

### 1. Overview & Intent
Reference: TODO Phase 2, Item #7
- Goal: Introduce a dedicated flow-root maptype and associated sub-nodes designed specifically for plotting logic flows, workflow automation, and state machines.
- Why: Standard mind-maps use a strict parent-child radial tree. To visually construct agent behaviors (TODO #8), complex prompt chains, or user workflows, we need directional relationships (e.g., "If Yes, go here; If No, go there") and specialized visual indicators (decision diamonds, process boxes).

---

### 2. Schema Architecture (mapstate-schema.json)
The schema must be expanded to include specific flowchart node types and support non-hierarchical connections (if a workflow loops back on itself).

Proposed Schema Additions:
New Node Types:
- `flow-root`: The root node of a flowchart map.
- `flow-process`: Standard action/step (rendered as a rectangle).
- `flow-decision`: Conditional branch (rendered as a diamond).
- `flow-terminal`: Start/End points (rendered as a pill).

Directional Edge Support:
Standard Multi-Map uses implicit parent-to-child edges. Add an `edges` or `connections` array to the map schema to support custom directional arrows linking arbitrary nodes (essential for loops/state machines).

```json
"edges": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "sourceId": { "type": "string" },
      "targetId": { "type": "string" },
      "label": { "type": "string", "description": "e.g., 'Yes', 'No', 'Retry'" }
    },
    "required": ["sourceId", "targetId"]
  }
}
```

---

### 3. UI Implementation & Rendering
Target Files: `multi-map-core.js` (Canvas Loop), `multi-map-rules.js` (Radial logic)

- Canvas Rendering Loop: Update the `drawNode()` function in `multi-map-core.js`.
  - If `node.type === 'flow-decision'`, render a diamond path instead of the standard rounded rectangle.
  - If `node.type === 'flow-terminal'`, render a heavily rounded pill shape.
  - Update edge rendering to draw directional arrows (with arrowheads) instead of plain bezier curves. Include support for rendering the label text on the edge line.
- Radial Menu (`multi-map-rules.js`):
  - When selecting a `flow-decision` node, the radial menu should offer explicit "Add True Branch" and "Add False Branch" actions, rather than generic "Add Node."
  - Allow an "Add Link" action to connect the current node to another existing node (populating the `edges` schema array).

---

### 4. Core Logic & Data Flow
Target Files: `multi-map-core.js`

- Layout Engine: Standard mind-maps use a radial or tree layout algorithm. Flowcharts typically require a top-down, left-to-right, or orthogonal routing algorithm. Implement a localized layout flag or alternate layout calculation when the map's root is `flow-root`.
- State Machine Execution (Future-proofing): Design the data structure so that an external engine (like the Agent or Prompt engines) can easily walk the graph. A `flow-decision` must have clear True/False target IDs.

---

### 5. Execution Plan for Agents
When an agent picks up this task, it should follow this strict sequence:
1. Schema Update: Add the `flow-*` node types and the `edges` array to `mapstate-schema.json`.
2. Rendering Engine: Modify `multi-map-core.js` to draw the specific shapes (diamond, pill) based on `node.type` and implement directional arrows for flowchart maps.
3. Interaction Rules: Update `multi-map-rules.js` to provide specific radial menu options for flowchart nodes (e.g., adding conditional branches).
4. Layout Logic: Adapt the coordinate assignment logic so flowchart nodes align in a readable flow (e.g., top-to-bottom) rather than sprawling radially.

---

### 6. Testing Criteria
- Creating a `flow-root` successfully initializes the new maptype.
- Adding a `flow-decision` node renders a diamond on the canvas.
- Edges between flowchart nodes clearly display directional arrowheads.
- The radial menu correctly adapts its options when a `flow-decision` node is selected.
- (Optional but recommended) Write a unit test `tests/test_flowchart.js` that generates a simple decision tree and validates the edge connections.