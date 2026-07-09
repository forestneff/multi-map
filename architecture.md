# Multi-Map Architecture Guide

This document maps the entire Multi-Map application to facilitate rapid codebase navigation for developers and AI agents.

## Core Paradigm: Decoupled State Machine
The application strictly separates **State/Logic** from **Rendering/DOM**. The DOM never dictates the truth.
1. **The Kernel** maintains the JSON MapState and performs mathematical mutations.
2. **The View Controller (Sandbox)** subscribes to the Kernel and updates the DOM to reflect the state.

---

## 🏗️ Component Rendering Strategy (Vanilla JS Templates)
The application uses Vanilla JS with ES6 template literals (`` innerHTML = `...` ``) to build UI components (modals, radial menus, settings panels). There is no virtual DOM framework (like React or Vue). 

UI rendering is separated into domain-specific modules:
- **`auth.js`**: Renders the Profile Drawer, Settings toggles, and Data Manager sidebar.
- **`multi-map-sandbox.js`**: Renders the Map Canvas nodes, Radial Context Menus, and dynamic Modals (e.g., Copy Page, Clip Branch, action dialogs).
- **`multi_map_ai_engine.js`**: Manages the AI Chat Panel, Tooltip Bars, and Autocomplete overlays.

DOM updates are handled either by completely replacing `innerHTML` inside a dedicated container (for modals/drawers) or by toggling CSS classes for high-performance localized updates.

---

## 🎨 Styling, Theming & Z-Index System

### Theming Paradigm (Light/Dark Mode)
The application defaults to a dark theme. Rather than dynamically modifying Tailwind utility classes directly in JS templates (which is brittle), themes are managed via a global class toggle:
- `localStorage.getItem('mm_theme')` dictates the initial theme.
- Toggling the theme adds or removes a `.light-mode` class on `document.body`.

### CSS Overrides
Because dark-mode Tailwind classes (e.g., `bg-slate-900`) are often hardcoded into JS template strings, the global theme is enforced by using `!important` descendant overrides in `multi-map-ui.css`. 
*Example:* `body.light-mode .bg-slate-900 { background-color: #ffffff !important; }`

### Z-Index Stacking Context
To prevent occlusion bugs between the disparate UI modules (which inject their own DOM elements), follow this z-index scale:
- **0 - 10**: Map Canvas and node elements.
- **20 - 30**: Persistent UI Nav, Sidebars, AI Toggle buttons.
- **30 - 40**: Radial Menus, Autocomplete Popovers, Tooltip Bars.
- **50 - 60**: Open Modals, Drawer Overlays, expanded AI Chat Panel.
- **100+**: Critical System Dialogs, Error Overlays.

*Note: Always verify that dynamically injected modals or chat panels occlude the radial menu and standard navigation.*

---

## 🧠 Core State & Visibility Logic
`multi-map-core.js` is responsible not only for physics but also for logical visibility and structural rules.

When modifying the MapState, do not try to manually toggle DOM elements. Instead, modify the underlying data and call `this.notify()`.
*Key Pattern (`selectNode`):* When a node is selected (e.g., via search or entering a portal), the Core automatically walks the structural links (`links.find(l => l.target === currentId)`) to expand any collapsed ancestors by setting `node.data.collapsed = false`. The Sandbox View Controller then re-renders the map with the updated visibility state.

---

## 🪟 Phase Engine Architecture (Iframe Isolation)
The alternative visual renderers (`engines/*.html`) run inside isolated iframes. They are completely stateless and enforce a strict unidirectional data flow.

**The `postMessage` Synchronization Contract:**
Any global UI state changes must be broadcast from `phase-engines.js` to the iframes. When the Sandbox pushes a state update, `phase-engines.js` sends a payload containing:
1. The full JSON MapState clone (`state`)
2. Global UI hints (`highlight`, `theme`)

Every iframe engine must include a `message` event listener to handle these payloads, parse the JSON, apply the local theme (e.g., `document.body.classList.toggle('light-mode', event.data.theme === 'light')`), and entirely re-render itself.

---

## 📁 File Structure & Responsibilities

