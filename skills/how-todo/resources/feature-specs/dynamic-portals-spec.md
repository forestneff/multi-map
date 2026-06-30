Feature Specification: Dynamic Portals

### 1. Overview & Intent
Reference: TODO Phase 2, Item #6
- Goal: Deprecate the bespoke "smart portal" implementation in favor of a universal, dynamic portal architecture. All portals will act as data-driven endpoints that read the target map's Smart Root metadata to dictate their behavior, layout, and editing permissions.
- Why: Currently, portals act mostly as dumb hyperlinks to other canvases. By standardizing them as dynamic endpoints, we can pass metadata (state, context, payloads) across the portal boundary. Enforcing that portals are "endpoints" means we can lock down generic editing and rely entirely on the target map's Phase Engine for specialized interactions. Crucially, this behavior must execute locally within the host map via a new `openPortal()` method, preserving the existing `enterPortal()` method strictly for full-page map traversal.

---

### 2. Architectural Updates
Target Files: `multi-map-core.js`, `multi-map-rules.js`, `phase-engines.js`

- The portal node itself doesn't require a major schema change, as its power now comes from reading the target map's `root_metadata` (defined in TODO #5).
- The Boundary Rule: Once a user "opens" a portal locally, they interact with a "Dynamic Endpoint." Generic map editing (manually adding arbitrary child nodes to the portal) is disabled unless explicitly permitted by the target map's `root_metadata.portal_behavior`.
- The Local Handoff: A new `openPortal` function must be created to act as a local data pipeline, taking the context of the parent map and using the child map's metadata to dynamically render content within the current session, without navigating away.

---

### 3. UI Implementation & Radial Menu
Target Files: `multi-map-rules.js`, `tutorials/radial_menu.json`

Users need immediate visual and interactive feedback that a portal leads to a managed endpoint, not just a standard link.
- Radial Menu Lockdown: Modify the radial menu generation logic in `multi-map-rules.js`. If a node is a portal, or if the user is currently interacting with a dynamic endpoint, the standard "Add Node" (plus icon) button must be removed or disabled in the radial menu.
- Tutorial Update: Update `tutorials/radial_menu.json` to reflect the removal of the generic add button for portal nodes, ensuring the automated tutorial doesn't look for a missing DOM element.

---

### 4. Core Logic & Data Flow
Target Files: `multi-map-core.js`, `tests/test_portal.js`

Implement `openPortal(targetMapId)`:
- Triggered by user interaction (e.g., specific click or radial action).
- Fetch the target map's state without clearing the current canvas.
- Extract the `root_metadata` payload from the target map's root node.
- Inject this payload into the current local state tied to that specific portal node.
- Auto-Spawning Children (Local Execution): Immediately after `openPortal` fetches the metadata, if the `root_metadata` dictates an auto-spawn behavior (e.g., `portal_behavior: "dynamic_spawn"`), automatically generate the required child nodes visually attached to the portal node in the current workspace.
  - Example: Opening a prompt-chain portal locally might auto-spawn input nodes based on variables defined in the Smart Root metadata.
- Preserve `enterPortal()`: The existing `enterPortal()` method must remain conceptually unchanged, acting as the traversal function to load the submap as the primary workspace page.

---

### 5. Execution Plan for Agents
When an agent picks up this task, it should follow this strict sequence:
1. Radial Menu Refactor: Start in `multi-map-rules.js`. Add a conditional check to hide/remove the "add node" action from the radial menu when interacting with a portal. Update `tutorials/radial_menu.json` to match.
2. Data Handoff Pipeline: Create `openPortal()` in `multi-map-core.js`. Write the logic to explicitly fetch the target map's root node, extract `root_metadata`, and pass it to a local rendering hook without invoking a page transition.
3. Auto-Spawn Logic: Implement the initialization hook that reads the handed-off metadata during `openPortal()` and dynamically spawns local child nodes on the current canvas if required. Ensure state is managed so these dynamic nodes don't permanently pollute the host map's save file incorrectly.
4. Test Remediation: Run and update `tests/test_portal.js`. Add new tests specifically validating `openPortal()`'s local execution, while ensuring `enterPortal()`'s traversal tests still pass.

---

### 6. Testing Criteria
- Opening the radial menu on a portal node does not show the standard "Add Node" button.
- Calling `openPortal()` successfully fetches the target map's `root_metadata` and makes it available locally without navigating away from the current map.
- If the target map is configured for it, child nodes auto-spawn immediately attached to the portal node upon calling `openPortal()`.
- Calling `enterPortal()` still successfully traverses to the submap as the main workspace view.
- `npm test` (specifically `test_portal.js`) executes completely without errors.