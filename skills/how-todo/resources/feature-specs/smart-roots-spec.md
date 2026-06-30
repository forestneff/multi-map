Feature Specification: Smart Roots

### 1. Overview & Intent
Reference: TODO Phase 2, Item #5
- Goal: Transform root nodes (e.g., `map-root`, `person-root`, `prompt-root`) from simple structural anchors into dynamic data payloads.
- Why: Currently, when a portal links to a map, it just links to the visual topology. By giving the root node a standardized, editable `root_metadata` payload, maps can act like functions or components—passing state, configuration, and context to whichever portal invokes them.

---

### 2. Schema Architecture (mapstate-schema.json)
The core Node schema must be updated to support the new metadata object. This should be validated to ensure it only applies to root-level nodes.

Proposed Addition to Node Schema:
```json
{
  "root_metadata": {
    "type": "object",
    "description": "Structured payload for root nodes, passed to connected portals.",
    "properties": {
      "summary": { "type": "string", "description": "High-level summary of the map's purpose." },
      "tags": { "type": "array", "items": { "type": "string" } },
      "portal_behavior": {
        "type": "string",
        "enum": ["standard", "dynamic_spawn", "read_only", "execute_prompt"],
        "default": "standard"
      },
      "custom_payload": {
        "type": "object",
        "description": "Arbitrary JSON data for specialized engines (e.g., agent configs, variables)."
      }
    }
  }
}
```

---

### 3. UI Implementation (The Inspector)
Users need a way to view and edit this metadata natively within the Multi-Map interface.
Target File: `multi-map-core.js` (Inspector rendering logic) & `multi-map-ui.css`

- Trigger: When the selected node (`SC.selectedNode`) is a root node (e.g., `id === 'root'` or `type.endsWith('-root')`), the Inspector panel should mount a new "Root Metadata" section.
- Fields:
  - A text area for the summary.
  - A comma-separated input or token-field for tags.
  - A dropdown for `portal_behavior` (preparing for TODO #6: Dynamic Portals).
  - A `<textarea>` that validates as JSON for `custom_payload`.
- Event Handling: Inputs should bind to `kernel.updateNodeData()` to ensure changes are pushed to the undo stack and saved to Firestore.

---

### 4. Core Logic & Data Flow
Target File: `multi-map-core.js` & `multi-map-library.js`

- Initialization: When a new map is generated (via `generateMapState` or manually), the root node should instantiate with a default, empty `root_metadata` object.
- Portal Handoff Preparation: Create a utility function (e.g., `kernel.getRootMetadata(mapId)`) that fetches a map, extracts the root node, and returns the `root_metadata` object.
- Caching: Because portals need to know the metadata of their target maps before actually fully entering them, the metadata should ideally be cached locally or included in the lightweight project index fetched by `multi-map-library.js`.

---

### 5. Execution Plan for Agents
When an agent picks up this task, it should follow this strict sequence:
1. Update Schema: Modify `mapstate-schema.json` to include the `root_metadata` definition.
2. Update Inspector UI: Modify the inspector rendering function in `multi-map-core.js` to detect root nodes and inject the metadata form fields. Add necessary styles to `multi-map-ui.css`.
3. Bind State: Ensure the new UI elements correctly update the node's state array and trigger `kernel.saveHistory()`.
4. Create Accessor: Add `kernel.getRootPayload(targetMapId)` to easily retrieve this data for the upcoming Dynamic Portals update.

---

### 6. Testing Criteria
- Selecting the root node of any map successfully displays the new metadata fields in the Inspector.
- Selecting a non-root node hides these fields.
- Updating the fields writes valid JSON to the local state and survives a page refresh (Firestore sync).
- Entering invalid JSON into the `custom_payload` field highlights the field with an error state and prevents saving.