### 1. `multi-map-core.js` (The Kernel)
**Role:** State management, mathematical physics, database sync, logical visibility, project/folder structures.
- **Physics/Layout:** 
  - `resolveOverlaps(iterations, kRepel, kSpring)` - The core force-directed layout engine.
  - `autoLayoutOrganic()` - Deep layout triggered by user.
- **Node Operations (Mutations):**
  - `addNode(data, pid)` / `updateNode(id, up)` / `deleteNode(id)` - Modifies the `this.state.nodes` array.
- **Map & Project Management:**
  - `createProject()`, `getOrCreateMasterMap(projectId)`
  - `syncProjectMasterMap(projectId)` - Bi-directional synchronization between the Master Directory map and internal project folder lists.
  - `savePage()`, `loadMapState()`
- **Portals (Submaps):**
  - `enterPortal(mapData)` / `openPortal(portalNodeId)` / `exitPortal()`
- **Global Instance:** Typically accessed via `kernel` variable.

### 2. `multi-map-sandbox.js` (The View Controller)
**Role:** DOM manipulation, UI event handling (mouse, touch, keyboard), Radial Menu, Camera/Viewport.
- **Rendering:**
  - `renderMap(state)` - Main loop. Creates/updates DOM elements using mathematical diffing (`dataset.stateHash`).
  - `updateTransform()` - Applies viewport pan/zoom CSS to the world layer.
- **Input Handling:**
  - `handlePointerDown/Move/Up`, `handleWheel` - Canvas interaction.
  - `handleGlobalKeydown(e)` - Keyboard shortcuts.
- **UI Elements:**
  - `showRadialMenu(node)` / `hideRadialMenu()`
  - `showDialogModal()`, `actionPrompt()`
- **User Actions (intent handlers):**
  - Prefix `action*` (e.g., `actionAddChild()`, `actionLink()`). These parse UI intent and call Kernel mutation methods.
- **Global Instance:** Typically accessed via `SC` variable.

### 3. `multi-map-rules.js` (The Ontology)
**Role:** Defines the schema, allowed node types, and structural rules.
- **`MultiMapSchema.definitions`**: Defines node visual metadata (label, icon, priority). Add new node types here.
- **`MultiMapSchema.rules`**: Defines strict parent-child relationship allowances.
- **`MultiMapSchema.mapTypes`**: Defines Subtype rules (what nodes are allowed in specific map types).

### 4. `auth.js` (Authentication & Settings UI)
**Role:** Firebase initialization, Auth UI, Profile Drawer, Data Manager Sidebar, Theme toggling.
- **Globals exposed:** `window.FirebaseAuth`, `window.FirebaseDb`, `window.Firestore`, `window.Auth`.
- Handles user profile rendering and global settings state.

### 5. `phase-engines.js` & `engines/*.html`
**Role:** Alternative visual renderers for the JSON MapState (running in iframes).
- **`phase-engines.js`**: Registry and iframe communication layer (`postMessage`). Broadcasts `STATE_UPDATE` to all engines.
- **`engines/web-architect.html`**: Live HTML/Tailwind compiler.
- **`engines/prompt-engine.html`**: Markdown compiler.
- **`engines/agent-config.html`**: Dashboard renderer.
- **`engines/orbital-focus.html`**: Strict hierarchical tree visualizer.

### 6. `multi_map_ai_engine.js` (AI Assistant)
**Role:** Native LLM integration, Chat UI Panel, Autocomplete overlays, Local Commands.
- **Key Methods:**
  - `handleSend()` - Chat processing.
  - `geminiAPIGeneration(prompt, contextStr)` - Cloud API call.
  - `tryExecuteLocalCommand(text)` - Sandbox logic avoiding API calls.

### 7. CSS & Styling
**Role:** The platform mixes Tailwind and custom CSS.
- **`multi-map-base.css`**: Core structural resets.
- **`multi-map-ui.css`**: Defines the "Astral Theme" CSS variables, light mode overrides (`body.light-mode`), glassmorphism panels, and SVG styling.

---

## 💾 Persistence Layer (Database & Storage)

### Firebase Firestore Collections
- `users/{uid}/projects/{projectId}`: Holds Project metadata and `page_ids` arrays.
- `users/{uid}/projects/{projectId}/pages/{pageId}`: Holds the exact `MapState` JSON.

