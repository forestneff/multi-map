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
        this.uiStack = [];
        this.sessionStartTime = Date.now();
        
        // Smart action options popover state
        this.isSmartOptionsOpen = false;
        this.selectedSmartOptionIdx = 0;
        this.smartButtonOptions = null;
        this._lastSelectedNodeId = null;
        this.lastMouseMovePos = { x: 0, y: 0 };
        
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

        this.kernel.subscribe((state) => {
            this.handleStateChange(state);
            this.render();
        });
        
        this.animate();
        this.render();
    }

    handleStateChange(state) {
        const selectedId = state.session && state.session.selectedId;
        if (selectedId && selectedId !== this._previousSelectedId) {
            this._previousSelectedId = selectedId;
            const node = state.nodes.find(n => n.id === selectedId);
            if (node && (node.type === 'file-root' || node.type === 'file-folder')) {
                const rootNode = this.kernel.findFileRootNode(node.id);
                if (rootNode && rootNode.root_metadata && rootNode.root_metadata.source === 'local_os') {
                    this.expandLocalOSFolder(node.id).catch(err => {
                        console.warn("Auto lazy-loading local folder failed:", err);
                    });
                }
            }
        } else if (!selectedId) {
            this._previousSelectedId = null;
        }
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
        
        const logNavAway = () => {
            this.kernel.saveCurrentMapToLibrary();
            const durationSec = Math.round((Date.now() - this.sessionStartTime) / 1000);
            this.logTelemetrySync('session_end', { duration_seconds: durationSec });
        };
        window.addEventListener('beforeunload', logNavAway);
        window.addEventListener('pagehide', logNavAway);

        window.addEventListener('focusin', () => {
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
            const isMobile = window.innerWidth <= 768;
            if (isMobile && isInputFocused && this.dom.sidebar) {
                this.dom.sidebar.classList.add('keyboard-visible');
            }
        });
        window.addEventListener('focusout', () => {
            setTimeout(() => {
                const activeEl = document.activeElement;
                const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
                if (!isInputFocused && this.dom.sidebar) {
                    this.dom.sidebar.classList.remove('keyboard-visible');
                }
            }, 50);
        });

        window.addEventListener('copy', (e) => {
            const target = e.target;
            const isEditable = target.tagName === 'INPUT' || 
                               target.tagName === 'TEXTAREA' || 
                               target.isContentEditable || 
                               target.closest('[contenteditable="true"]');
            if (isEditable) return;
            const selectedId = this.kernel.state.session.selectedId;
            if (selectedId) {
                e.preventDefault();
                this.actionCopyBranch(selectedId);
            }
        });

        window.addEventListener('paste', (e) => {
            const target = e.target;
            const isEditable = target.tagName === 'INPUT' || 
                               target.tagName === 'TEXTAREA' || 
                               target.isContentEditable || 
                               target.closest('[contenteditable="true"]');
            if (isEditable) return;
            const selectedId = this.kernel.state.session.selectedId;
            e.preventDefault();
            this.actionPasteBranch(selectedId);
        });

        // --- GLOBAL KEYBOARD SHORTCUTS & ESCAPE HANDLER ---
        window.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
        window.addEventListener('mousemove', (e) => {
            this.lastMouseMovePos = { x: e.clientX, y: e.clientY };
        });

        // --- MESSAGE LISTENER (EDIT MODE & KEYDOWN FORWARDING) ---
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'mm-select-node' && e.data.id) {
                if (this.kernel.webEditMode) {
                    this.actionEdit(e.data.id);
                }
            }
            if (e.data && e.data.type === 'mm-keydown') {
                const simulatedEvent = {
                    key: e.data.key,
                    shiftKey: e.data.shiftKey,
                    ctrlKey: e.data.ctrlKey,
                    metaKey: e.data.metaKey,
                    target: document.body,
                    preventDefault: () => {}
                };
                this.handleGlobalKeydown(simulatedEvent);
            }
            if (e.data && e.data.type === 'mm-copy-text' && e.data.text) {
                navigator.clipboard.writeText(e.data.text)
                    .then(() => {
                        this.showToast("Prompt copied to clipboard.", "success");
                    })
                    .catch((err) => {
                        console.error("Failed to copy prompt text:", err);
                        this.showToast("Failed to copy to clipboard.", "error");
                    });
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

    pushUiStack(id) {
        this.uiStack = this.uiStack.filter(item => item !== id);
        this.uiStack.push(id);
    }

    popUiStack(id) {
        this.uiStack = this.uiStack.filter(item => item !== id);
    }

    toggleSidebar() {
        if (this.kernel.isReadOnly) return;
        if (this.dom.sidebar) {
            // Close Data Manager first
            this.dom.sidebar.classList.remove('data-manager-open');
            this.popUiStack('data-manager-sidebar');
            const dmPanel = document.getElementById('sidebar-data-manager');
            if (dmPanel) dmPanel.classList.add('hidden');

            this.dom.sidebar.classList.toggle('open');
            const isOpen = this.dom.sidebar.classList.contains('open');
            
            const inspectorPanel = document.getElementById('sidebar-content');
            if (inspectorPanel) {
                if (isOpen) inspectorPanel.classList.remove('hidden');
                else inspectorPanel.classList.add('hidden');
            }

            if (isOpen) {
                this.pushUiStack('inspector-sidebar');
                // Close right profile drawer
                const p = document.getElementById('profile-drawer');
                if (p) p.classList.add('translate-x-full');
                this.popUiStack('profile-drawer');
            } else {
                this.popUiStack('inspector-sidebar');
            }
        }
    }

    toggleDataManager() {
        if (this.dom.sidebar) {
            // Close Inspector first
            this.dom.sidebar.classList.remove('open');
            this.popUiStack('inspector-sidebar');
            const inspectorPanel = document.getElementById('sidebar-content');
            if (inspectorPanel) inspectorPanel.classList.add('hidden');

            this.dom.sidebar.classList.toggle('data-manager-open');
            const isOpen = this.dom.sidebar.classList.contains('data-manager-open');
            
            const dmPanel = document.getElementById('sidebar-data-manager');
            if (dmPanel) {
                if (isOpen) dmPanel.classList.remove('hidden');
                else dmPanel.classList.add('hidden');
            }

            if (isOpen) {
                this.pushUiStack('data-manager-sidebar');
                // Close right profile drawer
                const p = document.getElementById('profile-drawer');
                if (p) p.classList.add('translate-x-full');
                this.popUiStack('profile-drawer');
                
                // Render data manager content
                if (window.Auth) {
                    window.Auth.renderDataManager(document.getElementById('data-manager-content'));
                }
            } else {
                this.popUiStack('data-manager-sidebar');
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

            const img = el.querySelector('.node-icon img');
            if (img) {
                const favScale = Math.min(2.0, Math.max(1.0, 1.1 / globalScale));
                img.style.transform = `scale(${favScale})`;
                img.style.transformOrigin = 'center';
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

        // Double tap detection for mobile zoom
        const now = Date.now();
        this.lastTapTime = this.lastTapTime || 0;
        if (this.lastTapTime && (now - this.lastTapTime < 300)) {
            const lastPos = this.lastTapPos || { x: 0, y: 0 };
            const dist = Math.hypot(e.clientX - lastPos.x, e.clientY - lastPos.y);
            if (dist < 20) {
                this.toggleViewportZoom(e.clientX, e.clientY);
                this.lastTapTime = 0;
                return;
            }
        }
        this.lastTapTime = now;
        this.lastTapPos = { x: e.clientX, y: e.clientY };

        this.activePointers.set(e.pointerId, e);
        if (this.activePointers.size === 1) {
            this.isDragging = true;
            this.userHasPanned = true;
            this.lastMouse = { x: e.clientX, y: e.clientY };
            this.clickStart = { x: e.clientX, y: e.clientY };
        }
    }

    toggleViewportZoom(clientX, clientY) {
        const vp = this.kernel.state.session.viewport;
        const rect = this.dom.viewport.getBoundingClientRect();
        const targetX = clientX - rect.left;
        const targetY = clientY - rect.top;

        // Calculate world coordinates of tap
        const worldX = (targetX - vp.x) / vp.scale;
        const worldY = (targetY - vp.y) / vp.scale;

        let newScale = 1.0;
        if (vp.scale < 1.25) {
            newScale = 1.6;
        } else {
            newScale = 1.0;
        }

        // Apply new scale centered on the tapped location
        vp.scale = newScale;
        vp.x = targetX - (worldX * newScale);
        vp.y = targetY - (worldY * newScale);

        this.updateTransform();
        this.render();
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
        if (this.kernel.linkingMode || this.parentSelectMode) return { x: node.data.x, y: node.data.y };
        
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
        if (this.kernel.isReadOnly) return;
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
        // Intercept menu if Linking Mode is active
        else if (isLinking) {
            if (node.id === this.kernel.linkingSourceId) {
                actions = [ { icon: '❌', action: 'Link', title: 'Cancel Link' } ];
            } else {
                actions = [ { icon: '✅', action: 'Link', title: 'Confirm Link' } ];
            }
        }
        // Intercept menu if AI Import Mode is active and target is a Smart Portal
        else if (this.aiImportMode) {
            if (node.type === 'smart-portal' || node.type === 'portal') {
                actions = [ { icon: '📥', action: 'ResolveAiImport', title: 'Inject AI Data Here' } ];
            } else {
                actions = [ { icon: '❌', action: 'CancelAiImport', title: 'Cancel AI Import' } ];
            }
        } else {
            // Normal Operations
            actions = [
                { icon: '📝', action: 'Edit', title: 'Edit' },
                { icon: '🔗', action: 'Link', title: linkTitle }
            ];
            if (node.type === 'prompt-root') {
                actions.push({ icon: '✍️', action: 'CopyPromptAsText', title: 'Copy as Text' });
            }
            if (!isPortal) {
                if (node.type === 'flow-decision') {
                    actions.push({ icon: '✔️', action: 'AddTrueBranch', title: 'Add True Branch' });
                    actions.push({ icon: '❌', action: 'AddFalseBranch', title: 'Add False Branch' });
                } else {
                    actions.push({ icon: '➕', action: 'AddChild', title: 'Add Child' });
                }
            }
            const isMaster = this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory");
            const isSyncPortal = node.data && node.data.isSyncPortal === true;
            if (isSyncPortal) {
                actions.push({ icon: '🗑️', action: 'Delete', title: 'Delete Page' });
            } else {
                if (!isNodeRoot) {
                    actions.push({ icon: '🗑️', action: 'Delete', title: 'Delete Downstream' });
                } else if (!isMaster) {
                    actions.push({ icon: '🗑️', action: 'Delete', title: 'Delete Page' });
                }
            }
            actions.push({ icon: (isCollapsed ? '🌞' : '🌚'), action: 'ToggleCollapse', title: (isCollapsed ? 'Expand' : 'Collapse') });
            
            // Add parent-select action (universal for non-root nodes)
            if (!isNodeRoot) {
                actions.push({ icon: '👆', action: 'SelectParent', title: hasParent ? 'Change Parent' : 'Select Parent' });
            }
            // Add "Project Directory" action for root nodes on all pages except Project Directory itself
            const isProjDir = this.kernel.state.meta && this.kernel.state.meta.title === "Project Directory";
            if (isNodeRoot && !isProjDir) {
                actions.push({ icon: '🏠', action: 'GoToDirectory', title: 'Project Directory' });
            }
            if (node.type === 'portal') {
                const rootMeta = node.content ? this.kernel.getRootMetadata(node.content) : null;
                const isPromptPortal = rootMeta && (rootMeta.portal_behavior === 'execute_prompt' || (this.kernel.hasRootType && this.kernel.hasRootType(node.content, 'prompt-root')) || (this.kernel.isPromptMap && this.kernel.isPromptMap(node.content)));
                if (isPromptPortal) {
                    actions.push({ 
                        icon: '✨', 
                        action: 'TriggerAI', 
                        title: 'Trigger AI' 
                    });
                }
                const isWebPortal = node.content && this.kernel.hasRootType && this.kernel.hasRootType(node.content, 'web-root');
                const isAgentPortal = node.content && this.kernel.hasRootType && this.kernel.hasRootType(node.content, 'agent-root');
                const isPersonPortal = node.content && this.kernel.hasRootType && this.kernel.hasRootType(node.content, 'person-root');

                if (node.content) {
                    if (isWebPortal) {
                        actions.push({ icon: '🚀', action: 'LaunchWebPortal', title: 'Launch Web App' });
                    } else if (isAgentPortal) {
                        actions.push({ icon: '⚙️', action: 'ConfigureAgentPortal', title: 'Configure Agent' });
                    } else if (isPersonPortal) {
                        actions.push({ icon: '👤', action: 'ViewPersonPortal', title: 'View Profile' });
                    }
                }
                
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
            } else {
                // Clip is only available for non-root, non-portal, non-web nodes
                const canClip = !isNodeRoot && !node.type.startsWith('web-');
                if (canClip) {
                    actions.push({ icon: '✂️', action: 'ClipBranch', title: 'Clip' });
                }
            }

            if (!isMaster) {
                // Copy branch action (universal)
                actions.push({ icon: '📋', action: 'CopyBranch', title: 'Copy' });

                // Paste branch action (only if content exists to be pasted)
                const hasPasteData = !!(this.kernel.clipboardData || localStorage.getItem('mm_clipboard_data'));
                if (hasPasteData) {
                    actions.push({ icon: '📥', action: 'PasteBranch', title: 'Paste' });
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
        
        this.aiPendingData.meta = this.aiPendingData.meta || {};
        this.aiPendingData.meta.project_id = this.kernel.activeProjectId || 'default_project';
        
        // Save the map to the library natively so the portal can reference it!
        const saved = await this.kernel.saveConstellationToLibrary(this.aiPendingData);
        if (saved === false) {
            throw new Error("Guest map limit (25) exceeded.");
        }
        
        // Update the smart portal's payload to link to this new map
        this.kernel.updateNode(nodeId, { content: this.aiPendingData.map_id });
        
        // Actually import the physical nodes
        this.kernel.importSubmap(nodeId, this.aiPendingData);
        
        await this.kernel.syncProjectMasterMap(this.kernel.activeProjectId);
        
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

        if (node.type === 'portal' && node.content) {
            const targetMapId = node.content;
            const lib = this.kernel.getLibrary();
            const mapData = lib.find(m => m.map_id === targetMapId);
            if (mapData) {
                const promptRoot = mapData.nodes.find(n => n.type === 'prompt-root');
                if (promptRoot) {
                    const descendants = new Set();
                    const getChildren = (nid) => mapData.connections.filter(c => c.from === nid).map(c => mapData.nodes.find(n => n.id === c.to)).filter(n => n);
                    const gather = (n) => {
                        if (!n || descendants.has(n)) return;
                        descendants.add(n);
                        getChildren(n.id).forEach(gather);
                    };
                    getChildren(promptRoot.id).forEach(gather);
                    
                    const variables = Array.from(descendants).filter(n => n.type === 'prompt-variable');
                    const varValues = {};
                    variables.forEach(v => {
                        const key = v.title.replace(/[^a-zA-Z0-9_]/g, '');
                        varValues[key] = promptStr;
                    });
                    
                    const compiled = this.kernel.compilePromptMapState(mapData, varValues);
                    
                    if (window.AI) {
                        const chatPanel = document.getElementById('ai-chat-container');
                        if (chatPanel && chatPanel.classList.contains('translate-y-full')) {
                            window.AI.toggleChat();
                        }
                        const input = document.getElementById('ai-input');
                        if (input) {
                            input.value = `Update node "${node.id}" by executing this compiled prompt:\n\n${compiled}`;
                            window.AI.handleSend();
                        }
                    }
                    return;
                }
            }
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
            const parentNode = this.kernel.state.nodes.find(n => n.id === parentId);
            const isParentPortal = parentNode && (parentNode.type === 'portal' || parentNode.type === 'smart-portal');
            const childNode = this.kernel.state.nodes.find(n => n.id === this.parentSelectSourceId);

            const downstreamOfChild = this.kernel.getDownstreamNodes(this.parentSelectSourceId);
            if (downstreamOfChild.has(parentId)) {
                this.showToast("Cannot set a descendant as the parent.", "error");
            } else if (isParentPortal) {
                this.showToast("Portal nodes cannot have child connections.", "error");
            } else {
                // Find and remove any existing structural parent connection for this.parentSelectSourceId
                const oldParentConnIndex = this.kernel.state.connections.findIndex(c => c.to === this.parentSelectSourceId && c.type === 'structural');
                let oldConn = null;
                if (oldParentConnIndex !== -1) {
                    oldConn = this.kernel.state.connections[oldParentConnIndex];
                    this.kernel.state.connections.splice(oldParentConnIndex, 1);
                }

                const res = this.kernel.addConnection(parentId, this.parentSelectSourceId, 'structural');
                if (res && res.success === false) {
                    if (oldConn) this.kernel.state.connections.push(oldConn);
                    this.showToast(`Schema constraint: Cannot make [${parentNode?.type || 'unknown'}] a parent of [${childNode?.type || 'unknown'}].`, "error");
                } else {
                    this.showToast(`Parent changed successfully.`, "success");
                    this.kernel.saveHistory();

                    if (this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory" || this.kernel.state.meta.type === "file-root")) {
                        this.kernel.syncFoldersFromMasterMap(this.kernel.state).then(() => {
                            if (this.dom.dataManager && !this.dom.dataManager.classList.contains('translate-x-full')) {
                                if (window.Auth && window.Auth.renderDataManager) {
                                    window.Auth.renderDataManager(document.getElementById('data-manager-content'));
                                }
                            }
                        }).catch(console.error);
                    }
                }
            }
        }
        this.parentSelectMode = false;
        this.parentSelectSourceId = null;
        this.dom.overlay.classList.add('hidden');
        this.render();
    }

    async actionDelete(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (!node) return;
        
        const isRoot = node.type === 'root' || node.type.endsWith('-root') || (node.data && node.data.isCore);
        if (isRoot) {
            await this.actionDeleteFromLibrary(this.kernel.state.map_id);
            return;
        }
        
        const isMaster = this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory");
        const isDirectoryPortal = isMaster && (node.type === 'portal' || node.type === 'smart-portal');

        if (isDirectoryPortal || (node.data && node.data.isSyncPortal)) {
            const pageExists = node.content ? this.kernel.getLibrary().some(p => p.map_id === node.content) : false;
            if (node.content && pageExists) {
                // deleteFromLibrary handles portal cleanup via syncProjectMasterMap
                const deleted = await this.actionDeleteFromLibrary(node.content);
                if (deleted) {
                    // Portal node is already removed from this.state by syncProjectMasterMap.
                    // Just persist the current master map state.
                    this.kernel.saveCurrentMapToLibrary();
                    this.render();
                }
            } else {
                const ok = await this.actionConfirm({
                    title: "Delete Portal",
                    message: "Are you sure you want to delete this unlinked or broken portal node?",
                    confirmText: "Delete",
                    isDestructive: true
                });
                if (ok) {
                    this.kernel.deleteNode(tgt);
                    this.kernel.saveCurrentMapToLibrary();
                }
            }
            return;
        }

        const ok = await this.actionConfirm({
            title: "Delete Node",
            message: "Are you sure you want to delete this node and cascade to all children? This action cannot be undone.",
            confirmText: "Delete",
            isDestructive: true
        });
        if (ok) {
            this.kernel.deleteNode(tgt);
            if (this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory")) {
                await this.kernel.syncFoldersFromMasterMap(this.kernel.state);
            }
        }
    }
    actionToggleCollapse(id) { 
        const tgt = id || this.kernel.state.session.selectedId; 
        this.kernel.toggleCollapse(tgt); 
    }
    
    async actionAddChild(id, forcedType) {
        let pid = id || this.kernel.state.session.selectedId;
        let p = this.kernel.state.nodes.find(n => n.id === pid);
        if (p && (p.type === 'portal' || p.type === 'smart-portal')) {
            const parentConnection = this.kernel.state.connections.find(c => c.to === p.id && c.type === 'structural');
            const portalParentId = parentConnection ? parentConnection.from : null;

            const actions = [
                `<button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>`,
                `<button class="root-btn px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Add to Root</button>`
            ];
            if (portalParentId) {
                actions.push(`<button class="parent-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Add to Parent</button>`);
            }

            const choice = await this.showDialogModal({
                title: "Portal Child Restricted",
                contentHtml: `<p class="leading-relaxed text-slate-350">Portals are terminal nodes and cannot contain child elements. Where would you like to place this node instead?</p>`,
                actionsHtml: actions.join(' '),
                onRender: (el, close) => {
                    el.querySelector('.cancel-btn').onclick = () => close(null);
                    el.querySelector('.root-btn').onclick = () => close('root');
                    if (portalParentId) {
                        el.querySelector('.parent-btn').onclick = () => close('parent');
                    }
                }
            });

            if (choice === 'root') {
                p = this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root')) || this.kernel.state.nodes[0];
                pid = p ? p.id : null;
            } else if (choice === 'parent' && portalParentId) {
                p = this.kernel.state.nodes.find(n => n.id === portalParentId);
                pid = portalParentId;
            } else {
                return null;
            }
        }
        if (!p && this.kernel.state.nodes.length > 0) {
            p = this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root')) || this.kernel.state.nodes[0];
            pid = p.id;
        }
        if (p) {
            let type = forcedType || this.kernel.getSmartChildType(pid);
            
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
                return null;
            }
            const child = this.kernel.addNode({ title: "New " + type, type: type }, pid);
            this.kernel.addConnection(pid, child.id);
            this.kernel.selectNode(child.id); 
            p.data.collapsed = false; 

            if (this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory")) {
                await this.kernel.syncFoldersFromMasterMap(this.kernel.state);
            }

            return child;
        }
        return null;
    }

    actionAddTrueBranch(id) {
        this._addFlowBranch(id, "Yes", "New True Branch");
    }

    actionAddFalseBranch(id) {
        this._addFlowBranch(id, "No", "New False Branch");
    }

    _addFlowBranch(id, label, title) {
        const pid = id || this.kernel.state.session.selectedId;
        const p = this.kernel.state.nodes.find(n => n.id === pid);
        if (p) {
            const type = 'flow-process';
            const child = this.kernel.addNode({ title: title, type: type }, pid);
            this.kernel.addConnection(pid, child.id, 'structural');
            const conn = this.kernel.state.connections.find(c => c.from === pid && c.to === child.id && c.type === 'structural');
            if (conn) {
                conn.label = label;
            }
            this.kernel.selectNode(child.id);
            p.data.collapsed = false;
            this.render();
        }
    }

    focusInspectorTitle() {
        if (this.dom.sidebar && !this.dom.sidebar.classList.contains('open')) {
            this.toggleSidebar();
        }
        setTimeout(() => {
            const universalEngine = this.registry.get('inspector');
            if (universalEngine && universalEngine.iframe && universalEngine.iframe.contentWindow) {
                universalEngine.iframe.contentWindow.postMessage({ type: 'FOCUS_TITLE' }, '*');
            }
        }, 100);
    }

    async actionAddSibling() {
        const selectedId = this.kernel.state.session.selectedId;
        if (!selectedId) return;
        const parentConnection = this.kernel.state.connections.find(c => c.to === selectedId && c.type === 'structural');
        const parentId = parentConnection ? parentConnection.from : null;
        if (parentId) {
            const selectedNode = this.kernel.state.nodes.find(n => n.id === selectedId);
            const forcedType = selectedNode ? selectedNode.type : null;
            await this.actionAddChild(parentId, forcedType);
            this.focusInspectorTitle();
        }
    }

    handleGlobalKeydown(e) {
        // Escape handler runs regardless of input focus
        if (e.key === 'Escape') {
            if (this.isSmartOptionsOpen) {
                this.isSmartOptionsOpen = false;
                this.updateSmartActionButton();
                return;
            }

            // Find the first actually open element from the top of the stack (most recent first)
            while (this.uiStack.length > 0) {
                const topId = this.uiStack[this.uiStack.length - 1];
                
                if (topId === 'dialog') {
                    const closeBtn = document.querySelector('.fixed.inset-0.z-\\[99999\\] .close-btn');
                    if (closeBtn) {
                        closeBtn.click();
                        return;
                    }
                } else if (topId === 'profile-drawer') {
                    const drawer = document.getElementById('profile-drawer');
                    if (drawer && !drawer.classList.contains('translate-x-full')) {
                        drawer.classList.add('translate-x-full');
                        this.popUiStack('profile-drawer');
                        return;
                    }
                } else if (topId === 'data-manager-sidebar') {
                    if (this.dom.sidebar && this.dom.sidebar.classList.contains('data-manager-open')) {
                        this.toggleDataManager();
                        return;
                    }
                } else if (topId === 'tutorial-modal') {
                    if (window.Tutorials && window.Tutorials.modalElement && !window.Tutorials.modalElement.classList.contains('hidden')) {
                        window.Tutorials.closeSelectionModal();
                        return;
                    }
                } else if (topId === 'ai-chat') {
                    if (window.AI && window.AI.isOpen) {
                        window.AI.toggleChat();
                        return;
                    }
                } else if (topId === 'inspector-sidebar') {
                    if (this.dom.sidebar && this.dom.sidebar.classList.contains('open')) {
                        this.toggleSidebar();
                        return;
                    }
                }
                
                // If it wasn't actually open, pop it from the stack and continue checking the next one
                this.uiStack.pop();
            }

            // Fallback: Check elements directly in case they were opened without stack registration
            const activeDialogCloseBtn = document.querySelector('.fixed.inset-0.z-\\[99999\\] .close-btn');
            if (activeDialogCloseBtn) {
                activeDialogCloseBtn.click();
                return;
            }
            const profileDrawer = document.getElementById('profile-drawer');
            if (profileDrawer && !profileDrawer.classList.contains('translate-x-full')) {
                profileDrawer.classList.add('translate-x-full');
                return;
            }
            if (this.dom.sidebar && this.dom.sidebar.classList.contains('data-manager-open')) {
                this.toggleDataManager();
                return;
            }
            if (window.Tutorials && window.Tutorials.modalElement && !window.Tutorials.modalElement.classList.contains('hidden')) {
                window.Tutorials.closeSelectionModal();
                return;
            }
            if (window.AI && window.AI.isOpen) {
                window.AI.toggleChat();
                return;
            }
            if (this.dom.sidebar && this.dom.sidebar.classList.contains('open')) {
                this.toggleSidebar();
                return;
            }
            
            // If absolutely no overlays are open, navigate up selected node's branch to the root
            const selectedId = this.kernel.state.session.selectedId;
            if (selectedId) {
                const parentConnection = this.kernel.state.connections.find(c => c.to === selectedId && c.type === 'structural');
                const parentId = parentConnection ? parentConnection.from : null;
                if (parentId) {
                    this.kernel.selectNode(parentId);
                    this.render();
                    return;
                }
            }

            if (this.kernel.portalHistory && this.kernel.portalHistory.length > 0) {
                this.actionExitPortal();
                return;
            }
        }

        // Do not interfere with text inputs, textareas, contenteditable elements, or open modal dialogs
        const target = e.target;
        const isEditable = target.tagName === 'INPUT' || 
                           target.tagName === 'TEXTAREA' || 
                           target.isContentEditable || 
                           target.closest('[contenteditable="true"]');
        if (isEditable) return;

        // Do not interfere if a modal backdrop is active
        if (document.querySelector('.fixed.inset-0.z-\\[99999\\]')) return;

        // Do not interfere if AI Chat is open
        if (window.AI && window.AI.isOpen) return;

        const selectedId = this.kernel.state.session.selectedId;

        const isCmdOrCtrl = e.ctrlKey || e.metaKey;
        if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
            if (selectedId) {
                e.preventDefault();
                this.actionCopyBranch(selectedId);
                return;
            }
        }
        
        if (this.kernel.isReadOnly) {
            if (isCmdOrCtrl && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                return;
            }
            if (e.key === 'Delete') {
                e.preventDefault();
                return;
            }
            if (e.key === 'Enter') {
                if (this.isSmartOptionsOpen && this.smartButtonOptions && this.smartButtonOptions.length > 0) {
                    // Fall through to original Enter options trigger
                } else {
                    e.preventDefault();
                    const btn = document.getElementById('btn-smart-action');
                    if (btn && !btn.classList.contains('hidden')) {
                        btn.click();
                    }
                    return;
                }
            }
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            if (selectedId) {
                (async () => {
                    const added = await this.actionAddChild();
                    if (added) this.focusInspectorTitle();
                })();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.isSmartOptionsOpen && this.smartButtonOptions && this.smartButtonOptions.length > 0) {
                const opt = this.smartButtonOptions[this.selectedSmartOptionIdx];
                if (opt) {
                    opt.action();
                    this.isSmartOptionsOpen = false;
                    this.updateSmartActionButton();
                }
            } else if (selectedId) {
                this.actionAddSibling();
            }
        } else if (e.key === 'Delete') {
            e.preventDefault();
            if (selectedId) {
                this.actionDelete(selectedId);
            }
        } else if (e.key === ' ' || e.key === 'Spacebar') {
            if (selectedId) {
                e.preventDefault();
                if (this.smartButtonOptions && this.smartButtonOptions.length > 1) {
                    if (!this.isSmartOptionsOpen) {
                        this.isSmartOptionsOpen = true;
                        this.selectedSmartOptionIdx = 0;
                        this.updateSmartActionButton();
                    } else {
                        const opt = this.smartButtonOptions[this.selectedSmartOptionIdx];
                        if (opt) {
                            opt.action();
                            this.isSmartOptionsOpen = false;
                            this.updateSmartActionButton();
                        }
                    }
                } else {
                    const btn = document.getElementById('btn-smart-action');
                    if (btn && !btn.classList.contains('hidden')) {
                        btn.click();
                    }
                }
            }
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if (this.isSmartOptionsOpen && this.smartButtonOptions) {
                if (e.key === 'ArrowUp') {
                    this.selectedSmartOptionIdx = (this.selectedSmartOptionIdx - 1 + this.smartButtonOptions.length) % this.smartButtonOptions.length;
                    this.updateSmartActionButton();
                } else if (e.key === 'ArrowDown') {
                    this.selectedSmartOptionIdx = (this.selectedSmartOptionIdx + 1) % this.smartButtonOptions.length;
                    this.updateSmartActionButton();
                }
            } else {
                this.navigateSelection(e.key);
            }
        }
    }

    navigateSelection(direction) {
        const getRootNode = () => {
            return this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root') || n.data?.isCore);
        };
        
        const root = getRootNode();
        const selectedId = this.kernel.state.session.selectedId;
        if (!selectedId) {
            if (root) {
                this.kernel.selectNode(root.id);
                this.render();
            }
            return;
        }

        const node = this.kernel.state.nodes.find(n => n.id === selectedId);
        if (!node) return;

        const nodePos = this.getVisualPos(node);
        const rootPos = root ? this.getVisualPos(root) : { x: 0, y: 0 };
        const isOnRight = nodePos.x >= rootPos.x;

        // Helper to find closest child by Y coordinate
        const getClosestChild = (childList, targetY) => {
            if (childList.length === 0) return null;
            return childList.reduce((closest, child) => {
                const closestPos = this.getVisualPos(closest);
                const childPos = this.getVisualPos(child);
                return Math.abs(childPos.y - targetY) < Math.abs(closestPos.y - targetY) ? child : closest;
            });
        };

        // Find structural children
        const childConnections = this.kernel.state.connections.filter(c => c.from === node.id && c.type === 'structural');
        const children = childConnections.map(c => this.kernel.state.nodes.find(n => n.id === c.to)).filter(Boolean);

        // Find structural parent
        const parentConnection = this.kernel.state.connections.find(c => c.to === node.id && c.type === 'structural');
        const parent = parentConnection ? this.kernel.state.nodes.find(n => n.id === parentConnection.from) : null;

        let targetNode = null;

        // --- 0. WEB MODE STRUCTURAL TRAVERSAL ---
        if (this.viewMode === 'web') {
            if (direction === 'ArrowUp') {
                targetNode = parent;
            } else if (direction === 'ArrowDown') {
                targetNode = children.length > 0 ? children[0] : null;
            } else if ((direction === 'ArrowLeft' || direction === 'ArrowRight') && parent) {
                const siblingConnections = this.kernel.state.connections.filter(c => c.from === parent.id && c.type === 'structural');
                const siblings = siblingConnections.map(c => this.kernel.state.nodes.find(n => n.id === c.to)).filter(Boolean);
                // We rely on connection insertion order for web DOM structure
                const idx = siblings.findIndex(s => s.id === node.id);
                if (idx !== -1) {
                    targetNode = direction === 'ArrowLeft' ? siblings[idx - 1] : siblings[idx + 1];
                }
            }
            
            if (targetNode) {
                this.kernel.selectNode(targetNode.id);
                this.render();
            }
            return;
        }

        // --- 1. TRY SEMANTIC TRAVERSAL ---
        if (direction === 'ArrowLeft') {
            if (node === root) {
                // From root, go to left branch children
                const leftChildren = children.filter(c => this.getVisualPos(c).x < rootPos.x);
                targetNode = getClosestChild(leftChildren, rootPos.y);
            } else if (isOnRight) {
                // If on right side, left arrow goes back towards parent
                targetNode = parent;
            } else {
                // If on left side, left arrow goes deeper into left children
                const leftChildren = children.filter(c => this.getVisualPos(c).x < nodePos.x);
                targetNode = getClosestChild(leftChildren.length > 0 ? leftChildren : children, nodePos.y);
            }
        } else if (direction === 'ArrowRight') {
            if (node === root) {
                // From root, go to right branch children
                const rightChildren = children.filter(c => this.getVisualPos(c).x > rootPos.x);
                targetNode = getClosestChild(rightChildren, rootPos.y);
            } else if (isOnRight) {
                // If on right side, right arrow goes deeper into right children
                const rightChildren = children.filter(c => this.getVisualPos(c).x > nodePos.x);
                targetNode = getClosestChild(rightChildren.length > 0 ? rightChildren : children, nodePos.y);
            } else {
                // If on left side, right arrow goes back towards parent
                targetNode = parent;
            }
        } else if (direction === 'ArrowUp' || direction === 'ArrowDown') {
            if (parent) {
                const siblingConnections = this.kernel.state.connections.filter(c => c.from === parent.id && c.type === 'structural');
                const siblings = siblingConnections.map(c => this.kernel.state.nodes.find(n => n.id === c.to)).filter(Boolean);
                
                // Sort siblings by Y coordinate
                siblings.sort((a, b) => this.getVisualPos(a).y - this.getVisualPos(b).y);
                
                const idx = siblings.findIndex(s => s.id === node.id);
                if (idx !== -1) {
                    if (direction === 'ArrowUp') {
                        targetNode = siblings[idx - 1] || null;
                    } else {
                        targetNode = siblings[idx + 1] || null;
                    }
                }
            }
        }

        // --- 2. FALLBACK TO SPATIAL TRAVERSAL ---
        if (!targetNode) {
            const allNodes = this.kernel.state.nodes.filter(n => n.id !== selectedId);
            let bestScore = Infinity;

            allNodes.forEach(n => {
                const pos = this.getVisualPos(n);
                const dx = pos.x - nodePos.x;
                const dy = pos.y - nodePos.y;
                const dist = Math.hypot(dx, dy);

                let isHeadingCorrect = false;
                let directionalDiff = 0;

                switch (direction) {
                    case 'ArrowLeft':
                        isHeadingCorrect = dx < 0;
                        directionalDiff = Math.abs(dy);
                        break;
                    case 'ArrowRight':
                        isHeadingCorrect = dx > 0;
                        directionalDiff = Math.abs(dy);
                        break;
                    case 'ArrowUp':
                        isHeadingCorrect = dy < 0;
                        directionalDiff = Math.abs(dx);
                        break;
                    case 'ArrowDown':
                        isHeadingCorrect = dy > 0;
                        directionalDiff = Math.abs(dx);
                        break;
                }

                if (isHeadingCorrect) {
                    const score = dist + directionalDiff * 1.5;
                    if (score < bestScore) {
                        bestScore = score;
                        targetNode = n;
                    }
                }
            });
        }

        if (targetNode) {
            // Auto‑expand collapsed folder nodes and sync project state
            if (targetNode.type === 'file-folder' && targetNode.data && targetNode.data.collapsed) {
                targetNode.data.collapsed = false;
                if (this.state.meta && (this.state.meta.isMaster === true || this.state.meta.title === 'Project Directory' || this.state.meta.type === 'file-root')) {
                    const projId = this.state.meta.project_id || this.activeProjectId;
                    if (projId && targetNode.content) {
                        this.updateProjectFolder(projId, targetNode.content, { isExpanded: true }).catch(console.error);
                    }
                }
            }
            this.kernel.selectNode(targetNode.id);
            this.render();
        }
    }

    async actionEnterPortal(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (node) {
            if (node.type === 'file-root') {
                this.setView('map');
                this.actionCloseDataManager();
                this.render();
                return;
            }
            if (node.type === 'portal' || node.type === 'smart-portal' || node.type === 'file-document') {
                const lib = this.kernel.getLibrary();
                const existingMap = lib.find(m => m.map_id === node.content);
                if (existingMap) {
                    // Navigate directly to existing page
                    this.kernel.enterPortal(existingMap);
                    const mapType = this.kernel.state.meta && this.kernel.state.meta.type ? this.kernel.state.meta.type : 'generic';
                    this.setView('map');
                    this.actionCloseDataManager();
                    this.render();
                } else {
                    // Open selection modal to choose existing or create new
                    this.actionSetPortalTarget(tgt);
                }
            }
        }
    }

    async actionLaunchWebPortal(id) {
        await this.actionEnterPortal(id);
        this.setView('web');
    }

    async actionConfigureAgentPortal(id) {
        await this.actionEnterPortal(id);
        this.setView('agent');
    }

    async actionViewPersonPortal(id) {
        await this.actionEnterPortal(id);
        this.setView('person');
    }

    async actionOpenFileInNewTab(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (!node || node.type !== 'file-document') return;
        
        try {
            const handle = await this.kernel.getFileHandleForNode(node.id);
            if (!handle) {
                alert("This file is not mounted locally or is not a local OS file.");
                return;
            }
            
            // Verify read permissions
            const opt = { mode: 'read' };
            if ((await handle.queryPermission(opt)) !== 'granted') {
                if ((await handle.requestPermission(opt)) !== 'granted') {
                    alert("Permission denied to read this file.");
                    return;
                }
            }
            
            const file = await handle.getFile();
            const url = URL.createObjectURL(file);
            window.open(url, '_blank');
        } catch(e) {
            console.error("Open file in tab failed:", e);
            alert("Failed to open file: " + e.message);
        }
    }

    async actionMountDirectory(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (!node || node.type !== 'file-root') return;
        
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await FileHandleStore.set(node.id, handle);
            
            node.root_metadata = node.root_metadata || {};
            node.root_metadata.source = 'local_os';
            node.root_metadata.is_mounted = true;
            node.root_metadata.directory_name = handle.name;
            
            this.kernel.syncTitlesFromPayload(node.id, handle.name);
            
            // Expand the folder automatically
            node.data.collapsed = false;
            
            this.kernel.saveCurrentMapToLibrary();
            
            // Parse entries
            await this.expandLocalOSFolder(node.id);
            this.render();
            this.showToast("Directory mounted successfully!", "success");
        } catch(e) {
            console.error("Mount directory failed:", e);
            if (e.name !== 'AbortError') {
                alert("Failed to mount directory: " + e.message);
            }
        }
    }

    async expandLocalOSFolder(nodeId) {
        const node = this.kernel.state.nodes.find(n => n.id === nodeId);
        if (!node || (node.type !== 'file-root' && node.type !== 'file-folder')) return;
        
        let handle;
        try {
            handle = await this.kernel.getDirectoryHandleForNode(node.id);
        } catch(e) {
            console.error("Failed to get handle:", e);
            return;
        }
        if (!handle) return;
        
        // Verify/Request permission
        const permission = await this.verifyFSReadWritePermission(handle);
        if (!permission) return;
        
        // Read top level children
        const entries = [];
        try {
            for await (const entry of handle.values()) {
                entries.push(entry);
            }
        } catch(e) {
            console.error("Error reading directory values:", e);
            return;
        }
        
        // Filter child nodes of this node
        const childrenConns = this.kernel.state.connections.filter(c => c.from === node.id && c.type === 'structural');
        const childrenNodes = childrenConns.map(c => this.kernel.state.nodes.find(n => n.id === c.to)).filter(n => n);
        
        let changed = false;
        for (const entry of entries) {
            const isDir = entry.kind === 'directory';
            const type = isDir ? 'file-folder' : 'file-document';
            
            // Check if node already exists
            const exists = childrenNodes.some(n => n.title === entry.name && n.type === type);
            if (!exists) {
                const childNode = this.kernel.addNode({
                    type: type,
                    title: entry.name,
                    content: entry.name
                }, node.id);
                this.kernel.addConnection(node.id, childNode.id);
                changed = true;
            }
        }
        
        if (changed) {
            this.kernel.saveCurrentMapToLibrary();
            this.render();
        }
    }

    async verifyFSReadWritePermission(fileHandle) {
        try {
            const opts = { mode: 'readwrite' };
            if ((await fileHandle.queryPermission(opts)) === 'granted') {
                return true;
            }
            if ((await fileHandle.requestPermission(opts)) === 'granted') {
                return true;
            }
        } catch(e) {
            console.error("verifyFSReadWritePermission error:", e);
        }
        return false;
    }
    
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 right-4 px-4 py-2.5 rounded-xl text-white text-xs font-bold shadow-2xl transition-all duration-500 transform translate-y-10 opacity-0 z-[9999] ${
            type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-slate-800'
        }`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove('translate-y-10', 'opacity-0');
        }, 100);
        setTimeout(() => {
            toast.classList.add('translate-y-10', 'opacity-0');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }

    getWebLinkUrl(node, state) {
        if (!node || node.type !== 'web-link') return null;
        let href = '';
        let isJson = false;
        let data = {};
        try {
            data = JSON.parse(node.content || '{}');
            href = data.href || '';
            isJson = true;
        } catch(e) {
            href = node.content || '';
        }
        href = href.trim();

        // If JSON contains no href but contains a web-pointing text, treat text as the href
        if (isJson && !href && data.text) {
            const txt = data.text.trim();
            const isWeb = txt.match(/^(https?:\/\/|www\.)/i) || txt.match(/[a-z0-9\-]+\.[a-z]{2,6}(\/|$)/i);
            if (isWeb) {
                href = txt;
            }
        }
        
        if (!href) return null;
        
        // Check if pointing to a node ID in the map
        if (state && state.nodes && state.nodes.some(n => n.id === href)) {
            return null; // internal link, no external favicon/navigation target
        }
        
        // Auto prefix protocol if missing
        if (!href.match(/^(https?:\/\/|file:\/\/|\/|\.\/|\.\.\/|#)/i)) {
            href = 'https://' + href;
        }
        
        // If it starts with local references/hashes, skip favicon/external domain parsing
        if (href.startsWith('#') || href.startsWith('.') || href.startsWith('/')) {
            return null;
        }
        
        return href;
    }

    getDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            return null;
        }
    }

    actionOpenWebLink(nodeId) {
        const node = this.kernel.state.nodes.find(n => n.id === nodeId);
        const url = this.getWebLinkUrl(node, this.kernel.state);
        if (url) {
            window.open(url, '_blank');
        } else {
            alert('No valid URL specified on this link node.');
        }
    }

    async actionTriggerLinktreeImport(rootNodeId) {
        const rootNode = this.kernel.state.nodes.find(n => n.id === rootNodeId);
        if (!rootNode) return;

        const contentHtml = `
            <div class="flex flex-col gap-3">
                <p class="text-slate-350">Paste any text containing links (e.g. copied screen text from a Linktree page, a list of URLs and titles, markdown links, or the HTML source code) below:</p>
                <textarea id="linktree-html-input" placeholder="Paste text, URLs, markdown links, or HTML code here..." class="w-full bg-slate-950 border border-slate-700/80 text-slate-200 p-3 rounded-lg text-xs font-mono focus:border-sky-500 outline-none resize-none shadow-inner h-48"></textarea>
                <div class="text-[10px] text-slate-500 bg-slate-950/40 p-2 rounded border border-slate-800">
                    💡 <strong>Tip:</strong> Open any link page in a browser, highlight/copy the text, and paste it here. Titles and URLs will be automatically matched!
                </div>
            </div>
        `;

        const actionsHtml = `
            <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>
            <button class="import-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Import Links</button>
        `;

        const choice = await this.showDialogModal({
            title: "🌳 General Link Importer",
            contentHtml: contentHtml,
            actionsHtml: actionsHtml,
            onRender: (el, close) => {
                el.querySelector('.cancel-btn').onclick = () => close(null);
                el.querySelector('.import-btn').onclick = () => {
                    const html = el.querySelector('#linktree-html-input').value;
                    close(html);
                };
            }
        });

        if (!choice) return;

        let html = choice.trim();
        let links = [];

        // Method 1: HTML & Next.js Hydration Parser
        if (html.includes('<') && (html.toLowerCase().includes('<a') || html.toLowerCase().includes('<script') || html.toLowerCase().includes('<div'))) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const nextScript = doc.querySelector('#__NEXT_DATA__');
            if (nextScript) {
                try {
                    const json = JSON.parse(nextScript.textContent || '{}');
                    const traverse = (obj) => {
                        if (!obj || typeof obj !== 'object') return;
                        if (Array.isArray(obj)) {
                            obj.forEach(item => {
                                if (item && item.url && item.title) {
                                    links.push({ title: item.title.trim(), url: item.url.trim() });
                                } else {
                                    traverse(item);
                                }
                            });
                        } else {
                            for (let k in obj) {
                                traverse(obj[k]);
                            }
                        }
                    };
                    traverse(json);
                } catch(e) {
                    console.warn("Failed parsing NextJS JSON state:", e);
                }
            }

            if (links.length === 0) {
                doc.querySelectorAll('a').forEach(a => {
                    const href = (a.getAttribute('href') || '').trim();
                    const text = (a.textContent || '').trim();
                    if (href && text) {
                        const lowerHref = href.toLowerCase();
                        const lowerText = text.toLowerCase();
                        if (lowerHref.startsWith('javascript:') || lowerHref.startsWith('#') || 
                            lowerHref === 'https://linktr.ee' || lowerHref === 'https://linktr.ee/' || 
                            lowerText.includes('create your linktree') || lowerText.includes('cookie') || lowerText.includes('terms') || 
                            lowerText.includes('privacy') || lowerText.includes('report this linktree') || lowerText.includes('support')) {
                            return;
                        }
                        links.push({ title: text, url: href });
                    }
                });
            }
        }

        // Method 2: Intelligent Plain Text / Markdown / List Parser
        if (links.length === 0) {
            const lines = html.split('\n').map(l => l.trim()).filter(l => l);
            const usedUrls = new Set();

            // Extract Markdown link syntaxes first [Title](URL)
            const markdownRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
            let match;
            while ((match = markdownRegex.exec(html)) !== null) {
                const title = match[1].trim();
                const url = match[2].trim();
                links.push({ title, url });
                usedUrls.add(url);
            }

            // Extract lines and map sequential titles & URLs
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const isUrl = line.match(/^(https?:\/\/)?([a-z0-9\-]+\.)+[a-z]{2,6}(\/|$)/i);
                if (isUrl) {
                    let url = line;
                    if (!url.match(/^https?:\/\//i)) {
                        url = 'https://' + url;
                    }
                    if (usedUrls.has(url)) continue;

                    let title = '';
                    if (i > 0) {
                        const prevLine = lines[i - 1];
                        const prevIsUrl = prevLine.match(/^(https?:\/\/)?([a-z0-9\-]+\.)+[a-z]{2,6}(\/|$)/i);
                        if (!prevIsUrl && prevLine.length < 100) {
                            title = prevLine;
                        }
                    }
                    if (!title && i < lines.length - 1) {
                        const nextLine = lines[i + 1];
                        const nextIsUrl = nextLine.match(/^(https?:\/\/)?([a-z0-9\-]+\.)+[a-z]{2,6}(\/|$)/i);
                        if (!nextIsUrl && nextLine.length < 100) {
                            title = nextLine;
                        }
                    }

                    if (!title) {
                        try {
                            const domain = new URL(url).hostname;
                            title = domain.replace('www.', '');
                        } catch(e) {
                            title = 'Link';
                        }
                    }
                    links.push({ title, url });
                    usedUrls.add(url);
                }
            }
        }

        if (links.length === 0) {
            alert("No links detected. Paste text containing URLs or markdown links!");
            return;
        }

        // Add nodes to the map around rootNode
        links.forEach((link, idx) => {
            const angle = (idx / links.length) * Math.PI * 2;
            const radius = 180 + Math.floor(idx / 5) * 50; 
            const posX = Math.round(Math.cos(angle) * radius);
            const posY = Math.round(Math.sin(angle) * radius);

            const contentObj = { text: link.title, href: link.url };
            const childNode = this.kernel.addNode({ 
                title: link.title, 
                type: 'web-link', 
                content: JSON.stringify(contentObj),
                data: { x: posX, y: posY }
            }, rootNodeId);
            
            if (childNode) {
                this.kernel.addConnection(rootNodeId, childNode.id);
            }
        });

        rootNode.data.collapsed = false;
        this.render();
        alert(`Successfully imported ${links.length} links!`);
    }

    compileWebNodeToHtml(nodeId, isRootNode) {
        const state = this.kernel.state;
        const targetNode = state.nodes.find(n => n.id === nodeId);
        if (!targetNode) return '';

        const getKids = (id) => state.connections.filter(c => c.from === id).map(c => state.nodes.find(n => n.id === c.to)).filter(n => n);
        
        const escapeHTML = (str) => {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const renderContent = (str) => {
            if (str === null || str === undefined) return '';
            if (/<[a-z][\s\S]*>/i.test(str)) {
                return str;
            }
            return escapeHTML(str).replace(/\n/g, '<br>');
        };

        const renderNode = (node) => {
            const kids = getKids(node.id).map(n => {
                let childHtml = renderNode(n);
                if (node.type === 'web-carousel') return `<div class="snap-center shrink-0">${childHtml}</div>`;
                return childHtml;
            }).join('');
            
            const title = escapeHTML(node.title || '');
            let contentRaw = node.content ? node.content.trim() : '';
            
            let data = { text: contentRaw, classes: '', src: '', href: '' };
            if (node.type.startsWith('web-') && node.type !== 'web-root') {
                try {
                    const pData = JSON.parse(contentRaw);
                    if (typeof pData === 'object' && pData !== null) {
                        data = { ...data, ...pData };
                    }
                } catch(e) {}
            }
            let content = data.text;
            let classes = data.classes;
            let src = data.src;
            let href = data.href;
            
            const getAttrs = (defaultClasses) => {
                const finalClasses = (classes || defaultClasses || '').trim();
                return finalClasses ? `class="${escapeHTML(finalClasses)}"` : '';
            };

            switch(node.type) {
                case 'web-root':
                    let iframeHtml = '';
                    let isUrl = false;
                    let url = contentRaw;

                    if (contentRaw && !/\n/.test(contentRaw)) { 
                        const hasSpaces = /\s/.test(contentRaw);
                        const hasProtocol = /^(https?:\/\/|file:\/\/)/i.test(contentRaw);
                        const startsWithWww = /^www\./i.test(contentRaw);
                        const isLocalPath = /^(\.\/|\.\.\/|\/)/.test(contentRaw) || /\.html?$/i.test(contentRaw);
                        const looksLikeDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/?.*)?$/.test(contentRaw) && !hasSpaces;
                        const isLocalHost = /^localhost(:\d+)?/i.test(contentRaw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(contentRaw);

                        if (hasProtocol || isLocalPath) {
                            isUrl = true;
                        } else if (startsWithWww || looksLikeDomain) {
                            isUrl = true;
                            url = 'https://' + contentRaw;
                        } else if (isLocalHost && !hasSpaces) {
                            isUrl = true;
                            url = 'http://' + contentRaw;
                        }
                    }

                    if (isUrl) {
                        const iframeClass = kids ? 'w-full h-[85vh] border-none block' : 'w-full h-screen border-none block';
                        iframeHtml = `<iframe src="${url}" class="${iframeClass}" title="Embedded Webpage"></iframe>`;
                    }

                    let textContent = (!isUrl && contentRaw) ? `<div class="py-12 px-8 max-w-5xl mx-auto prose text-slate-700">${renderContent(contentRaw)}</div>` : '';
                    const kidsContainer = kids ? `<div class="${isUrl ? 'relative z-10 bg-slate-50 shadow-[0_-20px_50px_rgba(0,0,0,0.15)] pt-10' : ''}">${kids}</div>` : '';
                    
                    return `<main ${getAttrs('')}>${iframeHtml}${textContent}${kidsContainer}</main>`;

                case 'web-nav':
                    return `<nav ${getAttrs('flex flex-wrap items-center justify-between gap-4 md:gap-6 p-4 md:p-6 bg-white shadow-sm sticky top-0 z-50 border-b border-slate-100 w-full')}><div class="font-black text-xl tracking-tighter">MyBrand</div><div class="flex flex-wrap items-center gap-4 md:gap-6">${kids}</div></nav>`;

                case 'web-hero':
                    let bgStyle = src ? `style="background-image: url('${escapeHTML(src)}'); background-size: cover; background-position: center;"` : '';
                    return `<header ${getAttrs('bg-gradient-to-br from-slate-900 to-indigo-950 text-white py-24 md:py-32 px-4 md:px-8 text-center w-full relative')} ${bgStyle}>
                        ${src ? '<div class="absolute inset-0 bg-slate-900/70 z-0"></div>' : ''}
                        <div class="relative z-10"><h1 class="text-5xl md:text-7xl font-black mb-6 tracking-tight">${title}</h1><div class="text-lg md:text-xl text-indigo-200 max-w-3xl mx-auto mb-10">${renderContent(content || '')}</div><div class="flex flex-wrap justify-center gap-4">${kids}</div></div>
                    </header>`;

                case 'web-section':
                    return `<section ${getAttrs('py-16 md:py-20 px-4 md:px-8 max-w-6xl mx-auto w-full')}><h2 class="text-3xl md:text-4xl font-black mb-10 text-center">${title}</h2><div class="flex flex-col gap-8 w-full">${kids}</div></section>`;

                case 'web-card':
                    return `<div ${getAttrs('bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all flex flex-col gap-3 h-full')}>${title ? `<h3 class="font-bold text-lg text-slate-900 mb-1 leading-snug">${title}</h3>` : ''}${content ? `<div class="text-slate-600 text-sm leading-relaxed">${renderContent(content)}</div>` : ''}${kids ? `<div class="mt-2 flex flex-col gap-2">${kids}</div>` : ''}</div>`;

                case 'web-button':
                    return `<button ${getAttrs('px-6 md:px-8 py-3 bg-indigo-600 text-white font-bold rounded-full shadow-lg shadow-indigo-500/30 hover:bg-indigo-500 hover:-translate-y-0.5 transition-all inline-block')}>${title || content}</button>`;

                case 'web-link':
                    let linkHref = href;
                    if (!linkHref) {
                        if (state.nodes.find(n => n.id === content)) linkHref = `#${content}`; 
                        else if (content && !content.match(/^(https?:\/\/|file:\/\/|\/|\.\/|\.\.\/|#)/i)) linkHref = `https://${content}`; 
                        else linkHref = content;
                    }
                    return `<a href="${escapeHTML(linkHref || '#')}" ${getAttrs('text-blue-600 hover:underline block py-1 font-semibold')}>${title}</a>`;

                case 'web-image':
                    return `<img src="${escapeHTML(src || content || '')}" alt="${title}" ${getAttrs('max-w-full h-auto rounded-lg shadow-sm mx-auto')} />`;

                case 'web-video':
                    return `<video src="${escapeHTML(src || content || '')}" controls ${getAttrs('w-full rounded-lg shadow-sm')}></video>`;

                case 'web-form':
                    return `<form ${getAttrs('flex flex-col gap-4 w-full max-w-md mx-auto')}><h3 class="font-bold text-lg mb-2 text-center">${title}</h3>${kids}</form>`;

                case 'web-input':
                    return `<input type="text" placeholder="${title || content}" ${getAttrs('border border-slate-300 rounded px-4 py-2 w-full focus:outline-none focus:border-indigo-500')} />`;

                case 'web-grid':
                    return `<div ${getAttrs('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full')}>${kids}</div>`;

                case 'web-list':
                    return `<ul ${getAttrs('list-disc pl-5 space-y-2 text-slate-700 w-full')}>${kids}</ul>`;

                case 'web-modal':
                    return `<div><dialog id="${node.id}" class="${escapeHTML(classes || 'p-6 md:p-8 rounded-2xl shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm w-[90%] max-w-lg')}"><h3 class="font-bold text-2xl mb-4">${title}</h3>${kids}<form method="dialog" class="mt-6 flex justify-end"><button class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-slate-800 font-bold transition-colors">Close</button></form></dialog><div class="w-full flex justify-center mt-4"><button onclick="document.getElementById('${node.id}').showModal()" class="px-6 py-3 bg-white border border-slate-200 shadow-sm rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">Open ${title}</button></div></div>`;

                case 'web-carousel':
                    return `<div ${getAttrs('flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 w-full custom-scrollbar')}>${kids}</div>`;

                case 'web-footer':
                    return `<footer ${getAttrs('py-12 px-4 md:px-8 mt-12 border-t border-slate-200 text-center bg-slate-100 w-full')}>${kids || `<p class="text-slate-500 text-sm font-semibold">${escapeHTML(content || title)}</p>`}</footer>`;

                case 'web-text':
                    return `<div ${getAttrs('mb-4 w-full')}><h3 class="font-bold text-xl text-slate-800 mb-3">${title}</h3><div class="text-slate-600 leading-relaxed">${renderContent(content || '')}</div>${kids}</div>`;

                default:
                    return `<div ${getAttrs('mb-6')}><h3 class="font-bold text-lg text-slate-800 mb-2">${title}</h3><div class="prose text-slate-600 leading-relaxed">${renderContent(content)}</div>${kids}</div>`;
            }
        };

        const innerHtml = renderNode(targetNode);
        if (isRootNode) {
            return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHTML(targetNode.title || 'Exported Page')}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { margin: 0; min-height: 100vh; background-color: #f8fafc; }
    </style>
</head>
<body>
${innerHtml}
</body>
</html>`;
        }
        return innerHtml;
    }

    actionPreviewWebPage(nodeId) {
        const html = this.compileWebNodeToHtml(nodeId, true);
        const win = window.open();
        if (win) {
            win.document.write(html);
            win.document.close();
        } else {
            alert("Popup blocked! Please allow popups to preview the page.");
        }
    }

    actionDownloadWebCode(nodeId) {
        const node = this.kernel.state.nodes.find(n => n.id === nodeId);
        if (!node) return;
        const isRoot = node.type === 'web-root';
        const html = this.compileWebNodeToHtml(nodeId, isRoot);
        const filename = isRoot ? 'index.html' : `${node.title || 'element'}.html`;
        
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }


    async actionOpenPortalLocal(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (node && (node.type === 'portal' || node.type === 'smart-portal')) {
            if (node.content) {
                this.kernel.openPortal(tgt);
                this.render();
            } else {
                this.actionSetPortalTarget(tgt);
            }
        }
    }

    async actionSetPortalTarget(nodeId, forceTab = null) {
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

        let selectedPageId = node.content || null;
        let activeTab = forceTab || (selectedPageId ? 'existing' : 'new'); // Default to 'new' if unlinked
        let selectedPageTitle = '-- Choose Target Page --';
        if (selectedPageId) {
            const targetMap = lib.find(m => m.map_id === selectedPageId);
            if (targetMap) {
                selectedPageTitle = targetMap.meta?.title || targetMap.map_id;
            }
        }

        // Determine default type to pre-pack for the Create New Page section
        let defaultNewType = 'generic';
        let preSelectedFromInspector = false;

        const universalEngine = this.registry.get('inspector');
        if (universalEngine && universalEngine.iframe && universalEngine.iframe.contentDocument) {
            const selectEl = universalEngine.iframe.contentDocument.getElementById('portal-new-type');
            if (selectEl && selectEl.value) {
                defaultNewType = selectEl.value;
                preSelectedFromInspector = true;
            }
        }

        if (!preSelectedFromInspector) {
            const currentMapType = this.kernel.state.meta?.type;
            if (currentMapType && currentMapType !== 'generic') {
                const schema = typeof MultiMapSchema !== 'undefined' ? MultiMapSchema : null;
                if (schema && schema.mapTypes && schema.mapTypes[currentMapType]) {
                    defaultNewType = currentMapType;
                }
            }
        }

        const contentHtml = `
            <div class="flex flex-col gap-4 font-sans text-slate-300">
                <!-- Tabs Header -->
                <div class="flex border-b border-slate-800/80">
                    <button id="tab-existing" class="flex-1 py-2 text-center text-xs font-bold border-b-2 ${activeTab === 'existing' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'} focus:outline-none transition-all cursor-pointer bg-transparent">Link Existing Page</button>
                    <button id="tab-new" class="flex-1 py-2 text-center text-xs font-bold border-b-2 ${activeTab === 'new' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'} focus:outline-none transition-all cursor-pointer bg-transparent">Create New Page</button>
                </div>

                <!-- Existing Page Section -->
                <div id="section-existing" class="flex flex-col gap-2 ${activeTab === 'existing' ? '' : 'hidden'}">
                    <label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select Existing Page</label>
                    <div class="relative w-full">
                        <button id="page-selector-btn" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-left text-slate-400 hover:border-slate-700 transition-colors flex justify-between items-center cursor-pointer">
                            <span id="page-selector-label" class="truncate ${node.content ? 'text-slate-200' : 'text-slate-400'}">${selectedPageTitle}</span>
                            <span class="text-slate-500 text-[10px]">▼</span>
                        </button>
                    </div>
                </div>

                <!-- Create New Section -->
                <div id="section-new" class="flex flex-col gap-3 ${activeTab === 'new' ? '' : 'hidden'}">
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Name</label>
                        <input type="text" id="new-page-title" value="${node.title || 'Sub Map'}" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                    </div>
                    <div class="flex flex-col gap-1.5">
                        <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Type</label>
                        <select id="new-page-type" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                            ${this.getMapTypeOptionsHtml(defaultNewType)}
                        </select>
                    </div>
                </div>
            </div>
        `;

        const actionsHtml = `
            <div class="flex w-full justify-end items-center gap-2">
                <button id="portal-btn-cancel" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel</button>
                <button id="portal-btn-submit" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Link Page</button>
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
                    const isAlreadyConfigured = !!node.content;
                    const isMobile = window.innerWidth <= 768;
                    if (activeTab === 'existing') {
                        btnSubmit.disabled = !selectedPageId;
                        btnSubmit.style.opacity = selectedPageId ? '1' : '0.5';
                        btnSubmit.textContent = isAlreadyConfigured ? 'Update' : 'Link Page';
                    } else {
                        const hasTitle = !!inputTitle.value.trim();
                        btnSubmit.disabled = !hasTitle;
                        btnSubmit.style.opacity = hasTitle ? '1' : '0.5';
                        if (isAlreadyConfigured) {
                            btnSubmit.textContent = isMobile ? 'Create' : 'Create & Update';
                        } else {
                            btnSubmit.textContent = 'Create & Link';
                        }
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
                        b.className = "text-left w-full px-3 py-2 text-[10px] font-medium text-slate-300 hover:bg-indigo-600 hover:text-white flex items-center justify-between transition-colors border-none bg-transparent cursor-pointer";
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
                            // Inherit folder assignment if the parent map is in a folder
                            const proj = this.kernel.getProjects().find(p => p.project_id === this.kernel.activeProjectId);
                            const currentMapId = this.kernel.state.map_id;
                            const isProjectDir = this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === 'Project Directory' || this.kernel.state.meta.type === 'file-root');
                            
                            if (!isProjectDir && proj && proj.page_assignments && proj.page_assignments[currentMapId]) {
                                const currentFolderId = proj.page_assignments[currentMapId];
                                await this.kernel.assignPageToFolder(this.kernel.activeProjectId, newPage.map_id, currentFolderId);
                            }

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
                            
                            setTimeout(() => this.actionOpenPageSettings(newPage.map_id), 50);
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
            this.actionCloseDataManager();
        }
    }

    async actionGoToDirectory(nodeId) {
        if (this.kernel.isReadOnly) return;
        let projectId = this.kernel.state.meta && this.kernel.state.meta.project_id;
        if (!projectId) projectId = this.kernel.activeProjectId;
        if (!projectId) return;

        // Remember the map we are coming from so we can focus its portal
        const currentMapId = this.kernel.state.map_id;

        // Ensure master map exists then navigate to it
        const masterMap = await this.kernel.getOrCreateMasterMap(projectId);
        if (!masterMap) {
            alert('No project directory found.');
            return;
        }
        // Retrieve full saved state for the master map
        const lib = this.kernel.getLibrary();
        const masterState = lib.find(m => m.map_id === masterMap.map_id) || masterMap;
        
        // Clear portal history and load the project directory directly
        this.kernel.portalHistory = [];
        this.kernel.loadMapState(masterState);
        
        // Find the portal node corresponding to the page we just left
        const targetPortal = this.kernel.state.nodes.find(n => 
            (n.type === 'portal' || n.type === 'smart-portal') && n.content === currentMapId
        );
        
        if (targetPortal) {
            this.kernel.state.session.selectedId = targetPortal.id;
            
            // Expand all ancestors to ensure the portal is visible
            let currentId = targetPortal.id;
            let parentLink = this.kernel.state.links.find(l => l.target === currentId);
            while (parentLink) {
                const parentNode = this.kernel.state.nodes.find(n => n.id === parentLink.source);
                if (parentNode) {
                    if (parentNode.data) parentNode.data.collapsed = false;
                    currentId = parentNode.id;
                    parentLink = this.kernel.state.links.find(l => l.target === currentId);
                } else {
                    break;
                }
            }
        } else {
            this.kernel.state.session.selectedId = null;
        }
        
        this.setView('map');
        this.actionCloseDataManager();
        this.render();
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
                        ${this.getMapTypeOptionsHtml(initialType)}
                    </select>
                </div>
            </div>
        `;
        
        const actionsHtml = `
            <div class="flex w-full justify-end items-center gap-2">
                <button id="clip-btn-cancel" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide">Cancel</button>
                <button id="clip-btn-submit" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Clip Branch</button>
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
                        setTimeout(() => this.actionOpenPageSettings(newMapId), 50);
                    } else {
                        alert('Clip failed. The node may not be clippable.');
                    }
                };
            }
        });
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg text-white font-bold text-sm shadow-lg transition-opacity duration-500 opacity-0 z-[9999] ${type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-slate-800'}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.remove('opacity-0');
            });
        });
        
        setTimeout(() => {
            toast.classList.add('opacity-0');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }

    async actionSaveConstellation(id) {
        const tgt = id || this.kernel.state.session.selectedId;
        const json = this.kernel.extractConstellation(tgt);
        if (json) { 
            const saved = await this.kernel.saveConstellationToLibrary(json); 
            if (saved !== false) this.showToast("Saved to Library.", "success");
        }
    }

    async actionCopyBranch(id) {
        if (this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory")) {
            this.showToast("Copy/paste actions are disabled in the Project Directory.", "error");
            return;
        }
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (!node) return;

        const branch = this.kernel.extractConstellation(tgt);
        if (!branch) return;

        const serialized = JSON.stringify({
            type: "mm-branch",
            sourceMapId: this.kernel.state.map_id,
            nodes: branch.nodes,
            connections: branch.connections,
            original_root: tgt
        }, null, 2);

        try {
            await (window.navigator || navigator).clipboard.writeText(serialized);
            this.kernel.clipboardData = serialized;
            localStorage.setItem('mm_clipboard_data', serialized);
            this.showToast("Branch copied to clipboard.", "success");
            this.render();
        } catch (e) {
            console.error("Failed to write to clipboard:", e);
            this.kernel.clipboardData = serialized;
            localStorage.setItem('mm_clipboard_data', serialized);
            this.showToast("Branch copied (local fallback).", "info");
            this.render();
        }
    }

    compilePromptText(nodeId) {
        const node = this.kernel.state.nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'prompt-root') return null;

        const descendants = new Set();
        const gather = (id) => {
            const n = this.kernel.state.nodes.find(x => x.id === id);
            if (!n || descendants.has(n)) return;
            descendants.add(n);
            this.kernel.state.connections.filter(c => c.from === id).forEach(c => gather(c.to));
        };
        gather(node.id);

        const order = ['prompt-role', 'prompt-context', 'prompt-goal', 'prompt-instruction', 'prompt-constraint', 'prompt-example', 'prompt-image', 'prompt-data-analytic', 'prompt-text-to-text', 'prompt-code-gen', 'prompt-chain'];
        const grouped = {};
        order.forEach(o => grouped[o] = []);

        descendants.forEach(n => {
            if (grouped[n.type]) grouped[n.type].push(n);
        });

        let compiledMd = "";
        order.forEach(type => {
            if (grouped[type].length > 0) {
                const sectionName = type.split('-')[1].toUpperCase();
                compiledMd += `### ${sectionName}\n\n`;
                grouped[type].forEach(n => {
                    const content = n.content || n.title || "";
                    compiledMd += `${content}\n\n`;
                });
            }
        });
        return compiledMd;
    }

    async actionCopyPromptAsText(nodeId) {
        const compiledMd = this.compilePromptText(nodeId);
        if (!compiledMd) {
            this.showToast("No prompt elements found connected to this root.", "error");
            return;
        }

        try {
            await (window.navigator || navigator).clipboard.writeText(compiledMd);
            this.showToast("Prompt copied to clipboard!", "success");
        } catch (e) {
            console.error(e);
            this.showToast("Failed to copy prompt to clipboard.", "error");
        }
    }

    async actionDownloadPromptAsMd(nodeId) {
        const compiledMd = this.compilePromptText(nodeId);
        if (!compiledMd) {
            this.showToast("No prompt elements found connected to this root.", "error");
            return;
        }

        try {
            const blob = new Blob([compiledMd], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const node = this.kernel.state.nodes.find(n => n.id === nodeId);
            const title = (node && node.title ? node.title.replace(/[^a-zA-Z0-9_-]/g, '_') : 'prompt') + '.md';
            a.href = url;
            a.download = title;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast("Prompt downloaded as Markdown!", "success");
        } catch (e) {
            console.error(e);
            this.showToast("Failed to download prompt.", "error");
        }
    }

    async actionPasteBranch(id) {
        if (this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory")) {
            this.showToast("Copy/paste actions are disabled in the Project Directory.", "error");
            return;
        }
        const tgt = id || this.kernel.state.session.selectedId;
        const node = this.kernel.state.nodes.find(n => n.id === tgt);
        if (!node) return;

        let clipboardText = "";
        try {
            clipboardText = await (window.navigator || navigator).clipboard.readText();
        } catch (e) {
            console.warn("Failed to read system clipboard, using local fallback:", e);
            clipboardText = this.kernel.clipboardData || localStorage.getItem('mm_clipboard_data') || "";
        }

        if (!clipboardText) {
            clipboardText = this.kernel.clipboardData || localStorage.getItem('mm_clipboard_data') || "";
        }

        if (!clipboardText) {
            this.showToast("Nothing to paste.", "error");
            return;
        }

        let parsed = null;
        try {
            parsed = JSON.parse(clipboardText);
        } catch (e) {
            // Not JSON
        }

        if (parsed && parsed.type === 'mm-branch' && Array.isArray(parsed.nodes)) {
            const originalRootId = parsed.original_root || (parsed.nodes[0] ? parsed.nodes[0].id : null);
            const parsedRoot = parsed.nodes.find(n => n.id === originalRootId);
            const isRootCopied = parsedRoot && (parsedRoot.type === 'root' || parsedRoot.type.endsWith('-root'));

            const isTargetRoot = node.type === 'root' || node.type.endsWith('-root') || (node.data && node.data.isCore);
            let tier1Result = 'hub';
            if (isRootCopied) {
                const sourceMapId = parsed.sourceMapId;
                const lib = this.kernel.getLibrary() || [];
                const originalPage = lib.find(p => p.map_id === sourceMapId);
                const showLinkOption = !!originalPage;
                const originalTitle = originalPage?.meta?.title || parsedRoot?.title || "Original Page";

                tier1Result = await this.showDialogModal({
                    title: "Paste Page/Root Node - Step 1",
                    contentHtml: `
                        <div class="flex flex-col gap-3">
                            <div class="text-slate-400 text-[11px] uppercase tracking-wider mb-1 font-bold">Select Paste Format:</div>
                            ${isTargetRoot ? `
                            <button id="btn-paste-overwrite" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-red-500 hover:bg-red-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                <span class="text-slate-200 font-bold text-xs group-hover:text-red-400 transition-colors">⚠️ Overwrite Current Page</span>
                                <span class="text-slate-400 text-[10px] leading-relaxed">Replaces the entire contents of this page with the copied page.</span>
                            </button>
                            ` : ''}
                            <button id="btn-paste-hub" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                <span class="text-slate-200 font-bold text-xs group-hover:text-indigo-400 transition-colors">✨ Convert to Hub</span>
                                <span class="text-slate-400 text-[10px] leading-relaxed">Converts the page root node to a generic Hub node and pastes the branch.</span>
                            </button>
                            ${showLinkOption ? `
                            <button id="btn-paste-link" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                <span class="text-slate-200 font-bold text-xs group-hover:text-indigo-400 transition-colors">🔗 Link to Original Page</span>
                                <span class="text-slate-400 text-[10px] leading-relaxed">Creates a portal node pointing to the original page: <strong>"${originalTitle}"</strong>.</span>
                            </button>
                            ` : ''}
                            <button id="btn-paste-clone" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                <span class="text-slate-200 font-bold text-xs group-hover:text-indigo-400 transition-colors">🌀 Clone Page & Link</span>
                                <span class="text-slate-400 text-[10px] leading-relaxed">Duplicates the copied branch under a new page, and creates a portal node pointing to it.</span>
                            </button>
                        </div>
                    `,
                    actionsHtml: `
                        <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>
                    `,
                    onRender: (el, close) => {
                        if (el.querySelector('#btn-paste-overwrite')) {
                            el.querySelector('#btn-paste-overwrite').onclick = () => close('overwrite');
                        }
                        el.querySelector('#btn-paste-hub').onclick = () => close('hub');
                        if (el.querySelector('#btn-paste-link')) {
                            el.querySelector('#btn-paste-link').onclick = () => close('link');
                        }
                        el.querySelector('#btn-paste-clone').onclick = () => close('clone');
                        el.querySelector('.cancel-btn').onclick = () => close(null);
                    }
                });
                if (!tier1Result) return;

                if (tier1Result === 'overwrite') {
                    const confirmOverwrite = await this.showDialogModal({
                        title: "Confirm Overwrite",
                        contentHtml: `<div class="text-slate-300 text-sm">Are you sure you want to overwrite this page with the copied page? This action cannot be undone.</div>`,
                        actionsHtml: `
                            <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>
                            <button class="confirm-btn px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Overwrite</button>
                        `,
                        onRender: (el, close) => {
                            el.querySelector('.cancel-btn').onclick = () => close(false);
                            el.querySelector('.confirm-btn').onclick = () => close(true);
                        }
                    });
                    
                    if (!confirmOverwrite) {
                        return;
                    }
                    
                    this.kernel.saveHistory();
                    const newRootId = tgt;
                    this.kernel.state.nodes = this.kernel.state.nodes.filter(n => n.id === newRootId);
                    this.kernel.state.connections = [];
                    
                    const idMap = {};
                    idMap[originalRootId] = newRootId;
                    
                    parsed.nodes.forEach(n => {
                        if (n.id !== originalRootId) {
                            idMap[n.id] = this.kernel.generateId();
                        }
                    });
                    
                    parsed.nodes.forEach(n => {
                        if (n.id === originalRootId) {
                            const rootNode = this.kernel.state.nodes[0];
                            rootNode.title = n.title;
                            rootNode.content = n.content;
                            rootNode.type = n.type;
                        } else {
                            const newId = idMap[n.id];
                            const newNode = {
                                id: newId,
                                type: n.type,
                                title: n.title,
                                content: n.content,
                                data: JSON.parse(JSON.stringify(n.data || {}))
                            };
                            if (newNode.data) newNode.data.isCore = false;
                            this.kernel.state.nodes.push(newNode);
                        }
                    });
                    
                    if (Array.isArray(parsed.connections)) {
                        parsed.connections.forEach(c => {
                            const newFrom = idMap[c.from];
                            const newTo = idMap[c.to];
                            if (newFrom && newTo) {
                                this.kernel.state.connections.push({
                                    id: this.kernel.generateId(),
                                    from: newFrom,
                                    to: newTo,
                                    type: c.type,
                                    label: c.label
                                });
                            }
                        });
                    }
                    
                    this.kernel.notify();
                    this.showToast("Page overwritten successfully.", "success");
                    return;
                }
            }

            let tier2Result = 'child';
            if (!isTargetRoot) {
                if (node.type === 'portal' || node.type === 'smart-portal') {
                    tier2Result = 'replace';
                } else {
                    const sourceRootNode = parsed.original_root ? this.kernel.state.nodes.find(n => n.id === parsed.original_root) : null;
                    const isSourceRootNodeMain = sourceRootNode && (sourceRootNode.type === 'root' || sourceRootNode.type.endsWith('-root') || (sourceRootNode.data && sourceRootNode.data.isCore));
                    const downstreamOfSource = parsed.original_root ? this.kernel.getDownstreamNodes(parsed.original_root) : new Set();
                    const isCircular = downstreamOfSource.has(node.id);
                    const isParentPortal = node.type === 'portal' || node.type === 'smart-portal';
                    
                    const canMove = sourceRootNode && !isSourceRootNodeMain && !isCircular && !isParentPortal && (parsed.sourceMapId === this.kernel.state.map_id);

                    let moveBtnHtml = '';
                    if (canMove) {
                        moveBtnHtml = `
                            <button id="btn-attach-move" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-cyan-500 hover:bg-cyan-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                <span class="text-slate-200 font-bold text-xs group-hover:text-cyan-400 transition-colors">🚚 Move Branch Here</span>
                                <span class="text-slate-400 text-[10px] leading-relaxed">Moves the existing branch of <strong>"${sourceRootNode.title || 'copied node'}"</strong> to be a child of <strong>"${node.title || 'selected node'}"</strong> instead of cloning it.</span>
                            </button>
                        `;
                    }

                    tier2Result = await this.showDialogModal({
                        title: isRootCopied ? "Paste Page/Root Node - Step 2" : "Paste Branch",
                        contentHtml: `
                            <div class="flex flex-col gap-3">
                                <div class="text-slate-400 text-[11px] uppercase tracking-wider mb-1 font-bold">Select Attachment Method:</div>
                                <button id="btn-attach-child" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                    <span class="text-slate-200 font-bold text-xs group-hover:text-indigo-400 transition-colors">➕ Add as Child</span>
                                    <span class="text-slate-400 text-[10px] leading-relaxed">Connects the pasted content as a structural child under the selected node <strong>"${node.title || 'selected node'}"</strong>.</span>
                                </button>
                                ${moveBtnHtml}
                                <button id="btn-attach-replace" class="flex flex-col items-start gap-1 p-3 border border-slate-700 hover:border-rose-500 hover:bg-rose-950/20 text-left rounded-xl transition-all cursor-pointer w-full group">
                                    <span class="text-slate-200 font-bold text-xs group-hover:text-rose-400 transition-colors">🔄 Replace Target Node</span>
                                    <span class="text-slate-400 text-[10px] leading-relaxed">Deletes the selected node <strong>"${node.title || 'selected node'}"</strong> and its downstream branch, replacing it with the pasted content.</span>
                                </button>
                            </div>
                        `,
                        actionsHtml: `
                            <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>
                        `,
                        onRender: (el, close) => {
                            el.querySelector('#btn-attach-child').onclick = () => close('child');
                            if (canMove) {
                                el.querySelector('#btn-attach-move').onclick = () => close('move');
                            }
                            el.querySelector('#btn-attach-replace').onclick = () => close('replace');
                            el.querySelector('.cancel-btn').onclick = () => close(null);
                        }
                    });
                    if (!tier2Result) return;
                }

                if (tier2Result === 'move') {
                    const sourceId = parsed.original_root;
                    const sourceRootNode = this.kernel.state.nodes.find(n => n.id === sourceId);
                    
                    // 1. Delete old parent connection
                    const oldParentConnIndex = this.kernel.state.connections.findIndex(c => c.to === sourceId && c.type === 'structural');
                    if (oldParentConnIndex !== -1) {
                        this.kernel.state.connections.splice(oldParentConnIndex, 1);
                    }
                    
                    // 2. Add new connection
                    const res = this.kernel.addConnection(node.id, sourceId, 'structural');
                    if (res && res.success === false) {
                        this.showToast(`Schema constraint: Cannot make [${node.type}] a parent of [${sourceRootNode?.type || 'unknown'}].`, "error");
                    } else {
                        // 3. Resolve layout
                        const rootNode = this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root') || (n.data && n.data.isCore));
                        const isStatic = rootNode && rootNode.root_metadata && rootNode.root_metadata.static_layout === true;
                        if (!isStatic) {
                            this.kernel.autoLayoutOrganic();
                        } else {
                            this.kernel.resolveOverlaps(40);
                        }
                        
                        this.kernel.saveHistory();
                        this.kernel.notify();
                        this.showToast(`Moved "${sourceRootNode?.title || 'untitled'}" under "${node.title || 'untitled'}".`, "success");

                        if (this.kernel.state.meta && (this.kernel.state.meta.isMaster === true || this.kernel.state.meta.title === "Project Directory" || this.kernel.state.meta.type === "file-root")) {
                            this.kernel.syncFoldersFromMasterMap(this.kernel.state).then(() => {
                                if (this.dom.dataManager && !this.dom.dataManager.classList.contains('translate-x-full')) {
                                    if (window.Auth && window.Auth.renderDataManager) {
                                        window.Auth.renderDataManager(document.getElementById('data-manager-content'));
                                    }
                                }
                            }).catch(console.error);
                        }
                    }
                    return;
                }

                if (tier2Result === 'replace') {
                    const hasChildren = this.kernel.state.connections.some(c => c.from === node.id);
                    const hasContent = !!node.content;
                    if (hasChildren || hasContent) {
                        const confirmReplace = await this.showDialogModal({
                            title: "Confirm Replace",
                            contentHtml: `<div class="text-slate-300 text-sm">Are you sure you want to replace this node? Its content and all descendant nodes will be deleted. This action cannot be undone.</div>`,
                            actionsHtml: `
                                <button class="cancel-btn px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Cancel</button>
                                <button class="confirm-btn px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider">Replace</button>
                            `,
                            onRender: (el, close) => {
                                el.querySelector('.cancel-btn').onclick = () => close(false);
                                el.querySelector('.confirm-btn').onclick = () => close(true);
                            }
                        });
                        
                        if (!confirmReplace) {
                            return;
                        }
                    }
                }
            }

            this.kernel.saveHistory();

            if (isRootCopied && (tier1Result === 'link' || tier1Result === 'clone')) {
                let targetPageId = parsed.sourceMapId;
                let finalTitle = parsedRoot?.title || "Portal Target";

                if (tier1Result === 'clone') {
                    targetPageId = this.kernel.generateId();
                    finalTitle = (parsedRoot?.title || "Untitled Page") + " Copy";

                    const idMap = {};
                    parsed.nodes.forEach(n => {
                        idMap[n.id] = this.kernel.generateId();
                    });

                    const clonedNodes = parsed.nodes.map(n => {
                        const cloned = JSON.parse(JSON.stringify(n));
                        cloned.id = idMap[n.id];
                        if (n.id === originalRootId) {
                            if (!cloned.data) cloned.data = {};
                            cloned.data.isCore = true;
                        } else {
                            if (cloned.data) cloned.data.isCore = false;
                        }
                        return cloned;
                    });

                    const clonedConnections = (parsed.connections || []).map(c => {
                        return {
                            id: this.kernel.generateId(),
                            from: idMap[c.from],
                            to: idMap[c.to],
                            type: c.type,
                            label: c.label
                        };
                    }).filter(c => c.from && c.to);

                    const clonedPageState = {
                        map_id: targetPageId,
                        meta: {
                            title: finalTitle,
                            type: parsedRoot?.type || "generic",
                            project_id: this.kernel.activeProjectId,
                            created_at: new Date().toISOString()
                        },
                        nodes: clonedNodes,
                        connections: clonedConnections
                    };
                    await this.kernel.saveMapToLibrary(clonedPageState);
                }

                const portalNodeId = this.kernel.generateId();
                const portalNode = {
                    id: portalNodeId,
                    type: 'portal',
                    title: finalTitle,
                    content: targetPageId,
                    data: {
                        x: tier2Result === 'replace' ? node.data.x : node.data.x + 100,
                        y: tier2Result === 'replace' ? node.data.y : node.data.y + 100,
                        isCore: false
                    }
                };

                if (tier2Result === 'child') {
                    this.kernel.state.nodes.push(portalNode);
                    this.kernel.addConnection(tgt, portalNodeId, 'structural');
                } else {
                    const incoming = this.kernel.state.connections.filter(c => c.to === tgt);
                    incoming.forEach(c => c.to = portalNodeId);

                    const toDelete = this.kernel.getDownstreamNodes(tgt);
                    this.kernel.state.nodes = this.kernel.state.nodes.filter(n => !toDelete.has(n.id));
                    this.kernel.state.connections = this.kernel.state.connections.filter(c => !toDelete.has(c.from) && !toDelete.has(c.to));
                    
                    this.kernel.state.nodes.push(portalNode);
                    this.kernel.state.session.selectedId = portalNodeId;
                }

                const rootNode = this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root') || (n.data && n.data.isCore));
                const isStatic = rootNode && rootNode.root_metadata && rootNode.root_metadata.static_layout === true;
                if (!isStatic) {
                    this.kernel.autoLayoutOrganic();
                } else {
                    this.kernel.resolveOverlaps(40);
                }
                this.kernel.notify();
                this.showToast(tier1Result === 'clone' ? "Page cloned and portal pasted." : "Portal link pasted successfully.", "success");
            } else {
                // Hub or standard branch paste
                const idMap = {};
                parsed.nodes.forEach(n => {
                    idMap[n.id] = this.kernel.generateId();
                });

                parsed.nodes.forEach(n => {
                    const newId = idMap[n.id];
                    const isRoot = n.id === originalRootId;
                    const newNode = {
                        id: newId,
                        type: (isRoot && isRootCopied) ? 'hub' : n.type,
                        title: n.title,
                        content: n.content,
                        data: JSON.parse(JSON.stringify(n.data || {}))
                    };
                    if (newNode.data) {
                        newNode.data.isCore = false;
                    }

                    if (isRoot) {
                        newNode.data.x = tier2Result === 'replace' ? node.data.x : node.data.x + 100;
                        newNode.data.y = tier2Result === 'replace' ? node.data.y : node.data.y + 100;
                    } else if (originalRootId) {
                        const origRootNode = parsed.nodes.find(x => x.id === originalRootId);
                        if (origRootNode) {
                            const dx = n.data.x - origRootNode.data.x;
                            const dy = n.data.y - origRootNode.data.y;
                            newNode.data.x = (tier2Result === 'replace' ? node.data.x : node.data.x + 100) + dx;
                            newNode.data.y = (tier2Result === 'replace' ? node.data.y : node.data.y + 100) + dy;
                        } else {
                            newNode.data.x = (tier2Result === 'replace' ? node.data.x : node.data.x + 100);
                            newNode.data.y = (tier2Result === 'replace' ? node.data.y : node.data.y + 100);
                        }
                    }
                    this.kernel.state.nodes.push(newNode);
                });

                if (Array.isArray(parsed.connections)) {
                    parsed.connections.forEach(c => {
                        const newFrom = idMap[c.from];
                        const newTo = idMap[c.to];
                        if (newFrom && newTo) {
                            this.kernel.state.connections.push({
                                id: this.kernel.generateId(),
                                from: newFrom,
                                to: newTo,
                                type: c.type,
                                label: c.label
                            });
                        }
                    });
                }

                const newRootId = originalRootId ? idMap[originalRootId] : null;
                if (newRootId) {
                    if (tier2Result === 'child') {
                        this.kernel.addConnection(tgt, newRootId, 'structural');
                    } else {
                        const incoming = this.kernel.state.connections.filter(c => c.to === tgt);
                        incoming.forEach(c => c.to = newRootId);

                        const toDelete = this.kernel.getDownstreamNodes(tgt);
                        this.kernel.state.nodes = this.kernel.state.nodes.filter(n => !toDelete.has(n.id));
                        this.kernel.state.connections = this.kernel.state.connections.filter(c => !toDelete.has(c.from) && !toDelete.has(c.to));

                        this.kernel.state.session.selectedId = newRootId;
                    }
                }

                const rootNode = this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root') || (n.data && n.data.isCore));
                const isStatic = rootNode && rootNode.root_metadata && rootNode.root_metadata.static_layout === true;
                if (!isStatic) {
                    this.kernel.autoLayoutOrganic();
                } else {
                    this.kernel.resolveOverlaps(40);
                }
                this.kernel.notify();
                this.showToast("Branch pasted successfully.", "success");
            }
        } else {
            const lines = this.parseIndentedList(clipboardText);
            if (lines.length === 0) {
                this.showToast("Clipboard text does not contain any valid list to paste.", "error");
                return;
            }

            const stack = [{ id: tgt, indent: -1 }];
            
            lines.forEach(line => {
                while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) {
                    stack.pop();
                }

                const parent = stack[stack.length - 1] || stack[0];
                const parentId = parent.id;
                const childType = this.kernel.getSmartChildType(parentId);

                const child = this.kernel.addNode({ title: line.title, type: childType }, parentId);
                this.kernel.addConnection(parentId, child.id, 'structural');

                stack.push({ id: child.id, indent: line.indent });
            });

            const rootNode = this.kernel.state.nodes.find(n => n.type === 'root' || n.type.endsWith('-root') || (n.data && n.data.isCore));
            const isStatic = rootNode && rootNode.root_metadata && rootNode.root_metadata.static_layout === true;
            if (!isStatic) {
                this.kernel.autoLayoutOrganic();
            } else {
                this.kernel.resolveOverlaps(40);
            }
            this.kernel.notify();
            this.showToast("List pasted successfully as sub-nodes.", "success");
        }
    }

    parseIndentedList(text) {
        const lines = text.split(/\r?\n/);
        const parsed = [];
        lines.forEach(line => {
            if (!line.trim()) return;
            
            let indent = 0;
            for (let i = 0; i < line.length; i++) {
                if (line[i] === ' ') indent += 1;
                else if (line[i] === '\t') indent += 4;
                else break;
            }
            
            let content = line.trim();
            content = content.replace(/^([-\*\+•]|\d+\.)\s+/, '');
            
            if (content) {
                parsed.push({ title: content, indent });
            }
        });
        return parsed;
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
            setTimeout(() => this.actionOpenPageSettings(clonedMap.map_id), 50);
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
                this.actionCloseDataManager();
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
                this.actionCloseDataManager();
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
        const page = lib.find(p => p.map_id === mapId) || (this.kernel.state && this.kernel.state.map_id === mapId ? this.kernel.state : null);
        if (!page) return alert('Page not found in library.');

        // Expiry modal
        const expiryChoice = await this.showDialogModal({
            title: `Share "${page.meta?.title || 'Untitled'}"`,
            contentHtml: `
                <div class="flex flex-col gap-3">
                    <p class="text-slate-400">Choose link expiry duration:</p>
                    <select id="mm-share-expiry-select" class="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                        <option value="1">No expiry (infinite)</option>
                        <option value="2">7 days</option>
                        <option value="3">30 days</option>
                        <option value="4">90 days</option>
                    </select>
                </div>
            `,
            actionsHtml: `
                <button id="mm-share-cancel" class="cancel-btn px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-white font-bold transition-all">Cancel</button>
                <button id="mm-share-confirm" class="confirm-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white font-bold transition-all shadow-md">Create Link</button>
            `,
            onRender: (backdrop, close) => {
                backdrop.querySelector('.cancel-btn').onclick = () => close(null);
                backdrop.querySelector('.confirm-btn').onclick = () => {
                    const sel = backdrop.querySelector('#mm-share-expiry-select');
                    close(sel.value);
                };
            }
        });
        if (!expiryChoice) return;
        await this.actionSharePageWithExpiry(mapId, expiryChoice);
    }

    async actionSharePageWithExpiry(mapId, expiryChoice) {
        const lib = this.kernel.getLibrary();
        const page = lib.find(p => p.map_id === mapId) || (this.kernel.state && this.kernel.state.map_id === mapId ? this.kernel.state : null);
        if (!page) return alert('Page not found in library.');

        const user = window.FirebaseAuth?.currentUser;
        if (!user) {
            return alert('You must be signed in (even as a guest) to share maps.');
        }

        const expiryDays = { '2': 7, '3': 30, '4': 90 }[expiryChoice] || null;
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
            const ref = window.Firestore.doc(window.Firestore.openDb || window.FirebaseDb, 'shared_maps', token);
            await window.Firestore.setDoc(ref, payload);

            // Update the map's own metadata in the library and active state
            page.meta.shared = true;
            page.meta.share_token = token;
            page.meta.share_expires = shareExpires;
            
            if (this.kernel.state && this.kernel.state.map_id === mapId) {
                if (!this.kernel.state.meta) this.kernel.state.meta = {};
                this.kernel.state.meta.shared = true;
                this.kernel.state.meta.share_token = token;
                this.kernel.state.meta.share_expires = shareExpires;
            }
            await this.kernel.saveConstellationToLibrary(page);

            this.render();

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
        const page = lib.find(p => p.map_id === mapId) || (this.kernel.state && this.kernel.state.map_id === mapId ? this.kernel.state : null);
        if (!page || !page.meta?.share_token) return;

        const confirmRevoke = await this.actionConfirm({
            title: "Revoke Share Link",
            message: `Are you sure you want to revoke the public share link for "${page.meta?.title || 'Untitled'}"? The link will stop working immediately.`,
            confirmText: "Revoke",
            cancelText: "Keep Active",
            isDestructive: true
        });
        if (!confirmRevoke) return;

        try {
            const ref = window.Firestore.doc(window.Firestore.openDb || window.FirebaseDb, 'shared_maps', page.meta.share_token);
            await window.Firestore.deleteDoc(ref);

            page.meta.shared = false;
            page.meta.share_token = '';
            page.meta.share_expires = null;

            if (this.kernel.state && this.kernel.state.map_id === mapId) {
                this.kernel.state.meta.shared = false;
                this.kernel.state.meta.share_token = '';
                this.kernel.state.meta.share_expires = null;
            }
            await this.kernel.saveConstellationToLibrary(page);

            this.render();
            return true;
        } catch (e) {
            console.error(e);
            alert('Failed to revoke share: ' + e.message);
            return false;
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
            // Check if this map is targeted by a portal in the current state
            const portalNode = this.kernel.state.nodes.find(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content === id);
            if (portalNode) {
                this.actionEnterPortal(portalNode.id);
                return;
            }

            this.kernel.activeProjectId = map.meta?.project_id || 'default_project';
            this.kernel.loadMapState(map); 
            this.setView('map');
            this.actionCloseDataManager();
        }
    }

    actionCloseDataManager() {
        if (this.dom.sidebar) {
            this.dom.sidebar.classList.remove('data-manager-open');
            this.popUiStack('data-manager-sidebar');
            const dmPanel = document.getElementById('sidebar-data-manager');
            if (dmPanel) dmPanel.classList.add('hidden');
        }
    }

    async actionSetActiveProject(projId) {
        this.kernel.activeProjectId = projId;
        const masterMap = await this.kernel.getOrCreateMasterMap(projId);
        if (masterMap) {
            this.kernel.loadMapState(masterMap);
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

    async actionCreateProjectFolder() {
        const activeProjId = this.kernel.activeProjectId;
        if (!activeProjId) return;

        const folderName = await this.actionPrompt({
            title: "New Folder",
            label: "Enter a name for the new folder:",
            defaultValue: "New Folder"
        });

        if (folderName) {
            await this.kernel.createProjectFolder(activeProjId, folderName, null);
            await this.kernel.syncProjectMasterMap(activeProjId);
            this.render();
        }
    }

    async actionRenameProjectFolder(folderId) {
        const activeProjId = this.kernel.activeProjectId;
        if (!activeProjId) return;

        const proj = this.kernel.getProjects().find(p => p.project_id === activeProjId);
        const folder = proj?.folders?.find(f => f.id === folderId);
        if (!folder) return;

        const newName = await this.actionPrompt({
            title: "Rename Folder",
            label: "Enter a new name for the folder:",
            defaultValue: folder.name
        });

        if (newName && newName !== folder.name) {
            await this.kernel.updateProjectFolder(activeProjId, folderId, { name: newName });
            await this.kernel.syncProjectMasterMap(activeProjId);
            this.render();
        }
    }

    async actionDeleteProjectFolder(folderId) {
        const activeProjId = this.kernel.activeProjectId;
        if (!activeProjId) return;

        const proj = this.kernel.getProjects().find(p => p.project_id === activeProjId);
        const folder = proj?.folders?.find(f => f.id === folderId);
        if (!folder) return;

        const modalId = `modal-${Math.random().toString(36).substr(2, 9)}`;
        const modalHtml = `
            <div id="${modalId}" class="fixed inset-0 bg-slate-950/80 backdrop-blur flex items-center justify-center z-50 p-4">
                <div class="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div class="p-4 border-b border-slate-800 bg-slate-800/50">
                        <h3 class="text-white font-bold text-lg flex items-center gap-2">🗑️ Delete Folder</h3>
                    </div>
                    <div class="p-5 text-slate-300 text-sm leading-relaxed">
                        Are you sure you want to delete <span class="text-white font-bold">'${folder.name}'</span>?<br><br>
                        <div class="bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg text-rose-400 text-xs">
                            <span class="font-bold">Warning:</span> All items within this folder will be moved to the root. The items themselves will not be deleted.
                        </div>
                    </div>
                    <div class="p-4 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
                        <button id="cancel-${modalId}" class="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
                        <button id="confirm-${modalId}" class="px-4 py-2 text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-lg shadow-rose-900/20 transition-all">Delete Folder</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        return new Promise((resolve) => {
            document.getElementById(`cancel-${modalId}`).onclick = () => {
                document.getElementById(modalId).remove();
                resolve();
            };
            document.getElementById(`confirm-${modalId}`).onclick = async () => {
                document.getElementById(modalId).remove();
                await this.kernel.deleteProjectFolder(activeProjId, folderId);
                await this.kernel.syncProjectMasterMap(activeProjId);
                this.render();
                resolve();
            };
        });
    }

    async actionToggleFolder(folderId) {
        const activeProjId = this.kernel.activeProjectId;
        if (!activeProjId) return;

        const proj = this.kernel.getProjects().find(p => p.project_id === activeProjId);
        const folder = proj?.folders?.find(f => f.id === folderId);
        if (folder) {
            await this.kernel.updateProjectFolder(activeProjId, folderId, { isExpanded: folder.isExpanded === false });
            await this.kernel.syncProjectMasterMap(activeProjId);
            this.render();
        }
    }

    async actionAssignToFolder(event, folderId) {
        event.preventDefault();
        const activeProjId = this.kernel.activeProjectId;
        if (!activeProjId) return;

        const draggedData = event.dataTransfer.getData("text/plain");
        if (!draggedData) return;

        if (draggedData.startsWith('page:')) {
            const pageId = draggedData.substring(5);
            await this.kernel.assignPageToFolder(activeProjId, pageId, folderId || null);
            await this.kernel.syncProjectMasterMap(activeProjId);
            this.render();
        } else if (draggedData.startsWith('folder:')) {
            const draggedFolderId = draggedData.substring(7);
            if (draggedFolderId !== folderId) {
                // Prevent cyclic assignment
                let current = folderId;
                const proj = this.kernel.getProjects().find(p => p.project_id === activeProjId);
                while(current) {
                    if (current === draggedFolderId) return; // Cycle!
                    const f = proj?.folders?.find(x => x.id === current);
                    current = f ? f.parent_id : null;
                }
                
                await this.kernel.updateProjectFolder(activeProjId, draggedFolderId, { parent_id: folderId || null });
                await this.kernel.syncProjectMasterMap(activeProjId);
                this.render();
            }
        }
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
            message: "Are you sure you want to delete this page? This action cannot be undone.",
            confirmText: "Delete Page",
            isDestructive: true
        });
        if (ok) {
            await this.kernel.deleteFromLibrary(id);
            this.render();
            return true;
        }
        return false;
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
            this.logTelemetry('sync_json_success');
        } catch (e) { 
            alert("Invalid JSON format."); 
            this.logTelemetry('sync_json_error', { raw_input: document.getElementById('json-exchange').value.substring(0, 1000) }, e, 'error');
        }
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
            try { 
                this.kernel.loadMapState(JSON.parse(e.target.result)); 
                alert("Mapstate Imported."); 
                this.render(); 
                this.logTelemetry('import_json_success', { filename: file.name });
            } 
            catch (err) { 
                alert("Invalid JSON file."); 
                this.logTelemetry('import_json_error', { filename: file.name }, err, 'error');
            }
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
            mapTitleEl.innerHTML = `<span class="opacity-65 hover:text-purple-400 cursor-pointer transition-colors" onclick="SC.toggleDataManager()">${this.escapeHTML(projTitle)}</span> <span class="mx-1 text-slate-500">›</span> <span class="text-white">${this.escapeHTML(pageTitle)}</span>`;
        }

        const inspector = this.registry.get('inspector');
        if (inspector && this.dom.panelProperties) inspector.render(this.dom.panelProperties, this.kernel.state);

        // Auto-update Data Manager sidebar if it is currently open
        if (this.dom.sidebar && this.dom.sidebar.classList.contains('data-manager-open')) {
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
            if (eng) {
                let stateToRender = this.kernel.state;
                const selId = this.kernel.state.session.selectedId;
                const selNode = this.kernel.state.nodes.find(n => n.id === selId);
                
                // Determine if we should render a targeted portal submap instead of the current map
                if (selNode && (selNode.type === 'portal' || selNode.type === 'smart-portal' || selNode.type === 'file-document') && selNode.content) {
                    const targetRootType = this.getRootTypeForPhase(this.viewMode);
                    if (targetRootType && this.kernel.hasRootType(selNode.content, targetRootType)) {
                        const lib = this.kernel.getLibrary();
                        const targetMap = lib.find(p => p.map_id === selNode.content);
                        if (targetMap) {
                            stateToRender = targetMap;
                        }
                    }
                }
                eng.render(this.dom.viewContent, stateToRender);
            }
        }
    }

    getRootTypeForPhase(phase) {
        const mapping = {
            'web': 'web-root',
            'prompt': 'prompt-root',
            'agent': 'agent-root',
            'person': 'person-root',
            'file': 'file-root'
        };
        return mapping[phase] || null;
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

        const downstreamOfChild = (this.parentSelectMode && this.parentSelectSourceId)
            ? this.kernel.getDownstreamNodes(this.parentSelectSourceId)
            : new Set();

        const isUnparentable = (nid) => {
            if (!this.parentSelectMode) return false;
            if (nid === this.parentSelectSourceId) return true;
            const node = state.nodes.find(n => n.id === nid);
            if (!node) return true;
            if (node.type === 'portal' || node.type === 'smart-portal') return true;
            if (downstreamOfChild.has(nid)) return true;
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

        const isFlowchart = state.nodes.some(n => n.type === 'flow-root');
        this.dom.edgeSvg.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="40" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="rgba(148, 163, 184, 0.6)"/>
                </marker>
            </defs>
        `;
        const edgeContainer = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.dom.edgeSvg.appendChild(edgeContainer);

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
                    
                    if (isFlowchart || c.label) {
                        l.setAttribute("marker-end", "url(#arrowhead)");
                    }
                    
                    const isLinking = this.kernel.linkingMode || this.parentSelectMode;
                    const distS = distances.has(s.id) ? distances.get(s.id) : -1;
                    const distT = distances.has(t.id) ? distances.get(t.id) : -1;
                    
                    const onPathOrDownstreamS = pathNodes.has(s.id) || distances.has(s.id);
                    const onPathOrDownstreamT = pathNodes.has(t.id) || distances.has(t.id);
                    
                    const isParentSelectUnrelated = this.parentSelectMode && (isUnparentable(s.id) || isUnparentable(t.id));

                    if (isParentSelectUnrelated) {
                        l.style.strokeOpacity = "0.2";
                    } else if (!isLinking && activeFocalId && (!onPathOrDownstreamS || !onPathOrDownstreamT)) {
                        l.style.strokeOpacity = "0.2"; // Sibling branch edges are faded to 20%
                    } else if (!isLinking && (distS === -1 || distT === -1)) {
                        l.style.strokeOpacity = "0.48";
                    }
                    edgeContainer.appendChild(l);

                    if (c.label) {
                        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
                        txt.setAttribute("x", (sp.x + tp.x) / 2);
                        txt.setAttribute("y", (sp.y + tp.y) / 2 - 5);
                        txt.setAttribute("fill", "#cbd5e1");
                        txt.setAttribute("font-size", "11px");
                        txt.setAttribute("font-weight", "600");
                        txt.setAttribute("text-anchor", "middle");
                        txt.textContent = c.label;
                        edgeContainer.appendChild(txt);
                    }
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
            el.dataset.type = node.type;
            
            const isLinking = this.kernel.linkingMode || this.parentSelectMode;
            const dist = distances.has(node.id) ? distances.get(node.id) : -1;
            let scale, color;

            const isNodeUnparentable = this.parentSelectMode && isUnparentable(node.id);
            const isReparentingChild = this.parentSelectMode && node.id === this.parentSelectSourceId;

            if (isReparentingChild) {
                // Keep the reparented node itself clearly visible but make it unselectable as parent
                scale = 1.0;
                color = '#a855f7';
                el.style.opacity = '0.75';
                el.style.backgroundColor = `rgba(168, 85, 247, 0.15)`;
                el.style.pointerEvents = 'none';
            } else if (isNodeUnparentable) {
                // Background/unrelated styling for unparentable nodes (faded to 20% opacity)
                scale = 0.5;
                color = '#475569';
                el.style.opacity = '0.2';
                el.style.backgroundColor = `rgba(30, 41, 59, 0.2)`;
                el.style.pointerEvents = 'none';
            } else if (this.kernel.linkingMode || (this.parentSelectMode && !isNodeUnparentable)) {
                scale = 1.0;
                color = '#38bdf8';
                el.style.opacity = '1';
                el.style.backgroundColor = `rgba(30, 41, 59, 0.95)`;
                el.style.pointerEvents = 'auto';
            } else if (dist === -1) {
                el.style.pointerEvents = 'auto';
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
                el.style.pointerEvents = 'auto';
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
                if (this.aiImportMode && (node.type === 'smart-portal' || node.type === 'portal')) {
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
            if (node.type === 'web-link') {
                const url = this.getWebLinkUrl(node, state);
                const domain = url ? this.getDomain(url) : null;
                if (domain) {
                    iconEl.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" class="w-4 h-4 object-contain rounded-sm" onerror="this.src=''; this.onerror=null; this.parentNode.innerHTML='🔗';" />`;
                } else {
                    iconEl.innerHTML = bp.icon;
                }
            } else {
                iconEl.innerHTML = bp.icon;
            }
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
                    
                    const childIcon = child.type === 'web-link' ? (() => {
                        const url = this.getWebLinkUrl(child, state);
                        const domain = url ? this.getDomain(url) : null;
                        return domain ? `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" class="w-3.5 h-3.5 object-contain rounded-sm" onerror="this.src=''; this.onerror=null; this.parentNode.innerHTML='🔗';" />` : this.kernel.getBlueprint(child.type).icon;
                    })() : this.kernel.getBlueprint(child.type).icon;
                    moon.innerHTML = childIcon;
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

                if (this.kernel.isReadOnly) {
                    this.kernel.selectNode(node.id);
                    this.hideRadialMenu(true);
                    return;
                }

                // Alt+Click integration for changing parent
                if (e.altKey) {
                    if (this.parentSelectMode) {
                        if (node.id === this.parentSelectSourceId) {
                            this.actionCancelSelectParent();
                        } else {
                            this.actionConfirmParent(node.id);
                        }
                        return;
                    } else {
                        // Start parent select mode for node.id (as child)
                        const isNodeRoot = node.type === 'root' || node.type.endsWith('-root') || (node.data && node.data.isCore);
                        if (isNodeRoot) {
                            this.showToast("Root nodes cannot have a parent.", "error");
                            return;
                        }
                        this.actionSelectParent(node.id);
                        return;
                    }
                }

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
        if (type === 'link-root')                         return 'rgba(16,185,129,0.5)';  // emerald
        if (type === 'person-root')                       return 'rgba(99,102,241,0.5)';  // indigo
        if (type === 'web-root' || type.startsWith('web-')) return 'rgba(14,165,233,0.5)'; // sky
        if (type === 'prompt-root')                       return 'rgba(217,119,6,0.5)';   // amber
        if (type === 'agent-root')                        return 'rgba(225,29,72,0.5)';   // rose
        if (type === 'file-document')                     return 'rgba(16,185,129,0.5)';  // emerald
        return null;
    }

    updatePhaseButtons() {
        if (!this.kernel || !this.kernel.state) return;
        
        const selectedId = this.kernel.state.session.selectedId;
        const selectedNode = this.kernel.state.nodes.find(n => n.id === selectedId);
        
        const phaseToRootType = {
            'web': 'web-root',
            'prompt': 'prompt-root',
            'agent': 'agent-root',
            'person': 'person-root',
            'file': 'file-root'
        };
        
        Object.entries(phaseToRootType).forEach(([phase, rootType]) => {
            const btn = document.getElementById(`btn-phase-${phase}`);
            if (btn) {
                // 1. Current map contains that phase's root
                const hasRootInMap = this.kernel.state.nodes.some(n => n.type === rootType);
                
                // 2. OR contains a portal to a page of that phase's root and that portal is currently focused
                let portalHasRoot = false;
                if (selectedNode && (selectedNode.type === 'portal' || selectedNode.type === 'smart-portal' || selectedNode.type === 'file-document') && selectedNode.content) {
                    if (this.kernel.hasRootType(selectedNode.content, rootType)) {
                        portalHasRoot = true;
                    }
                }
                
                const shouldShow = hasRootInMap || portalHasRoot;
                btn.style.display = shouldShow ? 'flex' : 'none';
            }
        });
        
        // Auto-revert to map view if current viewMode is a phase engine that is no longer available
        if (this.viewMode !== 'map' && this.viewMode !== 'orbital') {
            const rootType = phaseToRootType[this.viewMode];
            if (rootType) {
                const hasRootInMap = this.kernel.state.nodes.some(n => n.type === rootType);
                let portalHasRoot = false;
                if (selectedNode && (selectedNode.type === 'portal' || selectedNode.type === 'smart-portal' || selectedNode.type === 'file-document') && selectedNode.content) {
                    if (this.kernel.hasRootType(selectedNode.content, rootType)) {
                        portalHasRoot = true;
                    }
                }
                if (!hasRootInMap && !portalHasRoot) {
                    this.setView('map');
                }
            }
        }
    }

    hasSmartAction() {
        const selectedId = this.kernel.state.session.selectedId;
        const selectedNode = this.kernel.state.nodes.find(n => n.id === selectedId);
        const canExit = this.kernel.portalHistory && this.kernel.portalHistory.length > 0;
        if (selectedNode && this.viewMode === 'map') {
            const type = selectedNode.type;
            if (['portal', 'smart-portal', 'person-root', 'web-root', 'prompt-root', 'agent-root', 'file-document'].includes(type) || type.startsWith('web-')) {
                return true;
            }
            
            // Also show for any root node except the Project Directory itself
            const isRoot = type === 'root' || type.endsWith('-root') || (selectedNode.data && selectedNode.data.isCore);
            const isProjDir = this.kernel.state.meta && this.kernel.state.meta.title === "Project Directory";
            if (isRoot && !isProjDir) {
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
        
        // Reset options if node selection changed
        if (this._lastSelectedNodeId !== selectedId) {
            this.isSmartOptionsOpen = false;
            this.selectedSmartOptionIdx = 0;
            this._lastSelectedNodeId = selectedId;
        }

        const selectedNode = this.kernel.state.nodes.find(n => n.id === selectedId);
        const canExit = this.kernel.portalHistory && this.kernel.portalHistory.length > 0;

        let action = null;
        let text = '';
        let themeClasses = '';
        let options = null;
        
        // Scaffold options & default action
        if (selectedNode && this.viewMode === 'map') {
            const type = selectedNode.type;
            if (this.kernel.isReadOnly) {
                if (type === 'portal' || type === 'smart-portal') {
                    const hasTarget = !!selectedNode.content;
                    const isWebPortal = selectedNode.content && this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'web-root');
                    const isPersonPortal = selectedNode.content && this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'person-root');
                    
                    if (hasTarget) {
                        options = [];
                        if (isWebPortal) {
                            options.push({ text: 'Preview Page 👁️', action: () => { this.actionEnterPortal(selectedNode.id); this.actionPreviewWebPage(selectedNode.content); } });
                        } else if (isPersonPortal) {
                            options.push({ text: 'View Profile 👤', action: () => { this.actionEnterPortal(selectedNode.id); this.setView('person'); } });
                        }
                        options.push({ text: 'Enter Portal ➔', action: () => this.actionEnterPortal(selectedNode.id) });
                        
                        action = () => this.actionEnterPortal(selectedNode.id);
                        text = 'Enter Portal';
                        themeClasses = 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-emerald-100 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]';
                    }
                } else if (type === 'web-root') {
                    action = () => this.actionPreviewWebPage(selectedNode.id);
                    text = 'Preview Page';
                    themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    options = [
                        { text: 'Preview Page 👁️', action: action }
                    ];
                } else if (type === 'web-link') {
                    action = () => this.actionOpenWebLink(selectedNode.id);
                    text = 'Open Link';
                    themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    options = [
                        { text: 'Open Link 🔗', action: action }
                    ];
                } else if (type.startsWith('web-')) {
                    action = () => this.actionPreviewWebPage(selectedNode.id);
                    text = 'Preview Element';
                    themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    options = [
                        { text: 'Preview Element 👁️', action: action }
                    ];
                } else if (type === 'person-root') {
                    action = () => this.setView('person');
                    text = 'View Profile';
                    themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                    options = [
                        { text: 'View Profile 👤', action: action }
                    ];
                } else if (type === 'prompt-root') {
                    action = () => this.actionCopyPromptAsText(selectedNode.id);
                    text = 'Copy as Text';
                    themeClasses = 'bg-amber-600 hover:bg-amber-500 border-amber-400 text-amber-100 hover:text-white shadow-[0_0_15px_rgba(217,119,6,0.4)]';
                    options = [
                        { text: 'Copy as Text ✍️', action: action },
                        { text: 'Download as .md 💾', action: () => this.actionDownloadPromptAsMd(selectedNode.id) }
                    ];
                }
            } else {
                if (type === 'portal' || type === 'smart-portal') {
                    const hasTarget = !!selectedNode.content;
                    const isSmart = type === 'smart-portal';
                    const rootMeta = selectedNode.content ? this.kernel.getRootMetadata(selectedNode.content) : null;
                    const isPromptPortal = rootMeta && (rootMeta.portal_behavior === 'execute_prompt' || (this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'prompt-root')) || (this.kernel.isPromptMap && this.kernel.isPromptMap(selectedNode.content)));
                    const isWebPortal = selectedNode.content && this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'web-root');
                    const isAgentPortal = selectedNode.content && this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'agent-root');
                    const isPersonPortal = selectedNode.content && this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'person-root');
                    
                    options = [];
                    if (isSmart || isPromptPortal) {
                        options.push({ text: 'Trigger AI ✨', action: () => this.actionTriggerAI(selectedNode.id) });
                    }
                    
                    const isFilePortal = selectedNode.content && this.kernel.hasRootType && this.kernel.hasRootType(selectedNode.content, 'file-root');

                    if (hasTarget) {
                        if (isWebPortal) {
                            options.push({ text: 'Launch Web App 🚀', action: () => this.setView('web') });
                        } else if (isAgentPortal) {
                            options.push({ text: 'Configure Agent ⚙️', action: () => this.setView('agent') });
                        } else if (isPersonPortal) {
                            options.push({ text: 'View Profile 👤', action: () => this.setView('person') });
                        } else if (isFilePortal) {
                            options.push({ text: 'Explore Files 📁', action: () => this.setView('file') });
                        }
                        options.push({ text: 'Enter Portal ➔', action: () => this.actionEnterPortal(selectedNode.id) });
                        const isSyncPortal = selectedNode.data && selectedNode.data.isSyncPortal === true;
                        if (!isSyncPortal) {
                            options.push({ text: 'Configure Portal ⚙️', action: () => this.actionSetPortalTarget(selectedNode.id) });
                        }
                    } else {
                        options.push({ text: 'Set Target 🎯', action: () => this.actionEnterPortal(selectedNode.id) });
                    }
                    
                    if (isSmart || isPromptPortal) {
                        action = () => this.actionTriggerAI(selectedNode.id);
                        text = 'Trigger AI';
                        themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                    } else if (hasTarget && isWebPortal) {
                        action = () => this.setView('web');
                        text = 'Launch Web App';
                        themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    } else if (hasTarget && isAgentPortal) {
                        action = () => this.setView('agent');
                        text = 'Configure Agent';
                        themeClasses = 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-rose-100 hover:text-white shadow-[0_0_15px_rgba(225,29,72,0.4)]';
                    } else if (hasTarget && isPersonPortal) {
                        action = () => this.setView('person');
                        text = 'View Profile';
                        themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                    } else if (hasTarget && isFilePortal) {
                        action = () => this.setView('file');
                        text = 'Explore Files';
                        themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                    } else {
                        action = () => this.actionEnterPortal(selectedNode.id);
                        text = hasTarget ? 'Enter Portal' : 'Set Target';
                        themeClasses = hasTarget 
                            ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-emerald-100 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                            : 'bg-purple-600 hover:bg-purple-500 border-purple-400 text-purple-100 hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]';
                    }
                } else if (type === 'person-root') {
                    action = () => this.setView('person');
                    text = 'View Profile';
                    themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                    options = [
                        { text: 'View Profile 👤', action: () => this.setView('person') },
                        { text: 'Export CV 📄', action: () => alert('Exporting profile CV...') }
                    ];
                } else if (type === 'link-root') {
                    action = () => this.actionTriggerLinktreeImport(selectedNode.id);
                    text = 'Import';
                    themeClasses = 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-emerald-100 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]';
                    options = [
                        { text: 'Import 🌳', action: action }
                    ];
                } else if (type === 'web-root') {
                    action = () => this.setView('web');
                    text = 'Visual Editor';
                    themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    options = [
                        { text: 'Visual Editor 🌐', action: () => this.setView('web') },
                        { text: 'Preview Page 👁️', action: () => this.actionPreviewWebPage(selectedNode.id) },
                        { text: 'Download Code 💾', action: () => this.actionDownloadWebCode(selectedNode.id) }
                    ];
                } else if (type === 'web-link') {
                    action = () => this.actionOpenWebLink(selectedNode.id);
                    text = 'Open Link';
                    themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    options = [
                        { text: 'Open Link 🔗', action: action }
                    ];
                } else if (type.startsWith('web-')) {
                    action = () => this.actionDownloadWebCode(selectedNode.id);
                    text = 'Download Code';
                    themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    options = [
                        { text: 'Download Code 💾', action: () => this.actionDownloadWebCode(selectedNode.id) },
                        { text: 'Preview Element 👁️', action: () => this.actionPreviewWebPage(selectedNode.id) }
                    ];
                } else if (type === 'prompt-root') {
                    action = () => this.setView('prompt');
                    text = 'Run Chain';
                    themeClasses = 'bg-amber-600 hover:bg-amber-500 border-amber-400 text-amber-100 hover:text-white shadow-[0_0_15px_rgba(217,119,6,0.4)]';
                    options = [
                        { text: 'Run Chain ⛓️', action: action },
                        { text: 'Copy as Text ✍️', action: () => this.actionCopyPromptAsText(selectedNode.id) },
                        { text: 'Download as .md 💾', action: () => this.actionDownloadPromptAsMd(selectedNode.id) }
                    ];
                } else if (type === 'agent-root') {
                    action = () => this.setView('agent');
                    text = 'Configure Agent';
                    themeClasses = 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-rose-100 hover:text-white shadow-[0_0_15px_rgba(225,29,72,0.4)]';
                } else if (type === 'file-document') {
                    const fileRoot = this.kernel.state.nodes.find(x => x.type === 'file-root');
                    const isLocalOS = fileRoot && fileRoot.root_metadata && fileRoot.root_metadata.source === 'local_os';
                    
                    if (isLocalOS) {
                        action = () => this.actionOpenFileInNewTab(selectedNode.id);
                        text = 'Open in New Tab';
                        themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                        options = [
                            { text: 'Open in New Tab ↗️', action: action }
                        ];
                    }
                }
            }
        }

        // Scaffold default options if a single action is defined but options are null
        if (action && !options) {
            options = [
                { text: `${text} ➔`, action: action }
            ];
        }

        // For root nodes on all pages except Project Directory: inject "Project Directory" into options cascade
        if (selectedNode && this.viewMode === 'map') {
            const nodeType = selectedNode.type;
            const isRoot = nodeType === 'root' || nodeType.endsWith('-root') || (selectedNode.data && selectedNode.data.isCore);
            const isProjDir = this.kernel.state.meta && this.kernel.state.meta.title === "Project Directory";
            if (isRoot && !isProjDir && !this.kernel.isReadOnly) {
                if (!options) options = [];
                options.push({ text: 'Project Directory 🏠', action: () => this.actionGoToDirectory(selectedNode.id) });
            }
        }

        // Handle general state/navigation actions and merge them
        if (canExit) {
            if (!options) {
                action = () => this.actionExitPortal();
                text = 'Exit Portal ❮';
                themeClasses = 'bg-purple-600 hover:bg-purple-500 border-purple-400 text-purple-100 hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]';
                options = [
                    { text: 'Exit Portal ❮', action: () => this.actionExitPortal() }
                ];
            } else {
                options.push({ text: 'Exit Portal ❮', action: () => this.actionExitPortal() });
            }
        }

        this.smartButtonOptions = options;

        if (!action && options && options.length > 0) {
            action = options[0].action;
            text = options[0].text;
            if (text.includes('Project Directory')) {
                themeClasses = 'bg-slate-700 hover:bg-slate-600 border-slate-500 text-slate-100 hover:text-white shadow-[0_0_15px_rgba(100,116,139,0.4)]';
            }
        }

        const tutorialActive = window.Tutorials && window.Tutorials.isActive;

        // Render options popover if open
        let popover = document.getElementById('smart-action-options-popover');
        if (popover) popover.remove();

        if (this.isSmartOptionsOpen && this.smartButtonOptions && !tutorialActive) {
            const rect = btn.getBoundingClientRect();
            popover = document.createElement('div');
            popover.id = 'smart-action-options-popover';
            popover.className = 'fixed z-[99999] bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5),0_0_20px_rgba(99,102,241,0.15)] p-1.5 flex flex-col gap-1 w-56 font-sans';
            popover.style.left = `${rect.left}px`;
            popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;

            this.smartButtonOptions.forEach((opt, idx) => {
                const optBtn = document.createElement('button');
                optBtn.className = `w-full text-left text-xs p-2 rounded-xl transition-all cursor-pointer bg-transparent border-none ${
                    idx === this.selectedSmartOptionIdx 
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-bold shadow-[0_0_12px_rgba(79,70,229,0.4)]' 
                        : 'text-slate-450 hover:bg-slate-900 hover:text-slate-200'
                }`;
                optBtn.innerHTML = opt.text;
                
                // Add hover update logic with coordinate filtering to handle static mouse placement
                const handleHover = (e) => {
                    if (this.lastMouseMovePos && e.clientX === this.lastMouseMovePos.x && e.clientY === this.lastMouseMovePos.y) {
                        return; // Mouse is stationary, assume it just happens to be in that space (ignore static hover)
                    }
                    if (this.selectedSmartOptionIdx !== idx) {
                        this.selectedSmartOptionIdx = idx;
                        this.updateSmartActionButton();
                    }
                };
                optBtn.onmouseenter = handleHover;
                optBtn.onmousemove = handleHover;

                optBtn.onclick = (e) => {
                    e.stopPropagation();
                    opt.action();
                    this.isSmartOptionsOpen = false;
                    this.updateSmartActionButton();
                };
                popover.appendChild(optBtn);
            });
            document.body.appendChild(popover);
        }

        if (action && !tutorialActive) {
            let buttonText = text;
            if (this.isSmartOptionsOpen && this.smartButtonOptions && this.smartButtonOptions.length > 0) {
                const currentOpt = this.smartButtonOptions[this.selectedSmartOptionIdx];
                if (currentOpt) {
                    buttonText = currentOpt.text.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]|[➔❮]/g, '').trim();
                    
                    // Map option text to respective theme classes dynamically!
                    if (buttonText.includes('Trigger AI')) {
                        themeClasses = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-indigo-100 hover:text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]';
                    } else if (buttonText.includes('Enter Portal')) {
                        themeClasses = 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-emerald-100 hover:text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]';
                    } else if (buttonText.includes('Set Target') || buttonText.includes('Configure Portal') || buttonText.includes('Exit Portal')) {
                        themeClasses = 'bg-purple-600 hover:bg-purple-500 border-purple-400 text-purple-100 hover:text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]';
                    } else if (buttonText.includes('Visual Editor') || buttonText.includes('Preview Page') || buttonText.includes('Download Code')) {
                        themeClasses = 'bg-sky-600 hover:bg-sky-500 border-sky-400 text-sky-100 hover:text-white shadow-[0_0_15px_rgba(14,165,233,0.4)]';
                    } else if (buttonText.includes('Run Chain') || buttonText.includes('View Profile') || buttonText.includes('Export CV')) {
                        themeClasses = 'bg-amber-600 hover:bg-amber-500 border-amber-400 text-amber-100 hover:text-white shadow-[0_0_15px_rgba(217,119,6,0.4)]';
                    } else if (buttonText.includes('Configure Agent')) {
                        themeClasses = 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-rose-100 hover:text-white shadow-[0_0_15px_rgba(225,29,72,0.4)]';
                    }
                }
            }
            const displaySubtext = options && options.length > 1 ? ' <span class="text-[9px] opacity-75 ml-1.5">▼</span>' : '';
            btn.className = `text-xs font-bold uppercase tracking-widest px-6 py-3 rounded-full border shadow-lg transition-all flex items-center gap-2 cursor-pointer ${themeClasses}`;
            btn.innerHTML = buttonText + displaySubtext;
            btn.onclick = (e) => {
                e.stopPropagation();
                if (options && options.length > 1) {
                    this.isSmartOptionsOpen = !this.isSmartOptionsOpen;
                    this.selectedSmartOptionIdx = 0;
                    this.updateSmartActionButton();
                } else if (options && options.length === 1) {
                    options[0].action();
                } else {
                    action();
                }
            };
            btn.classList.remove('hidden');

            if (tooltipContent) tooltipContent.classList.add('hidden');
            if (tooltipActions) tooltipActions.classList.add('hidden');

            tooltipBar.className = tooltipBar.className.replace(/mb-\d+|bottom-\d+/g, '').trim() + ' bottom-6';
            tooltipBar.classList.remove('hidden', 'translate-x-4', 'opacity-0');
        } else {
            btn.classList.add('hidden');
            if (!tutorialActive) {
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

    getFunctionsBaseUrl() {
        const prodUrl = "https://us-central1-mm-multi-map.cloudfunctions.net/generateMapState";
        const localUrl = "http://127.0.0.1:5001/mm-multi-map/us-central1/generateMapState";
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        return isLocal ? localUrl : prodUrl;
    }

    async logTelemetry(action, details = {}, error = null, type = 'telemetry') {
        try {
            const uid = (this.kernel && this.kernel.state && this.kernel.state.session) ? (this.kernel.state.session.uid || window.FirebaseAuth?.currentUser?.uid || 'anonymous') : 'anonymous';
            const sessionId = (this.kernel && this.kernel.state && this.kernel.state.session) ? (this.kernel.state.session.sessionId || 'unknown') : 'unknown';
            const mapId = (this.kernel && this.kernel.state && this.kernel.state.meta) ? (this.kernel.state.meta.map_id || 'unknown') : 'unknown';
            
            const payload = {
                uid,
                sessionId,
                mapId,
                action,
                type,
                details,
                error: error ? { message: error.message || String(error), stack: error.stack || null } : null
            };
            
            await fetch(`${this.getFunctionsBaseUrl()}/telemetry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.warn("Failed to send telemetry:", e);
        }
    }

    logTelemetrySync(action, details = {}, error = null, type = 'telemetry') {
        try {
            const uid = (this.kernel && this.kernel.state && this.kernel.state.session) ? (this.kernel.state.session.uid || window.FirebaseAuth?.currentUser?.uid || 'anonymous') : 'anonymous';
            const sessionId = (this.kernel && this.kernel.state && this.kernel.state.session) ? (this.kernel.state.session.sessionId || 'unknown') : 'unknown';
            const mapId = (this.kernel && this.kernel.state && this.kernel.state.meta) ? (this.kernel.state.meta.map_id || 'unknown') : 'unknown';
            
            const payload = {
                uid,
                sessionId,
                mapId,
                action,
                type,
                details,
                error: error ? { message: error.message || String(error), stack: error.stack || null } : null
            };
            
            fetch(`${this.getFunctionsBaseUrl()}/telemetry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).catch(() => {});
        } catch (e) {
            console.warn("Failed to send sync telemetry:", e);
        }
    }

    getMapTypeOptionsHtml(selectedType = '') {
        if (typeof MultiMapSchema === 'undefined' || !MultiMapSchema.mapTypes) {
            return `<option value="generic" selected>Generic Map</option>`;
        }
        let normalizedType = selectedType;
        const matchedKey = Object.keys(MultiMapSchema.mapTypes).find(
            k => MultiMapSchema.mapTypes[k].rootNode === selectedType
        );
        if (matchedKey) {
            normalizedType = matchedKey;
        }
        return Object.keys(MultiMapSchema.mapTypes).map(typeKey => {
            const def = MultiMapSchema.mapTypes[typeKey];
            const isSelected = typeKey === normalizedType;
            return `<option value="${typeKey}" ${isSelected ? 'selected' : ''}>${def.label}</option>`;
        }).join('\n');
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
            this.pushUiStack('dialog');
            
            // Trigger animation
            requestAnimationFrame(() => {
                backdrop.classList.remove('opacity-0');
                backdrop.querySelector('div').classList.remove('scale-95');
            });
            
            const close = (val) => {
                this.popUiStack('dialog');
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

                // Allow Enter to confirm and Escape to cancel
                const onKey = (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); close(true); }
                    if (e.key === 'Escape') { e.preventDefault(); close(false); }
                };
                document.addEventListener('keydown', onKey);
                // Cleanup listener when dialog resolves
                el.addEventListener('remove', () => document.removeEventListener('keydown', onKey), { once: true });
                // Fallback cleanup: remove on backdrop removal via MutationObserver
                const observer = new MutationObserver(() => {
                    if (!document.body.contains(el)) {
                        document.removeEventListener('keydown', onKey);
                        observer.disconnect();
                    }
                });
                observer.observe(document.body, { childList: true });
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
        const page = lib.find(p => p.map_id === pageId) || (this.kernel.state && this.kernel.state.map_id === pageId ? this.kernel.state : null);
        if (!page) return alert('Page not found in library.');

        const isMaster = page.meta && (page.meta.isMaster === true || page.meta.title === "Project Directory");
        const initialTitle = page.meta?.title || "Untitled Page";
        const initialType = page.meta?.type || "generic";
        const storageText = page.meta?.storage_target === 'google_drive' ? '🔺 Google Drive' : (page.meta?.storage_target === 'local_os' ? '📁 Local OS' : '☁️ Cloud Vault / Local Database');

        const contentHtml = `
            <div class="flex flex-col gap-4 font-sans text-slate-200">
                ${isMaster ? `
                    <div class="bg-purple-950/20 border border-purple-800/40 rounded-xl p-3 text-purple-300 text-[10px] flex items-start gap-2 shadow-inner shadow-purple-950/10">
                        <span class="text-xs shrink-0">⚠️</span>
                        <div class="flex flex-col gap-0.5">
                            <strong class="text-purple-200 uppercase tracking-wider font-extrabold">System Directory Page</strong>
                            <p class="opacity-80">This page serves as the project directory master map. Rename, type alteration, and deletion are restricted to preserve navigation integrity.</p>
                        </div>
                    </div>
                ` : ''}

                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Name</label>
                    <input type="text" id="settings-page-title" value="${initialTitle}" ${isMaster ? 'disabled' : ''} class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed">
                </div>
                
                <div class="flex flex-col gap-1.5">
                    <label class="text-slate-400 font-bold uppercase text-[9px] tracking-wider">Page Type</label>
                    ${isMaster ? `
                        <input type="text" readonly value="📁 Project Directory" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-purple-400 font-semibold outline-none w-full cursor-not-allowed">
                    ` : `
                        <select id="settings-page-type" class="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full">
                            ${this.getMapTypeOptionsHtml(initialType)}
                        </select>
                    `}
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
            <div class="flex w-full justify-between items-center gap-2 flex-wrap font-sans">
                <div class="flex gap-2">
                    <button id="settings-btn-load" class="bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold py-2 px-3.5 rounded-lg transition-colors shadow-lg shadow-sky-950/20 uppercase tracking-wide cursor-pointer">Load Map</button>
                    ${isMaster ? '' : `
                        <button id="settings-btn-copy" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide cursor-pointer">Copy Page</button>
                    `}
                    <button id="settings-btn-dl" class="border border-slate-700 hover:bg-slate-850 text-slate-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide cursor-pointer">JSON</button>
                    ${isMaster ? '' : `
                        <button id="settings-btn-del" class="hover:bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:text-rose-300 text-[10px] font-bold py-2 px-3 rounded-lg transition-colors uppercase tracking-wide cursor-pointer">Delete</button>
                    `}
                </div>
                <div class="flex gap-2">
                    ${isMaster ? `
                        <button id="settings-btn-close-only" class="bg-slate-800 hover:bg-slate-750 text-slate-300 text-[10px] font-bold py-2 px-4 rounded-lg transition-colors uppercase tracking-wide cursor-pointer">Close</button>
                    ` : `
                        <button id="settings-btn-save" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide cursor-pointer">Save Details</button>
                    `}
                </div>
            </div>
        `;

        this.showDialogModal({
            title: isMaster ? "Directory Page Settings & Sharing" : "Page Settings & Sharing",
            contentHtml,
            actionsHtml,
            onRender: (backdrop, close) => {
                const titleInput = backdrop.querySelector('#settings-page-title');
                const typeSelect = backdrop.querySelector('#settings-page-type');
                
                // Helper to check if inputs are modified
                const isDirty = () => {
                    if (isMaster) return false;
                    return titleInput.value.trim() !== initialTitle || (typeSelect && typeSelect.value !== initialType);
                };

                // Sharing block update handler
                const updateShareSection = () => {
                    const shareSection = backdrop.querySelector('#settings-share-section');
                    if (isMaster) {
                        shareSection.innerHTML = `
                            <div class="text-slate-500 text-center py-2 text-[10px] font-medium">
                                The Project Directory itself cannot be shared. Please share individual pages.
                            </div>
                        `;
                        return;
                    }
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
                            const success = await this.actionRevokeShare(page.map_id);
                            if (success) {
                                updateShareSection();
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

                                if (this.kernel.state && this.kernel.state.map_id === page.map_id) {
                                    if (!this.kernel.state.meta) this.kernel.state.meta = {};
                                    this.kernel.state.meta.shared = true;
                                    this.kernel.state.meta.share_token = token;
                                    this.kernel.state.meta.share_expires = shareExpires;
                                }
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
                                <button class="save-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-bold text-[11px] uppercase tracking-wider shadow-lg">Save & Load</button>
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

                // Copy Page action
                if (!isMaster) {
                    backdrop.querySelector('#settings-btn-copy').onclick = (e) => {
                        e.stopPropagation();
                        this.actionPromptCopyPageCustom(pageId, close);
                    };
                }

                // JSON download action
                backdrop.querySelector('#settings-btn-dl').onclick = () => {
                    this.actionDownloadSingleConstellation(pageId);
                };

                // Delete page action
                if (!isMaster) {
                    backdrop.querySelector('#settings-btn-del').onclick = async () => {
                        close(false);
                        this.actionDeleteFromLibrary(pageId);
                    };
                }

                // Save or Close-Only buttons action
                if (isMaster) {
                    backdrop.querySelector('#settings-btn-close-only').onclick = () => {
                        close(false);
                    };
                } else {
                    backdrop.querySelector('#settings-btn-save').onclick = async () => {
                        const newTitle = titleInput.value.trim();
                        const newType = typeSelect.value;
                        if (!newTitle) return alert("Title cannot be empty.");
                        
                        await this.kernel.updateLibraryItem(pageId, { title: newTitle, type: newType });
                        this.render();
                        close(true);
                    };
                }
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
                            this.actionCloseDataManager();
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
                        ${this.getMapTypeOptionsHtml('generic')}
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
                        // Navigate to the new page
                        this.kernel.loadMapState(page);
                        this.actionCloseDataManager();
                        this.render();
                        setTimeout(() => this.actionOpenPageSettings(page.map_id), 50);
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
                <button id="copy-modal-submit" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-4 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Copy Page</button>
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
                                        <div id="option-keep" class="option-card p-3 rounded-xl border border-indigo-600 bg-indigo-950/20 text-slate-200 cursor-pointer transition-all flex items-start gap-3 shadow-lg shadow-indigo-950/20">
                                            <div class="radio-indicator w-4 h-4 rounded-full border-2 border-indigo-500 flex items-center justify-center shrink-0 mt-0.5">
                                                <div class="radio-fill w-2 h-2 rounded-full bg-indigo-500"></div>
                                            </div>
                                            <div class="flex-1">
                                                <span class="font-bold text-teal-400 block mb-0.5">🔗 Link Across Projects</span>
                                                <span class="text-[10px] text-slate-500 leading-tight">Keep the original portal targets. The copied portals will link back to the pages in the source project.</span>
                                            </div>
                                        </div>
                                        <div id="option-clone" class="option-card p-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 cursor-pointer transition-all flex items-start gap-3">
                                            <div class="radio-indicator w-4 h-4 rounded-full border-2 border-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                                                <div class="radio-fill w-2 h-2 rounded-full bg-transparent"></div>
                                            </div>
                                            <div class="flex-1">
                                                <span class="font-bold text-indigo-400 block mb-0.5">🌀 Clone Dependencies</span>
                                                <span class="text-[10px] text-slate-500 leading-tight">Duplicate the linked pages into the destination project, and update the copied portals to point to these new duplicates.</span>
                                            </div>
                                        </div>
                                        <div id="option-clear" class="option-card p-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 cursor-pointer transition-all flex items-start gap-3">
                                            <div class="radio-indicator w-4 h-4 rounded-full border-2 border-slate-600 flex items-center justify-center shrink-0 mt-0.5">
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
                                    <button class="confirm-btn bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold py-2 px-5 rounded-lg transition-colors shadow-lg shadow-indigo-950/20 uppercase tracking-wide">Confirm Copy</button>
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
                                            c.className = "option-card p-3 rounded-xl border border-indigo-600 bg-indigo-950/20 text-slate-200 cursor-pointer transition-all flex items-start gap-3 shadow-lg shadow-indigo-950/20";
                                            radioFill.className = "radio-fill w-2 h-2 rounded-full bg-indigo-500";
                                            radioInd.className = "radio-indicator w-4 h-4 rounded-full border-2 border-indigo-500 flex items-center justify-center shrink-0 mt-0.5";
                                        } else {
                                            c.className = "option-card p-3 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-300 cursor-pointer transition-all flex items-start gap-3";
                                            radioFill.className = "radio-fill w-2 h-2 rounded-full bg-transparent";
                                            radioInd.className = "radio-indicator w-4 h-4 rounded-full border-2 border-slate-600 flex items-center justify-center shrink-0 mt-0.5";
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
                            setTimeout(() => this.actionOpenPageSettings(clonedPageObj.map_id), 50);
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
            b.className = `text-left w-full px-3 py-2 text-[10px] font-medium flex flex-col transition-colors border-none bg-transparent cursor-pointer ${opt.enabled ? 'text-slate-300 hover:bg-indigo-600 hover:text-white' : 'text-slate-600 cursor-not-allowed'}`;
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
