Feature Specification: Launch True Federation (WebRTC + CRDTs)

### 1. Overview & Intent
Reference: TODO Phase 2, Item #11
- Goal: Transition Multi-Map from a centralized Firebase payload host to a true peer-to-peer (P2P) federated network.
- Why: To ensure infinite scalability, zero storage costs for the platform, and data ownership for the user. Firebase will be relegated to a "Switchboard" (Signaling Server and Identity Provider).

---

### 2. Architectural Pillars (Scaffold)
*(This specification will be fleshed out as Phase 2 progresses, but outlines the target architecture).*

#### A. The CRDT Data Layer
- Transition map state arrays (`state.nodes`) to Conflict-free Replicated Data Types (CRDTs), likely using Yjs or Automerge.
- This allows multiple users to edit the exact same map concurrently, resolving conflicts mathematically rather than relying on Firebase's timestamp-based `onSnapshot` overwrites.

#### B. WebRTC Signaling (The Switchboard)
- Deprecate heavy Firestore document syncing for collaborative sessions.
- Use Firebase/Firestore only to exchange WebRTC SDP (Session Description Protocol) offers, answers, and ICE candidates between peers.
- Once a direct P2P connection is established between collaborators, all node edits, mouse movements, and state changes flow directly between their browsers.

#### C. Persistent Storage Handoff
- Users saving to `google_drive` or `local_os` act as the "Host" nodes.
- If a host goes offline, the P2P swarm relies on the last synced state in their external drive, utilizing the integrations built in Phase 2, Items #9 and #10.

---

### 3. Dependencies
- Requires #9 (File-Root) for local OS storage hooks.
- Requires #10 (Third-Party Cloud) for async fallback storage.