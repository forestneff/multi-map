/**
 * Multi-Map Formatter & Ecosystem Client SDK
 * 
 * Provides utilities to validate, format, and convert arbitrary structured data
 * (hierarchies, trees, lists, key-value mappings) into valid Multi-Map schema JSON,
 * as well as a client fetch helper to call the Multi-Map Share API.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MultiMapFormatter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function generateId(prefix = 'n') {
        return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
    }

    function generateMapId() {
        return `map_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
    }

    /**
     * Validates whether an object complies with the Multi-Map schema.
     * @param {Object} data 
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function validateMapState(data) {
        const errors = [];
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: ['Map state must be a non-null object.'] };
        }

        if (!Array.isArray(data.nodes)) {
            errors.push('Map state missing "nodes" array.');
        } else {
            const nodeIds = new Set();
            let rootCount = 0;

            data.nodes.forEach((n, idx) => {
                if (!n || typeof n !== 'object') {
                    errors.push(`Node at index ${idx} is not an object.`);
                    return;
                }
                if (!n.id) {
                    errors.push(`Node at index ${idx} is missing an "id".`);
                } else {
                    if (nodeIds.has(n.id)) {
                        errors.push(`Duplicate node id "${n.id}".`);
                    }
                    nodeIds.add(n.id);
                }

                const type = n.type || '';
                if (type === 'root' || type.endsWith('-root')) {
                    rootCount++;
                }
            });

            if (data.nodes.length > 0 && rootCount === 0) {
                errors.push('Map must have at least one root-type node (e.g. "root", "link-root", "web-root").');
            }
        }

        const connections = data.connections || data.edges;
        if (connections && !Array.isArray(connections)) {
            errors.push('"connections" must be an array.');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Normalizes and repairs any missing fields to produce a strictly compliant MapState object.
     * @param {Object} state 
     * @param {Object} [options]
     * @returns {Object} Clean MapState
     */
    function normalizeMapState(state = {}, options = {}) {
        const title = options.title || state.meta?.title || 'Untitled Map';
        const type = options.mapType || state.meta?.type || 'generic';
        const now = new Date().toISOString();

        const clean = {
            map_id: state.map_id || generateMapId(),
            meta: {
                title: title,
                description: state.meta?.description || '',
                created: state.meta?.created || now,
                last_modified: now,
                type: type,
                phase_engines: state.meta?.phase_engines || ['web', 'tree', 'custom'],
                tags: Array.isArray(state.meta?.tags) ? state.meta.tags : ['all'],
                settings: state.meta?.settings || {},
                storage_target: state.meta?.storage_target || 'firebase',
                shared: Boolean(state.meta?.shared),
                share_token: state.meta?.share_token || null,
                share_expires: state.meta?.share_expires || null
            },
            source: state.source || {
                server: '',
                origin: '',
                contributors: []
            },
            nodes: Array.isArray(state.nodes) ? JSON.parse(JSON.stringify(state.nodes)) : [],
            connections: Array.isArray(state.connections)
                ? JSON.parse(JSON.stringify(state.connections))
                : (Array.isArray(state.edges) ? JSON.parse(JSON.stringify(state.edges)) : [])
        };

        // If no nodes, synthesize default root
        if (clean.nodes.length === 0) {
            clean.nodes.push({
                id: generateId('root'),
                type: type === 'link' ? 'link-root' : (type === 'web' ? 'web-root' : 'root'),
                title: title,
                content: '',
                data: { x: 0, y: 0, isCore: true, collapsed: false },
                root_metadata: {
                    summary: '',
                    tags: [],
                    portal_behavior: 'standard',
                    static_layout: false
                }
            });
        } else {
            // Ensure nodes have valid structure
            let hasCore = false;
            clean.nodes.forEach((n, idx) => {
                if (!n.id) n.id = generateId(`n${idx}`);
                if (!n.type) n.type = 'note';
                if (!n.title) n.title = n.content ? n.content.slice(0, 30) : 'Untitled';
                if (n.content === undefined) n.content = '';
                if (!n.data) n.data = { x: 0, y: 0 };
                if (n.data.collapsed === undefined) n.data.collapsed = false;

                const isRoot = n.type === 'root' || n.type.endsWith('-root');
                if (isRoot) {
                    if (!hasCore) {
                        n.data.isCore = true;
                        hasCore = true;
                        if (!n.root_metadata) {
                            n.root_metadata = {
                                summary: '',
                                tags: [],
                                portal_behavior: 'standard',
                                static_layout: false
                            };
                        }
                    } else {
                        n.type = 'hub';
                        n.data.isCore = false;
                    }
                }
            });

            // If no root was identified, promote the first node
            if (!hasCore) {
                const first = clean.nodes[0];
                first.type = type === 'link' ? 'link-root' : (type === 'web' ? 'web-root' : 'root');
                first.data.isCore = true;
                first.root_metadata = first.root_metadata || {
                    summary: '',
                    tags: [],
                    portal_behavior: 'standard',
                    static_layout: false
                };
            }
        }

        // Validate and clean connections
        const validNodeIds = new Set(clean.nodes.map(n => n.id));
        clean.connections = clean.connections.filter(c => {
            const from = c.from || c.sourceId;
            const to = c.to || c.targetId;
            return validNodeIds.has(from) && validNodeIds.has(to);
        }).map((c, idx) => ({
            id: c.id || generateId(`c${idx}`),
            from: c.from || c.sourceId,
            to: c.to || c.targetId,
            type: c.type || 'structural',
            meta: c.meta || {}
        }));

        return clean;
    }

    /**
     * Converts a hierarchical tree object into a valid MapState.
     * Supported tree item shapes:
     * - { name, children: [...] }
     * - { title, children: [...] }
     * - { label, items: [...] }
     * 
     * @param {Object} treeData 
     * @param {Object} [options] { title, mapType, spacingX, spacingY }
     * @returns {Object} MapState
     */
    function fromTree(treeData, options = {}) {
        if (!treeData || typeof treeData !== 'object') {
            throw new Error('fromTree requires a non-null tree object.');
        }

        const mapType = options.mapType || 'generic';
        const rootTitle = options.title || treeData.title || treeData.name || treeData.label || 'Root';
        const spacingX = options.spacingX || 220;
        const spacingY = options.spacingY || 130;

        const nodes = [];
        const connections = [];

        const rootType = mapType === 'link' ? 'link-root' : (mapType === 'web' ? 'web-root' : 'root');
        const rootId = generateId('root');

        const rootNode = {
            id: rootId,
            type: rootType,
            title: rootTitle,
            content: treeData.description || treeData.content || '',
            data: { x: 0, y: 0, isCore: true, collapsed: false },
            root_metadata: {
                summary: treeData.summary || '',
                tags: treeData.tags || [],
                portal_behavior: 'standard',
                static_layout: true
            }
        };
        nodes.push(rootNode);

        // Recursive tree traversal with layout positioning
        function traverse(item, parentId, depth, siblingIdx, totalSiblings) {
            const rawChildren = item.children || item.items || item.subitems || [];
            const children = Array.isArray(rawChildren) ? rawChildren : [];

            children.forEach((child, cIdx) => {
                const childId = generateId(`n_d${depth}_${cIdx}`);
                const childTitle = child.title || child.name || child.label || `Node ${depth}.${cIdx + 1}`;
                const childContent = child.content || child.description || child.url || '';
                
                // Determine node type
                let childType = child.type;
                if (!childType) {
                    if (child.url || child.href) childType = 'web-link';
                    else if (children.length > 0 && depth === 1) childType = 'hub';
                    else childType = 'note';
                }

                // Calculate hierarchical X/Y positioning
                const offsetY = (cIdx - (children.length - 1) / 2) * spacingY;
                const x = depth * spacingX;
                const y = offsetY;

                const nodeObj = {
                    id: childId,
                    type: childType,
                    title: childTitle,
                    content: childContent,
                    data: {
                        x: Math.round(x),
                        y: Math.round(y),
                        collapsed: false
                    }
                };

                if (child.url || child.href) {
                    nodeObj.data.url = child.url || child.href;
                }

                nodes.push(nodeObj);

                connections.push({
                    id: generateId('conn'),
                    from: parentId,
                    to: childId,
                    type: 'structural'
                });

                if (child.children || child.items) {
                    traverse(child, childId, depth + 1, cIdx, children.length);
                }
            });
        }

        traverse(treeData, rootId, 1, 0, 1);

        return normalizeMapState({
            meta: { title: rootTitle, type: mapType },
            nodes,
            connections
        }, options);
    }

    /**
     * Converts an array of items (strings, links, or objects) into a valid MapState.
     * @param {Array} list 
     * @param {Object} [options] { title, mapType, rootTitle }
     * @returns {Object} MapState
     */
    function fromList(list, options = {}) {
        if (!Array.isArray(list)) {
            throw new Error('fromList requires an array of items.');
        }

        const mapType = options.mapType || (list.some(i => i && (i.url || (typeof i === 'string' && i.startsWith('http')))) ? 'link' : 'generic');
        const title = options.title || options.rootTitle || 'Item List';

        const rootType = mapType === 'link' ? 'link-root' : 'root';
        const rootId = generateId('root');

        const nodes = [{
            id: rootId,
            type: rootType,
            title: title,
            content: options.description || '',
            data: { x: 0, y: 0, isCore: true, collapsed: false },
            root_metadata: {
                summary: '',
                tags: [],
                portal_behavior: 'standard',
                static_layout: true
            }
        }];
        const connections = [];

        const total = list.length;
        const radius = Math.max(200, total * 35);

        list.forEach((item, idx) => {
            const id = generateId(`item_${idx}`);
            let itemTitle = '';
            let itemContent = '';
            let itemType = 'note';

            if (typeof item === 'string') {
                if (item.startsWith('http://') || item.startsWith('https://')) {
                    itemTitle = item.replace(/^https?:\/\//, '').split('/')[0] || item;
                    itemContent = item;
                    itemType = 'web-link';
                } else {
                    itemTitle = item;
                    itemContent = '';
                }
            } else if (item && typeof item === 'object') {
                itemTitle = item.title || item.name || item.label || `Item ${idx + 1}`;
                itemContent = item.content || item.description || item.url || '';
                itemType = item.type || (item.url ? 'web-link' : 'note');
            }

            // Radial distribution around root
            const angle = (2 * Math.PI * idx) / (total || 1);
            const x = Math.round(Math.cos(angle) * radius);
            const y = Math.round(Math.sin(angle) * radius);

            nodes.push({
                id,
                type: itemType,
                title: itemTitle,
                content: itemContent,
                data: { x, y, collapsed: false }
            });

            connections.push({
                id: generateId('conn'),
                from: rootId,
                to: id,
                type: 'structural'
            });
        });

        return normalizeMapState({
            meta: { title, type: mapType },
            nodes,
            connections
        }, options);
    }

    /**
     * Converts a flat or grouped key-value mapping into a categorized MapState with Hubs.
     * e.g. { "Frontend": ["React", "CSS"], "Backend": ["Node", "Express"] }
     * @param {Object} obj 
     * @param {Object} [options] 
     * @returns {Object} MapState
     */
    function fromKeyValues(obj, options = {}) {
        if (!obj || typeof obj !== 'object') {
            throw new Error('fromKeyValues requires a non-null object.');
        }

        const title = options.title || 'Knowledge Map';
        const rootId = generateId('root');
        const nodes = [{
            id: rootId,
            type: 'root',
            title: title,
            content: '',
            data: { x: 0, y: 0, isCore: true, collapsed: false },
            root_metadata: {
                summary: '',
                tags: [],
                portal_behavior: 'standard',
                static_layout: true
            }
        }];
        const connections = [];

        const categories = Object.keys(obj);
        const catRadius = Math.max(220, categories.length * 50);

        categories.forEach((catKey, cIdx) => {
            const hubId = generateId(`hub_${cIdx}`);
            const angle = (2 * Math.PI * cIdx) / (categories.length || 1);
            const hubX = Math.round(Math.cos(angle) * catRadius);
            const hubY = Math.round(Math.sin(angle) * catRadius);

            nodes.push({
                id: hubId,
                type: 'hub',
                title: catKey,
                content: '',
                data: { x: hubX, y: hubY, collapsed: false }
            });

            connections.push({
                id: generateId('conn'),
                from: rootId,
                to: hubId,
                type: 'structural'
            });

            const val = obj[catKey];
            const childItems = Array.isArray(val) ? val : (val && typeof val === 'object' ? Object.entries(val).map(([k, v]) => `${k}: ${v}`) : [String(val)]);

            childItems.forEach((childItem, iIdx) => {
                const leafId = generateId(`leaf_${cIdx}_${iIdx}`);
                const leafTitle = typeof childItem === 'string' ? childItem : (childItem.title || childItem.name || String(childItem));
                const leafContent = (typeof childItem === 'object' && childItem.content) ? childItem.content : '';
                
                // Position leaves offset outwards from their hub
                const leafAngle = angle + ((iIdx - (childItems.length - 1) / 2) * 0.35);
                const leafX = Math.round(hubX + Math.cos(leafAngle) * 160);
                const leafY = Math.round(hubY + Math.sin(leafAngle) * 160);

                nodes.push({
                    id: leafId,
                    type: (typeof leafTitle === 'string' && leafTitle.startsWith('http')) ? 'web-link' : 'note',
                    title: leafTitle,
                    content: leafContent,
                    data: { x: leafX, y: leafY, collapsed: false }
                });

                connections.push({
                    id: generateId('conn'),
                    from: hubId,
                    to: leafId,
                    type: 'structural'
                });
            });
        });

        return normalizeMapState({
            meta: { title, type: 'generic' },
            nodes,
            connections
        }, options);
    }

    /**
     * Client API helper to share a map via the Multi-Map API endpoint.
     * @param {string} endpointUrl - Base URL of the API (e.g. "https://your-domain.com/api/share")
     * @param {Object} payload - MapState or arbitrary JSON/text to map
     * @param {Object} [options]
     * @param {string} [options.apiKey] - Service API Key (X-API-Key)
     * @param {string} [options.token] - Firebase Auth Bearer token
     * @param {string} [options.title] - Optional map title override
     * @param {number|null} [options.expiresInDays=30] - Expiration duration
     * @param {string} [options.mode="auto"] - "auto" | "direct" | "adapter" | "ai"
     * @param {string} [options.prompt] - Optional AI instructions
     * @param {string} [options.mapType] - Optional map type hint
     * @param {string} [options.author] - Author/App display name
     * @param {boolean} [options.includeMapState=false] - Return full mapState
     * @returns {Promise<{ success: boolean, shareUrl: string, token: string, mapId: string, title: string, expiresAt: string|null, mode: string, mapState?: Object }>}
     */
    async function shareMap(endpointUrl, payload, options = {}) {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (options.apiKey) {
            headers['X-API-Key'] = options.apiKey;
        } else if (options.token) {
            headers['Authorization'] = `Bearer ${options.token}`;
        }

        const body = {
            payload,
            title: options.title,
            expiresInDays: options.expiresInDays !== undefined ? options.expiresInDays : 30,
            mode: options.mode || 'auto',
            prompt: options.prompt,
            mapType: options.mapType,
            author: options.author,
            includeMapState: Boolean(options.includeMapState)
        };

        const res = await fetch(endpointUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status}: Failed to share map`);
        }

        return await res.json();
    }

    return {
        validateMapState,
        normalizeMapState,
        fromTree,
        fromList,
        fromKeyValues,
        shareMap
    };
}));
