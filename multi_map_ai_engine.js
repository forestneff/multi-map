/**
 * Multi-Map AI ENGINE v1.0
 * Capstone Feature: Native Language to MapState Generation.
 */

class MultiMapAI {
    constructor(kernel, sandbox) {
        this.kernel = kernel;
        this.sandbox = sandbox;
        this.isOpen = false;
        this.selectedModel = 'gemini-2.5-flash';
        this.chatHistory = [];
        this.pendingMapData = null; // Holds the generated JSON until assigned
        this.pendingProjectData = null; // Holds the generated project JSON
        this.env = {};
        this.envLoaded = false;

        // Tutorial Mode State
        this.tutorialMode = false;

        this.promptsLoaded = false;
        this.basePrompt = "You are an expert System Architect for the Multi-Map Platform. Output valid MapState JSON.";

        this.initDOM();
        this.initAutocomplete();
    }

    initDOM() {
        const container = document.getElementById('ai-chat-container');
        if (!container) return;

        container.innerHTML = `
            <!-- AI Widget Wrapper -->

            <!-- AI Widget Radial Menu Wrapper -->
            <div id="ai-radial-wrapper" class="absolute bottom-6 right-6 z-[60] flex items-center justify-center">
                
                <!-- Main Toggle Button -->
                <button id="ai-toggle-btn" class="relative w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-[0_0_20px_rgba(79,70,229,0.5)] flex items-center justify-center text-2xl transition-transform hover:scale-110 z-[61] text-white border-2 border-indigo-400">
                    ✨
                </button>
            </div>

            <!-- Chat Interface -->
            <div id="ai-chat-panel" class="absolute bottom-24 right-6 w-[380px] max-w-[calc(100vw-3rem)] h-[500px] max-h-[60vh] bg-slate-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-2xl shadow-2xl flex flex-col hidden z-[50] overflow-hidden transform transition-all translate-y-4 opacity-0">
                
                <!-- Header -->
                <div class="p-3 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center shrink-0 gap-2">
                    <div class="flex items-center gap-2">
                        <span class="text-indigo-400 text-lg">✨</span>
                        <span class="font-black text-sm text-slate-200 tracking-wide uppercase">MM-AI</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="ai-tutorial-toggle" class="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded shadow-[0_0_10px_rgba(79,70,229,0.3)] transition-colors flex items-center gap-1 font-bold" title="Toggle Interactive Tutorials">
                            <span class="text-[12px]">🎓</span> <span id="ai-tutorial-status">Learn</span>
                        </button>
                        <select id="ai-model-select" class="bg-slate-800 border border-slate-700 text-xs text-slate-300 rounded px-2 py-1 outline-none focus:border-indigo-500">
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                        </select>
                    </div>
                </div>

                <!-- Messages Area -->
                <div id="ai-messages" class="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
                    <div id="ai-intro-message" class="text-xs text-slate-400 bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 self-start max-w-[85%]">
                        Hello! I am your structural AI. Describe a concept, project, or website, and I will generate a spatial mapstate for it.
                    </div>
                </div>

                <!-- Input Area -->
                <div class="p-3 border-t border-slate-800 bg-slate-950/50 shrink-0 relative">
                    <!-- Autocomplete Popover -->
                    <div id="ai-autocomplete-popover" class="absolute bottom-full mb-2 left-3 right-3 bg-slate-900 border border-indigo-500/40 rounded-xl shadow-2xl z-[120] hidden flex flex-col overflow-hidden max-h-48 custom-scrollbar">
                    </div>
                    <div class="relative flex items-end gap-2">
                        <textarea id="ai-input" rows="1" placeholder="Generate a map for..." class="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 resize-none custom-scrollbar max-h-32" oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"></textarea>
                        <button id="ai-send-btn" class="shrink-0 w-9 h-9 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full flex items-center justify-center transition-colors shadow">
                            <svg class="w-4 h-4 translate-x-px" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Single Line Tooltip Mode -->
            <div id="ai-tooltip-bar" class="absolute bottom-6 right-24 mr-2 bg-slate-900/95 backdrop-blur-xl border border-indigo-500/50 rounded-2xl shadow-[0_0_20px_rgba(79,70,229,0.3)] hidden flex flex-col sm:flex-row sm:items-center px-4 py-3 z-[110] transform transition-all translate-x-4 opacity-0 pointer-events-auto max-w-[calc(100vw-6rem)] gap-3">
                <div id="ai-tooltip-content" class="text-sm text-slate-200 flex-1 whitespace-normal break-words w-full"></div>
                <div id="ai-tooltip-actions" class="flex items-center shrink-0 self-end sm:self-auto"></div>
                <button id="btn-smart-action" class="hidden text-xs font-bold uppercase tracking-widest px-6 py-3 rounded-full border shadow-lg transition-all flex items-center gap-2"></button>
            </div>
        `;

        document.getElementById('ai-toggle-btn').onclick = () => this.toggleChat();
        document.getElementById('ai-send-btn').onclick = () => this.handleSend();

        const panel = document.getElementById('ai-chat-panel');
        // Prevent scroll/zoom events from propagating to the underlying map
        panel.addEventListener('wheel', e => e.stopPropagation(), { passive: false });
        panel.addEventListener('touchmove', e => e.stopPropagation(), { passive: false });
        panel.addEventListener('touchstart', e => e.stopPropagation(), { passive: false });

        const input = document.getElementById('ai-input');
        input.addEventListener('keydown', (e) => {
            if (this.autocompleteActive) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
                    this.handleAutocompleteKeydown(e);
                    return;
                }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });

        document.getElementById('ai-model-select').onchange = (e) => this.selectedModel = e.target.value;

