Feature Specification: Colab-Root, Communities, & Shared Spaces

### 1. Overview & Intent
Reference: TODO Phase 4, Item #15
- Goal: Introduce an entirely new colab-root system that acts as a dedicated container for social networks, organizations, communities, and shared workspaces.
- Why: To support multi-user workflows, users need a map-native way to track contacts, form groups, and collaboratively edit maps in real-time. Instead of overloading the person-root type, a dedicated colab-root maptype provides a clean, specialized container. Existing person objects will be incorporated as sub-types or called through dynamic portals within this new collaborative ecosystem.

---

### 2. Schema Architecture (mapstate-schema.json)
We need to introduce new maptypes to represent social hierarchies and collaborative containers, and update the node schema to store relationship and permission metadata.

Proposed Sub-Type Additions:
- colab-root: The master container maptype for any shared workspace or social group.
- colab-organization: A top-level entity/node that can contain multiple communities and groups.
- colab-community: A managed group with discrete shared spaces.
- colab-group: A small, informal collection of users (e.g., a project team).

Note on person nodes: Existing person-root maps and contact nodes will be natively linkable inside the colab-root hierarchy, either directly attached as sub-types or dynamically referenced via portals.

Metadata Additions (node.root_metadata):
To manage Role-Based Access Control (RBAC), root nodes for these new types (and any maps shared with them) need an acl (Access Control List) object:

```json
"acl": {
  "type": "object",
  "description": "Role-Based Access Control for collaborative maps and communities.",
  "properties": {
    "owner": { "type": "string", "description": "User ID of the creator." },
    "admins": { "type": "array", "items": { "type": "string" } },
    "editors": { "type": "array", "items": { "type": "string" } },
    "viewers": { "type": "array", "items": { "type": "string" } },
    "isPublic": { "type": "boolean", "default": false }
  }
}
```

---

### 3. Real-Time Collaborative Editing
Target File: multi-map-library.js
This is the most critical technical shift. Single-player maps can use basic get() and set() operations. Multiplayer maps under a colab-root require real-time synchronization.

- Transition to Listeners:
  - Create a new method subscribeToMap(mapId, callback).
  - Use Firestore's onSnapshot() to listen for changes to the map document.
  - When a change comes in from another user (check snapshot.metadata.hasPendingWrites to ignore local echoes), cleanly merge the updated state.nodes into the local window.kernel.maps[mapId].
  - Trigger a canvas re-render.
- Unsubscribing:
  - Ensure onSnapshot listeners are properly detached (unsubscribe()) when the user navigates away from the map to prevent memory leaks and ghost writes.

---

### 4. Security & RBAC (firestore.rules)
Target File: firestore.rules
With multi-user editing enabled, the database rules must be heavily reinforced to prevent unauthorized modifications.

- Match rule for Colab/Shared Maps:
  - allow read: if request.auth.uid is in resource.data.acl.viewers, editors, admins, or owner.
  - allow update: if request.auth.uid is in resource.data.acl.editors, admins, or owner.
  - allow delete: if request.auth.uid == resource.data.acl.owner.

---

### 5. The Sandbox Phase Engines
Target Files: engines/person.html, engines/colab-engine.html (New)

- Native Contacts (person.html):
  - Continue using this engine for individual user profiles, but optimize it to cleanly render when loaded inside a colab-root portal.
  - Implement an "Add Contact" feature (via user ID or email lookup, governed by privacy settings).
- Colab Management (colab-engine.html):
  - Create a new specialized phase engine for colab-root nodes.
  - Provide a UI to visualize the organization's structure, invite users, assign roles (Admin/Editor/Viewer), and view a directory of shared maps owned by the community or group.

---

### 6. Execution Plan for Agents
When an agent executes this task, it must proceed carefully to avoid breaking existing single-player map saving:
- Schema & Types: Update mapstate-schema.json with the new colab-* types and the acl object.
- Security First: Update firestore.rules to enforce the RBAC logic based on the acl schema. This must be deployed/tested locally before wiring up the front-end.
- Real-Time Sync: Refactor multi-map-library.js to support an onSnapshot subscription model for shared maps. Keep the standard setDoc approach for purely local/private maps to minimize unnecessary reads.
- UI & Phase Engines: Build engines/colab-engine.html and update engines/person.html to provide the visual interfaces for managing these new collaborative connections.
- Integration: Ensure dynamic portals (TODO #6) pointing to colab roots automatically load the colab-engine.html engine and resolve internal person links correctly.

---

### 7. Testing Criteria
- Firestore rules block write attempts from non-editors on shared colab maps.
- User A and User B can open the same shared map. When User A adds a node, it appears on User B's screen within 2 seconds without a page refresh.
- Navigating away from the shared map successfully detaches the Firestore listener (verified via console logging).
- The Colab Engine phase engine successfully adds a user's ID to the acl.editors array when an Admin invites them.