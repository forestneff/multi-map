/**
 * Multi-Map SANDBOX CONTROLLER v14.11
 * Features: Spatial Search, Auto-Parent Expansion, and Highlighting.
 */

class SandboxController {
    constructor(kernel, registry) {
        this.kernel = kernel;
        this.registry = registry;

        if (!this.kernel.state.session) {
            this.kernel.state.session = { viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, selectedId: null, remoteTemplates: [] };
        }

        this.dom = {
            viewport: document.getElementById('viewport'),
            worldLayer: document.getElementById('world-layer'),
            edgeSvg: document.getElementById('edge-svg'),
            overlay: document.getElementById('linking-overlay'),
            panelProperties: document.getElementById('panel-properties'), 
            viewMap: document.getElementById('view-map'),
            viewContent: document.getElementById('view-content'),
            sidebar: document.getElementById('sidebar')
        };

        this.dom.edgeSvg.style.overflow = 'visible';

        this.viewMode = 'map';
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };
        this.clickStart = { x: 0, y: 0 }; 
        this.draggedNode = null;
        this.activeRadialNodeId = null;
        this.userHasPanned = false;
        this.parentSelectMode = false;
        this.parentSelectSourceId = null;
        
        // NEW: Tracks what to highlight in the inspector
        this.activeSearchHighlight = null; 
        
        this.activePointers = new Map();
        this.lastPinchDist = null;
        this.lastPinchCenter = null;

        this.ensureDomElements();
        
        if (window.innerWidth > 768) {
            this.dom.sidebar.classList.add('open');
        } else {
            this.dom.sidebar.classList.remove('open');
        }

        this.initEvents(); 
        
        setTimeout(() => this.actionLoadRemoteTemplates(), 200);

        this.kernel.subscribe(this.render.bind(this));
        