        const tutorialToggleBtn = document.getElementById('ai-tutorial-toggle');
        tutorialToggleBtn.onclick = () => {
            // clear onboarding pulse if active
            tutorialToggleBtn.classList.remove('animate-pulse');
            tutorialToggleBtn.style.boxShadow = '';
            document.getElementById('ai-toggle-btn').classList.remove('animate-pulse');
            document.getElementById('ai-toggle-btn').style.boxShadow = '';

            // revert onboarding message to standard
            const msgEl = document.getElementById('ai-intro-message');
            if (msgEl && msgEl.innerHTML.includes('Welcome to Multi-Map!')) {
                msgEl.innerHTML = "Hello! I am your structural AI. Describe a concept, project, or website, and I will generate a spatial mapstate for it.";
            }

            // Persist the state so it doesn't reappear on refresh
            let progress = JSON.parse(localStorage.getItem('MultiMapTutorialProgress') || '{}');
            if (!progress['seen_onboarding']) {
                progress['seen_onboarding'] = true;
                localStorage.setItem('MultiMapTutorialProgress', JSON.stringify(progress));
            }

            if (window.Tutorials) {
                if (window.Tutorials.isActive) {
                    window.Tutorials.endTutorial();
                } else {
                    window.Tutorials.openSelectionModal();
                }
            }
        };

        this.checkOnboardingState();

