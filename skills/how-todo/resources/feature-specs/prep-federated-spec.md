Feature Specification: Prep Federated Storage & Quota UI

### 1. Overview & Intent
Reference: TODO Phase 1, Item #2
- Goal: Lay the UI and schema groundwork for the "Bring Your Own Storage" (BYOS) federated architecture. Implement Firebase storage quotas to cap server costs and build the "Vault" selection UI, preparing users for the transition away from centralized hosting.
- Crucial Note for Agents: The actual API wiring for Google Drive and Local OS is handled in Phase 2 (Items #9 & #10). This task strictly builds the UI, schemas, and logic for limits. Use UI stubs for external connections.

---

### 2. Schema Architecture (mapstate-schema.json)
We must update the core map metadata to understand where its payload lives.

Proposed Addition to Map Schema:
```json
{
  "storage_target": {
    "type": "string",
    "enum": ["firebase", "google_drive", "local_os"],
    "default": "firebase",
    "description": "Indicates where the full map payload is stored. If not firebase, Firestore only holds a lightweight pointer."
  },
  "external_id": {
    "type": "string",
    "description": "The Drive file ID or IndexedDB local handle key."
  }
}
```

---

### 3. Quota Management Logic
Target File: `multi-map-library.js`, `firestore.rules`

- Calculate Usage: Create a utility function to calculate current Firebase usage. For the MVP, simply count the number of maps where `storage_target === 'firebase'`.
- Define Limits: Set a constant for free-tier limits (e.g., `MAX_FIREBASE_MAPS = 25`).
- Enforcement (UI & DB):
  - If a user tries to create a new map and is at the limit, block the creation and show the upgrade/connect modal.
  - Update `firestore.rules` to enforce this count (if feasible via a `user_stats` document, otherwise rely on UI enforcement for this MVP step).

---

### 4. The Vault UI & Warning System
Target Files: `multi-map-core.js` (Data Manager UI), `multi-map-ui.css`

- Data Manager "Vault" Selector:
  - Add a dropdown or tab system in the Data Manager sidebar allowing users to filter maps by their `storage_target`.
  - Add icons next to map titles in the library list (e.g., a Cloud icon for Firebase, a Drive logo, a Folder icon for Local).
- Capacity Warning:
  - Render a visual progress bar in the Data Manager showing `Firebase Usage: [XX] / 25`.
  - When usage hits 80%, change the bar color to warning (orange/red) and show a banner: `"Your cloud workspace is almost full. Connect Google Drive or a Local Directory for unlimited free storage."`
- Temp Stubs for Connect Buttons:
  - The warning banner and Vault UI should feature "Connect Google Drive" and "Connect Local Folder" buttons.
  - AGENT INSTRUCTION: Bind these buttons to a simple `console.log('Stub: Route to OAuth / File Picker')` or a toast notification saying `"External storage integration coming in Phase 2."` Do not implement the actual Drive API or File System Access API here.

---

### 5. Execution Plan for Agents
1. Update `mapstate-schema.json` with `storage_target` and `external_id`.
2. Implement quota counting logic in `multi-map-library.js`.
3. Build the progress bar, warning banner, and Vault filters in the Data Manager UI (`multi-map-core.js`).
4. Add the stubbed "Connect" buttons.
5. Ensure newly created maps default to `storage_target: 'firebase'` for now.