        this.animate();
        this.render();
    }

    ensureDomElements() {
        if (!document.getElementById('radial-menu')) {
            const menu = document.createElement('div');
            menu.id = 'radial-menu';
            document.body.appendChild(menu);
            this.dom.radialMenu = menu;
        } else {
            this.dom.radialMenu = document.getElementById('radial-menu');
        }
    }

    escapeHTML(str) { 
        if(!str) return '';
        const d = document.createElement('div'); 
        d.textContent = str; 
        return d.innerHTML; 
    }

    initEvents() {
        window.SC = this; 
        const vp = this.dom.viewport;
        
        vp.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
        window.addEventListener('pointermove', (e) => this.handlePointerMove(e));
        window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
        window.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
        vp.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        window.addEventListener('resize', () => this.render());
        window.addEventListener('beforeunload', () => this.kernel.saveCurrentMapToLibrary());
        window.addEventListener('pagehide', () => this.kernel.saveCurrentMapToLibrary());

        // --- GLOBAL ESCAPE HANDLER (CASCADING CLOSE) ---
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // 1. Close Tutorial Menu Modal
                if (window.Tutorials && window.Tutorials.modalElement && !window.Tutorials.modalElement.classList.contains('hidden')) {
                    window.Tutorials.closeSelectionModal();
                    return;
                }
                // 2. Close AI Chat
                if (window.AI && window.AI.isVisible) {
                    window.AI.hideChat();
                    return;
                }
                // 3. Close Inspector Sidebar
                if (this.dom.sidebar && this.dom.sidebar.classList.contains('open')) {
                    this.closeSidebar();
                    return;
                }
            }
        });

        // --- WEB EDIT MODE MESSAGE LISTENER ---
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'mm-select-node' && e.data.id) {
                if (this.kernel.webEditMode) {
                    this.actionEdit(e.data.id);
                }
            }
        });

        // --- WEB EDIT BUTTON LOGIC ---
        const webEditBtn = document.getElementById('btn-web-edit');
        if (webEditBtn) {
            webEditBtn.addEventListener('click', () => {
                this.kernel.webEditMode = !this.kernel.webEditMode;
                webEditBtn.classList.toggle('bg-sky-600', this.kernel.webEditMode);
                webEditBtn.classList.toggle('bg-slate-800', !this.kernel.webEditMode);
                webEditBtn.classList.toggle('text-white', this.kernel.webEditMode);
                webEditBtn.classList.toggle('text-slate-400', !this.kernel.webEditMode);
                this.render();
            });
        }

        // --- MAP SEARCH BAR LOGIC ---
        const searchInput = document.getElementById('map-search-input');
        const searchResults = document.getElementById('map-search-results');
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                if (!query) {
                    searchResults.classList.add('hidden');
                    searchResults.classList.remove('flex');
                    return;
                }
                
                const results = this.kernel.state.nodes.filter(n => 
                    (n.title && n.title.toLowerCase().includes(query)) || 
                    (n.content && n.content.toLowerCase().includes(query)) ||
                    (n.type && n.type.toLowerCase().includes(query))
                );
                
                searchResults.innerHTML = '';
                if (results.length === 0) {
                    searchResults.innerHTML = '<div class="text-xs text-slate-500 text-center py-2">No matches found in active map.</div>';
                } else {
                    results.forEach(n => {
                        const div = document.createElement('div');
                        div.className = 'p-2 hover:bg-slate-800 rounded cursor-pointer transition-colors border border-transparent hover:border-slate-700 flex flex-col gap-1';
                        
                        let matchWhere = 'title';
                        if (n.content && n.content.toLowerCase().includes(query) && !(n.title && n.title.toLowerCase().includes(query))) {
                            matchWhere = 'content';
                        }
                        
                        div.innerHTML = `<div class="text-xs font-bold text-sky-400">${this.escapeHTML(n.title)} <span class="text-[9px] text-slate-500 uppercase ml-1">${n.type}</span></div>
                                         <div class="text-[10px] text-slate-400 truncate">${this.escapeHTML(n.content || '')}</div>`;
                        
                        div.onclick = () => {
                            searchInput.value = '';
                            searchResults.classList.add('hidden');
                            searchResults.classList.remove('flex');
                            
                            // 1. Force Uncollapse Parents if hidden
                            let currentId = n.id;
                            while (true) {
                                const parentConn = this.kernel.state.connections.find(c => c.to === currentId && c.type === 'structural');
                                if (!parentConn) break;
                                const parentNode = this.kernel.state.nodes.find(p => p.id === parentConn.from);
                                if (parentNode) {
                                    parentNode.data.collapsed = false;
                                    currentId = parentNode.id;
                                } else break;
                            }

                            // 2. Set Focus and Highlight
                            this.activeSearchHighlight = { nodeId: n.id, field: matchWhere, query: query };
                            this.userHasPanned = false; // Forces camera to glide to node!
                            
                            this.actionEdit(n.id);
                            
                            // Slight delay ensures the UI picks up the highlight state in case it was fast-diffed
                            setTimeout(() => this.render(), 50);
                        };
                        searchResults.appendChild(div);
                    });
                }
                searchResults.classList.remove('hidden');
                searchResults.classList.add('flex');
            });

            // Hide results when clicking outside
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.classList.add('hidden');
                    searchResults.classList.remove('flex');
                }
            });
        }
    }

    toggleSidebar() {
        if (this.dom.sidebar) {
            this.dom.sidebar.classList.toggle('open');
            // On mobile, opening the sidebar should close the right drawers
            if (this.dom.sidebar.classList.contains('open') && window.innerWidth <= 768) {
                const p = document.getElementById('profile-drawer');
                if (p) p.classList.add('translate-x-full');
                const d = document.getElementById('data-manager-drawer');
                if (d) d.classList.add('translate-x-full');
            }
        }
    }
    
    setView(mode) {
        this.viewMode = mode;
        const btns = document.querySelectorAll('.phase-btn');
        btns.forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`btn-phase-${mode}`);
        if (btn) btn.classList.add('active');
        
        document.body.classList.toggle('orbital-mode', mode === 'orbital');
        if (window.innerWidth <= 768 && this.dom.sidebar && this.dom.sidebar.classList.contains('open')) {
            this.toggleSidebar();
        }

        const webEditBtn = document.getElementById('btn-web-edit');
        if (webEditBtn) {
            if (mode === 'web') {
                webEditBtn.classList.remove('hidden');
                webEditBtn.classList.add('flex');
            } else {
                webEditBtn.classList.add('hidden');
                webEditBtn.classList.remove('flex');
                this.kernel.webEditMode = false;
                webEditBtn.classList.remove('bg-sky-600', 'text-white');
                webEditBtn.classList.add('bg-slate-800', 'text-slate-400');
            }
        }
        


        this.render();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (!this.kernel.state.session) return;

        const focalId = this.kernel.state.session.selectedId;

        if (focalId && this.viewMode === 'map') {
            const node = this.kernel.state.nodes.find(n => n.id === focalId);
            if (node) this.updateMenuPosition(node);
            else this.hideRadialMenu(true);
        } else {
            this.hideRadialMenu(true);
        }

        if (this.viewMode === 'map' && this.kernel.config.autoFocus && focalId && !this.userHasPanned && !this.isDragging) {
            const node = this.kernel.state.nodes.find(n => n.id === focalId);
            if (node) {
                const vpPos = this.getVisualPos(node);
                const vp = this.kernel.state.session.viewport;
                const rect = this.dom.viewport.getBoundingClientRect();
                const targetX = (rect.width / 2) - (vpPos.x * vp.scale);
                const targetY = (rect.height / 2) - (vpPos.y * vp.scale);
                
                if (Math.abs(targetX - vp.x) > 0.1 || Math.abs(targetY - vp.y) > 0.1) {
                    vp.x += (targetX - vp.x) * 0.08; vp.y += (targetY - vp.y) * 0.08;
                    this.updateTransform();
                }
            }
        }
    }

    updateTransform() {
        const vp = this.kernel.state.session.viewport;
        const transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`;
        this.dom.worldLayer.style.transform = transform;
        this.dom.edgeSvg.style.transform = transform;
        
        const nodes = this.dom.worldLayer.querySelectorAll('.node');
        nodes.forEach(el => {
            const nodeScale = parseFloat(el.dataset.nodeScale || 1);
            const globalScale = nodeScale * vp.scale;
            const invScale = 1 / globalScale;
            const label = el.querySelector('.node-label');
            if (label) {
                label.style.transform = `translateX(-50%) scale(${invScale})`;
                
                const forceLabel = el.dataset.forceLabel === 'true';
                const dist = parseInt(el.dataset.nodeDist || '-1', 10);
                
                let isVisible = false;
                if (forceLabel) {
                    isVisible = true;
                } else if (dist === 0) {
                    isVisible = vp.scale >= 0.20;
                } else if (dist === 1) {
                    isVisible = vp.scale >= 0.40;
                } else if (dist > 1) {
                    const triggerScale = 1.0 + (dist - 1) * 0.03;
                    isVisible = vp.scale >= triggerScale;
                }
                
                if (isVisible) {
                    label.style.opacity = '1';
                    label.style.pointerEvents = 'auto';
                } else {
                    label.style.opacity = '0';
                    label.style.pointerEvents = 'none';
                }
            }
        });
    }

    handlePointerDown(e) {
        if (this.viewMode !== 'map') return;
        if (window.innerWidth <= 768 && this.dom.sidebar && this.dom.sidebar.classList.contains('open')) {
            this.toggleSidebar();
        }
        
        // Ignore clicks on floating UI that shouldn't deselect the map
        if (e.target.closest('#ai-chat-container')) return;

        if (e.target.closest('.node')) return;
        this.activePointers.set(e.pointerId, e);
        if (this.activePointers.size === 1) {
            this.isDragging = true;
            this.userHasPanned = true;
            this.lastMouse = { x: e.clientX, y: e.clientY };
            this.clickStart = { x: e.clientX, y: e.clientY };
        }
    }

    handlePointerMove(e) {
        if (this.activePointers.has(e.pointerId)) {
            this.activePointers.set(e.pointerId, e);
        }
        if (this.activePointers.size === 2) {
            const pts = Array.from(this.activePointers.values());
            const p1 = pts[0], p2 = pts[1];
            const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
            const cx = (p1.clientX + p2.clientX) / 2;
            const cy = (p1.clientY + p2.clientY) / 2;

            if (this.lastPinchDist) {
                const zoomFactor = dist / this.lastPinchDist;
                const vp = this.kernel.state.session.viewport;
                const newScale = Math.max(0.1, Math.min(5, vp.scale * zoomFactor));
                const actualZoom = newScale / vp.scale;
                vp.x = cx - actualZoom * (cx - vp.x);
                vp.y = cy - actualZoom * (cy - vp.y);
                vp.scale = newScale;
                if (this.lastPinchCenter) {
                    vp.x += (cx - this.lastPinchCenter.x);
                    vp.y += (cy - this.lastPinchCenter.y);
                }
                this.updateTransform();
            }
            this.lastPinchDist = dist;
            this.lastPinchCenter = { x: cx, y: cy };
            this.userHasPanned = true;
            this.isDragging = false; 
        } 
        else if (this.isDragging && this.activePointers.size === 1) {
            const dx = e.clientX - this.lastMouse.x, dy = e.clientY - this.lastMouse.y;
            this.kernel.state.session.viewport.x += dx; 
            this.kernel.state.session.viewport.y += dy;
            this.lastMouse = { x: e.clientX, y: e.clientY };
            this.updateTransform(); 
        } 
        else if (this.draggedNode) {
            const vp = this.kernel.state.session.viewport;
            const dx = (e.clientX - this.lastMouse.x) / vp.scale;
            const dy = (e.clientY - this.lastMouse.y) / vp.scale;
            this.draggedNode.data.x += dx;
            this.draggedNode.data.y += dy;
            this.kernel.updateNode(this.draggedNode.id, { x: this.draggedNode.data.x, y: this.draggedNode.data.y });
            this.lastMouse = { x: e.clientX, y: e.clientY };
        }
    }

    handlePointerUp(e) {
        if (this.activePointers.has(e.pointerId)) this.activePointers.delete(e.pointerId);
        if (this.activePointers.size < 2) { this.lastPinchDist = null; this.lastPinchCenter = null; }
        if (this.activePointers.size === 0) {
            if (this.isDragging) {
                const dist = Math.hypot(e.clientX - this.clickStart.x, e.clientY - this.clickStart.y);
                if (dist < 5) {
                    
                    // Cancel Modes on background click
                    if (this.kernel.linkingMode) {
                        this.kernel.linkingMode = false;
                        this.dom.overlay.classList.add('hidden');
                    }
                    if (this.aiImportMode) {
                        this.aiImportMode = false;
                        this.aiPendingData = null;
                        if(this.dom.aiOverlay) this.dom.aiOverlay.classList.add('hidden');
                    }
                    if (this.parentSelectMode) {
                        this.parentSelectMode = false;
                        this.parentSelectSourceId = null;
                        this.dom.overlay.classList.add('hidden');
                    }

                    this.kernel.selectNode(null);
                    this.hideRadialMenu(true);
                }
            }
            this.isDragging = false;
        }
        if (this.draggedNode) this.userHasPanned = false; 
        this.draggedNode = null;
    }

    handleWheel(e) {
        if (this.viewMode !== 'map') return; 
        e.preventDefault();
        const s = this.kernel.state.session;
        const rect = this.dom.viewport.getBoundingClientRect();
        
        let targetX = rect.width / 2;
        let targetY = rect.height / 2;
        
        if (!s.selectedId) {
            targetX = e.clientX - rect.left;
            targetY = e.clientY - rect.top;
        }
        
        const worldX = (targetX - s.viewport.x) / s.viewport.scale;
        const worldY = (targetY - s.viewport.y) / s.viewport.scale;
        
        const factor = Math.exp(-e.deltaY * 0.001);
        s.viewport.scale = Math.max(0.1, Math.min(5, s.viewport.scale * factor));
        
        s.viewport.x = targetX - (worldX * s.viewport.scale);
        s.viewport.y = targetY - (worldY * s.viewport.scale);
        
        this.updateTransform();
    }

    updateMenuPosition(node) {
        const vp = this.kernel.state.session.viewport;
        const rect = this.dom.viewport.getBoundingClientRect();
        const vpPos = this.getVisualPos(node);
        const screenX = (vpPos.x * vp.scale) + vp.x + rect.left;
        const screenY = (vpPos.y * vp.scale) + vp.y + rect.top;
        const menu = this.dom.radialMenu;
        
        menu.style.position = 'fixed';
        menu.style.width = '2px';
        menu.style.height = '2px';
        menu.style.left = `${Math.round(screenX)}px`;
        menu.style.top = `${Math.round(screenY)}px`;
    }

    getVisualPos(node) {
        const state = this.kernel.state;
        if (state.session.layoutMode === 'structured' && this._structuredCoords) {
            return this._structuredCoords.get(node.id) || { x: node.data.x, y: node.data.y };
        }
        if (this.kernel.linkingMode) return { x: node.data.x, y: node.data.y };
        
        const dist = (this._focalDistances && this._focalDistances.has(node.id)) ? this._focalDistances.get(node.id) : -1;
        if (dist <= 0 || !this._focalNodes || this._focalNodes.length === 0) return { x: node.data.x, y: node.data.y };
        
        let fNode = null;
        if (state.session.selectedId) {
            fNode = state.nodes.find(n => n.id === state.session.selectedId);
        } else if (this._focalNodes.length > 0) {
            fNode = state.nodes.find(n => n.id === this._focalNodes[0]);
        }
        if (!fNode || fNode.id === node.id) return { x: node.data.x, y: node.data.y };
        
        const dx = node.data.x - fNode.data.x;
        const dy = node.data.y - fNode.data.y;
        
        let sum = 0;
        for (let i = 0; i < dist; i++) {
            sum += Math.max(0.2, Math.pow(0.7, i));
        }
        const spread = 1.4 * (sum / dist);
        
        return {
            x: fNode.data.x + dx * spread,
            y: fNode.data.y + dy * spread
        };
    }


    showRadialMenu(node) {
        this.activeRadialNodeId = node.id;
        const menu = this.dom.radialMenu;
        menu.style.display = 'block';

        const isLinking = this.kernel.linkingMode;
        const isPortal = node.type === 'portal' || node.type === 'smart-portal';
        const stateHash = `${node.id}-${node.type}-${isLinking}-${this.kernel.linkingSourceId === node.id}-${this.aiImportMode}-${this.parentSelectMode}${isPortal ? '-' + (node.content || '') : ''}`;

        if (menu.dataset.activeNode === stateHash && menu.innerHTML !== '') {
            menu.classList.add('active'); 
            if (!menu.classList.contains('ready')) {
                setTimeout(() => { if (menu.dataset.activeNode === stateHash) menu.classList.add('ready'); }, 300);
            }
            return;
        }
        
        menu.dataset.activeNode = stateHash;
        menu.classList.remove('active'); 
        menu.classList.remove('ready'); 

        const off = 80;
        const isCollapsed = node.data.collapsed;

        let linkTitle = 'Link to Node';
        if (isLinking) {
            linkTitle = (node.id === this.kernel.linkingSourceId) ? 'Cancel Link' : 'Confirm Link';
        }

        let actions = [];

        // Check if this node is an orphan (no structural parent connection AND not the root)
        const hasParent = this.kernel.state.connections.some(c => c.to === node.id && c.type === 'structural');
        const isNodeRoot = node.type === 'root' || node.type.endsWith('-root') || (node.data && node.data.isCore);
        const isRoot = node.data && node.data.isCore;
        const isOrphan = !hasParent && !isRoot;

        // Intercept menu if Parent Select Mode is active
        if (this.parentSelectMode) {
            if (node.id === this.parentSelectSourceId) {
                actions = [ { icon: '❌', action: 'CancelSelectParent', title: 'Cancel' } ];
            } else {
                actions = [ { icon: '✅', action: 'ConfirmParent', title: 'Set as Parent' } ];
            }
        }
        // Intercept menu if AI Import Mode is active and target is a Smart Portal
        else if (this.aiImportMode) {
            if (node.type === 'smart-portal') {
                actions = [ { icon: '📥', action: 'ResolveAiImport', title: 'Inject AI Data Here' } ];
            } else {
                actions = [ { icon: '❌', action: 'CancelAiImport', title: 'Cancel AI Import' } ];
            }
        } else {
            // Normal Operations
            actions = [
                { icon: '📝', action: 'Edit', title: 'Edit' },
                { icon: '🔗', action: 'Link', title: linkTitle },
                { icon: '➕', action: 'AddChild', title: 'Add Child' }
            ];
            if (!isNodeRoot) {
                actions.push({ icon: '🗑️', action: 'Delete', title: 'Delete Downstream' });
            }
            actions.push({ icon: (isCollapsed ? '🌞' : '🌚'), action: 'ToggleCollapse', title: (isCollapsed ? 'Expand' : 'Collapse') });
            
            // Add orphan-specific action
            if (isOrphan) {
                actions.push({ icon: '👆', action: 'SelectParent', title: 'Select Parent' });
            }
            if (node.type === 'portal') {
                actions.push({ 
                    icon: node.content ? '🌀' : '🎯', 
                    action: 'EnterPortal', 
                    title: node.content ? 'Enter' : 'Set Target' 
                });
            } else if (node.type === 'smart-portal') {
                actions.push({ 
                    icon: node.content ? '✨' : '🎯', 
                    action: 'TriggerAI', 
                    title: node.content ? 'Trigger AI' : 'Set Target' 
                });
            }
            else {
                // Clip is only available for non-root, non-portal, non-web nodes
                const canClip = !isNodeRoot && !node.type.startsWith('web-');
                if (canClip) {
                    actions.push({ icon: '✂️', action: 'ClipBranch', title: 'Clip' });
                }
            }
        }

        let html = '';
        actions.forEach((action, i) => {
            const angle = -Math.PI / 2 + (i * (2 * Math.PI / actions.length));
            const tx = Math.cos(angle) * off;
            const ty = Math.sin(angle) * off;
            
            let btnStyle = `left:0; top:0; margin-left:-22px; margin-top:-22px; position:absolute; --tx: ${tx}px; --ty: ${ty}px;`;
            
            if (action.action === 'Link' && isLinking) {
                if (node.id === this.kernel.linkingSourceId) {
                    btnStyle += ` color: #ef4444; border-color: #ef4444; box-shadow: 0 0 15px rgba(239,68,68,0.6);`;
                } else {
                    btnStyle += ` color: #10b981; border-color: #10b981; box-shadow: 0 0 15px rgba(16,185,129,0.6);`;
                }
            } else if (action.action === 'ResolveAiImport') {
                btnStyle += ` color: #818cf8; border-color: #818cf8; box-shadow: 0 0 15px rgba(79,70,229,0.6); animation: pulse 2s infinite;`;
            } else if ((action.action === 'EnterPortal' || action.action === 'TriggerAI') && node.content) {
                // Highlight action buttons if a payload is selected
                btnStyle += ` background-color: rgba(147, 51, 234, 0.4); color: #d8b4fe; border-color: #a855f7; box-shadow: 0 0 15px rgba(168,85,247,0.6);`;
            }

            html += `<div class="radial-btn" style="${btnStyle}" onpointerdown="event.stopPropagation()" onclick="SC.action${action.action}('${node.id}'); event.stopPropagation();" title="${action.title}">${action.icon}</div>`;
        });
        menu.innerHTML = html;

        requestAnimationFrame(() => {
            menu.classList.add('active'); 
            setTimeout(() => {
                if (menu.dataset.activeNode === stateHash) {
                    menu.classList.add('ready');
                }
            }, 300);
        });
    }

    hideRadialMenu(force) {
        if (force) {
            this.dom.radialMenu.classList.remove('active');
            this.dom.radialMenu.classList.remove('ready'); 
            
            setTimeout(() => {
                if (!this.dom.radialMenu.classList.contains('active')) {
                    this.dom.radialMenu.style.display = 'none';
                    this.dom.radialMenu.innerHTML = ''; 
                    this.dom.radialMenu.dataset.activeNode = '';
                }
            }, 300);
        }
    }

    // --- AI WORKFLOW API ---
    enterAiImportMode(mapData) {
        this.aiImportMode = true;
        this.aiPendingData = mapData;
        if (this.dom.aiOverlay) this.dom.aiOverlay.classList.remove('hidden');
        this.render(); // Trigger render to show halos
    }

    actionCancelAiImport() {
        this.aiImportMode = false;
        this.aiPendingData = null;
        if (this.dom.aiOverlay) this.dom.aiOverlay.classList.add('hidden');
        this.hideRadialMenu(true);
        this.render(); // Remove halos
    }

    async actionResolveAiImport(nodeId) {
        if (!this.aiPendingData) return;
        
        // Save the map to the library natively so the portal can reference it!
        const saved = await this.kernel.saveConstellationToLibrary(this.aiPendingData);
        if (saved === false) {
            throw new Error("Guest map limit (25) exceeded.");
        }
        
        // Update the smart portal's payload to link to this new map
        this.kernel.updateNode(nodeId, { content: this.aiPendingData.map_id });
        
        // Actually import the physical nodes
        this.kernel.importSubmap(nodeId, this.aiPendingData);
        
        alert(`AI Generated Map "${this.aiPendingData.meta.title}" injected successfully!`);
        
        // Cleanup
        this.actionCancelAiImport();
        this.kernel.selectNode(nodeId);
    }

    actionTriggerAI(id) {
        this.hideRadialMenu();
        const node = this.kernel.state.nodes.find(n => n.id === id);
        if (!node) return;

        // Find connected input nodes to act as prompt
        const connectedNodes = this.kernel.state.connections
            .filter(c => c.to === id)
            .map(c => this.kernel.state.nodes.find(n => n.id === c.from))
            .filter(n => n);
        
        let promptStr = '';
        if (connectedNodes.length > 0) {
            promptStr = connectedNodes.map(n => n.content || n.title).join('\n');
        } else {
            promptStr = node.content || node.title;
        }

        if (window.AI && window.AI.handleSmartNodeConnection) {
            // Reusing handleSmartNodeConnection with dummy source/target for now,
            // or we could add a new method to window.AI for direct triggers.
            const dummySource = { id: 'manual', type: 'note', title: 'Manual Trigger', content: promptStr };
            window.AI.handleSmartNodeConnection(dummySource, node);
        } else {
            console.error("AI Engine not loaded.");
        }
    }

    actionEdit(id) { 
        const tgt = id || this.kernel.state.session.selectedId; 
        this.kernel.selectNode(tgt); 
        if (this.dom.sidebar && !this.dom.sidebar.classList.contains('open')) {
            this.toggleSidebar();
        }
    }
    
    actionLink(id) { 
        const tgt = id || this.kernel.state.session.selectedId; 
        
        // Cancel other modes
        this.parentSelectMode = false;
        this.parentSelectSourceId = null;

        if (this.kernel.linkingMode) {
            if (this.kernel.linkingSourceId !== tgt) {
                this.kernel.addConnection(this.kernel.linkingSourceId, tgt, 'association');
            }
            this.kernel.linkingMode = false;
            this.dom.overlay.classList.add('hidden');
            this.render(); 
        } else {
            this.kernel.linkingMode = true; 
            this.kernel.linkingSourceId = tgt; 
            if (this.dom.overlay && this.dom.overlay.firstElementChild) {
                this.dom.overlay.firstElementChild.textContent = "Select Target & Click Link";
            }
            this.dom.overlay.classList.remove('hidden'); 
            this.render(); 
        }
    }

    actionSelectParent(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        
        // Cancel other modes
        this.kernel.linkingMode = false;
        this.kernel.linkingSourceId = null;
        
        this.parentSelectMode = true;
        this.parentSelectSourceId = tgt;
        if (this.dom.overlay && this.dom.overlay.firstElementChild) {
            this.dom.overlay.firstElementChild.textContent = "Select Parent & Click 'Set as Parent'";
        }
        this.dom.overlay.classList.remove('hidden');
        this.render();
    }

    actionCancelSelectParent() {
        this.parentSelectMode = false;
        this.parentSelectSourceId = null;
        this.dom.overlay.classList.add('hidden');
        this.render();
    }

    actionConfirmParent(id) {
        const parentId = id || this.kernel.state.session.selectedId;
        if (this.parentSelectSourceId && parentId !== this.parentSelectSourceId) {
            const res = this.kernel.addConnection(parentId, this.parentSelectSourceId, 'structural');
            if (res && res.success === false) {
                alert(`Schema constraint: Cannot make [${this.kernel.state.nodes.find(n => n.id === parentId)?.type}] a parent of [${this.kernel.state.nodes.find(n => n.id === this.parentSelectSourceId)?.type}].`);
            }
        }
        this.parentSelectMode = false;
        this.parentSelectSourceId = null;
        this.dom.overlay.classList.add('hidden');
        this.render();
    }

    async actionDelete(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const ok = await this.actionConfirm({
            title: "Delete Node",
            message: "Are you sure you want to delete this node and cascade to all children? This action cannot be undone.",
            confirmText: "Delete",
            isDestructive: true
        });
        if (ok) {
            this.kernel.deleteNode(tgt);
        }
    }
    actionToggleCollapse(id) { const tgt = id || this.kernel.state.session.selectedId; this.kernel.toggleCollapse(tgt); }
    
    actionAddChild(id) {
        const pid = id || this.kernel.state.session.selectedId;
        const p = this.kernel.state.nodes.find(n => n.id === pid);
        if (p) {
            let type = this.kernel.getSmartChildType(pid);
            
            const mapType = this.kernel.state.meta && this.kernel.state.meta.type ? this.kernel.state.meta.type : 'generic';
            if (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes && MultiMapSchema.mapTypes[mapType]) {
                const allowedInMap = MultiMapSchema.mapTypes[mapType].allowedNodes || [];
                if (!allowedInMap.includes(type) || !MultiMapSchema.canConnect(p.type, type)) {
                    // Find first allowed node in this map that can connect as child to p.type and is not a root type
                    const fallbackType = allowedInMap.find(t => t !== 'root' && !t.endsWith('-root') && MultiMapSchema.canConnect(p.type, t));
                    type = fallbackType || 'note';
                }
            }

            if (typeof MultiMapSchema !== 'undefined' && !MultiMapSchema.canConnect(p.type, type)) {
                alert(`Schema constraint: Cannot add a [${type}] child to a [${p.type}] node in this map.`);
                return;
            }
            const child = this.kernel.addNode({ title: "New " + type, type: type }, pid);
            this.kernel.addConnection(pid, child.id);
            this.kernel.selectNode(child.id); 
            p.data.collapsed = false; 
        }
    }

    async actionEnterPortal(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (node && (node.type === 'portal' || node.type === 'smart-portal')) {
            const lib = this.kernel.getLibrary();
            const existingMap = lib.find(m => m.map_id === node.content);
            if (existingMap) {
                // Navigate directly to existing page
                this.kernel.enterPortal(existingMap);
                const mapType = this.kernel.state.meta && this.kernel.state.meta.type ? this.kernel.state.meta.type : 'generic';
                if (mapType === 'web') this.setView('web');
                else this.setView('map');
                this.actionCloseDataManager();
                this.render();
            } else {
                // Open selection modal to choose existing or create new
                this.actionSetPortalTarget(tgt);
            }
        }
    }

    async actionSetPortalTarget(nodeId) {
        const node = this.kernel.state.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const lib = this.kernel.getLibrary() || [];
        const projects = this.kernel.state.session.projects || [];
        const activeProjId = this.kernel.activeProjectId;
        const activeProj = projects.find(p => p.project_id === activeProjId) || { meta: { title: "Active Project" } };
        const activeProjTitle = activeProj.meta?.title || "Active Project";

        // Filter same project and other project pages
        const sameProjectPages = lib.filter(p => p.meta?.project_id === activeProjId || (!p.meta?.project_id && activeProjId === 'default_project'));
        const otherProjectPages = lib.filter(p => p.meta?.project_id && p.meta?.project_id !== activeProjId);

        let activeTab = 'existing'; // 'existing' or 'new'
        let selectedPageId = null;
        let selectedPageTitle = '-- Choose Target Page --';

        const contentHtml = `
            <div class="flex flex-col gap-4 font-sans text-slate-300">
                <!-- Tabs Header -->
                <div class="flex border-b border-slate-800/80">
                    <button id="tab-existing" class="flex-1 py-2 text-center text-xs font-bold border-b-2 border-indigo-500 text-indigo-400 focus:outline-none transition-all cursor-pointer bg-transparent">Link Existing Page</button>
                    <button id="tab-new" class="flex-1 py-2 text-center text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 focus:outline-none transition-all cursor-pointer bg-transparent">Create New Page</button>
                </div>

                <!-- Existing Page Section -->
                <div id="section-existing" class="flex flex-col gap-2">
                    <label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select Existing Page</label>
                    <div class="relative w-full">
                        <button id="page-selector-btn" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-left text-slate-400 hover:border-slate-700 transition-colors flex justify-between items-center cursor-pointer">
                            <span id="page-selector-label" class="truncate">${selectedPageTitle}</span>
                            <span class="text-slate-500 text-[10px]">▼</span>
                        </button>
                    </div>
                </div>

                <!-- Create New Section -->
                <div id="section-new" class="flex flex-col gap-3 hidden">
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Name</label>
                        <input type="text" id="new-page-title" value="${node.title || 'Sub Map'}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Type</label>
                        <select id="new-page-type" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                            <option value="generic" selected>Generic Map</option>
                            <option value="web">Web Architect</option>
                            <option value="person">Person Profile</option>
                            <option value="prompt">Prompt Engine</option>
                            <option value="agent">Agent Config</option>
                        </select>
                    </div>
                </div>
            </div>
        `;

        const actionsHtml = `
            <div class="flex w-full justify-end items-center gap-2">
                <button id="portal-btn-cancel" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel</button>
                <button id="portal-btn-submit" class="bg-indigo-650 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Link Page</button>
            </div>
        `;

        this.showDialogModal({
            title: "Set Portal Target",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, close) => {
                const tabExisting = backdrop.querySelector('#tab-existing');
                const tabNew = backdrop.querySelector('#tab-new');
                const sectionExisting = backdrop.querySelector('#section-existing');
                const sectionNew = backdrop.querySelector('#section-new');
                const btnSelector = backdrop.querySelector('#page-selector-btn');
                const labelSelector = backdrop.querySelector('#page-selector-label');
                const btnSubmit = backdrop.querySelector('#portal-btn-submit');
                const inputTitle = backdrop.querySelector('#new-page-title');
                const selectType = backdrop.querySelector('#new-page-type');

                const updateSubmitState = () => {
                    if (activeTab === 'existing') {
                        btnSubmit.disabled = !selectedPageId;
                        btnSubmit.style.opacity = selectedPageId ? '1' : '0.5';
                        btnSubmit.textContent = 'Link Page';
                    } else {
                        const hasTitle = !!inputTitle.value.trim();
                        btnSubmit.disabled = !hasTitle;
                        btnSubmit.style.opacity = hasTitle ? '1' : '0.5';
                        btnSubmit.textContent = 'Create & Link';
                    }
                };

                inputTitle.oninput = updateSubmitState;
                updateSubmitState();

                tabExisting.onclick = () => {
                    activeTab = 'existing';
                    tabExisting.className = "flex-1 py-2 text-center text-xs font-bold border-b-2 border-indigo-500 text-indigo-400 focus:outline-none transition-all cursor-pointer bg-transparent";
                    tabNew.className = "flex-1 py-2 text-center text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 focus:outline-none transition-all cursor-pointer bg-transparent";
                    sectionExisting.classList.remove('hidden');
                    sectionNew.classList.add('hidden');
                    updateSubmitState();
                };

                tabNew.onclick = () => {
                    activeTab = 'new';
                    tabNew.className = "flex-1 py-2 text-center text-xs font-bold border-b-2 border-indigo-500 text-indigo-400 focus:outline-none transition-all cursor-pointer bg-transparent";
                    tabExisting.className = "flex-1 py-2 text-center text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 focus:outline-none transition-all cursor-pointer bg-transparent";
                    sectionExisting.classList.add('hidden');
                    sectionNew.classList.remove('hidden');
                    inputTitle.focus();
                    inputTitle.select();
                    updateSubmitState();
                };

                btnSelector.onclick = (e) => {
                    e.stopPropagation();
                    const dropdownId = 'mm-portal-target-dropdown';
                    const existingDropdown = document.getElementById(dropdownId);
                    if (existingDropdown) {
                        existingDropdown.remove();
                        return;
                    }

                    const rect = btnSelector.getBoundingClientRect();
                    const panel = document.createElement('div');
                    panel.id = dropdownId;
                    panel.className = "fixed z-[9999999] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl overflow-y-auto flex flex-col font-sans py-1 max-h-60";
                    panel.style.left = `${rect.left}px`;
                    panel.style.top = `${rect.bottom + 4}px`;
                    panel.style.width = `${rect.width}px`;

                    const addOption = (pageObj) => {
                        const b = document.createElement('button');
                        b.className = "text-left w-full px-3 py-2 text-[10px] font-medium text-slate-300 hover:bg-indigo-650 hover:text-white flex items-center justify-between transition-colors border-none bg-transparent cursor-pointer";
                        const pageTypeStr = pageObj.meta.type || 'generic';
                        const escapedTitle = this.escapeHTML(pageObj.meta.title);
                        b.innerHTML = `<span class="truncate flex-1 font-bold">${escapedTitle}</span><span class="text-[9px] text-slate-500 uppercase tracking-wider">${pageTypeStr}</span>`;
                        b.onclick = () => {
                            selectedPageId = pageObj.map_id;
                            selectedPageTitle = pageObj.meta.title;
                            labelSelector.textContent = pageObj.meta.title;
                            labelSelector.classList.remove('text-slate-400');
                            labelSelector.classList.add('text-slate-200');
                            updateSubmitState();
                            panel.remove();
                        };
                        panel.appendChild(b);
                    };

                    if (sameProjectPages.length > 0) {
                        const header = document.createElement('div');
                        header.className = "px-3 py-1 text-[8px] font-bold text-slate-550 uppercase tracking-wider bg-slate-900/40 select-none";
                        header.textContent = `${activeProjTitle} (Active)`;
                        panel.appendChild(header);
                        sameProjectPages.forEach(p => addOption(p));
                    }

                    if (otherProjectPages.length > 0) {
                        const header = document.createElement('div');
                        header.className = "px-3 py-1 text-[8px] font-bold text-slate-550 uppercase tracking-wider bg-slate-900/40 select-none mt-1";
                        header.textContent = "Other Projects";
                        panel.appendChild(header);
                        otherProjectPages.forEach(p => addOption(p));
                    }

                    if (sameProjectPages.length === 0 && otherProjectPages.length === 0) {
                        const noPages = document.createElement('div');
                        noPages.className = "px-3 py-2 text-[10px] text-slate-500 italic select-none";
                        noPages.textContent = "No pages found in library.";
                        panel.appendChild(noPages);
                    }

                    document.body.appendChild(panel);

                    const closeDD = (ev) => {
                        if (!panel.contains(ev.target) && ev.target !== btnSelector) {
                            panel.remove();
                            document.removeEventListener('mousedown', closeDD, true);
                        }
                    };
                    setTimeout(() => document.addEventListener('mousedown', closeDD, true), 0);
                };

                backdrop.querySelector('#portal-btn-cancel').onclick = () => close(null);
                btnSubmit.onclick = async () => {
                    close(true);

                    if (activeTab === 'existing') {
                        if (!selectedPageId) return;
                        node.content = selectedPageId;
                        this.kernel.saveCurrentMapToLibrary();

                        const map = lib.find(m => m.map_id === selectedPageId);
                        if (map) {
                            this.kernel.enterPortal(map);
                            const mapType = this.kernel.state.meta && this.kernel.state.meta.type ? this.kernel.state.meta.type : 'generic';
                            if (mapType === 'web') this.setView('web');
                            else this.setView('map');
                            this.actionCloseDataManager();
                            this.render();
                        }
                    } else {
                        const title = inputTitle.value.trim();
                        const type = selectType.value;
                        if (!title) return;

                        const newPage = await this.kernel.createPage(this.kernel.activeProjectId, title, type);
                        if (newPage) {
                            node.content = newPage.map_id;
                            this.kernel.saveCurrentMapToLibrary();
                            
                            // Push the parent map to portalHistory so exit portal loads correctly
                            this.kernel.portalHistory.push(JSON.parse(JSON.stringify(this.kernel.state)));
                            this.kernel.history = []; // Clear undo
                            this.kernel.state = this.kernel.ensureSchema(newPage);
                            this.kernel.notify();

                            if (type === 'web') this.setView('web');
                            else this.setView('map');
                            this.actionCloseDataManager();
                            this.render();
                            
                            this.actionOpenPageSettings(newPage.map_id);
                        } else {
                            alert("Failed to create page.");
                        }
                    }
                };
            }
        });
    }
    
    actionExitPortal() {
        if (this.kernel.exitPortal()) {
            this.setView('map');
            
            const drawer = document.getElementById('data-manager-drawer');
            if (drawer) drawer.classList.add('translate-x-full');
        }
    }

    async actionClipBranch(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (!node) return;
        
        const isRoot   = node.data.isCore || node.type === 'root' || node.type.endsWith('-root');
        const isPortal = node.type === 'portal' || node.type === 'smart-portal';
        const isWeb    = node.type.startsWith('web-');
        if (isRoot || isPortal || isWeb) {
            return alert('Clip is not available for root nodes, portals, or web-type nodes.');
        }
        
        const initialTitle = node.title || "Clipped Branch";
        const initialType = node.type || "generic";
        
        const contentHtml = `
            <div class="flex flex-col gap-4 font-sans text-slate-300">
                <p class="text-xs text-slate-400">Clip the branch starting at "${initialTitle}" into a new sub-page. This replaces this node with a portal to the new space and removes all downstream sub-nodes from the current map.</p>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Sub-Page Name</label>
                    <input type="text" id="clip-page-title" value="${initialTitle}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Sub-Page Type</label>
                    <select id="clip-page-type" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                        <option value="generic" ${initialType === 'generic' ? 'selected' : ''}>Generic Map</option>
                        <option value="web" ${initialType === 'web' ? 'selected' : ''}>Web Architect</option>
                        <option value="person" ${initialType === 'person' ? 'selected' : ''}>Person Profile</option>
                        <option value="prompt" ${initialType === 'prompt' ? 'selected' : ''}>Prompt Engine</option>
                        <option value="agent" ${initialType === 'agent' ? 'selected' : ''}>Agent Config</option>
                    </select>
                </div>
            </div>
        `;
        
        const actionsHtml = `
            <div class="flex w-full justify-end items-center gap-2">
                <button id="clip-btn-cancel" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel</button>
                <button id="clip-btn-submit" class="bg-indigo-650 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Clip Branch</button>
            </div>
        `;
        
        this.showDialogModal({
            title: "Clip Branch to New Page",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, closeClip) => {
                const titleInput = backdrop.querySelector('#clip-page-title');
                const typeSelect = backdrop.querySelector('#clip-page-type');
                
                titleInput.focus();
                titleInput.select();
                
                backdrop.querySelector('#clip-btn-cancel').onclick = () => closeClip(null);
                backdrop.querySelector('#clip-btn-submit').onclick = async () => {
                    const title = titleInput.value.trim();
                    const type = typeSelect.value;
                    if (!title) return alert("Sub-page name cannot be empty.");
                    
                    closeClip(true);
                    
                    const newMapId = await this.kernel.clipBranch(tgt, title, type);
                    if (newMapId) {
                        this.kernel.selectNode(tgt);
                        this.actionOpenPageSettings(newMapId);
                    } else {
                        alert('Clip failed. The node may not be clippable.');
                    }
                };
            }
        });
    }

    async actionSaveConstellation(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const json = this.kernel.extractConstellation(tgt);
        if (json) { 
            const saved = await this.kernel.saveConstellationToLibrary(json); 
            if (saved !== false) alert("Saved to Library.");
        }
    }

    actionLoadRemoteTemplates() {
        this.kernel.loadRemoteTemplates();
    }
    
    async actionApplyTemplateToNode(nodeId, tplId) {
        try {
            const tplData = await this.kernel.bridge.fetchTemplateData(tplId);
            this.kernel.applyTemplateToNode(nodeId, tplData);
            alert(`Template "${tplData.meta.title}" applied!`);
            this.setView('map');
        } catch (e) {
            alert("Failed to apply template.");
            console.error(e);
        }
    }
    
    actionUpdatePersonField(nodeId, field, value) {
        this.kernel.updatePersonField(nodeId, field, value);
    }

    async processMapImport(parsedData, target) {
        let maps = Array.isArray(parsedData) ? parsedData : [parsedData];
        let added = 0, skipped = 0, overwritten = 0;

        for (let newMap of maps) {
            if (!newMap.map_id || !newMap.nodes) continue;

            if (target !== 'template') {
                if (!newMap.meta) newMap.meta = {};
                newMap.meta.project_id = this.kernel.activeProjectId;
            }

            let existingMaps = [];
            if (target === 'template') {
                existingMaps = typeof MultiMapLibrary !== 'undefined' ? MultiMapLibrary.getCustomTemplates() : [];
            } else {
                existingMaps = this.kernel.getLibrary();
            }

            let existing = existingMaps.find(m => m.map_id === newMap.map_id);

            if (existing) {
                let existingStr = JSON.stringify(existing);
                let newStr = JSON.stringify(newMap);
                if (existingStr === newStr) { skipped++; continue; }

                let msg = `Conflict: A map titled "${newMap.meta?.title || newMap.map_id}" already exists.\nOverwrite existing map?`;
                if (confirm(msg)) {
                    if (target === 'template') {
                        MultiMapLibrary.saveCustomTemplate(newMap);
                        overwritten++;
                    } else {
                        const saved = await this.kernel.saveMapToLibrary(newMap);
                        if (saved !== false) {
                            overwritten++;
                        } else {
                            break; // Stop importing further if quota exceeded
                        }
                    }
                } else { skipped++; }
            } else {
                if (target === 'template') {
                    MultiMapLibrary.saveCustomTemplate(newMap);
                    added++;
                } else {
                    const saved = await this.kernel.saveMapToLibrary(newMap);
                    if (saved !== false) {
                        added++;
                    } else {
                        break; // Stop importing further if quota exceeded
                    }
                }
            }
        }

        alert(`Import Complete:\n✅ ${added} Added\n🔄 ${overwritten} Overwritten\n⏭️ ${skipped} Skipped`);
        if (target === 'template') this.actionLoadRemoteTemplates();
        else this.render();
    }

    actionUploadTemplateFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try { const parsed = JSON.parse(e.target.result); await this.processMapImport(parsed, 'template'); } 
            catch (err) { alert("Invalid JSON format."); }
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    actionUploadLibraryFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try { const parsed = JSON.parse(e.target.result); await this.processMapImport(parsed, 'constellation'); } 
            catch (err) { alert("Invalid JSON format."); }
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    async actionDownloadTemplate(id) {
        try {
            const tplData = await this.kernel.bridge.fetchTemplateData(id);
            const json = JSON.stringify(tplData, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            let safeTitle = (tplData.meta?.title || id).replace(/[^a-z0-9]/gi, '_').toLowerCase();
            a.download = `multi_map_template_${safeTitle}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { alert("Failed to download template."); }
    }

    actionDeleteRemoteTemplate(id) {
        if(confirm("Permanently delete this custom template?")) {
            if (typeof MultiMapLibrary !== 'undefined') {
                if (MultiMapLibrary.deleteCustomTemplate(id)) this.actionLoadRemoteTemplates(); 
            }
        }
    }

    async actionSpawnAssetAsPortal(tplId) {
        try {
            const tplData = await this.kernel.bridge.fetchTemplateData(tplId);
            
            // Clone the template map, give it a new map_id, and assign to current project
            const newMapId = this.kernel.generateId();
            const clonedMap = JSON.parse(JSON.stringify(tplData));
            clonedMap.map_id = newMapId;
            clonedMap.meta.project_id = this.kernel.activeProjectId;
            clonedMap.meta.title = tplData.meta.title || "Cloned Space";
            
            const saved = await this.kernel.saveConstellationToLibrary(clonedMap);
            if (saved === false) {
                throw new Error("Storage limit exceeded.");
            }
            
            // Add the portal node to the current map pointing to newMapId
            const vp = this.kernel.state.session.viewport;
            const rect = this.dom.viewport.getBoundingClientRect();
            
            // If there's a selected node, position near it, otherwise center of viewport
            const selectedId = this.kernel.state.session.selectedId;
            let posX = undefined;
            let posY = undefined;
            if (!selectedId) {
                posX = (rect.width / 2 - vp.x) / vp.scale;
                posY = (rect.height / 2 - vp.y) / vp.scale;
            }
            
            const portalNode = this.kernel.addNode({
                type: 'portal',
                title: clonedMap.meta.title,
                content: newMapId,
                x: posX,
                y: posY
            }, selectedId);
            
            // Link portal node to selected node or root
            let parentId = selectedId;
            if (!parentId) {
                // Find a core or root node
                const rootNode = this.kernel.state.nodes.find(n => n.data && n.data.isCore) || 
                                 this.kernel.state.nodes.find(n => n.type === 'root' || n.type === 'file-root') || 
                                 this.kernel.state.nodes[0];
                if (rootNode) parentId = rootNode.id;
            }
            
            if (parentId && portalNode) {
                this.kernel.addConnection(parentId, portalNode.id);
            }
            
            this.setView('map');
            this.kernel.selectNode(portalNode.id);
            this.actionCloseDataManager();
            this.actionOpenPageSettings(clonedMap.map_id);
        } catch (e) {
            console.error(e);
            alert("Failed to spawn asset as portal: " + e.message);
        }
    }

    /** Shared implementation: clone asset template into a specific project */
    async _importAssetToProject(tplId, targetProjectId) {
        const tplData = await this.kernel.bridge.fetchTemplateData(tplId);
        const projects = this.kernel.getProjects();

        const newMapId = this.kernel.generateId();
        const clonedMap = JSON.parse(JSON.stringify(tplData));
        clonedMap.map_id = newMapId;
        clonedMap.meta.project_id = targetProjectId;
        clonedMap.meta.title = tplData.meta.title || 'Imported Page';

        // Library templates use meta.target_type (e.g. "web-root") instead of meta.type.
        // Reverse-map it to the schema's mapType key so ensureSchema never falls back to "generic".
        if (!clonedMap.meta.type && clonedMap.meta.target_type) {
            const targetRootType = clonedMap.meta.target_type;
            if (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes) {
                const matchedType = Object.keys(MultiMapSchema.mapTypes).find(
                    m => MultiMapSchema.mapTypes[m].rootNode === targetRootType
                );
                if (matchedType) clonedMap.meta.type = matchedType;
            }
        }

        const saved = await this.kernel.saveConstellationToLibrary(clonedMap);
        if (saved === false) throw new Error('Storage limit exceeded.');

        // Register the page under its project
        const proj = projects.find(p => p.project_id === targetProjectId)
            || (this.kernel.firestoreProjects || []).find(p => p.project_id === targetProjectId);
        if (proj && !proj.page_ids.includes(newMapId)) {
            proj.page_ids.push(newMapId);
            if (this.kernel.isUsingCloudVault()) {
                const uid = window.FirebaseAuth.currentUser.uid;
                const projRef = window.Firestore.doc(window.FirebaseDb, 'users', uid, 'projects', targetProjectId);
                await window.Firestore.setDoc(projRef, proj);
            } else {
                localStorage.setItem('mm_projects', JSON.stringify(this.kernel.projects));
            }
        }

        return { clonedMap, projTitle: proj ? proj.meta.title : targetProjectId };
    }

    /** Called by the dropdown when the user picks an existing project */
    async actionImportAssetToProjectId(tplId, projectId) {
        // Close any open dropdown for this asset before doing async work
        const ddKey = 'asset_dd_' + tplId;
        const engine = this.registry.get('data');
        if (engine && engine.ui.openItems[ddKey]) engine.toggleItem(ddKey);

        try {
            const { clonedMap, projTitle } = await this._importAssetToProject(tplId, projectId);
            const openNow = confirm(`"${clonedMap.meta.title}" added to "${projTitle}". Open it now?`);
            if (openNow) {
                this.kernel.activeProjectId = projectId;
                this.kernel.loadMapState(clonedMap);
                this.setView('map');
                const drawer = document.getElementById('data-manager-drawer');
                if (drawer) drawer.classList.add('translate-x-full');
            } else {
                this.render();
            }
        } catch (e) {
            console.error(e);
            alert('Failed to import asset: ' + e.message);
        }
    }

    /** Called by the dropdown when the user chooses "+ New Project…" */
    async actionImportAssetToNewProject(tplId) {
        const ddKey = 'asset_dd_' + tplId;
        const engine = this.registry.get('data');
        if (engine && engine.ui.openItems[ddKey]) engine.toggleItem(ddKey);

        const tplData = await this.kernel.bridge.fetchTemplateData(tplId).catch(() => null);
        const defaultName = tplData ? `${tplData.meta.title} Project` : 'New Project';
        const newProjName = prompt('New project name:', defaultName);
        if (!newProjName) return;

        try {
            const newProjId = await this.kernel.createProject(newProjName, '', '📁', '#6366f1', false);
            if (!newProjId) throw new Error('Could not create project.');
            const { clonedMap } = await this._importAssetToProject(tplId, newProjId);
            const openNow = confirm(`Project "${newProjName}" created with page "${clonedMap.meta.title}". Open it now?`);
            if (openNow) {
                this.kernel.activeProjectId = newProjId;
                this.kernel.loadMapState(clonedMap);
                this.setView('map');
                const drawer = document.getElementById('data-manager-drawer');
                if (drawer) drawer.classList.add('translate-x-full');
            } else {
                this.render();
            }
        } catch (e) {
            console.error(e);
            alert('Failed to create project or import asset: ' + e.message);
        }
    }

    /** @deprecated — kept in case anything still references the old single-method flow */
    async actionImportAssetToPage(tplId) {
        return this.actionImportAssetToProjectId(tplId, this.kernel.activeProjectId);
    }

    /**
     * Renders a body-level fixed dropdown anchored to the "New Page" button.
     * Avoids overflow-hidden clipping from the asset card / scrollable list.
     */
    showAssetProjectDropdown(event, tplId) {
        // Remove any existing dropdown
        const existing = document.getElementById('mm-asset-proj-dd');
        if (existing) {
            existing.remove();
            // If same button was clicked again, just close (toggle off)
            if (existing.dataset.tplId === tplId) return;
        }

        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        const projects = this.kernel.getProjects();

        const panel = document.createElement('div');
        panel.id = 'mm-asset-proj-dd';
        panel.dataset.tplId = tplId;
        panel.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${rect.bottom + 4}px;
            min-width: ${Math.max(rect.width, 180)}px;
            z-index: 99999;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            font-family: inherit;
        `;

        // Keep panel on-screen if it would overflow viewport bottom
        const estimatedHeight = (projects.length + 1) * 32 + 8;
        if (rect.bottom + 4 + estimatedHeight > window.innerHeight) {
            panel.style.top = '';
            panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        }

        const activeId = this.kernel.activeProjectId;

        projects.forEach(proj => {
            const b = document.createElement('button');
            b.style.cssText = 'text-align:left;width:100%;padding:6px 12px;font-size:10px;font-weight:500;color:#cbd5e1;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;';
            b.innerHTML = `<span>${proj.meta.icon || '📁'}</span><span style="flex:1">${proj.meta.title}</span>${proj.project_id === activeId ? '<span style="font-size:8px;color:#64748b">current</span>' : ''}`;
            b.onmouseover = () => { b.style.background = '#2563eb'; b.style.color = '#fff'; };
            b.onmouseout  = () => { b.style.background = 'transparent'; b.style.color = '#cbd5e1'; };
            b.onclick = () => {
                panel.remove();
                this.actionImportAssetToProjectId(tplId, proj.project_id);
            };
            panel.appendChild(b);
        });

        // Divider
        const hr = document.createElement('div');
        hr.style.cssText = 'border-top:1px solid #334155;margin:2px 0;';
        panel.appendChild(hr);

        // + New Project
        const newBtn = document.createElement('button');
        newBtn.style.cssText = 'text-align:left;width:100%;padding:6px 12px;font-size:10px;font-weight:600;color:#34d399;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;';
        newBtn.innerHTML = '＋ New Project…';
        newBtn.onmouseover = () => { newBtn.style.background = '#059669'; newBtn.style.color = '#fff'; };
        newBtn.onmouseout  = () => { newBtn.style.background = 'transparent'; newBtn.style.color = '#34d399'; };
        newBtn.onclick = () => {
            panel.remove();
            this.actionImportAssetToNewProject(tplId);
        };
        panel.appendChild(newBtn);

        document.body.appendChild(panel);

        // Auto-close on outside click or scroll
        const close = (e) => {
            if (!panel.contains(e.target) && e.target !== btn) {
                panel.remove();
                document.removeEventListener('mousedown', close, true);
                document.removeEventListener('scroll', close, true);
            }
        };
        // Slight delay so the current click doesn't immediately close
        setTimeout(() => {
            document.addEventListener('mousedown', close, true);
            document.addEventListener('scroll', close, { capture: true, passive: true });
        }, 0);
    }

    // ─────────────────────────────────────────────
    // MAP SHARING
    // ─────────────────────────────────────────────

    /** Generate a UUID v4 */
    _generateToken() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    /**
     * Share a page by writing its full payload to shared_maps/{token}.
     * Cloud-vault only — local pages cannot be served publicly.
     */
    async actionSharePage(mapId) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === mapId);
        if (!page) return alert('Page not found in library.');

        const user = window.FirebaseAuth?.currentUser;
        if (!user) {
            return alert('You must be signed in (even as a guest) to share maps.');
        }

        // Expiry prompt
        const expiryChoice = prompt(
            `Share "${page.meta?.title || 'Untitled'}":\n` +
            `Choose link expiry:\n` +
            `  1. No expiry\n` +
            `  2. 7 days\n` +
            `  3. 30 days\n` +
            `  4. 90 days\n` +
            `Enter 1–4:`, '1'
        );
        if (!expiryChoice) return;
        const expiryDays = { '2': 7, '3': 30, '4': 90 }[expiryChoice.trim()] || null;
        const shareExpires = expiryDays
            ? new Date(Date.now() + expiryDays * 86400000).toISOString()
            : null;

        const token = this._generateToken();

        // Deep clone without transient session data
        const payload = JSON.parse(JSON.stringify(page));
        delete payload.session;
        payload.meta.shared = true;
        payload.meta.share_token = token;
        payload.meta.share_expires = shareExpires;
        payload.owner_uid = user.uid;
        payload.owner_display = user.displayName || user.email || 'Anonymous';

        try {
            const ref = window.Firestore.doc(window.FirebaseDb, 'shared_maps', token);
            await window.Firestore.setDoc(ref, payload);

            // Update the map's own metadata in the library
            page.meta.shared = true;
            page.meta.share_token = token;
            page.meta.share_expires = shareExpires;
            await this.kernel.saveConstellationToLibrary(page);

            const shareUrl = `${window.location.origin}/view.html?token=${token}`;
            this.showShareLinkPanel(shareUrl, page.meta?.title || 'Untitled');
        } catch (e) {
            console.error(e);
            alert('Failed to share map: ' + e.message);
        }
    }

    /**
     * Revoke sharing — delete the shared_maps document and clear meta flags.
     */
    async actionRevokeShare(mapId) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === mapId);
        if (!page || !page.meta?.share_token) return;

        if (!confirm(`Revoke the public link for "${page.meta?.title || 'Untitled'}"? The link will stop working immediately.`)) return;

        try {
            const ref = window.Firestore.doc(window.FirebaseDb, 'shared_maps', page.meta.share_token);
            await window.Firestore.deleteDoc(ref);

            page.meta.shared = false;
            page.meta.share_token = '';
            page.meta.share_expires = null;
            await this.kernel.saveConstellationToLibrary(page);

            this.render();
        } catch (e) {
            console.error(e);
            alert('Failed to revoke share: ' + e.message);
        }
    }

    /**
     * Fork a shared map into the viewer's workspace.
     * Guests fork to local browser storage; auth users fork to their active project.
     */
    async actionForkSharedMap(token) {
        try {
            const ref = window.Firestore.doc(window.FirebaseDb, 'shared_maps', token);
            const snap = await window.Firestore.getDoc(ref);
            if (!snap.exists()) return alert('This shared map no longer exists.');

            const data = snap.data();
            // Expiry check
            if (data.meta?.share_expires && new Date(data.meta.share_expires) < new Date()) {
                return alert('This shared link has expired.');
            }

            const cloned = JSON.parse(JSON.stringify(data));
            const newMapId = this.kernel.generateId();
            cloned.map_id = newMapId;
            cloned.meta.shared = false;
            cloned.meta.share_token = '';
            cloned.meta.share_expires = null;
            cloned.meta.title = (cloned.meta.title || 'Forked Map') + ' (fork)';
            cloned.meta.project_id = this.kernel.activeProjectId || 'default_project';
            delete cloned.owner_uid;
            delete cloned.owner_display;

            const saved = await this.kernel.saveConstellationToLibrary(cloned);
            if (saved === false) {
                // Guest hit local storage limit — prompt sign-up
                return alert('Local storage is full. Sign in to get more space.');
            }

            // Register under active project if possible
            const projects = this.kernel.getProjects();
            const proj = projects.find(p => p.project_id === cloned.meta.project_id);
            if (proj && !proj.page_ids.includes(newMapId)) {
                proj.page_ids.push(newMapId);
                if (!this.kernel.isUsingCloudVault()) {
                    localStorage.setItem('mm_projects', JSON.stringify(this.kernel.projects));
                }
            }

            alert(`"${cloned.meta.title}" forked to your workspace!`);
        } catch (e) {
            console.error(e);
            alert('Fork failed: ' + e.message);
        }
    }

    /**
     * Body-level panel showing the share URL with a copy button.
     * Dismisses on outside click.
     */
    showShareLinkPanel(url, title = 'Shared Map') {
        document.getElementById('mm-share-panel')?.remove();

        const panel = document.createElement('div');
        panel.id = 'mm-share-panel';
        panel.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
            font-family: inherit;
        `;

        panel.innerHTML = `
            <div style="background:#0f172a;border:1px solid #334155;border-radius:16px;padding:24px;max-width:480px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,0.7);display:flex;flex-direction:column;gap:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;font-size:14px;color:#e2e8f0;">🔗 Share Link</span>
                    <button id="mm-share-close" style="background:transparent;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:0 4px;">✕</button>
                </div>
                <div style="font-size:11px;color:#94a3b8;">"${title}" is now publicly accessible at:</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input id="mm-share-url" readonly value="${url}"
                        style="flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;font-size:11px;color:#cbd5e1;outline:none;font-family:monospace;">
                    <button id="mm-share-copy" style="background:#2563eb;border:none;border-radius:8px;padding:8px 14px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap;">Copy</button>
                </div>
                <div style="font-size:10px;color:#475569;">Anyone with this link can view and fork the map.</div>
            </div>
        `;

        document.body.appendChild(panel);

        panel.querySelector('#mm-share-copy').onclick = () => {
            navigator.clipboard.writeText(url).then(() => {
                const btn = panel.querySelector('#mm-share-copy');
                btn.textContent = 'Copied!';
                btn.style.background = '#16a34a';
                setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = '#2563eb'; }, 2000);
            });
        };

        const dismiss = (e) => {
            if (!panel.querySelector('div > div').contains(e.target)) {
                panel.remove();
            }
        };
        panel.querySelector('#mm-share-close').onclick = () => panel.remove();
        setTimeout(() => panel.addEventListener('mousedown', dismiss), 0);
    }

    async actionSaveCurrentToLibrary() {
        const copy = JSON.parse(JSON.stringify(this.kernel.state));
        copy.map_id = this.kernel.generateId();
        copy.meta.title = (copy.meta.title || "Untitled") + " (Copy)";
        const saved = await this.kernel.saveConstellationToLibrary(copy);
        if (saved !== false) {
            alert("Session saved to Library!");
            this.render(); 
        }
    }
    
    actionLoadFromLibrary(id) {
        const lib = this.kernel.getLibrary();
        const map = lib.find(m => m.map_id === id);
        if (map) { 
            this.kernel.activeProjectId = map.meta?.project_id || 'default_project';
            this.kernel.loadMapState(map); 
            this.setView('map');
            this.actionCloseDataManager();
        }
    }

    actionCloseDataManager() {
        const drawer = document.getElementById('data-manager-drawer');
        if (drawer) drawer.classList.add('translate-x-full');
    }

    actionSetActiveProject(projId) {
        this.kernel.activeProjectId = projId;
        const pages = this.kernel.getPages(projId);
        if (pages.length > 0) {
            const hasActivePage = pages.some(p => p.map_id === this.kernel.state.map_id);
            if (!hasActivePage) {
                this.kernel.loadMapState(pages[0]);
            }
        } else {
            this.kernel.state = this.kernel.getEmptyState();
            this.kernel.state.meta.project_id = projId;
            this.kernel.notify();
        }
        this.render();
    }

    async actionChangeVault(vault) {
        await this.kernel.setVault(vault);
        this.render();
    }

    actionCreateProject() {
        this.actionCreateProjectCustom();
    }

    actionPromptRenameProject(projId) {
        this.actionOpenProjectSettings(projId);
    }

    async actionDeleteProject(projId) {
        const projects = this.kernel.getProjects();
        const proj = projects.find(p => p.project_id === projId);
        if (!proj) return;

        const ok = await this.actionConfirm({
            title: "Delete Project",
            message: `Are you sure you want to delete the project "${proj.meta.title || 'Untitled'}" and all its pages? This action cannot be undone.`,
            confirmText: "Delete Project",
            isDestructive: true
        });
        if (ok) {
            this.kernel.deleteProject(projId);
        }
    }

    actionCreatePage() {
        this.actionCreatePageCustom();
    }

    actionPromptRenamePage(pageId) {
        this.actionOpenPageSettings(pageId);
    }

    async actionPromptCopyPage(pageId) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === pageId);
        if (page) {
            const pageTitle = page.meta?.title || "Page";
            const defaultProjName = `${pageTitle} Project`;
            const newProjName = await this.actionPrompt({
                title: "Copy Page to Project",
                label: "Enter a title for the new project to copy this page into:",
                defaultValue: defaultProjName
            });
            if (newProjName) {
                await this.kernel.clonePage(pageId, 'new', null, newProjName);
                this.render();
                alert(`Page copied into new project "${newProjName}"!`);
            }
        }
    }


    actionMovePageToProject(event, targetProjId) {
        event.preventDefault();
        const pageId = event.dataTransfer.getData("text/plain");
        if (!pageId) return;
        
        const projects = this.kernel.getProjects();
        let fromProjId = null;
        for (const p of projects) {
            if (p.page_ids && p.page_ids.includes(pageId)) {
                fromProjId = p.project_id;
                break;
            }
        }
        
        if (!fromProjId) {
            const lib = this.kernel.getLibrary();
            const page = lib.find(p => p.map_id === pageId);
            if (page) fromProjId = page.meta?.project_id || 'default_project';
        }
        
        if (fromProjId && fromProjId !== targetProjId) {
            this.kernel.movePage(pageId, fromProjId, targetProjId);
        }
    }

    actionDownloadProject() {
        const activeProjId = this.kernel.activeProjectId;
        const proj = this.kernel.getProjects().find(p => p.project_id === activeProjId);
        if (!proj) return;
        
        const pages = this.kernel.getPages(activeProjId);
        const payload = {
            type: "multimap_project",
            project: proj,
            pages: pages
        };
        
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        let safeTitle = proj.meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `multi_map_project_${safeTitle}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    actionUploadProjectOrPageFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.type === "multimap_project") {
                    await this.processProjectImport(parsed);
                } else {
                    await this.processMapImport(parsed, 'constellation');
                }
            } catch (err) {
                alert("Invalid JSON format.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    async processProjectImport(parsedData) {
        const { project, pages } = parsedData;
        if (!project || !project.project_id || !Array.isArray(pages)) {
            alert("Invalid project file format.");
            return;
        }
        
        if (!this.kernel.checkStorageLimit(1024 * pages.length)) return;
        
        let targetProjId = project.project_id;
        const existingProjects = this.kernel.getProjects();
        const conflict = existingProjects.some(p => p.project_id === targetProjId);
        
        if (conflict) {
            if (confirm(`Project "${project.meta.title}" already exists. Overwrite?`)) {
                await this.kernel.deleteProject(targetProjId);
            } else {
                targetProjId = this.kernel.generateId();
                project.project_id = targetProjId;
                project.meta.title += " (Copy)";
            }
        }
        
        project.page_ids = pages.map(p => p.map_id);
        project.created_at = new Date().toISOString();
        project.updated_at = new Date().toISOString();
        
        if (window.FirebaseAuth && window.FirebaseAuth.currentUser && !window.FirebaseAuth.currentUser.isAnonymous) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", targetProjId);
                await window.Firestore.setDoc(projRef, project);
                this.kernel.firestoreProjects.push(project);
                this.kernel.firestorePagesByProject[targetProjId] = [];
                
                for (const page of pages) {
                    if (!page.meta) page.meta = {};
                    page.meta.project_id = targetProjId;
                    const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", targetProjId, "pages", page.map_id);
                    await window.Firestore.setDoc(pageRef, page);
                    this.kernel.firestorePagesByProject[targetProjId].push(page);
                }
            } catch(e) {
                console.error("Firestore project import failed:", e);
            }
        } else {
            this.kernel.projects.push(project);
            localStorage.setItem("mm_projects", JSON.stringify(this.kernel.projects));
            
            let lib = this.kernel.getLibrary();
            for (const page of pages) {
                if (!page.meta) page.meta = {};
                page.meta.project_id = targetProjId;
                lib.push(page);
            }
            this.kernel.saveLibrary(lib);
        }
        
        this.kernel.activeProjectId = targetProjId;
        if (pages.length > 0) {
            this.kernel.loadMapState(pages[0]);
        }
        alert(`Project "${project.meta.title}" imported successfully!`);
        this.render();
    }
    
    async actionDeleteFromLibrary(id) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === id);
        const title = page?.meta?.title || "this page";

        const ok = await this.actionConfirm({
            title: "Delete Page",
            message: `Permanently delete "${title}"? This action cannot be undone.`,
            confirmText: "Delete Page",
            isDestructive: true
        });
        if (ok) {
            await this.kernel.deleteFromLibrary(id);
            this.render();
        }
    }

    actionDownloadLibrary() {
        const lib = this.kernel.getLibrary();
        if (!lib || lib.length === 0) { alert("Your library is empty."); return; }
        const json = JSON.stringify(lib, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `multi_map_library_export.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    actionDownloadSingleConstellation(id) {
        const lib = this.kernel.getLibrary();
        const map = lib.find(m => m.map_id === id);
        if (!map) return;
        const json = JSON.stringify(map, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        let safeTitle = (map.meta?.title || id).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `multi_map_map_${safeTitle}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    actionUpdateLibraryItem(id) {
        const titleInput = document.getElementById(`lib-title-${id}`);
        const notesInput = document.getElementById(`lib-notes-${id}`);
        const sharedInput = document.getElementById(`lib-shared-${id}`);
        if(titleInput) {
            this.kernel.updateLibraryItem(id, { title: titleInput.value, notes: notesInput.value, shared: sharedInput.checked });
            alert("Details Saved.");
            this.render();
        }
    }

    actionSyncJson() {
        try {
            const val = document.getElementById('json-exchange').value;
            this.kernel.loadMapState(JSON.parse(val));
            alert("Mapstate Applied Successfully.");
        } catch (e) { alert("Invalid JSON format."); }
    }

    actionCopyJson() {
        const val = document.getElementById('json-exchange');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val.value).then(() => alert("Copied to clipboard.")).catch(() => {
                val.select(); document.execCommand('copy'); alert("Copied to clipboard.");
            });
        } else {
            val.select(); document.execCommand('copy'); alert("Copied to clipboard.");
        }
    }
    
    actionSaveEndpoints() {
        this.kernel.bridge.pushUrl = document.getElementById('api-push-url').value;
        this.kernel.bridge.pullUrl = document.getElementById('api-pull-url').value;
        alert(`Endpoints mapped temporarily.`);
    }
    actionPushApi() { alert(`POST to ${this.kernel.bridge.pushUrl}`); }
    actionPullApi() { alert(`GET from ${this.kernel.bridge.pullUrl}`); }
    
    actionExportJsonFile() {
        const json = this.kernel.exportMapState();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MultiMap_active_map_${this.kernel.state.map_id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    actionImportJsonFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try { this.kernel.loadMapState(JSON.parse(e.target.result)); alert("Mapstate Imported."); this.render(); } 
            catch (err) { alert("Invalid JSON file."); }
        };
        reader.readAsText(file);
        event.target.value = ''; 
    }

    render() {
        this.updatePhaseButtons();
        this.updateSmartActionButton();
        
        // Update breadcrumbs in navbar
        const mapTitleEl = document.getElementById('map-title');
        if (mapTitleEl) {
            const activeProjId = this.kernel.activeProjectId;
            const projects = this.kernel.getProjects();
            const proj = projects.find(p => p.project_id === activeProjId) || { meta: { title: "My Project" } };
            const projTitle = proj.meta?.title || "My Project";
            const pageTitle = this.kernel.state.meta?.title || "Untitled Space";
            mapTitleEl.innerHTML = `<span class="opacity-65 hover:text-purple-400 cursor-pointer transition-colors" onclick="toggleDrawer('data-manager-drawer')">${this.escapeHTML(projTitle)}</span> <span class="mx-1 text-slate-500">›</span> <span class="text-white">${this.escapeHTML(pageTitle)}</span>`;
        }

        const inspector = this.registry.get('inspector');
        if (inspector && this.dom.panelProperties) inspector.render(this.dom.panelProperties, this.kernel.state);

        // Auto-update Data Manager drawer if it is currently open
        const dataDrawer = document.getElementById('data-manager-drawer');
        if (dataDrawer && !dataDrawer.classList.contains('translate-x-full')) {
            const dmContent = document.getElementById('data-manager-content');
            if (dmContent && window.Auth) {
                window.Auth.renderDataManager(dmContent);
            }
        }

        if (this.viewMode === 'map') {
            this.dom.viewMap.style.display = 'block';
            this.dom.viewContent.style.display = 'none';
            this.renderMap(this.kernel.state);
        } else {
            this.dom.viewMap.style.display = 'none';
            this.dom.viewContent.style.display = 'block';
            const eng = this.registry.get(this.viewMode);
            if (eng) eng.render(this.dom.viewContent, this.kernel.state);
        }
    }

    renderMap(state) {
        if (!state.nodes || !state.session) return;
        this.updateTransform();

        const selId = state.session.selectedId;

        const structuralEdges = state.connections.filter(c => c.type === 'structural');
        // True roots = nodes with no incoming structural edges (used for root highlight in selection mode)
        const hasIncomingEdge = new Set(structuralEdges.map(e => e.to));
        const trueRootIds = new Set(state.nodes.filter(n => !hasIncomingEdge.has(n.id)).map(n => n.id));

        // Compute absolute depth of each node from the root node(s) for depth auto-collapse
        const depth = new Map();
        trueRootIds.forEach(id => depth.set(id, 0));
        let depthQueue = [...trueRootIds];
        while (depthQueue.length > 0) {
            const curr = depthQueue.shift();
            const currDepth = depth.get(curr);
            const kids = structuralEdges.filter(c => c.from === curr).map(c => c.to);
            for (const kid of kids) {
                if (!depth.has(kid)) {
                    depth.set(kid, currDepth + 1);
                    depthQueue.push(kid);
                }
            }
        }

        // Active focal nodes calculation
        let focalNodes = [];
        if (state.session.selectedId) {
            focalNodes = [state.session.selectedId];
        } else {
            focalNodes = state.nodes.filter(n => !hasIncomingEdge.has(n.id)).map(n => n.id);
            if (focalNodes.length === 0 && state.nodes.length > 0) {
                focalNodes = [state.nodes[0].id];
            }
        }

        const distances = new Map();
        focalNodes.forEach(id => distances.set(id, 0));
        let q = [...focalNodes];
        
        const adj = new Map();
        state.nodes.forEach(n => adj.set(n.id, []));
        structuralEdges.forEach(e => {
            if (adj.has(e.from)) adj.get(e.from).push(e.to); // Directed: downstream only
        });

        while(q.length > 0) {
            const curr = q.shift();
            const currDist = distances.get(curr);
            const neighbors = adj.get(curr) || [];
            for (const nxt of neighbors) {
                if (!distances.has(nxt)) {
                    distances.set(nxt, currDist + 1);
                    q.push(nxt);
                }
            }
        }

        // Path Nodes calculation (ancestors + selected/highlighted node)
        const pathNodes = new Set();
        const highlightNodeId = this.activeSearchHighlight ? this.activeSearchHighlight.nodeId : null;
        const activeFocalId = state.session.selectedId || highlightNodeId;

        if (activeFocalId) {
            let currId = activeFocalId;
            while (currId) {
                pathNodes.add(currId);
                const parentEdge = structuralEdges.find(e => e.to === currId);
                currId = parentEdge ? parentEdge.from : null;
            }
        }

        const autoCollapseDepth = this.kernel.config.autoCollapseDepth || 3;

        // Auto-collapse logic matching TODO specs
        const isNodeCollapsed = (nid) => {
            const n = state.nodes.find(node => node.id === nid);
            if (!n) return false;
            
            // 1. Manual collapse takes precedence
            if (n.data.collapsed === true) return true;
            
            // 2. Selection-driven collapse/re-expansion if a selection/highlight is active
            if (activeFocalId) {
                if (pathNodes.has(nid)) {
                    return false; // fully expanded path node
                }
                
                // Downstream of selection
                if (distances.has(nid)) {
                    const distVal = distances.get(nid);
                    if (distVal >= autoCollapseDepth) {
                        return !n.data.expanded; // collapsed beyond threshold unless explicitly expanded
                    }
                    return false;
                }
                
                // Sibling branch (neither on path nor downstream of selection)
                return true; // collapsed
            }
            
            // 3. Depth-based auto-collapse if no selection is active
            const depthVal = depth.has(nid) ? depth.get(nid) : 0;
            if (depthVal >= autoCollapseDepth) {
                return !n.data.expanded;
            }
            return false;
        };

        const visibleNodes = new Set();
        state.nodes.forEach(n => visibleNodes.add(n.id));

        state.nodes.forEach(n => {
            if (isNodeCollapsed(n.id)) {
                // Sibling branch nodes are collapsed (fade to 20% opacity), but they do NOT prune their subtrees
                const isSiblingBranch = activeFocalId && !pathNodes.has(n.id) && !distances.has(n.id) && n.data.collapsed !== true;
                if (isSiblingBranch) {
                    return;
                }
                
                const queue = [n.id];
                while(queue.length > 0) {
                    const curr = queue.shift();
                    const kids = state.connections.filter(c => c.from === curr && c.type === 'structural').map(c => c.to);
                    kids.forEach(k => { visibleNodes.delete(k); queue.push(k); });
                }
            }
        });

        let structuredCoords = null;
        if (state.session.layoutMode === 'structured') {
            structuredCoords = new Map();
            const vSpacing = 280;
            const hSpacing = 320;
            // Reuse trueRootIds computed above
            const trueRootsArr = [...trueRootIds];
            if (trueRootsArr.length === 0 && state.nodes.length > 0) trueRootsArr.push(state.nodes[0].id);

            let currentX = 0;
            const calculateSubtree = (nodeId, depth) => {
                const kids = structuralEdges.filter(c => c.from === nodeId).map(c => c.to);
                if (kids.length === 0) {
                    const x = currentX;
                    currentX += hSpacing;
                    structuredCoords.set(nodeId, { x, y: depth * vSpacing });
                    return x;
                } else {
                    const childrenX = kids.map(k => calculateSubtree(k, depth + 1));
                    const x = (childrenX[0] + childrenX[childrenX.length - 1]) / 2;
                    structuredCoords.set(nodeId, { x, y: depth * vSpacing });
                    return x;
                }
            };
            
            trueRootsArr.forEach(root => { calculateSubtree(root, 0); currentX += hSpacing; });
            state.nodes.forEach(n => {
                if (!structuredCoords.has(n.id)) {
                    structuredCoords.set(n.id, { x: currentX, y: 0 });
                    currentX += hSpacing;
                }
            });
        }
        
        this._focalNodes = focalNodes;
        this._focalDistances = distances;
        this._structuredCoords = structuredCoords;

        this.dom.edgeSvg.innerHTML = '';
        state.connections.forEach(c => {
            if (visibleNodes.has(c.from) && visibleNodes.has(c.to)) {
                const s = state.nodes.find(n => n.id === c.from), t = state.nodes.find(n => n.id === c.to);
                if (s && t) {
                    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    const sp = this.getVisualPos(s);
                    const tp = this.getVisualPos(t);
                    l.setAttribute("x1", sp.x); l.setAttribute("y1", sp.y);
                    l.setAttribute("x2", tp.x); l.setAttribute("y2", tp.y);
                    l.setAttribute("class", "edge-vis");
                    if (c.type === 'association') l.style.strokeDasharray = "5,5";
                    
                    const isLinking = this.kernel.linkingMode;
                    const distS = distances.has(s.id) ? distances.get(s.id) : -1;
                    const distT = distances.has(t.id) ? distances.get(t.id) : -1;
                    
                    const onPathOrDownstreamS = pathNodes.has(s.id) || distances.has(s.id);
                    const onPathOrDownstreamT = pathNodes.has(t.id) || distances.has(t.id);
                    
                    if (!isLinking && activeFocalId && (!onPathOrDownstreamS || !onPathOrDownstreamT)) {
                        l.style.strokeOpacity = "0.2"; // Sibling branch edges are faded to 20%
                    } else if (!isLinking && (distS === -1 || distT === -1)) {
                        l.style.strokeOpacity = "0.48";
                    }
                    this.dom.edgeSvg.appendChild(l);
                }
            }
        });

        const existingNodes = new Map();
        Array.from(this.dom.worldLayer.children).forEach(el => {
            if (el.dataset.nodeId) existingNodes.set(el.dataset.nodeId, el);
        });
        const newNodes = new Set();

        state.nodes.forEach(node => {
            if (!visibleNodes.has(node.id)) return;
            newNodes.add(node.id);

            let el = existingNodes.get(node.id);
            if (!el) {
                el = document.createElement('div');
                this.dom.worldLayer.appendChild(el);
            }
            
            el.className = `node ${node.id === selId ? 'selected' : ''}`;
            
            const isLinking = this.kernel.linkingMode;
            const dist = distances.has(node.id) ? distances.get(node.id) : -1;
            let scale, color;
            if (isLinking) {
                scale = 1.0;
                color = '#38bdf8';
                el.style.opacity = '1';
                el.style.backgroundColor = `rgba(30, 41, 59, 0.95)`;
            } else if (dist === -1) {
                // Background (upstream / unrelated) nodes
                const isRoot = trueRootIds.has(node.id) && state.session.selectedId;
                const isSibling = activeFocalId && !pathNodes.has(node.id);
                
                if (isRoot) {
                    // Root node gets a slightly bigger, brighter treatment so it stays findable
                    scale = 0.85;
                    color = '#e2e8f0';
                    el.style.opacity = '0.85';
                    el.style.backgroundColor = `rgba(30, 41, 59, 0.75)`;
                } else if (isSibling) {
                    // Sibling branches fade to 20% opacity
                    scale = 0.5;
                    color = '#475569';
                    el.style.opacity = '0.2';
                    el.style.backgroundColor = `rgba(30, 41, 59, 0.2)`;
                } else {
                    scale = 0.8;
                    color = '#cbd5e1';
                    el.style.opacity = '0.9';
                    el.style.backgroundColor = `rgba(30, 41, 59, 0.7)`;
                }
            } else {
                scale = Math.max(0.3, 1.4 * Math.pow(0.7, dist));
                const layerColors = ['#ffffff', '#a855f7', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];
                color = layerColors[dist % layerColors.length];
                el.style.opacity = '1';
                const alpha = Math.max(0.1, 0.95 - (dist * 0.2));
                el.style.backgroundColor = `rgba(30, 41, 59, ${alpha})`;
            }
            
            el.dataset.nodeScale = scale;
            el.dataset.nodeDist = dist;
            el.dataset.forceLabel = isLinking ? 'true' : 'false';
            
            const vpPos = this.getVisualPos(node);
            el.style.left = `${vpPos.x}px`;
            el.style.top = `${vpPos.y}px`;
            el.style.transform = `translate(-50%, -50%) scale(${scale})`;
            el.dataset.nodeId = node.id;
            
            el.style.borderColor = color;
            if (dist !== -1) {
                el.style.boxShadow = `0 0 10px ${color}40`;
            } else {
                const isRoot = trueRootIds.has(node.id) && state.session.selectedId;
                const isSibling = activeFocalId && !pathNodes.has(node.id);
                if (isRoot) {
                    el.style.boxShadow = `0 0 12px ${color}60`;
                } else if (isSibling) {
                    el.style.boxShadow = 'none';
                } else {
                    el.style.boxShadow = `0 0 8px ${color}30`;
                }
            }
            
            if (node.data.isCore && dist !== -1) el.style.borderColor = '#ea580c';
            if ((node.type === 'portal' || node.type === 'smart-portal') && dist !== -1) {
                el.style.borderColor = '#a855f7';
                if (this.aiImportMode && node.type === 'smart-portal') {
                    el.style.boxShadow = "0 0 25px rgba(129,140,248, 0.8)";
                    el.classList.add('animate-pulse');
                }
            }

            // Smart-action halo: breathing glow for nodes with button actions
            const halo = this.getSmartActionHalo(node.type);
            if (halo && dist !== -1 && !this.aiImportMode) {
                el.classList.add('smart-action-halo');
                el.style.setProperty('--halo-color', halo);
            } else {
                el.classList.remove('smart-action-halo');
                el.style.removeProperty('--halo-color');
            }
            
            const collapsed = isNodeCollapsed(node.id);
            if (collapsed) el.classList.add('collapsed');
            else el.classList.remove('collapsed');
            
            const bp = this.kernel.getBlueprint(node.type);
            let labelEl = el.querySelector('.node-label');
            let iconEl = el.querySelector('.node-icon');
            if (!labelEl) {
                el.innerHTML = `<div class="node-icon"></div><div class="node-label"></div>`;
                labelEl = el.querySelector('.node-label');
                iconEl = el.querySelector('.node-icon');
                labelEl.style.transition = 'opacity 0.2s, transform 0.2s';
            }
            iconEl.innerHTML = bp.icon;
            labelEl.innerHTML = node.title;

            el.querySelectorAll('.moon-btn').forEach(m => m.remove());

            if (collapsed) {
                const children = state.connections
                    .filter(c => c.from === node.id && c.type === 'structural')
                    .map(c => state.nodes.find(n => n.id === c.to));
                
                children.forEach((child, i) => {
                    if(!child) return;
                    const angle = (i / children.length) * Math.PI * 2;
                    const mx = Math.cos(angle) * 55;
                    const my = Math.sin(angle) * 55;
                    
                    const moon = document.createElement('div');
                    moon.className = "moon-btn absolute w-6 h-6 bg-slate-800 border border-slate-500 rounded-full flex items-center justify-center text-[10px] cursor-pointer hover:bg-sky-600 hover:scale-125 transition-all shadow-md z-50";
                    moon.style.left = `calc(50% + ${mx}px - 12px)`;
                    moon.style.top = `calc(50% + ${my}px - 12px)`;
                    moon.style.pointerEvents = "auto";
                    
                    moon.innerHTML = this.kernel.getBlueprint(child.type).icon;
                    moon.onpointerdown = (e) => {
                        e.stopPropagation();
                        this.kernel.updateNode(node.id, { data: { ...node.data, collapsed: false, expanded: true }});
                        this.kernel.selectNode(child.id);
                        this.render();
                    };
                    el.appendChild(moon);
                });
            }
        });
        
        existingNodes.forEach((el, id) => {
            if (!newNodes.has(id)) el.remove();
        });

        state.nodes.forEach(node => {
            if (!visibleNodes.has(node.id)) return;
            const el = this.dom.worldLayer.querySelector(`[data-node-id="${node.id}"]`);
            if(!el) return;

            let startX = 0, startY = 0;
            el.onpointerdown = (e) => {
                if(e.target.closest('.radial-btn') || e.target.closest('.moon-btn')) return; 
                e.stopPropagation();
                el.setPointerCapture(e.pointerId);
                startX = e.clientX; startY = e.clientY;
                this.draggedNode = node;
                this.lastMouse = { x: e.clientX, y: e.clientY };
                
                if (selId === node.id) {
                    if (this.dom.radialMenu.classList.contains('active')) {
                        this.hideRadialMenu(true);
                    } else {
                        this.showRadialMenu(node);
                    }
                } else {
                    this.kernel.selectNode(node.id);
                    this.showRadialMenu(node);
                }
                this.userHasPanned = false; 
            };
            
            el.onpointerup = (e) => {
                if(e.target.closest('.radial-btn') || e.target.closest('.moon-btn')) return;
                e.stopPropagation();
                el.releasePointerCapture(e.pointerId);
                this.draggedNode = null;
                const pointerDist = Math.hypot(e.clientX - startX, e.clientY - startY);
                
                if (pointerDist < 5) {
                    if (window.innerWidth <= 768 && this.dom.sidebar && !this.dom.sidebar.classList.contains('open')) {
                        this.toggleSidebar();
                    }
                }
            };

            this.dom.worldLayer.appendChild(el);
            
            if (selId === node.id && this.dom.radialMenu.classList.contains('active')) {
                const isLinking = this.kernel.linkingMode;
                const stateHash = `${node.id}-${node.type}-${isLinking}-${this.kernel.linkingSourceId === node.id}-${this.aiImportMode}-${this.parentSelectMode}`;
                if (this.dom.radialMenu.dataset.activeNode !== stateHash) {
                    this.showRadialMenu(node);
                }
                this.updateMenuPosition(node);
            }
        });
        
        this.updateTransform();
    }

    // Returns the halo colour (rgba string) for node types that spawn a smart button action,
    // or null for types that don't.
    getSmartActionHalo(type) {
        if (type === 'portal' || type === 'smart-portal') return 'rgba(16,185,129,0.5)';  // emerald
        if (type === 'person-root')                       return 'rgba(99,102,241,0.5)';  // indigo
        if (type === 'web-root' || type.startsWith('web-')) return 'rgba(14,165,233,0.5)'; // sky
        if (type === 'prompt-root')                       return 'rgba(217,119,6,0.5)';   // amber
        if (type === 'agent-root')                        return 'rgba(225,29,72,0.5)';   // rose
        return null;
    }

    updatePhaseButtons() {
        if (!this.kernel || !this.kernel.state) return;
        const currentMapType = (this.kernel.state.meta && this.kernel.state.meta.type) ? this.kernel.state.meta.type : 'generic';
        const portalNodes = this.kernel.state.nodes.filter(n => n.type === 'portal' || n.type === 'smart-portal');
        
        const lib = this.kernel.getLibrary();
        const targetMapTypes = new Set();
        portalNodes.forEach(n => {
            const targetMap = lib.find(m => m.map_id === n.content);
            if (targetMap && targetMap.meta && targetMap.meta.type) {
                targetMapTypes.add(targetMap.meta.type);
            }
        });

        const typesToCheck = ['web', 'prompt', 'agent', 'person'];
        typesToCheck.forEach(type => {
            const btn = document.getElementById(`btn-phase-${type}`);
            if (btn) {
                const shouldShow = currentMapType === type || targetMapTypes.has(type);
                if (shouldShow) {
                    btn.style.display = 'flex';
                } else {
                    btn.style.display = 'none';
                }
            }
        });
    }

    hasSmartAction() {
        const selectedId = this.kernel.state.session.selectedId;
        const selectedNode = this.kernel.state.nodes.find(n => n.id === selectedId);
        const canExit = this.kernel.portalHistory && this.kernel.portalHistory.length > 0;
        if (selectedNode && this.viewMode === 'map') {
            const type = selectedNode.type;
            if (['portal', 'smart-portal', 'person-root', 'web-root', 'prompt-root', 'agent-root'].includes(type) || type.startsWith('web-')) {
                return true;
            }
        }
        return !!canExit;
    }

    updateSmartActionButton() {
        const btn = document.getElementById('btn-smart-action');
        const tooltipBar = document.getElementById('ai-tooltip-bar');
        const tooltipContent = document.getElementById('ai-tooltip-content');
        const tooltipActions = document.getElementById('ai-tooltip-actions');
        
        if (!btn || !tooltipBar) return;

        const selectedId = this.kernel.state.session.selectedId;
        const selectedNode = this.kernel.state.nodes.find(n => n.id === selectedId);
        const canExit = this.kernel.portalHistory && this.kernel.portalHistory.length > 0;

        let action = null;
        let text = '';
        let themeClasses = '';
        
        // Check for node-specific actions first
        if (selectedNode && this.viewMode === 'map') {
            const type = selectedNode.type;
            if (type === 'portal' || type === 'smart-portal') {
                action = () => this.actionEnterPortal(selectedNode.id);
                const hasTarget = !!selectedNode.content;
                text = hasTarget ? 'Enter Portal ➔' : 'Set Target 🎯';
                themeClasses = hasTarget 
                    ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-emerald-100 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    : 'bg-purple-650 hover:bg-purple-500 border-purple-400 text-purple-100 hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]';
            } else if (type === 'person-root') {
                action = () => this.setView('person');
                text = 'View Profile 👤';
                themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
            } else if (type === 'web-root' || type.startsWith('web-')) {
                action = () => this.setView('web');
                text = 'Visual Editor 🌐';
                themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
            } else if (type === 'prompt-root') {
                action = () => this.setView('prompt');
                text = 'Run Chain 💬';
                themeClasses = 'bg-amber-600 hover:bg-amber-500 border-amber-400 text-amber-100 hover:text-white shadow-[0_0_15px_rgba(217,119,6,0.4)]';
            } else if (type === 'agent-root') {
                action = () => this.setView('agent');
                text = 'Configure Agent 🤖';
                themeClasses = 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-rose-100 hover:text-white shadow-[0_0_15px_rgba(225,29,72,0.4)]';
            }
        }

        // Fall back to general state/navigation actions
        if (!action && canExit) {
            action = () => this.actionExitPortal();
            text = 'Exit Portal ❮';
            themeClasses = 'bg-purple-600 hover:bg-purple-500 border-purple-400 text-purple-100 hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]';
        }

        const tutorialActive = window.Tutorials && window.Tutorials.isActive;

        if (action && !tutorialActive) {
            btn.className = `text-xs font-bold uppercase tracking-widest px-6 py-3 rounded-full border shadow-lg transition-all flex items-center gap-2 ${themeClasses}`;
            btn.innerHTML = text;
            btn.onclick = (e) => {
                e.stopPropagation();
                action();
            };
            btn.classList.remove('hidden');

            if (tooltipContent) tooltipContent.classList.add('hidden');
            if (tooltipActions) tooltipActions.classList.add('hidden');

            tooltipBar.className = tooltipBar.className.replace(/mb-\d+|bottom-\d+/g, '').trim() + ' bottom-6';
            tooltipBar.classList.remove('hidden', 'translate-x-4', 'opacity-0');
        } else {
            btn.classList.add('hidden');
            if (!tutorialActive) {
                // If the tooltip was only showing the smart button, hide it
                if (tooltipContent && tooltipContent.classList.contains('hidden')) {
                    tooltipBar.classList.add('translate-x-4', 'opacity-0');
                    setTimeout(() => {
                        if (btn.classList.contains('hidden') && tooltipContent.classList.contains('hidden')) {
                            tooltipBar.classList.add('hidden');
                        }
                    }, 300);
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // NATIVE-STYLED MODAL DIALOGS SYSTEM
    // ─────────────────────────────────────────────

    /**
     * Show a beautiful custom modal dialog.
     * Returns a Promise resolving to the action clicked, or null if dismissed.
     */
    showDialogModal({ title, contentHtml, actionsHtml, onRender }) {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = "fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm transition-all duration-300 opacity-0 pointer-events-auto";
            backdrop.style.fontFamily = "inherit";
            backdrop.innerHTML = `
                <div class="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.8)] w-full max-w-lg mx-4 overflow-hidden transform scale-95 transition-all duration-300 flex flex-col max-h-[90vh]">
                    <!-- Header -->
                    <div class="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/30 shrink-0">
                        <h3 class="text-slate-200 font-bold text-xs uppercase tracking-wider flex items-center gap-2">${title}</h3>
                        <button class="close-btn text-slate-400 hover:text-white transition-colors p-1 text-base leading-none">✕</button>
                    </div>
                    <!-- Body -->
                    <div class="px-6 py-5 overflow-y-auto custom-scrollbar flex-1 text-slate-300 text-xs">
                        ${contentHtml}
                    </div>
                    <!-- Footer / Actions -->
                    <div class="px-6 py-4 border-t border-slate-800 bg-slate-950/20 flex flex-wrap justify-end gap-2 shrink-0">
                        ${actionsHtml}
                    </div>
                </div>
            `;
            document.body.appendChild(backdrop);
            
            // Trigger animation
            requestAnimationFrame(() => {
                backdrop.classList.remove('opacity-0');
                backdrop.querySelector('div').classList.remove('scale-95');
            });
            
            const close = (val) => {
                backdrop.classList.add('opacity-0');
                backdrop.querySelector('div').classList.add('scale-95');
                setTimeout(() => {
                    backdrop.remove();
                    resolve(val);
                }, 300);
            };
            
            backdrop.querySelector('.close-btn').onclick = () => close(null);
            backdrop.onclick = (e) => {
                if (e.target === backdrop) close(null);
            };
            
            if (onRender) {
                onRender(backdrop, close);
            }
        });
    }

    /** Replaces standard confirm() */
    actionConfirm({ title, message, confirmText = "Confirm", cancelText = "Cancel", isDestructive = false }) {
        return this.showDialogModal({
            title: title || "Confirm Action",
            contentHtml: `<div class="text-slate-300 text-sm leading-relaxed">${message}</div>`,
            actionsHtml: `
                <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">${cancelText}</button>
                <button class="confirm-btn px-4 py-2 ${isDestructive ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/30' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/30'} rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">${confirmText}</button>
            `,
            onRender: (el, close) => {
                el.querySelector('.cancel-btn').onclick = () => close(false);
                el.querySelector('.confirm-btn').onclick = () => close(true);
            }
        });
    }

    /** Replaces standard prompt() */
    actionPrompt({ title, label, defaultValue = "", placeholder = "" }) {
        return this.showDialogModal({
            title: title || "Input Required",
            contentHtml: `
                <div class="flex flex-col gap-2">
                    ${label ? `<label class="text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">${label}</label>` : ''}
                    <input type="text" id="prompt-input" value="${defaultValue}" placeholder="${placeholder}" class="bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
            `,
            actionsHtml: `
                <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>
                <button class="confirm-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">OK</button>
            `,
            onRender: (el, close) => {
                const input = el.querySelector('#prompt-input');
                input.focus();
                input.select();
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') close(input.value);
                    if (e.key === 'Escape') close(null);
                };
                el.querySelector('.cancel-btn').onclick = () => close(null);
                el.querySelector('.confirm-btn').onclick = () => close(input.value);
            }
        });
    }

    /**
     * Unified Page Settings & Sharing Modal.
     * Replaces rename prompt, copy prompt, share prompt, delete confirmation, and loading button.
     */
    actionOpenPageSettings(pageId) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === pageId);
        if (!page) return alert('Page not found in library.');

        const initialTitle = page.meta?.title || "Untitled Page";
        const initialType = page.meta?.type || "generic";
        const storageText = page.meta?.storage_target === 'google_drive' ? '🔺 Google Drive' : (page.meta?.storage_target === 'local_os' ? '📁 Local OS' : '☁️ Cloud Vault / Local Database');

        const contentHtml = `
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Name</label>
                    <input type="text" id="settings-page-title" value="${initialTitle}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Type</label>
                    <select id="settings-page-type" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                        <option value="generic" ${initialType === 'generic' ? 'selected' : ''}>Generic Map</option>
                        <option value="web" ${initialType === 'web' ? 'selected' : ''}>Web Architect</option>
                        <option value="person" ${initialType === 'person' ? 'selected' : ''}>Person Profile</option>
                        <option value="prompt" ${initialType === 'prompt' ? 'selected' : ''}>Prompt Engine</option>
                        <option value="agent" ${initialType === 'agent' ? 'selected' : ''}>Agent Config</option>
                        <option value="file-root" ${initialType === 'file-root' ? 'selected' : ''}>File Root</option>
                        <option value="file-document" ${initialType === 'file-document' ? 'selected' : ''}>File Document</option>
                    </select>
                </div>

                <div class="flex items-center justify-between text-[10px] text-slate-500 px-1">
                    <span>Storage Target:</span>
                    <span class="font-bold text-slate-400">${storageText}</span>
                </div>

                <div class="h-px bg-slate-800/80 my-1"></div>

                <!-- Sharing Panel Section (updated dynamically) -->
                <div id="settings-share-section" class="flex flex-col gap-2 bg-slate-950/40 border border-slate-800/80 rounded-xl p-3">
                    <!-- Populated dynamically -->
                </div>
            </div>
        `;

        const actionsHtml = `
            <div class="flex w-full justify-between items-center gap-2 flex-wrap">
                <div class="flex gap-2">
                    <button id="settings-btn-load" class="bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold py-2 px-3.5 rounded-lg transition-colors shadow-lg shadow-sky-950/20 uppercase tracking-wide">Load Map</button>
                    <button id="settings-btn-copy" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide">Copy Page</button>
                    <button id="settings-btn-dl" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide">JSON</button>
                    <button id="settings-btn-del" class="hover:bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:text-rose-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide">Delete</button>
                </div>
                <div class="flex gap-2">
                    <button id="settings-btn-save" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Save Details</button>
                </div>
            </div>
        `;

        this.showDialogModal({
            title: "Page Settings & Sharing",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, close) => {
                const titleInput = backdrop.querySelector('#settings-page-title');
                const typeSelect = backdrop.querySelector('#settings-page-type');
                
                // Helper to check if inputs are modified
                const isDirty = () => {
                    return titleInput.value.trim() !== initialTitle || typeSelect.value !== initialType;
                };

                // Sharing block update handler
                const updateShareSection = () => {
                    const shareSection = backdrop.querySelector('#settings-share-section');
                    const isLoggedIn = !!(window.FirebaseAuth?.currentUser);
                    
                    if (!isLoggedIn) {
                        shareSection.innerHTML = `
                            <div class="text-slate-500 text-center py-2 text-[10px] font-medium">
                                Sign in (even as a guest) required to share maps publicly.
                            </div>
                        `;
                        return;
                    }
                    
                    if (page.meta?.shared) {
                        const shareUrl = `${window.location.origin}/view.html?token=${page.meta.share_token}`;
                        shareSection.innerHTML = `
                            <div class="flex flex-col gap-2">
                                <div class="flex justify-between items-center">
                                    <span class="text-teal-400 font-bold uppercase text-[9px] tracking-wider">🔗 Active Share Link</span>
                                    ${page.meta.share_expires ? `<span class="text-[9px] text-slate-500">Expires: ${new Date(page.meta.share_expires).toLocaleDateString()}</span>` : '<span class="text-[9px] text-slate-500">Permanent Link</span>'}
                                </div>
                                <div class="flex gap-2 items-center">
                                    <input id="settings-share-url" readonly value="${shareUrl}" class="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-[10px] text-slate-400 font-mono outline-none">
                                    <button id="settings-btn-copy-url" class="bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-bold py-2 px-3.5 rounded-lg transition-colors">Copy</button>
                                    <button id="settings-btn-revoke" class="bg-rose-900/60 hover:bg-rose-800 text-rose-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors">Revoke</button>
                                </div>
                            </div>
                        `;
                        
                        shareSection.querySelector('#settings-btn-copy-url').onclick = () => {
                            navigator.clipboard.writeText(shareUrl).then(() => {
                                const btn = shareSection.querySelector('#settings-btn-copy-url');
                                btn.textContent = 'Copied!';
                                btn.className = "bg-green-600 text-white text-[10px] font-bold py-2 px-3.5 rounded-lg";
                                setTimeout(() => {
                                    btn.textContent = 'Copy';
                                    btn.className = "bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-bold py-2 px-3.5 rounded-lg transition-colors";
                                }, 2000);
                            });
                        };
                        
                        shareSection.querySelector('#settings-btn-revoke').onclick = async () => {
                            const confirmRevoke = await this.actionConfirm({
                                title: "Revoke Share Link",
                                message: `Are you sure you want to revoke the public share link for "${page.meta?.title || 'Untitled'}"? The link will stop working immediately.`,
                                confirmText: "Revoke",
                                cancelText: "Keep Active",
                                isDestructive: true
                            });
                            if (!confirmRevoke) return;
                            
                            try {
                                const ref = window.Firestore.doc(window.FirebaseDb, 'shared_maps', page.meta.share_token);
                                await window.Firestore.deleteDoc(ref);
                                
                                page.meta.shared = false;
                                page.meta.share_token = '';
                                page.meta.share_expires = null;
                                await this.kernel.saveConstellationToLibrary(page);
                                this.render();
                                updateShareSection();
                            } catch (e) {
                                console.error(e);
                                alert('Failed to revoke share link: ' + e.message);
                            }
                        };
                    } else {
                        shareSection.innerHTML = `
                            <div class="flex flex-col gap-2">
                                <span class="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">🔗 Share Map Publicly</span>
                                <div class="flex gap-2 items-center">
                                    <select id="settings-share-expiry" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none flex-1">
                                        <option value="1">No Expiry (Permanent)</option>
                                        <option value="2">7 Days Expiry</option>
                                        <option value="3">30 Days Expiry</option>
                                        <option value="4">90 Days Expiry</option>
                                    </select>
                                    <button id="settings-btn-share" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shrink-0 uppercase tracking-wide">Publish Link</button>
                                </div>
                            </div>
                        `;
                        
                        shareSection.querySelector('#settings-btn-share').onclick = async () => {
                            const user = window.FirebaseAuth?.currentUser;
                            if (!user) return alert('You must be signed in to share maps.');
                            
                            const expiryChoice = shareSection.querySelector('#settings-share-expiry').value;
                            const expiryDays = { '2': 7, '3': 30, '4': 90 }[expiryChoice] || null;
                            const shareExpires = expiryDays
                                ? new Date(Date.now() + expiryDays * 86400000).toISOString()
                                : null;
                                
                            const token = this._generateToken();
                            
                            const payload = JSON.parse(JSON.stringify(page));
                            delete payload.session;
                            payload.meta.shared = true;
                            payload.meta.share_token = token;
                            payload.meta.share_expires = shareExpires;
                            payload.owner_uid = user.uid;
                            payload.owner_display = user.displayName || user.email || 'Anonymous';
                            
                            try {
                                const ref = window.Firestore.doc(window.FirebaseDb, 'shared_maps', token);
                                await window.Firestore.setDoc(ref, payload);
                                
                                page.meta.shared = true;
                                page.meta.share_token = token;
                                page.meta.share_expires = shareExpires;
                                await this.kernel.saveConstellationToLibrary(page);
                                
                                this.render();
                                updateShareSection();
                            } catch (e) {
                                console.error(e);
                                alert('Failed to publish share link: ' + e.message);
                            }
                        };
                    }
                };

                // Initial share section build
                updateShareSection();

                // Setup Close / Cancel dirty checking
                const handleCancel = async () => {
                    if (isDirty()) {
                        const saveConfirm = await this.showDialogModal({
                            title: "Unsaved Changes",
                            contentHtml: `<div class="text-slate-300 text-sm leading-relaxed">You have unsaved changes to this page. Do you want to save them before closing?</div>`,
                            actionsHtml: `
                                <button class="discard-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Discard</button>
                                <button class="keep-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Keep Editing</button>
                                <button class="save-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider shadow-lg">Save & Close</button>
                            `,
                            onRender: (el, clsConfirm) => {
                                el.querySelector('.discard-btn').onclick = () => clsConfirm('discard');
                                el.querySelector('.keep-btn').onclick = () => clsConfirm('keep');
                                el.querySelector('.save-btn').onclick = () => clsConfirm('save');
                            }
                        });
                        
                        if (saveConfirm === 'save') {
                            await this.kernel.updateLibraryItem(pageId, { title: titleInput.value.trim(), type: typeSelect.value });
                            this.render();
                            close(true);
                        } else if (saveConfirm === 'discard') {
                            close(false);
                        }
                        // If 'keep', we do nothing and stay on the settings page modal!
                    } else {
                        close(false);
                    }
                };

                // Overrides backdrop click & default close button to check dirty state
                backdrop.querySelector('.close-btn').onclick = handleCancel;
                backdrop.onclick = (e) => { if (e.target === backdrop) handleCancel(); };

                // Load button action
                backdrop.querySelector('#settings-btn-load').onclick = async () => {
                    if (isDirty()) {
                        const saveConfirm = await this.showDialogModal({
                            title: "Unsaved Changes",
                            contentHtml: `<div class="text-slate-300 text-sm leading-relaxed">You have unsaved changes to this page. Do you want to save them before loading the map?</div>`,
                            actionsHtml: `
                                <button class="discard-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Discard</button>
                                <button class="keep-btn px-4 py-2 border border-slate-700 hover:bg-slate-850 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Keep Editing</button>
                                <button class="save-btn px-4 py-2 bg-indigo-650 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider shadow-lg">Save & Load</button>
                            `,
                            onRender: (el, clsConfirm) => {
                                el.querySelector('.discard-btn').onclick = () => clsConfirm('discard');
                                el.querySelector('.keep-btn').onclick = () => clsConfirm('keep');
                                el.querySelector('.save-btn').onclick = () => clsConfirm('save');
                            }
                        });
                        
                        if (saveConfirm === 'save') {
                            await this.kernel.updateLibraryItem(pageId, { title: titleInput.value.trim(), type: typeSelect.value });
                            this.render();
                            close(true);
                            this.actionLoadFromLibrary(pageId);
                        } else if (saveConfirm === 'discard') {
                            close(false);
                            this.actionLoadFromLibrary(pageId);
                        }
                        // If 'keep', stay in settings modal
                    } else {
                        close(false);
                        this.actionLoadFromLibrary(pageId);
                    }
                };

                // Copy Page action (triggers custom copy sub-modal)
                backdrop.querySelector('#settings-btn-copy').onclick = (e) => {
                    e.stopPropagation();
                    this.actionPromptCopyPageCustom(pageId, close);
                };

                // JSON download action
                backdrop.querySelector('#settings-btn-dl').onclick = () => {
                    this.actionDownloadSingleConstellation(pageId);
                };

                // Delete page action
                backdrop.querySelector('#settings-btn-del').onclick = async () => {
                    close(false);
                    this.actionDeleteFromLibrary(pageId);
                };

                // Save button action
                backdrop.querySelector('#settings-btn-save').onclick = async () => {
                    const newTitle = titleInput.value.trim();
                    const newType = typeSelect.value;
                    if (!newTitle) return alert("Title cannot be empty.");
                    
                    await this.kernel.updateLibraryItem(pageId, { title: newTitle, type: newType });
                    this.render();
                    close(true);
                };
            }
        });
    }

    /**
     * Unified Project Settings & Details Modal.
     * Replaces rename prompts and delete confirmation for projects.
     */
    actionOpenProjectSettings(projectId) {
        const projects = this.kernel.getProjects();
        const proj = projects.find(p => p.project_id === projectId);
        if (!proj) return;

        const initialTitle = proj.meta.title || "Untitled Project";
        const initialDesc = proj.meta.description || "";
        const initialIcon = proj.meta.icon || "📁";
        const initialColor = proj.meta.color || "#8b5cf6";

        const contentHtml = `
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Project Name</label>
                    <input type="text" id="settings-proj-title" value="${initialTitle}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Description</label>
                    <input type="text" id="settings-proj-desc" value="${initialDesc}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Emoji Icon</label>
                        <input type="text" id="settings-proj-icon" value="${initialIcon}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full text-center">
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Theme Color</label>
                        <div class="flex gap-2 items-center">
                            <input type="color" id="settings-proj-color" value="${initialColor}" class="bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs outline-none focus:border-indigo-500 transition-colors w-12 h-9 cursor-pointer">
                            <span id="settings-proj-color-text" class="text-[10px] font-mono text-slate-500">${initialColor}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const actionsHtml = `
            <div class="flex w-full justify-between items-center gap-2">
                <button id="settings-proj-btn-del" class="hover:bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:text-rose-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide">Delete Project</button>
                <div class="flex gap-2">
                    <button id="settings-proj-btn-save" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Save Details</button>
                </div>
            </div>
        `;

        this.showDialogModal({
            title: "Project Settings",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, close) => {
                const titleInput = backdrop.querySelector('#settings-proj-title');
                const descInput = backdrop.querySelector('#settings-proj-desc');
                const iconInput = backdrop.querySelector('#settings-proj-icon');
                const colorInput = backdrop.querySelector('#settings-proj-color');
                const colorText = backdrop.querySelector('#settings-proj-color-text');

                colorInput.oninput = () => { colorText.textContent = colorInput.value; };

                const isDirty = () => {
                    return titleInput.value.trim() !== initialTitle ||
                           descInput.value.trim() !== initialDesc ||
                           iconInput.value.trim() !== initialIcon ||
                           colorInput.value !== initialColor;
                };

                const handleCancel = async () => {
                    if (isDirty()) {
                        const saveConfirm = await this.showDialogModal({
                            title: "Unsaved Changes",
                            contentHtml: `<div class="text-slate-300 text-sm leading-relaxed">You have unsaved changes to this project. Do you want to save them before closing?</div>`,
                            actionsHtml: `
                                <button class="discard-btn px-4 py-2 border border-slate-700 hover:bg-slate-850 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Discard</button>
                                <button class="keep-btn px-4 py-2 border border-slate-700 hover:bg-slate-850 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Keep Editing</button>
                                <button class="save-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider shadow-lg">Save & Close</button>
                            `,
                            onRender: (el, clsConfirm) => {
                                el.querySelector('.discard-btn').onclick = () => clsConfirm('discard');
                                el.querySelector('.keep-btn').onclick = () => clsConfirm('keep');
                                el.querySelector('.save-btn').onclick = () => clsConfirm('save');
                            }
                        });
                        
                        if (saveConfirm === 'save') {
                            await this.kernel.renameProject(projectId, titleInput.value.trim(), descInput.value.trim(), iconInput.value.trim(), colorInput.value);
                            this.render();
                            close(true);
                        } else if (saveConfirm === 'discard') {
                            close(false);
                        }
                    } else {
                        close(false);
                    }
                };

                // Override closes
                backdrop.querySelector('.close-btn').onclick = handleCancel;
                backdrop.onclick = (e) => { if (e.target === backdrop) handleCancel(); };

                // Delete button
                backdrop.querySelector('#settings-proj-btn-del').onclick = async () => {
                    close(false);
                    this.actionDeleteProject(projectId);
                };

                // Save button
                backdrop.querySelector('#settings-proj-btn-save').onclick = async () => {
                    const newTitle = titleInput.value.trim();
                    const newDesc = descInput.value.trim();
                    const newIcon = iconInput.value.trim() || '📁';
                    const newColor = colorInput.value;
                    
                    if (!newTitle) return alert("Project name cannot be empty.");
                    
                    await this.kernel.renameProject(projectId, newTitle, newDesc, newIcon, newColor);
                    this.render();
                    close(true);
                };
            }
        });
    }

    /** Custom Modal Project Creation Form */
    actionCreateProjectCustom() {
        const contentHtml = `
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Project Name</label>
                    <input type="text" id="create-proj-title" value="New Project" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Description</label>
                    <input type="text" id="create-proj-desc" placeholder="Workspace details..." class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Emoji Icon</label>
                        <input type="text" id="create-proj-icon" value="📁" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full text-center">
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Theme Color</label>
                        <div class="flex gap-2 items-center">
                            <input type="color" id="create-proj-color" value="#8b5cf6" class="bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs outline-none focus:border-indigo-500 transition-colors w-12 h-9 cursor-pointer">
                            <span id="create-proj-color-text" class="text-[10px] font-mono text-slate-500">#8b5cf6</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const actionsHtml = `
            <button id="create-proj-btn-cancel" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel</button>
            <button id="create-proj-btn-save" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Create Project</button>
        `;

        this.showDialogModal({
            title: "Create New Project",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, close) => {
                const titleInput = backdrop.querySelector('#create-proj-title');
                const descInput = backdrop.querySelector('#create-proj-desc');
                const iconInput = backdrop.querySelector('#create-proj-icon');
                const colorInput = backdrop.querySelector('#create-proj-color');
                const colorText = backdrop.querySelector('#create-proj-color-text');

                titleInput.focus();
                titleInput.select();
                colorInput.oninput = () => { colorText.textContent = colorInput.value; };

                backdrop.querySelector('#create-proj-btn-cancel').onclick = () => close(null);
                backdrop.querySelector('#create-proj-btn-save').onclick = async () => {
                    const name = titleInput.value.trim();
                    const desc = descInput.value.trim();
                    const icon = iconInput.value.trim() || '📁';
                    const color = colorInput.value;
                    
                    if (!name) return alert("Project name cannot be empty.");
                    
                    close(true);
                    
                    const projectId = await this.kernel.createProject(name, desc, icon, color, false);
                    if (projectId) {
                        const openNow = await this.actionConfirm({
                            title: "Project Created",
                            message: `Project "${name}" created. Open it now?`,
                            confirmText: "Open Project",
                            cancelText: "Keep Current"
                        });
                        if (openNow) {
                            this.kernel.activeProjectId = projectId;
                            const pages = this.kernel.getPages(projectId);
                            if (pages.length > 0) {
                                this.kernel.loadMapState(pages[0]);
                            }
                            this.setView('map');
                            const drawer = document.getElementById('data-manager-drawer');
                            if (drawer) drawer.classList.add('translate-x-full');
                        } else {
                            this.render();
                        }
                    }
                };
            }
        });
    }

    /** Custom Modal Page Creation Form */
    actionCreatePageCustom() {
        const contentHtml = `
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Name</label>
                    <input type="text" id="create-page-title" value="New Space" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Type</label>
                    <select id="create-page-type" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                        <option value="generic" selected>Generic Map</option>
                        <option value="web">Web Architect</option>
                        <option value="person">Person Profile</option>
                        <option value="prompt">Prompt Engine</option>
                        <option value="agent">Agent Config</option>
                        <option value="file-root">File Root</option>
                        <option value="file-document">File Document</option>
                    </select>
                </div>
            </div>
        `;

        const actionsHtml = `
            <button id="create-page-btn-cancel" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel</button>
            <button id="create-page-btn-save" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Create Page</button>
        `;

        this.showDialogModal({
            title: "Create New Page",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, close) => {
                const titleInput = backdrop.querySelector('#create-page-title');
                const typeSelect = backdrop.querySelector('#create-page-type');

                titleInput.focus();
                titleInput.select();

                backdrop.querySelector('#create-page-btn-cancel').onclick = () => close(null);
                backdrop.querySelector('#create-page-btn-save').onclick = async () => {
                    const title = titleInput.value.trim();
                    const type = typeSelect.value;
                    
                    if (!title) return alert("Page name cannot be empty.");
                    
                    close(true);
                    
                    const page = await this.kernel.createPage(this.kernel.activeProjectId, title, type);
                    if (page) {
                        this.actionOpenPageSettings(page.map_id);
                    }
                };
            }
        });
    }

    /** Custom sub-modal for page copying with project selection dropdown and dependency cloning */
    async actionPromptCopyPageCustom(pageId, parentModalClose) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === pageId);
        if (!page) return;

        const projects = this.kernel.getProjects();
        const activeProjId = this.kernel.activeProjectId;
        const activeProj = projects.find(p => p.project_id === activeProjId);

        let selectedProjId = activeProjId;
        let isNewProject = false;

        const contentHtml = `
            <div class="flex flex-col gap-4 font-sans text-slate-300">
                <p class="text-xs text-slate-400">Create a copy of this space. You can clone it into an existing project or create a new project for it.</p>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Destination Project</label>
                    <div class="relative w-full">
                        <button id="copy-proj-selector-btn" class="bg-slate-950 hover:bg-slate-800 text-xs text-slate-200 px-3 py-2.5 rounded-lg border border-slate-800 font-semibold flex items-center justify-between transition-colors cursor-pointer w-full">
                            <span id="copy-proj-selected-label">${activeProj ? activeProj.meta.icon + ' ' + activeProj.meta.title : 'Select Project...'}</span>
                            <span class="text-[8px] opacity-60">▼</span>
                        </button>
                    </div>
                </div>

                <div id="copy-new-proj-input-container" class="hidden flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">New Project Name</label>
                    <input type="text" id="copy-new-proj-title" placeholder="Enter new project name" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                </div>
            </div>
        `;

        const actionsHtml = `
            <div class="flex w-full justify-end items-center gap-2">
                <button id="copy-modal-submit" class="bg-indigo-650 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Copy Page</button>
            </div>
        `;

        await this.showDialogModal({
            title: `Copy "${page.meta?.title || 'Page'}"`,
            contentHtml,
            actionsHtml,
            onRender: (backdrop, closeCopyModal) => {
                const btnSelector = backdrop.querySelector('#copy-proj-selector-btn');
                const labelSelected = backdrop.querySelector('#copy-proj-selected-label');
                const containerNewProj = backdrop.querySelector('#copy-new-proj-input-container');
                const inputNewProj = backdrop.querySelector('#copy-new-proj-title');
                const btnSubmit = backdrop.querySelector('#copy-modal-submit');

                const updateSubmitState = () => {
                    if (isNewProject) {
                        btnSubmit.disabled = !inputNewProj.value.trim();
                        btnSubmit.style.opacity = inputNewProj.value.trim() ? '1' : '0.5';
                    } else {
                        btnSubmit.disabled = !selectedProjId;
                        btnSubmit.style.opacity = selectedProjId ? '1' : '0.5';
                    }
                };

                inputNewProj.oninput = updateSubmitState;
                updateSubmitState();

                btnSelector.onclick = (e) => {
                    e.stopPropagation();
                    
                    const rect = btnSelector.getBoundingClientRect();
                    const panel = document.createElement('div');
                    panel.id = 'mm-copy-proj-dropdown';
                    panel.className = "fixed z-[9999999] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans py-1";
                    panel.style.left = `${rect.left}px`;
                    panel.style.top = `${rect.bottom + 4}px`;
                    panel.style.width = `${rect.width}px`;

                    projects.forEach(proj => {
                        const b = document.createElement('button');
                        b.className = "text-left w-full px-3 py-2 text-[10px] font-medium text-slate-355 hover:bg-indigo-600 hover:text-white flex items-center gap-2 transition-colors border-none bg-transparent cursor-pointer";
                        b.innerHTML = `<span>${proj.meta.icon || '📁'}</span><span class="flex-1 truncate">${proj.meta.title}</span>`;
                        b.onclick = () => {
                            selectedProjId = proj.project_id;
                            isNewProject = false;
                            labelSelected.textContent = `${proj.meta.icon || '📁'} ${proj.meta.title}`;
                            containerNewProj.classList.add('hidden');
                            updateSubmitState();
                            panel.remove();
                        };
                        panel.appendChild(b);
                    });

                    // Divider
                    const hr = document.createElement('div');
                    hr.className = "border-t border-slate-800 my-1";
                    panel.appendChild(hr);

                    // + New Project
                    const newBtn = document.createElement('button');
                    newBtn.className = "text-left w-full px-3 py-2 text-[10px] font-bold text-emerald-450 hover:bg-emerald-600 hover:text-white flex items-center gap-2 transition-colors border-none bg-transparent cursor-pointer";
                    newBtn.innerHTML = '＋ New Project…';
                    newBtn.onclick = () => {
                        selectedProjId = null;
                        isNewProject = true;
                        labelSelected.textContent = '＋ New Project…';
                        containerNewProj.classList.remove('hidden');
                        inputNewProj.focus();
                        updateSubmitState();
                        panel.remove();
                    };
                    panel.appendChild(newBtn);

                    document.body.appendChild(panel);

                    const closeDD = (ev) => {
                        if (!panel.contains(ev.target) && ev.target !== btnSelector) {
                            panel.remove();
                            document.removeEventListener('mousedown', closeDD, true);
                        }
                    };
                    setTimeout(() => document.addEventListener('mousedown', closeDD, true), 0);
                };

                btnSubmit.onclick = async () => {
                    let targetProjId = selectedProjId;
                    let targetProjName = '';

                    if (isNewProject) {
                        targetProjName = inputNewProj.value.trim();
                        if (!targetProjName) return;
                        targetProjId = 'new';
                    }

                    closeCopyModal(true);
                    parentModalClose(false);

                    const sourceProjId = page.meta?.project_id || 'default_project';
                    const isBetweenProjects = (targetProjId === 'new' || targetProjId !== sourceProjId);
                    const hasPortals = page.nodes && page.nodes.some(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content);

                    let copyMode = 'keep'; // Default for within-project copy is to keep targets

                    if (isBetweenProjects && hasPortals) {
                        const choice = await this.showDialogModal({
                            title: "Portal Dependencies",
                            contentHtml: `
                                <div class="flex flex-col gap-3 font-sans text-slate-350 text-xs">
                                    <p class="leading-relaxed">This space contains portals linking to other pages. Since you are copying it to a different project, select how these portal connections should be handled:</p>
                                    <div class="flex flex-col gap-2.5 mt-1 select-none">
                                        <div id="option-keep" class="option-card p-3 rounded-xl border border-indigo-650 bg-indigo-950/20 text-slate-200 cursor-pointer transition-all flex items-start gap-3 shadow-lg shadow-indigo-950/20">
                                            <div class="radio-indicator w-4 h-4 rounded-full border-2 border-indigo-500 flex items-center justify-center shrink-0 mt-0.5">
                                                <div class="radio-fill w-2 h-2 rounded-full bg-indigo-500"></div>
                                            </div>
                                            <div class="flex-1">
                                                <span class="font-bold text-teal-400 block mb-0.5">🔗 Link Across Projects</span>
                                                <span class="text-[10px] text-slate-500 leading-tight">Keep the original portal targets. The copied portals will link back to the pages in the source project.</span>
                                            </div>
                                        </div>
                                        <div id="option-clone" class="option-card p-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 cursor-pointer transition-all flex items-start gap-3">
                                            <div class="radio-indicator w-4 h-4 rounded-full border-2 border-slate-650 flex items-center justify-center shrink-0 mt-0.5">
                                                <div class="radio-fill w-2 h-2 rounded-full bg-transparent"></div>
                                            </div>
                                            <div class="flex-1">
                                                <span class="font-bold text-indigo-400 block mb-0.5">🌀 Clone Dependencies</span>
                                                <span class="text-[10px] text-slate-500 leading-tight">Duplicate the linked pages into the destination project, and update the copied portals to point to these new duplicates.</span>
                                            </div>
                                        </div>
                                        <div id="option-clear" class="option-card p-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 cursor-pointer transition-all flex items-start gap-3">
                                            <div class="radio-indicator w-4 h-4 rounded-full border-2 border-slate-650 flex items-center justify-center shrink-0 mt-0.5">
                                                <div class="radio-fill w-2 h-2 rounded-full bg-transparent"></div>
                                            </div>
                                            <div class="flex-1">
                                                <span class="font-bold text-slate-400 block mb-0.5">🧹 Clear Portal Targets</span>
                                                <span class="text-[10px] text-slate-500 leading-tight">Reset the copied portals. They will remain in the copied map but will be empty and unlinked.</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `,
                            actionsHtml: `
                                <div class="flex w-full justify-between items-center gap-2">
                                    <button class="cancel-btn border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel Copy</button>
                                    <button class="confirm-btn bg-indigo-650 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-5 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Confirm Copy</button>
                                </div>
                            `,
                            onRender: (el, cls) => {
                                let selected = 'keep';
                                const cardKeep = el.querySelector('#option-keep');
                                const cardClone = el.querySelector('#option-clone');
                                const cardClear = el.querySelector('#option-clear');
                                
                                const updateCards = () => {
                                    [cardKeep, cardClone, cardClear].forEach(c => {
                                        const opt = c.id.replace('option-', '');
                                        const radioFill = c.querySelector('.radio-fill');
                                        const radioInd = c.querySelector('.radio-indicator');
                                        if (opt === selected) {
                                            c.className = "option-card p-3 rounded-xl border border-indigo-650 bg-indigo-950/20 text-slate-200 cursor-pointer transition-all flex items-start gap-3 shadow-lg shadow-indigo-950/20";
                                            radioFill.className = "radio-fill w-2 h-2 rounded-full bg-indigo-500";
                                            radioInd.className = "radio-indicator w-4 h-4 rounded-full border-2 border-indigo-500 flex items-center justify-center shrink-0 mt-0.5";
                                        } else {
                                            c.className = "option-card p-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 cursor-pointer transition-all flex items-start gap-3";
                                            radioFill.className = "radio-fill w-2 h-2 rounded-full bg-transparent";
                                            radioInd.className = "radio-indicator w-4 h-4 rounded-full border-2 border-slate-650 flex items-center justify-center shrink-0 mt-0.5";
                                        }
                                    });
                                };
                                
                                cardKeep.onclick = () => { selected = 'keep'; updateCards(); };
                                cardClone.onclick = () => { selected = 'clone'; updateCards(); };
                                cardClear.onclick = () => { selected = 'clear'; updateCards(); };
                                
                                el.querySelector('.cancel-btn').onclick = () => cls('cancel');
                                el.querySelector('.confirm-btn').onclick = () => cls(selected);
                            }
                        });
                        
                        if (choice === 'cancel' || choice === null) {
                            return; // Abort copy
                        }
                        copyMode = choice;
                    }

                    let clonedPageId = null;

                    if (copyMode === 'clone') {
                        const mapIdMapping = {};
                        
                        // Recursive cloner helper
                        const cloneWithDependencies = async (sourceId, targetProjectId, targetProjectTitle) => {
                            if (mapIdMapping[sourceId]) return mapIdMapping[sourceId];

                            // Clone the page
                            const newPageId = await this.kernel.clonePage(sourceId, targetProjectId, null, targetProjectTitle);
                            if (!newPageId) return null;
                            mapIdMapping[sourceId] = newPageId;

                            // Find the project ID used/generated
                            const currentLib = this.kernel.getLibrary();
                            const clonedPageObj = currentLib.find(p => p.map_id === newPageId);
                            if (!clonedPageObj) return newPageId;

                            const resolvedProjectId = clonedPageObj.meta?.project_id;

                            // Recursively clone portal targets
                            let updated = false;
                            if (clonedPageObj.nodes) {
                                for (const node of clonedPageObj.nodes) {
                                    if ((node.type === 'portal' || node.type === 'smart-portal') && node.content) {
                                        const origTgtId = node.content;
                                        const origTgtPage = currentLib.find(p => p.map_id === origTgtId);
                                        if (origTgtPage) {
                                            // Pass the resolved target project ID so they all end up in the same project!
                                            const newTgtId = await cloneWithDependencies(origTgtId, resolvedProjectId, targetProjectTitle);
                                            if (newTgtId) {
                                                node.content = newTgtId;
                                                updated = true;
                                            }
                                        }
                                    }
                                }
                            }

                            if (updated) {
                                await this.kernel.saveMapToLibrary(clonedPageObj);
                            }

                            return newPageId;
                        };

                        clonedPageId = await cloneWithDependencies(pageId, targetProjId, targetProjName);
                    } else {
                        clonedPageId = await this.kernel.clonePage(pageId, targetProjId, null, targetProjName);
                        if (clonedPageId && copyMode === 'clear') {
                            const updatedLib = this.kernel.getLibrary();
                            const clonedPageObj = updatedLib.find(p => p.map_id === clonedPageId);
                            if (clonedPageObj && clonedPageObj.nodes) {
                                let updated = false;
                                clonedPageObj.nodes.forEach(node => {
                                    if ((node.type === 'portal' || node.type === 'smart-portal') && node.content) {
                                        node.content = '';
                                        updated = true;
                                    }
                                });
                                if (updated) {
                                    await this.kernel.saveMapToLibrary(clonedPageObj);
                                }
                            }
                        }
                    }

                    if (clonedPageId) {
                        const updatedLib = this.kernel.getLibrary();
                        const clonedPageObj = updatedLib.find(p => p.map_id === clonedPageId);
                        if (clonedPageObj) {
                            this.actionCloseDataManager();
                            this.actionOpenPageSettings(clonedPageObj.map_id);
                        }
                    }
                };
            }
        });
    }

    /** Stylized custom select dropdown for Data Vault targeting */
    showVaultSelectorDropdown(event) {
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        
        const activeVault = this.kernel.isUsingCloudVault() ? 'firebase' : 'local';
        const isLoggedIn = window.FirebaseAuth && window.FirebaseAuth.currentUser && !window.FirebaseAuth.currentUser.isAnonymous;

        const panel = document.createElement('div');
        panel.id = 'mm-vault-selector-dd';
        panel.className = "fixed z-[99999] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans py-1";
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.bottom + 4}px`;
        panel.style.minWidth = `${Math.max(rect.width, 220)}px`;

        const options = [
            { value: 'firebase', label: 'Firebase (Cloud) ☁️', enabled: isLoggedIn, desc: isLoggedIn ? 'Active cloud-synchronized vault' : 'Requires full account sign-in' },
            { value: 'local', label: 'Local Browser (Legacy) 📁', enabled: true, desc: 'Saves locally inside browser cache' },
            { value: 'gdrive', label: 'Google Drive (Coming Soon) 🔺', enabled: false, desc: 'Personal Drive synchronization' },
            { value: 'local-os', label: 'Local OS (Coming Soon) 💾', enabled: false, desc: 'Access local computer directory' }
        ];

        options.forEach(opt => {
            const b = document.createElement('button');
            b.className = `text-left w-full px-3 py-2 text-[10px] font-medium flex flex-col transition-colors border-none bg-transparent cursor-pointer ${opt.enabled ? 'text-slate-300 hover:bg-indigo-650 hover:text-white' : 'text-slate-600 cursor-not-allowed'}`;
            b.disabled = !opt.enabled;
            b.innerHTML = `
                <div class="flex justify-between items-center w-full font-bold">
                    <span>${opt.label}</span>
                    ${opt.value === activeVault ? '<span class="text-[8px] text-emerald-400 font-extrabold uppercase tracking-wider select-none">active</span>' : ''}
                </div>
                <div class="text-[8px] text-slate-500 mt-0.5 leading-tight">${opt.desc}</div>
            `;
            if (opt.enabled) {
                b.onclick = () => {
                    panel.remove();
                    this.actionChangeVault(opt.value);
                };
            }
            panel.appendChild(b);
        });

        document.body.appendChild(panel);

        const close = (e) => {
            if (!panel.contains(e.target) && e.target !== btn) {
                panel.remove();
                document.removeEventListener('mousedown', close, true);
                document.removeEventListener('scroll', close, true);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', close, true);
            document.addEventListener('scroll', close, { capture: true, passive: true });
        }, 0);
    }
}