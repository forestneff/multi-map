Feature Specification: Prompt-Root Ecosystem

### 1. Overview & Intent
Reference: TODO Phase 2, Item #8 (Part 1)
- Goal: Transform the prompt-root maptype into a robust, map-native interface for designing, structuring, and chaining complex prompts.
- Why: Managing complex prompts is difficult in flat text files. By utilizing the mind-map structure and a "perfect prompt" framework, users can visually compartmentalize prompt logic (roles, contexts, constraints), inject variables dynamically, and export high-quality, structured text to use with external LLMs or agentic systems like Antigravity.

---

### 2. Schema Architecture (mapstate-schema.json)
We need to expand the node type hierarchy under prompt-root to support semantic prompt construction based on the "perfect prompt" framework.

Proposed Sub-Type Additions:
Core Framework Nodes:
- `prompt-role`: Defines the AI's persona, expertise, or perspective (e.g., "Act as a Senior Cloud Architect").
- `prompt-goal`: The primary objective or task the LLM must accomplish.
- `prompt-context`: Background information, environment details, or necessary context for the task.
- `prompt-instruction`: Step-by-step directives, methodologies, or formatting instructions.
- `prompt-constraint`: Explicit boundaries, rules, guardrails, and negative prompts (what not to do).
- `prompt-example`: Few-shot learning examples (input/output pairs) to demonstrate the desired result.

Dynamic & Structural Nodes:
- `prompt-variable`: Dynamic injection points (e.g., `{{user_name}}` or `{{data_payload}}`).
- `prompt-chain`: A node indicating sequential or conditional execution of sub-prompts (ties into the Flowchart maptype).

Update `mapstate-schema.json` to define these types, ensuring they are valid children of a `prompt-root`.

---

### 3. The Sandbox Phase Engine (engines/prompt-engine.html)
This file will serve as the dedicated viewport for interacting with the assembled prompt.
- Visual Assembly: The engine should parse the tree structure (starting from `prompt-root`) and render a unified preview of the final text.
- Variable Binding: Render input fields in the inspector or sandbox UI for any `prompt-variable` nodes detected in the tree, allowing real-time preview of variable injection.
- Structure Validation: Visually warn the user if foundational nodes (like `prompt-goal` or `prompt-instruction`) are missing from their map.

---

### 4. Export & Builder Logic
Target File: `engines/prompt-engine.html` & `multi-map-core.js`

- Semantic String Builder: Create a utility function that walks the node tree. Instead of simple Depth-First Search concatenation, the builder should compile the prompt semantically based on node type, assembling them in the optimal "perfect prompt" order (e.g., Role -> Context -> Goal -> Instructions -> Constraints -> Examples). It should inject clear markdown headers for each section.
- Export Action: Add an "Export Prompt" button to the prompt-phase sandbox viewport. This should take the compiled string and trigger a browser download as a `.md` or `.txt` file.

---

### 5. Portal Integration (multi_map_ai_engine.js)
When a dynamic portal (TODO Phase 2, Item #6) points to a `prompt-root` map locally, the AI engine logic should dictate the layout. For example, if the prompt has three `prompt-variable` nodes, the portal should dynamically auto-spawn three local input child nodes for the user to fill out before executing the prompt against an LLM.

---

### 6. Execution Plan for Agents
1. Schema Expansion: Update `mapstate-schema.json` with the new `prompt-*` node types and define their allowed relationships. Update `multi-map-rules.js` to include these in the radial menu when working in a `prompt-root`.
2. Phase Engine Development: Flesh out `engines/prompt-engine.html` to parse and display a concatenated, semantically ordered preview of the map's nodes.
3. Export Utility: Implement the semantic string builder and the `.md`/`.txt` download hook.
4. Dynamic Portal Hook: Tie the detection of `prompt-variable` nodes to the `openPortal()` initialization logic to auto-spawn inputs locally.

---

### 7. Testing Criteria
- Adding various `prompt-*` nodes accurately updates the preview in `prompt-engine.html`, organizing them in the correct semantic order regardless of how they are spatially arranged on the canvas.
- Clicking Export successfully downloads a well-formatted `.md` file containing the assembled prompt with appropriate section headers.
- Opening a portal to a `prompt-root` dynamically exposes its `prompt-variable` nodes as inputs.