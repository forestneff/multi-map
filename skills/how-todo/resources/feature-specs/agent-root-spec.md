Feature Specification: Agent-Root Ecosystem

### 1. Overview & IntentReference: TODO Phase 2, Item #8 (Part 2)
- Goal: Expand the agent-root maptype into a visual architecture builder for AI agent harnesses, allowing users to visually construct complex, multi-tool, and multi-skill agent ecosystems.
- Why: Building external agents (like those in the .agents/ directory for Antigravity) requires strict structuring of instructions, tools, routing logic, and constraints into specific file systems (AGENTS.md, SKILL.md, etc.). A map-native interface allows developers to visualize the agent's workflow, dependencies, and tool access before exporting it into a deployable, industry-standard package.

---

### 2. Schema Architecture (mapstate-schema.json)
- The node hierarchy must reflect the anatomy of a modern agent harness and standard skill directories.
Proposed Sub-Type Additions:
- Core Harness Nodes:
  - agent-persona: The top-level identity, core operating loop, and orchestrator instructions (compiles to AGENTS.md or system.md).
  - agent-router: Logic for a multi-agent or multi-skill setup, defining how the agent decides which skill or sub-agent to invoke based on user intent.

- Skill & Tool Nodes:
  - agent-skill: A specific workflow or Standard Operating Procedure
   (SOP) the agent can execute (compiles to a SKILL.md inside a dedicated folder).
  - agent-tool: A definition of a function/API the agent can call. Should include JSON schema fields for parameters and descriptions.

- Context & Boundary Nodes:
  - agent-memory: Definitions for state management, RAG integration, or local file access permissions.agent-guardrail: Explicit constraints, anti-patterns, and safety bounds the agent must not cross.Update mapstate-schema.json to define these types as valid children of an agent-root.

---

### 3. The Sandbox Phase Engine (engines/agent-config.html)
- This phase engine provides a high-level, dashboard-style overview of the agent architecture.
- Architecture Graph: Display a visual summary of the agent: its core persona, the skills it has loaded, and the specific tools granted to each skill.
- Tool Validation: Warn the user visually if a tool is referenced in an agent-skill but is missing a formal agent-tool definition/schema.
- Dry-Run Interface: Provide a chat-like interface that simulates the agent-router logic, allowing the user to type a prompt and see which skill and tools the agent would select based on the map's current configuration.

---

### 4. Export & Compilation LogicTarget File: engines/agent-config.html & string-builder utilities
- File Structure Generation: The export function must translate the map structure into a standard folder hierarchy matching the templates in .agents/skills/ (Antigravity standard).agent-persona and global agent-guardrail nodes compile into the root AGENTS.md.
- Every agent-skill node generates a new sub-folder (e.g., skills/[skill-name]/).The contents of the agent-skill (and any attached child nodes like specific constraints or steps) compile into skills/[skill-name]/SKILL.md.agent-tool nodes compile into a tools.json file containing the OpenAPI/JSON schema definitions required for function calling.
- Zip Export: Utilize a client-side library (like JSZip) to bundle these generated text/JSON files and folders into a .zip archive. The user clicks "Export Agent Bundle," and downloads a .zip ready to be dropped into an Antigravity environment.

---

### 5. Portal Integration (multi_map_ai_engine.js)
- When a dynamic portal (TODO #6) points to an agent-root map locally, the multi_map_ai_engine.js should dictate the layout to expose key agent interfaces.
- Dynamic Loading: The portal acts as the invocation trigger. When the portal is opened, the host map temporarily grants the AI engine the tools and skills defined in the target agent-root.

---

### 6. Execution Plan for Agents
- Schema Expansion: Update mapstate-schema.json with the new agent-* node types, ensuring relationships allow tools to be children of specific skills, or children of the root for global access.
- Dashboard UI: Build out engines/agent-config.html to parse the map, display the capability dashboard, and provide the dry-run routing test.
- Zip Compilation: Implement the logic to map node content to specific file names (AGENTS.md, SKILL.md, tools.json), construct the virtual directory structure, bundle them into a .zip, and trigger a browser download.
- Portal Rendering: Connect multi_map_ai_engine.js to intelligently read agent-root metadata and configure its active toolset based on the portal target.

---

### 7. Testing Criteria
- The agent-config.html viewport correctly identifies and lists skills and tools added to the map.
- Exporting generates a valid .zip file.
- Extracting the .zip file yields a strict directory structure: an AGENTS.md file at the root, a skills/ directory containing individual folders for each skill, and properly formatted SKILL.md and tools.json files within those folders.