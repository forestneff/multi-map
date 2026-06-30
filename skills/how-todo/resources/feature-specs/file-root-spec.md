Feature Specification: File-Root Maptype

### 1. Overview & Intent
Reference: TODO Phase 2, Item #9
- Goal: Create a map-native file-system explorer. This will serve two purposes:
  1. Visually represent local OS directories as nodes, allowing users to browse and interact with their local files directly within the Multi-Map workspace.
  2. Act as an auto-generated, dynamic "Master Navigation Map" for native Multi-Map projects, mapping out internal pages as a virtual file system.
- Why: To truly act as an OS for ideas and agentic workflows, users need a way to link their conceptual maps directly to their physical project files. Furthermore, as projects grow to contain dozens of pages/submaps, users need a map-native, spatial directory to navigate their own workspace without relying solely on the UI sidebar.

---

### 2. Schema Architecture (mapstate-schema.json)
We need node types to represent the file system hierarchy, as well as a flag to indicate if the root is managing external OS files or internal project files.

Proposed Sub-Type Additions:
- `file-root`: The mount point. Should include a `source` property in its `root_metadata` (e.g., `local_os` vs `internal_project`).
- `file-folder`: Represents a directory (either local OS folder or a virtual internal group).
- `file-document`: Represents a specific file or an internal Multi-Map page.

Important Data Constraint (Local OS):
The HTML5 File System Access API returns `FileSystemDirectoryHandle` and `FileSystemFileHandle` objects. These cannot be serialized into standard JSON. Therefore, the schema will only store the paths or names, while the actual handles must be stored in browser IndexedDB (using the node's ID as the key) to maintain persistent permission across sessions.

---

### 3. Core Logic A: Local File System Integration
Target Files: `multi-map-core.js`, `multi-map-library.js`

- Mounting a Directory: When a user selects a `file-root` node, expose a "Mount Local Folder" action in the radial menu or inspector. Trigger `window.showDirectoryPicker({ mode: 'readwrite' })`. Store the resulting handle in IndexedDB.
- Dynamic Parsing (Lazy Loading): Iterate over the directory handle's entries. Auto-spawn `file-folder` or `file-document` child nodes. Do not recursively render the entire nested tree instantly (lazy loading on node expansion).

---

### 4. Core Logic B: The Internal Project Master Map
Target Files: `multi-map-library.js`, `multi-map-core.js`, `multi-map-rules.js`

- Auto-Spawning & Two-Way Editing: When a new Multi-Map project is initialized, automatically generate a visible page using the `file-root` maptype (e.g., "Project Directory"). Unlike standard portals, this map is fully editable. If a user manually adds a `file-document` node to this map, it should trigger the creation of a new blank page in the project. If they delete a node, it should prompt to delete the corresponding project page.
- Dynamic Synchronization: Hook into the `addPage()` and `deletePage()` functions in `multi-map-library.js`. Whenever a user creates a new map/page in their project via the standard sidebar, automatically spawn a corresponding `file-document` child node on the Master Map. Update the topology automatically (e.g., arranging them in a grid or standard top-down flowchart layout).
- Radial Menu Navigation (Non-Destructive Expansion): Architectural Principle: We do not overwrite core logic like node selection. When a user clicks a `file-document` node inside this Master Map, standard selection occurs. Update `multi-map-rules.js` so the Radial Menu and Smart Button dynamically populate a "Navigate to Page" action specifically for these internal file nodes. Clicking that action triggers the workspace transition.

---

### 5. The Sandbox Phase Engine (engines/file-explorer.html)
This file will serve as the dedicated viewport for interacting with mounted files (primarily for `local_os` sources).
- Dual-Pane Layout: Render a classic file-explorer UI. The left pane or canvas handles the map-based folder tree, while the right pane provides a robust preview window.
- File Previewing: Fetch text files (`.md`, `.txt`, `.js`) via the handle and render in an editable `<textarea>` or code block. For internal Multi-Map pages, the phase engine view might simply act as a list-view alternative to the canvas.

---

### 6. Execution Plan for Agents
1. Schema & Storage Prep: Update `mapstate-schema.json` with `file-*` types and the source metadata. Update `multi-map-library.js` for IndexedDB handle storage.
2. Master Map Hooks: Modify the project creation flow to auto-spawn the `file-root` Master Map. Add event listeners/hooks in the page creation/deletion logic to maintain two-way sync with the nodes on this map.
3. Mount & Parse Logic (Local): Implement the `showDirectoryPicker()` flow in `multi-map-core.js` for local OS mounting.
4. Interaction Rules: Update `multi-map-rules.js` to populate a "Navigate to Page" button in the radial menu when a `file-document` is selected.
5. Phase Engine UI: Build `engines/file-explorer.html` to preview local files.

---

### 7. Testing Criteria
- Creating a new project automatically generates a visible "Project Directory" map.
- Adding a new page to the project via the sidebar automatically spawns a node on the "Project Directory" map.
- Adding a `file-document` node via the radial menu on the "Project Directory" map automatically creates a new page in the sidebar.
- Selecting a page node does not instantly navigate, but opening its radial menu reveals a functional "Navigate to Page" action.
- Creating a local `file-root` node and clicking "Mount" successfully opens the browser's directory picker and spawns children from the local OS.