### LocalStorage Fallbacks
- `mm_projects`: Offline project definitions.
- `mm_core_state`: The active session's auto-saved MapState.
- `mm_constellation_lib`: User's saved JSON maps.
- `mm_theme`: Active visual theme (`light` | `dark`).

---

## 🧬 Data Structures: MapState JSON Schema

```json
{
  "map_id": "string",
  "meta": {
    "title": "string",
    "type": "string",               // matches keys in MultiMapSchema.mapTypes
    "project_id": "string",         // parent project mapping
    "isMaster": "boolean"           // true ONLY for Project Directory map
  },
  "nodes": [
    {
      "id": "string",
      "type": "string",             // matches keys in MultiMapSchema.definitions
      "title": "string",
      "content": "string",          // optional text payload
      "data": { 
        "x": "number", 
        "y": "number", 
        "isCore": "boolean",        // pinned node (immune to physics)
        "collapsed": "boolean"      // children hidden (converted to Moons)
      }
    }
  ],
  "connections": [
    { 
      "id": "string", 
      "from": "node_id", 
      "to": "node_id", 
      "type": "structural|association|flow" 
    }
  ],
  "session": {
    "viewport": { "x": "number", "y": "number", "scale": "number" },
    "selectedId": "string"
  }
}
```

---

## 🛠️ Common Developer Workflows (Recipes)

### How to Add a New Node Type
1. Open `multi-map-rules.js`.
2. Add the node to `MultiMapSchema.definitions` with a label, icon, and priority.
3. Add a strict parent-child rule in `MultiMapSchema.rules`.
4. Add the type to specific `allowedNodes` arrays in `MultiMapSchema.mapTypes`.

### How to Create a New Dynamic Modal or Dialog
1. Open `multi-map-sandbox.js`.
2. Locate or use `this.showDialogModal(title, text, options)`.
3. Build your internal modal structure using an ES6 template literal (`innerHTML = \`...\``).
4. For interactive components (e.g., radios, checkboxes), query them inside the `onRender` callback of `showDialogModal` to attach standard event listeners.
5. Use existing Tailwind utility classes for structure, and rely on `multi-map-ui.css` theme overrides for light/dark shifting.

### How to Add a New Global UI State (e.g., Theme/Highlight)
1. **State Persistence**: Save the new state in `localStorage` (e.g. inside `auth.js`).
2. **DOM Update**: Toggle a top-level class on `document.body` if it dictates global CSS overrides.
3. **Phase Engine Sync**: Update `phase-engines.js` (`IframePhaseEngine.prototype.updateState`) to include the new variable in the `postMessage` payload.
4. **Iframe Receivers**: Update all `engines/*.html` message listeners to read `event.data.[your_state]` and toggle their own DOM accordingly.

### How to Change the Canvas Layout Physics
1. Open `multi-map-core.js`.
2. Locate the `resolveOverlaps()` method. 
3. Modify `kRepel` (Universal push) or `kSpring` (Hooke's Law pull on structural connections).

### How to Modify the Radial Context Menu
1. Open `multi-map-sandbox.js`.
2. Locate `showRadialMenu(node)`.
3. HTML for the buttons is dynamically generated here based on node type. Button click handlers route to `this.action*()` methods.

---

## 🎯 Quick Reference for Agents (Where to look)

- **To modify arrow-key navigation or shortcuts:** Look at `handleGlobalKeydown()` and `navigateSelection()` in `multi-map-sandbox.js`.
- **To change how nodes look on the canvas:** Look at `renderMap()` inside `multi-map-sandbox.js` (specifically where it builds `nodeDiv.innerHTML`).
- **To fix folder/project UI sync bugs:** Look at `syncProjectMasterMap()` in `multi-map-core.js` and `actionAssignToFolder()` in `multi-map-sandbox.js`.
- **To intercept or modify AI Prompts before they send:** Look at `handleSend()` and `buildContextString()` in `multi_map_ai_engine.js`.
- **To fix overlapping UI elements (Z-Index):** Consult the Z-Index Stacking Context section and modify classes in the relevant UI generator (e.g., `multi_map_ai_engine.js` for chat, `multi-map-sandbox.js` for radial menus).
