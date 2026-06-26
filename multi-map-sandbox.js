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
        const stateHash = `${node.id}-${node.type}-${isLinking}-${this.kernel.linkingSourceId === node.id}-${this.aiImportMode}-${this.parentSelectMode}`;

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
            if (node.type === 'portal') actions.push({ icon: '🌀', action: 'EnterPortal', title: 'Enter' });
            else if (node.type === 'smart-portal') actions.push({ icon: '✨', action: 'TriggerAI', title: 'Trigger AI' });
            else actions.push({ icon: '🌌', action: 'SaveConstellation', title: 'Save Submap' });
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

    actionResolveAiImport(nodeId) {
        if (!this.aiPendingData) return;
        
        // Save the map to the library natively so the portal can reference it!
        this.kernel.saveConstellationToLibrary(this.aiPendingData);
        
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

    actionDelete(id) { const tgt = id || this.kernel.state.session.selectedId; if (confirm("Delete this node and cascade to all children?")) this.kernel.deleteNode(tgt); }
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

    actionEnterPortal(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (node && (node.type === 'portal' || node.type === 'smart-portal')) {
            const lib = this.kernel.getLibrary();
            const map = lib.find(m => m.map_id === node.content);
            if (map) {
                this.kernel.enterPortal(map);
                const mapType = this.kernel.state.meta && this.kernel.state.meta.type ? this.kernel.state.meta.type : 'generic';
                if (mapType === 'web') this.setView('web');
                else this.setView('map');
            } else {
                alert("Target map not found in library.");
            }
        }
    }
    
    actionExitPortal() {
        if (this.kernel.exitPortal()) {
            this.setView('map');
        }
    }

    actionSaveConstellation(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const json = this.kernel.extractConstellation(tgt);
        if (json) { this.kernel.saveConstellationToLibrary(json); alert("Saved to Library."); }
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
                    if (target === 'template') MultiMapLibrary.saveCustomTemplate(newMap);
                    else {
                        await this.kernel.saveMapToLibrary(newMap);
                    }
                    overwritten++;
                } else { skipped++; }
            } else {
                if (target === 'template') MultiMapLibrary.saveCustomTemplate(newMap);
                else {
                    await this.kernel.saveMapToLibrary(newMap);
                }
                added++;
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

    async actionSpawnTemplate(tplId) {
        try {
            const tplData = await this.kernel.bridge.fetchTemplateData(tplId);
            this.kernel.saveConstellationToLibrary(tplData);
            
            const vp = this.kernel.state.session.viewport;
            const rect = this.dom.viewport.getBoundingClientRect();
            const center_x = (rect.width / 2 - vp.x) / vp.scale;
            const center_y = (rect.height / 2 - vp.y) / vp.scale;

            const portal = this.kernel.addNode({ type: 'portal', title: tplData.meta.title, content: tplData.map_id, x: center_x, y: center_y });
            this.kernel.importSubmap(portal.id, tplData);
            alert(`Template imported successfully!`);
            this.setView('map');
            this.kernel.selectNode(portal.id);
        } catch (e) { alert("Failed to spawn template."); }
    }

    actionSaveCurrentToLibrary() {
        const copy = JSON.parse(JSON.stringify(this.kernel.state));
        copy.map_id = this.kernel.generateId();
        copy.meta.title = (copy.meta.title || "Untitled") + " (Copy)";
        this.kernel.saveConstellationToLibrary(copy);
        alert("Session saved to Library!");
        this.render(); 
    }
    
    actionLoadFromLibrary(id) {
        const lib = this.kernel.getLibrary();
        const map = lib.find(m => m.map_id === id);
        if (map) { 
            this.kernel.activeProjectId = map.meta?.project_id || 'default_project';
            this.kernel.loadMapState(map); 
            this.setView('map'); 
        }
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

    actionCreateProject() {
        const name = prompt("Enter Project Name:", "New Project");
        if (name) {
            const desc = prompt("Enter Project Description:", "");
            this.kernel.createProject(name, desc);
        }
    }

    actionPromptRenameProject(projId) {
        const projects = this.kernel.getProjects();
        const proj = projects.find(p => p.project_id === projId);
        if (proj) {
            const name = prompt("Rename Project:", proj.meta.title);
            if (name) {
                const desc = prompt("Update Description:", proj.meta.description || "");
                this.kernel.renameProject(projId, name, desc, proj.meta.icon, proj.meta.color);
            }
        }
    }

    actionDeleteProject(projId) {
        if (confirm("Are you sure you want to delete this project and all its pages? This action cannot be undone.")) {
            this.kernel.deleteProject(projId);
        }
    }

    actionCreatePage() {
        const title = prompt("Enter Page Name:", "New Space");
        if (title) {
            const type = prompt("Enter Page Type (generic, web, person, prompt, agent):", "generic");
            this.kernel.createPage(this.kernel.activeProjectId, title, type).then(page => {
                this.kernel.loadMapState(page);
                this.setView('map');
            });
        }
    }

    actionPromptRenamePage(pageId) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === pageId);
        if (page) {
            const newTitle = prompt("Rename Page:", page.meta?.title || "");
            if (newTitle) {
                this.kernel.updateLibraryItem(pageId, { title: newTitle });
            }
        }
    }

    async actionPromptCopyPage(pageId) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === pageId);
        if (page) {
            const pageTitle = page.meta?.title || "Page";
            const defaultProjName = `${pageTitle} Project`;
            const newProjName = prompt("Enter a title for the new project to copy this page into:", defaultProjName);
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
    
    actionDeleteFromLibrary(id) {
        if(confirm("Permanently delete this saved constellation?")) { this.kernel.deleteFromLibrary(id); this.render(); }
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
                text = 'Enter Portal ➔';
                themeClasses = 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-emerald-100 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]';
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
}