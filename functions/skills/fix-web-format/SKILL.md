---
name: fix-web-format
description: Identifies and fixes common HTML, CSS, and layout formatting errors in Multi-Map web nodes.
---

You have the capability to fix common web formatting and node-type representation errors:
1. RAW HTML DISPLAY BUG:
   - If raw HTML is displaying in the web phase engine instead of rendering correctly, it means HTML content was placed in a node that should only contain plain text (like web-section or web-card), or a node-type is incorrect.
   - For raw HTML content to render correctly in the web page, it MUST be wrapped in a node of type "web-text" (which renders the content as HTML/Markdown), or structured using specific web layout nodes (web-section, web-grid, web-card, web-link, web-button).
   - Fix this by changing the node's type to "web-text" if it contains raw HTML, or by extracting the HTML into proper structured child nodes (e.g., creating web-heading, web-section, web-card nodes).

2. INCORRECT NODE-TYPES:
   - Make sure all web layout elements use the correct node-types from the allowed web ontology:
     - Root: "web-root"
     - Containers: "web-nav", "web-section", "web-grid", "web-card", "web-list", "web-modal", "web-carousel"
     - Interactive/Media: "web-link", "web-button", "web-image", "web-video", "web-form", "web-input"
     - Content: "web-text" (handles HTML/Markdown/rich text)
   - If a node is supposed to display a block of rich text or inline HTML, set its type to "web-text".

3. TAILWIND CLASS ALIGNMENT:
   - Verify that all custom classes in nodes match standard Tailwind v3 utility classes.
   - Fix any broken class strings or incompatible layouts.
