Feature Specification: Third-Party Cloud Storage Integrations

### 1. Overview & Intent
Reference: TODO Phase 2, Item #10
- Goal: Extend the map-native file system to natively represent and interact with external cloud storage providers (initially targeting Google Drive and Google Docs).
- Why: Users manage assets across various platforms. By bridging third-party cloud storage into Multi-Map, users can visually organize external documents alongside their internal map logic, treating a Google Doc exactly like a native node.

---

### 2. Schema Architecture (mapstate-schema.json)
We will build upon the file-root ecosystem defined in TODO #9. The schema needs to support external identifiers, URLs, and specific MIME types for cloud files.

Proposed Sub-Type Extensions:
- `file-root` (Update): Expand the `root_metadata.source` property to allow "google_drive".
- `file-folder` & `file-document` (Metadata Additions): Add an optional `cloud_metadata` object to these nodes:

```json
"cloud_metadata": {
  "type": "object",
  "properties": {
    "provider": { "type": "string", "enum": ["google"] },
    "file_id": { "type": "string", "description": "The external ID provided by the cloud service." },
    "mime_type": { "type": "string", "description": "e.g., application/vnd.google-apps.document" },
    "web_view_url": { "type": "string", "description": "The URL to open the file in the browser." }
  }
}
```

---

### 3. Authentication & API Bridging
Target Files: `auth.js`, `functions/index.js`, `functions/middleware/rateLimit.js`

To access user files, we must elevate their Firebase Authentication token to include Google Drive OAuth scopes.
- OAuth Scope Elevation (`auth.js`):
  - Update the Google Auth Provider configuration.
  - Add required scopes: `https://www.googleapis.com/auth/drive.readonly` (start with read-only for safety and easier verification).
  - Implement a re-authentication trigger: If a user attempts to mount a Google Drive node and lacks the scope, trigger a popup asking for the elevated permissions.
- API Request Routing:
  - Determine if Drive API calls will be made directly from the client (using the OAuth access token) or proxied through Firebase Cloud Functions.
  - Recommendation: Use Cloud Functions for proxying to ensure strict rate limiting using the existing `rateLimit.js` middleware, preventing abuse that could get the API key blacklisted.

---

### 4. Core Logic & Data Flow
Target Files: `multi-map-core.js`, `multi-map-library.js`

- Mounting a Cloud Directory: When a user creates a `file-root` node and sets the source to `google_drive`, the system prompts them to pick a folder from their Drive (using the Google Picker API). Once a folder is selected, its `file_id` is stored in the `file-root`'s `cloud_metadata`.
- Lazy-Loaded Auto-Spawning: Critical Guardrail: Do not recursively map the entire Google Drive. When the node is expanded (or mounted), fetch only the direct children of that specific `file_id`. Auto-spawn `file-document` and `file-folder` nodes for these children. Store the `file_id` and `web_view_url` on the spawned nodes.
- Radial Menu Navigation: As established in #9, do not overwrite standard node selection. Update `multi-map-rules.js` to add an "Open in Google Drive" or "Preview File" action to the radial menu when a `file-document` with `cloud_metadata` is selected.

---

### 5. The Sandbox Phase Engine (engines/file-explorer.html)
Target File: `engines/file-explorer.html`

Extend the file explorer built in #9 to handle cloud previews.
- Iframe Embeds: If the `mime_type` indicates a Google Doc, Sheet, or Slide, use the `web_view_url` (appended with `?embedded=true` if applicable) to render an iframe preview in the right-hand pane of the file explorer.
- Fallback UI: If the file type cannot be previewed (e.g., an unknown binary format), display a standardized "External File" graphic with a prominent button linking to the `web_view_url`.

---

### 6. Execution Plan for Agents
1. Schema Update: Modify `mapstate-schema.json` to accept the new `cloud_metadata` structures on file-type nodes.
2. Auth Expansion: Update `auth.js` to handle dynamic OAuth scope elevation for Google Drive.
3. API & Rate Limiting: Implement the fetch logic (either client-side or via `functions/index.js`). Strictly enforce API throttling to prevent 429 errors.
4. Mount & Spawn Logic: Add the Google Picker integration to `multi-map-core.js` and implement the lazy-loading fetch-and-spawn loop for Google Drive contents.
5. UI & Rules Update: Add radial menu rules for handling external links, and update `engines/file-explorer.html` to support iframe embeds for Google Workspace documents.

---

### 7. Testing Criteria
- User is prompted for Google Drive permissions only when they attempt to mount a Drive folder (not on initial login).
- Mounting a folder successfully spawns the first layer of files/folders as child nodes on the canvas.
- Expanding a spawned cloud folder node successfully fetches and spawns its respective children (lazy-loading).
- Rate limits are respected (no mass 429 errors in the console during rapid clicking).
- Opening the radial menu on a mapped Google Doc node provides a functional external link.
- Viewing the node in the `file-explorer.html` phase engine successfully renders the Google Doc iframe.