        window.addEventListener('resize', () => this.handleResize());
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this.handleResize());
            window.visualViewport.addEventListener('scroll', () => this.handleResize());
        }
    }

    initAutocomplete() {
        this.autocompleteActive = false;
        this.filteredCommands = [];
        this.activeCommandIdx = 0;
        this.allCommands = [
            { key: '/generate', label: 'Generate Map', desc: 'Generate a new map or submap' },
            { key: '/edit', label: 'Edit Map', desc: 'Modify or extend the current map' },
            { key: '/refine', label: 'Refine Selected', desc: 'Modify selected node(s)/subgraph' },
            { key: '/explain', label: 'Explain Map', desc: 'Narrate what this map represents' },
            { key: '/project', label: 'Generate Project', desc: 'Generate a multi-page project' }
        ];

        const input = document.getElementById('ai-input');
        if (!input) return;

        input.addEventListener('input', () => this.handleAutocompleteInput());
    }

    handleAutocompleteInput() {
        const input = document.getElementById('ai-input');
        const val = input.value;

        if (val.startsWith('/') && !val.includes(' ')) {
            const filterText = val.toLowerCase();
            this.filteredCommands = this.allCommands.filter(c => c.key.startsWith(filterText));

            if (this.filteredCommands.length > 0) {
                this.showAutocompletePopover();
            } else {
                this.hideAutocompletePopover();
            }
        } else {
            this.hideAutocompletePopover();
        }
    }

    handleAutocompleteKeydown(e) {
        if (!this.autocompleteActive) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.activeCommandIdx = (this.activeCommandIdx + 1) % this.filteredCommands.length;
            this.renderAutocompletePopover();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.activeCommandIdx = (this.activeCommandIdx - 1 + this.filteredCommands.length) % this.filteredCommands.length;
            this.renderAutocompletePopover();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.selectActiveCommand();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.hideAutocompletePopover();
        }
    }

    showAutocompletePopover() {
        this.autocompleteActive = true;
        const popover = document.getElementById('ai-autocomplete-popover');
        if (popover) {
            popover.classList.remove('hidden');
        }
        this.activeCommandIdx = 0;
        this.renderAutocompletePopover();
    }

    hideAutocompletePopover() {
        this.autocompleteActive = false;
        const popover = document.getElementById('ai-autocomplete-popover');
        if (popover) {
            popover.classList.add('hidden');
        }
    }

    renderAutocompletePopover() {
        const popover = document.getElementById('ai-autocomplete-popover');
        if (!popover) return;

        popover.innerHTML = '';
        this.filteredCommands.forEach((cmd, idx) => {
            const isSelected = idx === this.activeCommandIdx;
            const item = document.createElement('div');
            item.className = `p-2 px-3 text-xs flex justify-between items-center cursor-pointer transition-colors border-b border-slate-800 last:border-0 ${
                isSelected ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800/80 text-slate-300'
            }`;
            item.innerHTML = `
                <div class="flex flex-col">
                    <span class="font-bold">${cmd.key}</span>
                    <span class="text-[10px] ${isSelected ? 'text-slate-200' : 'text-slate-400'}">${cmd.desc}</span>
                </div>
                <span class="text-[10px] opacity-65 uppercase font-black tracking-wider">${cmd.label}</span>
            `;
            item.onclick = (e) => {
                e.stopPropagation();
                this.activeCommandIdx = idx;
                this.selectActiveCommand();
            };
            popover.appendChild(item);
        });
    }

    selectActiveCommand() {
        const cmd = this.filteredCommands[this.activeCommandIdx];
        if (!cmd) return;

        const input = document.getElementById('ai-input');
        if (!input) return;

        const tag = `[${cmd.key.substring(1)}] `;
        input.value = tag;
        
        this.hideAutocompletePopover();
        input.focus();
        
        input.style.height = '';
        input.style.height = input.scrollHeight + 'px';
    }

    handleResize() {
        const panel = document.getElementById('ai-chat-panel');
        const toggleBtn = document.getElementById('ai-toggle-btn');

        if (window.innerWidth <= 768 && window.visualViewport) {
            const vv = window.visualViewport;
            const isInputFocused = document.activeElement === document.getElementById('ai-input') || (document.activeElement && document.activeElement.tagName === 'INPUT');
            const heightDiff = window.innerHeight - vv.height;

            if (isInputFocused || heightDiff > 50) {
                const vvBottom = vv.offsetTop + vv.height;
                const offsetFromBottom = window.innerHeight - vvBottom;

                // Keep toggle button visible above keyboard at all times
                if (toggleBtn) {
                    toggleBtn.style.opacity = '';
                    toggleBtn.style.pointerEvents = '';
                    toggleBtn.style.bottom = `${offsetFromBottom + 24}px`;
                }

                if (panel && this.isOpen) {
                    // Position panel above the toggle button to prevent overlap
                    panel.style.bottom = `${offsetFromBottom + 96}px`;
                    panel.style.maxHeight = `${vv.height - 112}px`;
                }
            } else {
                // Keyboard closed
                if (toggleBtn) {
                    toggleBtn.style.opacity = '';
                    toggleBtn.style.pointerEvents = '';
                    toggleBtn.style.bottom = '';
                }
                if (panel && this.isOpen) {
                    panel.style.bottom = '';
                    panel.style.maxHeight = '';
                }
            }
        } else {
            // Desktop or standard state
            if (toggleBtn) {
                toggleBtn.style.opacity = '';
                toggleBtn.style.pointerEvents = '';
                toggleBtn.style.bottom = '';
            }
            if (panel && this.isOpen) {
                panel.style.bottom = '';
                panel.style.maxHeight = '';
            }
        }
    }

    checkOnboardingState() {
        const progress = JSON.parse(localStorage.getItem('MultiMapTutorialProgress') || '{}');
        // Check if basic_intro is completed or if they've already seen the onboarding
        if (!progress['basic_intro'] && !progress['seen_onboarding']) {
            // Pulse the AI toggle widget so they click it
            const btn = document.getElementById('ai-toggle-btn');
            if (btn && !btn.classList.contains('animate-pulse')) {
                btn.classList.add('animate-pulse');
                btn.style.boxShadow = '0 0 25px 10px rgba(79,70,229,0.7)';
            }

            // Change intro message
            const msgEl = document.getElementById('ai-intro-message');
            if (msgEl) {
                msgEl.innerHTML = "Welcome to Multi-Map! To get started, I highly recommend exploring the interactive <span class='text-indigo-400 font-bold'>Learn</span> tutorials to learn the ropes.";
            }

            // Highlight the Learn button inside
            const learnBtn = document.getElementById('ai-tutorial-toggle');
            if (learnBtn) {
                learnBtn.classList.add('animate-pulse');
                learnBtn.style.boxShadow = '0 0 15px 5px rgba(79,70,229,0.7)';
            }
        }
    }

    // --- Tutorial / Tooltip Methods ---

    setTutorialMode(active) {
        this.tutorialMode = active;
        const btn = document.getElementById('ai-toggle-btn');
        const status = document.getElementById('ai-tutorial-status');
        const toggleBtn = document.getElementById('ai-tutorial-toggle');

        if (active) {
            btn.classList.add('animate-pulse');
            btn.style.boxShadow = '0 0 25px 10px rgba(79,70,229,0.7)';
            status.innerText = 'On';
            toggleBtn.classList.add('bg-indigo-900', 'border-indigo-500', 'text-indigo-200');
            toggleBtn.classList.remove('bg-slate-800', 'border-slate-700', 'text-slate-300');
            // Ensure main panel is closed
            if (this.isOpen) this.toggleChat();
        } else {
            btn.classList.remove('animate-pulse');
            btn.style.boxShadow = '';
            status.innerText = 'Learn';
            toggleBtn.classList.remove('bg-indigo-900', 'border-indigo-500', 'text-indigo-200');
            toggleBtn.classList.add('bg-slate-800', 'border-slate-700', 'text-slate-300');
            this.hideTooltip();
        }
    }

    showTooltip(text, actionsHtml = '', customClass = '') {
        const bar = document.getElementById('ai-tooltip-bar');
        const content = document.getElementById('ai-tooltip-content');
        const actions = document.getElementById('ai-tooltip-actions');
        const btn = document.getElementById('btn-smart-action');

        if (this.tooltipHideTimeout) {
            clearTimeout(this.tooltipHideTimeout);
            this.tooltipHideTimeout = null;
        }

        if (btn) btn.classList.add('hidden');
        if (content) {
            content.innerHTML = text;
            content.classList.remove('hidden');
        }
        if (actions) {
            actions.innerHTML = actionsHtml;
            actions.classList.remove('hidden');
        }

        // Apply any custom offset classes (clean up old ones first)
        bar.className = bar.className.replace(/mb-\d+|bottom-\d+/g, '').trim() + ' bottom-6';
        if (customClass) {
            bar.classList.remove('bottom-6');
            bar.classList.add(...customClass.split(' '));
        }

        bar.classList.remove('hidden');
        setTimeout(() => {
            bar.classList.remove('translate-x-4', 'opacity-0');
        }, 10);
    }

    hideTooltip() {
        const bar = document.getElementById('ai-tooltip-bar');
        if (!bar) return;

        // If no tutorial is active, and a smart action is active, transition back to it
        const tutorialActive = window.Tutorials && window.Tutorials.isActive;
        if (!tutorialActive && this.sandbox && typeof this.sandbox.updateSmartActionButton === 'function') {
            if (typeof this.sandbox.hasSmartAction === 'function' && this.sandbox.hasSmartAction()) {
                this.sandbox.updateSmartActionButton();
                return;
            }
        }

        bar.classList.add('translate-x-4', 'opacity-0');
        if (this.tooltipHideTimeout) clearTimeout(this.tooltipHideTimeout);
        this.tooltipHideTimeout = setTimeout(() => bar.classList.add('hidden'), 300);
    }

    toggleChat() {
        const panel = document.getElementById('ai-chat-panel');
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            panel.classList.remove('hidden');
            setTimeout(() => {
                this.handleResize();
                panel.classList.remove('translate-y-4', 'opacity-0');
                document.getElementById('ai-input').focus();
            }, 10);
        } else {
            panel.classList.add('translate-y-4', 'opacity-0');
            setTimeout(() => {
                panel.classList.add('hidden');
            }, 300);
        }
    }

    addMessage(role, text, actionHtml = '') {
        const msgs = document.getElementById('ai-messages');
        const div = document.createElement('div');
        div.className = `text-xs p-3 rounded-xl border max-w-[90%] ${role === 'user' ? 'self-end bg-sky-900/40 border-sky-700/50 text-sky-100' : 'self-start bg-slate-800/80 border-indigo-700/30 text-slate-300'}`;
        div.innerHTML = text.replace(/\n/g, '<br>') + actionHtml;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }

    handleSmartNodeConnection(sourceNode, targetNode) {
        if (!sourceNode || !targetNode || targetNode.type !== 'smart-portal') return;
        
        // Open the AI chat panel if closed
        const chatPanel = document.getElementById('ai-chat-container');
        if (chatPanel && chatPanel.classList.contains('translate-y-full')) {
            window.AI.toggleChat();
        }

        const input = document.getElementById('ai-input');
        if (input) {
            let func = targetNode.content || 'expand';
            let customInst = '';
            if (func.startsWith('custom:')) {
                customInst = func.substring(7);
                func = 'custom';
            }
            
            let instruction = '';
            switch(func) {
                case 'expand': instruction = 'process and expand upon the data'; break;
                case 'summarize': instruction = 'provide a concise summary of the data'; break;
                case 'pass_prompt': instruction = 'use the data as a direct prompt/instruction to generate new structures'; break;
                case 'custom': instruction = customInst; break;
                default: instruction = 'process the data';
            }

            input.value = `Update node "${targetNode.id}" by executing the following instruction on the source data from "${sourceNode.title}":\nInstruction: ${instruction}\nSource Data: ${sourceNode.content}`;
            this.handleSend();
        }
    }

    tryExecuteLocalCommand(text) {
        if (!this.kernel) return false;

        // 1. View switching
        const viewMatch = text.match(/^\s*(?:show|view|switch\s+to|go\s+to)\s+(map|web|orbital|prompt|agent|person)\s*$/i);
        if (viewMatch) {
            const phase = viewMatch[1].toLowerCase();
            window.SC.setView(phase);
            this.addMessage('system', `Switched view to <strong>${phase}</strong>.`);
            return true;
        }

        // 2. Exit Portal
        const exitMatch = text.match(/^\s*(?:exit|leave|go\s+back|exit\s+portal)\s*$/i);
        if (exitMatch) {
            if (this.kernel.portalHistory.length > 0) {
                window.SC.actionExitPortal();
                this.addMessage('system', `Exited portal and returned to parent map.`);
            } else {
                this.addMessage('system', `You are not currently inside a portal/submap.`);
            }
            return true;
        }

        // 3. Portal Enter
        const enterMatch = text.match(/^\s*(?:enter|go\s+into|open)\s+(?:portal\s+)?(.+)\s*$/i);
        if (enterMatch) {
            const term = enterMatch[1].trim().toLowerCase();
            const node = this.kernel.state.nodes.find(n => 
                (n.type === 'portal' || n.type === 'smart-portal') && 
                (n.id === term || n.title.toLowerCase().includes(term))
            );
            if (node) {
                const lib = this.kernel.getLibrary();
                const map = lib.find(m => m.map_id === node.content);
                if (map) {
                    window.SC.actionEnterPortal(node.id);
                    this.addMessage('system', `Entered portal <strong>${node.title}</strong>.`);
                } else {
                    this.addMessage('system', `Target map for portal <strong>${node.title}</strong> not found in library.`);
                }
            } else {
                this.addMessage('system', `Could not find a portal node matching <strong>${enterMatch[1]}</strong>.`);
            }
            return true;
        }

        // 4. Node selection
        const selectMatch = text.match(/^\s*select\s+(?:node\s+)?(.+)\s*$/i);
        if (selectMatch) {
            const term = selectMatch[1].trim().toLowerCase();
            const node = this.kernel.state.nodes.find(n => 
                n.id === term || n.title.toLowerCase().includes(term)
            );
            if (node) {
                this.kernel.selectNode(node.id);
                window.SC.render();
                this.addMessage('system', `Selected node <strong>${node.title}</strong>.`);
            } else {
                this.addMessage('system', `Could not find a node matching <strong>${selectMatch[1]}</strong>.`);
            }
            return true;
        }

        // 5. Node renaming
        const renameMatch = text.match(/^\s*rename\s+(?:node\s+)?(.+?)\s+to\s+(.+)\s*$/i);
        if (renameMatch) {
            const term = renameMatch[1].trim().toLowerCase();
            const newTitle = renameMatch[2].trim();
            const node = this.kernel.state.nodes.find(n => 
                n.id === term || n.title.toLowerCase().includes(term)
            );
            if (node) {
                const oldTitle = node.title;
                this.kernel.updateNode(node.id, { title: newTitle });
                window.SC.render();
                this.addMessage('system', `Renamed node <strong>${oldTitle}</strong> to <strong>${newTitle}</strong>.`);
            } else {
                this.addMessage('system', `Could not find a node matching <strong>${renameMatch[1]}</strong>.`);
            }
            return true;
        }

        // 6. Node deletion
        const deleteMatch = text.match(/^\s*(?:delete|remove)\s+(?:node\s+)?(.+)\s*$/i);
        if (deleteMatch) {
            const term = deleteMatch[1].trim().toLowerCase();
            const node = this.kernel.state.nodes.find(n => 
                n.id === term || n.title.toLowerCase().includes(term)
            );
            if (node) {
                const title = node.title;
                this.kernel.deleteNode(node.id);
                window.SC.render();
                this.addMessage('system', `Deleted node <strong>${title}</strong>.`);
            } else {
                this.addMessage('system', `Could not find a node matching <strong>${deleteMatch[1]}</strong>.`);
            }
            return true;
        }

        // 7. Node linking
        const linkMatch = text.match(/^\s*link\s+(.+?)\s+to\s+(.+)\s*$/i);
        if (linkMatch) {
            const term1 = linkMatch[1].trim().toLowerCase();
            const term2 = linkMatch[2].trim().toLowerCase();
            const node1 = this.kernel.state.nodes.find(n => n.id === term1 || n.title.toLowerCase().includes(term1));
            const node2 = this.kernel.state.nodes.find(n => n.id === term2 || n.title.toLowerCase().includes(term2));
            
            if (node1 && node2) {
                const exists = this.kernel.state.connections.some(c => 
                    (c.from === node1.id && c.to === node2.id) || 
                    (c.from === node2.id && c.to === node1.id)
                );
                if (exists) {
                    this.addMessage('system', `Node <strong>${node1.title}</strong> and <strong>${node2.title}</strong> are already linked.`);
                } else {
                    const res = this.kernel.addConnection(node1.id, node2.id);
                    if (res && res.success === false) {
                        this.addMessage('system', `Cannot link <strong>${node1.title}</strong> to <strong>${node2.title}</strong> due to schema/connection rules.`);
                    } else {
                        window.SC.render();
                        this.addMessage('system', `Linked <strong>${node1.title}</strong> to <strong>${node2.title}</strong>.`);
                    }
                }
            } else {
                if (!node1) {
                    this.addMessage('system', `Could not find a node matching <strong>${linkMatch[1]}</strong>.`);
                } else {
                    this.addMessage('system', `Could not find a node matching <strong>${linkMatch[2]}</strong>.`);
                }
            }
            return true;
        }

        // 8. Node adding/creation
        const addMatch = text.match(/^\s*(?:add|create)\s+(?:node\s+)?(?:([a-zA-Z0-9_-]+)\s+)?(.+)\s*$/i);
        if (addMatch) {
            let type = addMatch[1];
            let title = addMatch[2].trim();
            const knownTypes = ['root', 'hub', 'note', 'portal', 'smart-portal', 'logic-gate',
                                'web-root', 'web-nav', 'web-hero', 'web-section', 'web-card',
                                'web-link', 'web-button', 'web-text', 'web-image', 'web-video',
                                'web-form', 'web-input', 'web-grid', 'web-list', 'web-modal',
                                'web-carousel', 'person-root', 'person-profile', 'person-credentials',
                                'person-notes'];
            if (!type || !knownTypes.includes(type.toLowerCase())) {
                title = (type ? type + ' ' : '') + title;
                type = null;
            } else {
                type = type.toLowerCase();
            }

            const pid = this.kernel.state.session.selectedId;
            const parentNode = pid ? this.kernel.state.nodes.find(n => n.id === pid) : null;

            if (!type) {
                type = pid ? this.kernel.getSmartChildType(pid) : 'note';
            }

            if (parentNode && typeof MultiMapSchema !== 'undefined') {
                const mapType = this.kernel.state.meta && this.kernel.state.meta.type ? this.kernel.state.meta.type : 'generic';
                const allowedInMap = (MultiMapSchema.mapTypes && MultiMapSchema.mapTypes[mapType]) ? MultiMapSchema.mapTypes[mapType].allowedNodes || [] : [];
                
                if (allowedInMap.length > 0 && !allowedInMap.includes(type)) {
                    this.addMessage('system', `Schema constraint: Type <strong>${type}</strong> is not allowed in a <strong>${mapType}</strong> map.`);
                    return true;
                }
                if (!MultiMapSchema.canConnect(parentNode.type, type)) {
                    this.addMessage('system', `Schema constraint: Cannot add a [${type}] child to a [${parentNode.type}] node in this map.`);
                    return true;
                }
            }

            const child = this.kernel.addNode({ title: title, type: type }, pid);
            if (pid) {
                this.kernel.addConnection(pid, child.id);
            }
            window.SC.render();
            
            let msg = `Created node <strong>${title}</strong> of type <strong>${type}</strong>`;
            if (parentNode) {
                msg += ` linked under <strong>${parentNode.title}</strong>.`;
            } else {
                msg += `.`;
            }
            this.addMessage('system', msg);
            return true;
        }

        return false;
    }

    async handleSend() {
        const input = document.getElementById('ai-input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = 'auto';
        this.addMessage('user', text);

        if (this.tryExecuteLocalCommand(text)) {
            return;
        }

        // Loading state
        const msgs = document.getElementById('ai-messages');
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'ai-loading';
        loadingDiv.className = 'text-xs text-indigo-400 self-start animate-pulse p-2';
        loadingDiv.innerText = 'Synthesizing matrix...';
        msgs.appendChild(loadingDiv);
        msgs.scrollTop = msgs.scrollHeight;

        try {
            let jsonString = '';
            const contextStr = this.buildContextString();
            const contextualPrompt = text + (contextStr ? "\n\n" + contextStr : "");
            let mode = 'generate';

            if (this.selectedModel === 'native-mock') {
                // Keep local keyword matching for the mock
                const textLower = text.toLowerCase();
                if (textLower.includes('update') || textLower.includes('edit') || textLower.includes('add') || textLower.includes('delete') || textLower.includes('change')) {
                    mode = 'edit';
                } else if (textLower.includes('summarize') || textLower.includes('analyze') || textLower.includes('what') || textLower.includes('explain')) {
                    mode = 'analyze';
                }
                jsonString = await this.mockAIGeneration(contextualPrompt, mode);
            } else {
                const aiResult = await this.geminiAPIGeneration(text, contextStr);
                jsonString = aiResult.text;
                mode = aiResult.mode;
            }

            // Clean markdown JSON wrapping if present
            jsonString = jsonString.trim();
            if (jsonString.startsWith('```')) {
                jsonString = jsonString.replace(/^```(?:json)?\s*/i, '');
                jsonString = jsonString.replace(/\s*```$/i, '');
            }

            let aiData;
            try {
                aiData = JSON.parse(jsonString);
            } catch (err) {
                console.error("Raw AI Output:", jsonString);
                throw new Error("Invalid JSON structure returned by AI.");
            }

            if (aiData.type === "multimap_project" || (aiData.project && aiData.pages)) {
                // Project Generation Mode
                aiData.type = "multimap_project";
                this.pendingProjectData = aiData;

                const actionHtml = `
                    <div class="mt-3 flex flex-col gap-2 border-t border-indigo-500/30 pt-3">
                        <button onclick="window.AI.importPendingProject()" class="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold shadow transition-colors flex justify-center items-center gap-2">
                            🚀 Import as New Project
                        </button>
                    </div>
                `;

                if (document.getElementById('ai-loading')) {
                    document.getElementById('ai-loading').remove();
                }
                this.addMessage('system', `Project generated: **${aiData.project.meta?.title || 'Project'}** with ${aiData.pages.length} pages. How would you like to deploy it?`, actionHtml);
            } else if (aiData.map_id && aiData.nodes) {
                // Legacy Map Generation Mode
                aiData.map_id = "ai_" + this.kernel.generateId();
                this.pendingMapData = aiData;

                const actionHtml = `
                    <div class="mt-3 flex flex-col gap-2 border-t border-indigo-500/30 pt-3">
                        <button onclick="window.AI.initiateTargetedImport()" class="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold shadow transition-colors flex justify-center items-center gap-2">
                            🎯 Assign to Existing Smart-Portal
                        </button>
                        <button onclick="window.AI.injectIntoNewSmartPortal()" class="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold shadow transition-colors flex justify-center items-center gap-2">
                            🌟 Assign to New Smart-Portal
                        </button>
                        <button onclick="window.AI.actionExpandSelected()" class="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-bold shadow transition-colors flex justify-center items-center gap-2">
                            🌱 Expand Selected Node
                        </button>
                        <button onclick="window.AI.actionUpdateSelected()" class="w-full py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded font-bold shadow transition-colors flex justify-center items-center gap-2">
                            ✏️ Update Selected Node
                        </button>
                        <button onclick="window.AI.loadAsNewSession()" class="w-full py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded font-bold shadow transition-colors flex justify-center items-center gap-2">
                            🌌 Load as New Session
                        </button>
                    </div>
                `;

                if (document.getElementById('ai-loading')) {
                    document.getElementById('ai-loading').remove();
                }
                this.addMessage('system', `Map generated: **${aiData.meta?.title || 'Map'}** (${aiData.nodes.length} nodes). How would you like to deploy it?`, actionHtml);
            } else if (aiData.message) {
                // New Analyze or Edit Mode
                if (document.getElementById('ai-loading')) {
                    document.getElementById('ai-loading').remove();
                }

                // Print Message
                this.addMessage('system', aiData.message);

                // Apply Edits if they exist
                if (aiData.edits && Array.isArray(aiData.edits)) {
                    for (const edit of aiData.edits) {
                        try {
                            if (edit.action === 'update' && edit.nodeId) {
                                this.kernel.updateNode(edit.nodeId, edit.data);
                            } else if (edit.action === 'add' && edit.parentId) {
                                const newNode = this.kernel.addNode(edit.data, edit.parentId);
                                this.kernel.addConnection(edit.parentId, newNode.id);
                            } else if (edit.action === 'delete' && edit.nodeId) {
                                this.kernel.deleteNode(edit.nodeId);
                            } else if (edit.action === 'project-update' && edit.projectId) {
                                await this.kernel.renameProject(edit.projectId, edit.data.title, edit.data.description, edit.data.icon, edit.data.color);
                            } else if (edit.action === 'page-add' && edit.projectId) {
                                await this.kernel.createPage(edit.projectId, edit.data.title, edit.data.type || 'generic');
                            } else if (edit.action === 'page-rename' && edit.pageId) {
                                await this.kernel.updateLibraryItem(edit.pageId, { title: edit.data.title });
                            } else if (edit.action === 'page-delete' && edit.pageId) {
                                await this.kernel.deleteFromLibrary(edit.pageId);
                            } else if (edit.action === 'page-move' && edit.pageId) {
                                await this.kernel.movePage(edit.pageId, edit.fromProjectId, edit.toProjectId);
                            } else if (edit.action === 'page-copy' && edit.pageId) {
                                await this.kernel.clonePage(edit.pageId, edit.toProjectId || 'new', edit.data?.title, edit.data?.projectName);
                            }
                        } catch (err) {
                            console.error("Failed to apply edit:", edit, err);
                        }
                    }
                    this.sandbox.render();
                }
            } else {
                throw new Error("Unrecognized JSON schema returned by AI.");
            }

        } catch (e) {
            if (document.getElementById('ai-loading')) {
                document.getElementById('ai-loading').remove();
            }
            
            if (e.message === "RATE_LIMIT_EXCEEDED" && e.quota) {
                const isUserAnon = window.FirebaseAuth && window.FirebaseAuth.currentUser && window.FirebaseAuth.currentUser.isAnonymous;
                const isGuest = !window.FirebaseAuth || !window.FirebaseAuth.currentUser;
                
                let limitMsg = '';
                let actionHtml = '';
                
                if (isUserAnon || isGuest) {
                    limitMsg = `**Quota reached (5/5 requests).** You've used your free AI credits for today. Create a free account to get 25/day!`;
                    actionHtml = `
                        <div class="mt-3 border-t border-indigo-500/30 pt-3 flex justify-center">
                            <button onclick="toggleDrawer('profile-drawer'); window.AI.toggleChat();" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold shadow transition-colors text-[11px] uppercase tracking-wider">
                                🔑 Create Free Account
                            </button>
                        </div>
                    `;
                } else {
                    const resetDate = new Date(e.quota.reset_at);
                    const localResetStr = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    limitMsg = `**Rate limit reached (25/25 requests).** Your daily quota resets at ${localResetStr}.`;
                }
                
                this.addMessage('system', limitMsg, actionHtml);
            } else {
                this.addMessage('system', `Error: Failed to generate valid MapState. ${e.message}`);
            }
        }
    }

    // --- Actions Triggered by Chat Buttons ---

    initiateTargetedImport() {
        if (!this.pendingMapData) return;
        this.sandbox.enterAiImportMode(this.pendingMapData);
        this.toggleChat(); // Hide chat to focus on selection
    }

    async injectIntoNewSmartPortal() {
        if (!this.pendingMapData) return;

        let parentId = this.kernel.state.session.selectedId;
        if (!parentId && this.kernel.state.nodes.length > 0) {
            parentId = this.kernel.state.nodes[0].id;
        }

        if (!parentId) {
            alert("Please select a node first to attach the new portal.");
            return;
        }

        const child = this.kernel.addNode({ title: this.pendingMapData.meta.title || "AI Portal", type: "smart-portal" }, parentId);
        this.kernel.addConnection(parentId, child.id);

        const saved = await this.kernel.saveConstellationToLibrary(this.pendingMapData);
        if (saved === false) {
            alert("Guest map limit (25) exceeded.");
            return;
        }
        
        this.kernel.updateNode(child.id, { content: this.pendingMapData.map_id });
        this.kernel.importSubmap(child.id, this.pendingMapData);

        alert(`AI Map injected into a new Smart Portal!`);

        this.kernel.selectNode(child.id);
        this.sandbox.render();
        this.pendingMapData = null;
        this.toggleChat();
    }

    async actionExpandSelected() {
        if (!this.pendingMapData) return;
        const parentId = this.kernel.state.session.selectedId;
        if (!parentId) {
            alert("No node selected to expand!");
            return;
        }

        const saved = await this.kernel.saveConstellationToLibrary(this.pendingMapData);
        if (saved === false) {
            alert("Guest map limit (25) exceeded.");
            return;
        }

        // importSubmap links the imported roots to the parentId
        this.kernel.importSubmap(parentId, this.pendingMapData);

        alert(`AI Map expanded into selected node!`);
        this.sandbox.render();
        this.pendingMapData = null;
        this.toggleChat();
    }

    actionUpdateSelected() {
        if (!this.pendingMapData) return;
        const targetId = this.kernel.state.session.selectedId;
        if (!targetId) {
            alert("No node selected to update!");
            return;
        }

        const targetNode = this.kernel.state.nodes.find(n => n.id === targetId);
        if (!targetNode) return;

        // Grab the root node of the generated map
        const rootNodes = this.pendingMapData.nodes.filter(n => !this.pendingMapData.connections.find(c => c.to === n.id && c.type === 'structural'));
        const genRoot = rootNodes.length > 0 ? rootNodes[0] : this.pendingMapData.nodes[0];

        if (genRoot) {
            // Schema Guardrails
            let newType = genRoot.type;
            if (typeof MultiMapSchema !== 'undefined' && !MultiMapSchema.definitions[newType]) {
                console.warn(`Type ${newType} not allowed by schema. Keeping ${targetNode.type}`);
                newType = targetNode.type;
            }

            // Prevent changing root type to a regular type, or regular type to a root type
            const isTargetRoot = targetNode.type === 'root' || targetNode.type.endsWith('-root') || (targetNode.data && targetNode.data.isCore);
            const isGenRoot = newType === 'root' || newType.endsWith('-root');
            if (isTargetRoot !== isGenRoot) {
                console.warn(`Type change from ${targetNode.type} to ${newType} blocked to preserve root ontology.`);
                newType = targetNode.type;
            }

            // Repositioning logic: keep original x/y unless valid new coordinates provided
            let newX = genRoot.data?.x !== undefined ? genRoot.data.x : targetNode.data.x;
            let newY = genRoot.data?.y !== undefined ? genRoot.data.y : targetNode.data.y;

            this.kernel.updateNode(targetId, {
                title: genRoot.title || targetNode.title,
                type: newType,
                content: genRoot.content !== undefined ? genRoot.content : targetNode.content,
                data: {
                    ...targetNode.data,
                    x: newX,
                    y: newY,
                }
            });
        }

        alert(`Selected node updated with AI content!`);
        this.sandbox.render();
        this.pendingMapData = null;
        this.toggleChat();
    }

    loadAsNewSession() {
        if (!this.pendingMapData) return;

        // Save current to library
        this.sandbox.actionSaveCurrentToLibrary();

        // Load new map
        this.kernel.loadMapState(this.pendingMapData);
        alert(`Session Saved. AI Map "${this.pendingMapData.meta.title}" loaded successfully.`);
        this.pendingMapData = null;
    }

    async importPendingProject() {
        if (!this.pendingProjectData) return;
        await this.sandbox.processProjectImport(this.pendingProjectData);
        this.pendingProjectData = null;
        this.toggleChat();
    }

    // --- Context Building ---

    buildContextString() {
        const activeProjId = this.kernel.activeProjectId;
        const projects = this.kernel.getProjects ? this.kernel.getProjects() : [];
        const activeProj = projects.find(p => p.project_id === activeProjId) || { meta: { title: "Untitled Project", description: "" } };
        const activeProjPages = this.kernel.getPages ? this.kernel.getPages(activeProjId) : [];

        let ctx = "--- PROJECT CONTEXT ---\n" +
            `Active Project ID: ${activeProjId || 'default_project'}\n` +
            `Active Project Title: ${activeProj.meta?.title || "Untitled"}\n` +
            `Active Project Description: ${activeProj.meta?.description || "None"}\n` +
            `Pages in Active Project:\n` +
            activeProjPages.map(p => `  - [Page ID: ${p.map_id}] "${p.meta?.title || "Untitled"}" (${p.meta?.type || "generic"} type, ${(p.nodes || []).length} nodes)`).join("\n") +
            "\n" +
            `All Workspace Projects:\n` +
            projects.map(p => `  - [Project ID: ${p.project_id}] "${p.meta?.title || "Untitled"}" (${(p.page_ids || []).length} pages)`).join("\n") +
            "\n---------------------------\n";

        const selectedId = this.kernel.state.session.selectedId;
        if (!selectedId) {
            ctx += "--- FULL MAP OVERVIEW ---\n" +
                JSON.stringify(this.kernel.state.nodes.map(n => ({ id: n.id, title: n.title, type: n.type }))) +
                "\n---------------------------\n";
            return ctx;
        }

        const state = this.kernel.state;
        ctx += "--- CURRENT MAP CONTEXT ---\n";

        // Helper to get connected nodes recursively
        const getConnected = (nodeId, direction, maxDepth, currentDepth = 0, visited = new Set()) => {
            if (currentDepth > maxDepth || visited.has(nodeId)) return [];
            visited.add(nodeId);
            const node = state.nodes.find(n => n.id === nodeId);
            if (!node) return [];

            let result = [{ depth: currentDepth, node }];

            const conns = state.connections.filter(c => direction === 'up' ? c.to === nodeId : c.from === nodeId);
            for (const conn of conns) {
                const nextId = direction === 'up' ? conn.from : conn.to;
                result = result.concat(getConnected(nextId, direction, maxDepth, currentDepth + 1, visited));
            }
            return result;
        };

        const upstream = getConnected(selectedId, 'up', 3);
        const downstream = getConnected(selectedId, 'down', 3);

        const formatNode = (n) => `[ID: ${n.id}] ${n.title} (Type: ${n.type})` + (n.content ? `\n  Content: ${n.content.substring(0, 100)}...` : '');

        ctx += "Selected Node:\n";
        const selectedNode = state.nodes.find(n => n.id === selectedId);
        if (selectedNode) ctx += formatNode(selectedNode) + "\n\n";

        ctx += "Upstream Context (up to 3 levels):\n";
        upstream.filter(x => x.depth > 0).forEach(x => {
            ctx += `${'-'.repeat(x.depth)} ` + formatNode(x.node) + "\n";
        });

        ctx += "\nDownstream Context (up to 3 levels):\n";
        downstream.filter(x => x.depth > 0).forEach(x => {
            ctx += `${'-'.repeat(x.depth)} ` + formatNode(x.node) + "\n";
        });

        ctx += "---------------------------\n";
        ctx += "If editing, use these node IDs to target your changes.\n";
        return ctx;
    }

    // --- AI Generation Handlers ---

    async mockAIGeneration(prompt, mode) {
        return new Promise(resolve => {
            setTimeout(() => {
                if (mode === 'edit' || mode === 'analyze') {
                    resolve(JSON.stringify({
                        message: "Mocked response. I have analyzed/edited the map as requested.",
                        edits: mode === 'edit' ? [] : undefined
                    }));
                } else {
                    const response = {
                        "map_id": "ai_mock",
                        "meta": { "title": "AI Generated Structure", "created": new Date().toISOString(), "notes": "Generated from prompt: " + prompt, "shared": false },
                        "nodes": [
                            { "id": "m1", "type": "root", "title": "Core Concept", "content": prompt, "data": { "x": 0, "y": 0, "isCore": true, "collapsed": false }, "submaps": [] },
                            { "id": "m2", "type": "note", "title": "Detail 1", "content": "Synthesized detail.", "data": { "x": -150, "y": -150, "isCore": false, "collapsed": false }, "submaps": [] },
                            { "id": "m3", "type": "note", "title": "Detail 2", "content": "Synthesized detail.", "data": { "x": 150, "y": -150, "isCore": false, "collapsed": false }, "submaps": [] },
                            { "id": "m4", "type": "smart-portal", "title": "Deep Dive", "content": "", "data": { "x": 0, "y": 150, "isCore": false, "collapsed": false }, "submaps": [] }
                        ],
                        "connections": [
                            { "id": "mc1", "from": "m1", "to": "m2", "type": "structural" },
                            { "id": "mc2", "from": "m1", "to": "m3", "type": "structural" },
                            { "id": "mc3", "from": "m1", "to": "m4", "type": "structural" }
                        ],
                        "submaps": []
                    };
                    resolve(JSON.stringify(response));
                }
            }, 1500); // Simulate API latency
        });
    }

    async loadPrompts() {
        if (this.promptsLoaded) return;
        try {
            const baseRes = await fetch('./skills/generate-mapstate/SKILL.md');
            if (baseRes.ok) {
                const baseText = await baseRes.text();
                this.basePrompt = baseText.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
            }

            const webRes = await fetch('./skills/generate-web-mapstate/SKILL.md');
            if (webRes.ok) {
                const webText = await webRes.text();
                this.webPrompt = webText.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
            }

            const analyzeRes = await fetch('./skills/analyze-mapstate/SKILL.md');
            if (analyzeRes.ok) {
                const analyzeText = await analyzeRes.text();
                this.analyzePrompt = analyzeText.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
            }

            const editRes = await fetch('./skills/edit-mapstate/SKILL.md');
            if (editRes.ok) {
                const editText = await editRes.text();
                this.editPrompt = editText.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
            }

            this.promptsLoaded = true;
        } catch (e) {
            console.warn("Failed to load skills:", e.message);
            this.promptsLoaded = true; // prevent retry on failure
        }
    }



    async getAuthToken() {
        if (typeof window.getFirebaseAuthToken === 'function') {
            const token = await window.getFirebaseAuthToken();
            if (token) {
                return { scheme: 'Bearer', value: token };
            }
        }

        // Guest / Anonymous fallback
        let anonSessionId = localStorage.getItem('mm_anon_session_id');
        if (!anonSessionId) {
            anonSessionId = 'anon-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('mm_anon_session_id', anonSessionId);
        }
        return { scheme: 'Anonymous', value: anonSessionId };
    }

    async geminiAPIGeneration(prompt, contextStr) {
        // --- CLOUD AGENT ARCHITECTURE ---
        // We no longer query Google APIs directly from the client.
        // Instead, we hit our Serverless Cloud Function (Firebase/Cloudflare).

        let CLOUD_AGENT_URL = "https://us-central1-mm-multi-map.cloudfunctions.net/generateMapState";

        // Auto-detect local development
        if (window.location.hostname !== "mm.forestneff.com") {
            const projectId = "mm-multi-map";
            const host = (window.location.hostname === "0.0.0.0" || window.location.hostname === "[::1]" || !window.location.hostname) ? "127.0.0.1" : window.location.hostname;
            CLOUD_AGENT_URL = `http://${host}:5001/${projectId}/us-central1/generateMapState`;
        }

        const auth = await this.getAuthToken();
        const authHeaderValue = `${auth.scheme} ${auth.value}`;

        const response = await fetch(CLOUD_AGENT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeaderValue,
                'X-Authorization': authHeaderValue,
                'X-Anonymous-Session': auth.scheme === 'Anonymous' ? auth.value : ''
            },
            body: JSON.stringify({
                prompt: prompt,
                contextStr: contextStr,
                model: this.selectedModel,
                mapId: this.kernel?.state?.map_id || 'unknown'
            })
        });

        if (response.status === 429) {
            const errorData = await response.json().catch(() => ({}));
            const err = new Error("RATE_LIMIT_EXCEEDED");
            err.quota = errorData;
            throw err;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Cloud Agent Error ${response.status}`);
        }

        const data = await response.json();
        const outputText = data.text || data.result;

        if (!outputText) {
            throw new Error("Invalid response format from Cloud Agent");
        }

        return { text: outputText, mode: data.mode || 'generate' };
    }
}