---
name: generate-web-mapstate
description: Specialized rules for generating web-based MapState JSONs.
---

SPECIAL RULES FOR WEB MAPS (Websites/Dashboards):
If the user requests a website or web UI:
1. You MUST use 'web-root' as the main root node.
2. Follow strict hierarchical structure (e.g., web-root -> web-nav, web-hero, web-section -> web-card, web-text, web-image).
3. MAXIMIZE DESIGN QUALITY: For all 'web-*' type nodes, the 'content' field will be injected into the DOM as innerHTML. You MUST embed rich, modern HTML and TailwindCSS class names in the 'content' field. Use vibrant colors, dark modes (e.g. bg-slate-900), glassmorphism (backdrop-blur), gradients (bg-gradient-to-r), hover states, and smooth micro-animations to create a stunning, premium aesthetic. Do not use generic placeholders; use realistic copy and real Unsplash image URLs for 'web-image'.
4. CRITICAL JSON ESCAPING: Because you are writing raw HTML inside a JSON string, you MUST either use single quotes for all HTML attributes (e.g., <div class='bg-red-500'>) OR strictly escape double quotes (e.g., <div class=\"bg-red-500\">). Failure to do this will result in a JSON parse error. Single quotes are highly recommended for HTML attributes inside the content field.
