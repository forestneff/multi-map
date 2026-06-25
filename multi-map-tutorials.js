/**
 * Multi-Map TUTORIAL ORCHESTRATOR
 * Handles interactive tutorials via glowing halos, AI tooltips, and file-based dynamic sequences.
 */

class TutorialOrchestrator {
    constructor(aiEngine) {
        this.ai = aiEngine;
        this.isActive = false;
        this.currentTutorial = null;
        this.currentStepIndex = 0;
        this.haloElement = null;
        this.modalElement = null;

        // Ensure we re-position halo on resize
        window.addEventListener('resize', () => {
            if (this.isActive && this.haloElement && this.haloElement.style.opacity === '1') {
                this.updateHaloPosition();
            }
        });

        this.init();
    }

    init() {
        this.initHalo();
        this.initModal();
        this.updateLearnButtonState();
    }

    updateLearnButtonState() {
        const span = document.getElementById('ai-tutorial-status');
        if (!span) return;
        
        const prog = this.getTutorialProgress();
        const totalTutorials = 7; 
        const completedCount = Object.keys(prog).length;
        if (completedCount >= totalTutorials) {
            span.classList.add('hidden');
        } else {
            span.classList.remove('hidden');
        }
    }

    getTutorialProgress() {
        try {
            return JSON.parse(localStorage.getItem('MultiMapTutorialProgress') || '{}');
        } catch(e) {
            return {};
        }
    }

    markTutorialComplete(id) {
        const prog = this.getTutorialProgress();
        prog[id] = true;
        localStorage.setItem('MultiMapTutorialProgress', JSON.stringify(prog));
        this.updateLearnButtonState();
    }

    initHalo() {
        this.haloElement = document.createElement('div');
        this.haloElement.className = 'absolute pointer-events-none transition-all duration-500 z-[60] opacity-0 rounded-xl';
        this.haloElement.style.boxShadow = '0 0 0 9999px rgba(15, 23, 42, 0.6), 0 0 30px 10px rgba(79, 70, 229, 0.8), inset 0 0 20px 5px rgba(79, 70, 229, 0.5)';
        this.haloElement.style.border = '2px solid rgba(129, 140, 248, 0.8)';
        document.body.appendChild(this.haloElement);
    }

    initModal() {
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] hidden flex flex-col items-center justify-center transition-opacity opacity-0';
        document.body.appendChild(this.modalElement);
    }

    openSelectionModal() {
        // If they haven't completed basic_intro, force them or strongly suggest it?
        // Let's just start it automatically if not completed!
        const prog = this.getTutorialProgress();
        if (!prog['basic_intro']) {
            this.startTutorial('basic_intro');
            return;
        }

        // Otherwise, show carousel
        this.registry = [
            { id: 'basic_intro', title: 'Interface Basics', desc: 'A quick tour of the main tools and map navigation.' },
            { id: 'radial_menu', title: 'Inspector & Tools', desc: 'Learn to use the Inspector, action tools, and node radial menus.' },
            { id: 'map_creation', title: 'Saving & Loading Maps', desc: 'Learn how to save your constellation and find it again in the Library.' },
            { id: 'map_phase', title: 'Map Architecture', desc: 'Learn how to construct semantic graphs and link nodes.' },
            { id: 'data_phase', title: 'Data Manager', desc: 'Understand how to import cloud templates and manage raw JSON.' },
            { id: 'web_template', title: 'Web App Builder', desc: 'See how to visually design user interfaces directly inside the map.' },
            { id: 'person', title: 'Person Profiles', desc: 'Learn how dynamic nodes manage unique data formats like credentials.' }
        ];

        let cardsHtml = '';
        this.registry.forEach(t => {
            const isCompleted = prog[t.id];
            cardsHtml += `
                <div class="snap-center shrink-0 w-72 bg-slate-900 border border-slate-700 rounded-2xl p-6 flex flex-col gap-4 shadow-2xl hover:border-indigo-500 hover:shadow-[0_0_30px_rgba(79,70,229,0.3)] transition-all cursor-pointer group relative" onclick="window.Tutorials.startTutorial('${t.id}')">
                    ${isCompleted ? '<div class="absolute top-4 right-4 text-emerald-500 text-sm" title="Completed">✅</div>' : ''}
                    <div class="w-12 h-12 rounded-xl bg-indigo-900/50 flex items-center justify-center text-2xl border border-indigo-500/30 group-hover:scale-110 transition-transform">🎓</div>
                    <div>
                        <h3 class="text-white font-bold text-lg">${t.title}</h3>
                        <p class="text-slate-400 text-sm mt-2">${t.desc}</p>
                    </div>
                    <div class="mt-auto pt-4 flex items-center justify-between text-indigo-400 text-sm font-bold">
                        <span>${isCompleted ? 'Replay' : 'Start'} Tutorial</span>
                        <span class="group-hover:translate-x-2 transition-transform">➔</span>
                    </div>
                </div>
            `;
        });

        this.modalElement.innerHTML = `
            <div class="absolute top-6 right-6">
                <button onclick="window.Tutorials.closeSelectionModal()" class="w-10 h-10 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full flex items-center justify-center transition-colors text-xl">✕</button>
            </div>
            <div class="flex flex-col items-center w-full max-w-5xl px-4">
                <h2 class="text-3xl font-black text-white mb-2 uppercase tracking-widest text-center">Interactive Tutorials</h2>
                <p class="text-slate-400 mb-10 text-center max-w-lg">Select a specialized module to learn advanced techniques and templates.</p>
                
                <div id="tutorial-carousel" class="w-full flex gap-6 overflow-x-auto snap-x snap-mandatory pb-8 pt-4 px-4 custom-scrollbar items-stretch justify-start">
                    ${cardsHtml}
                </div>
            </div>
        `;

        this.modalElement.classList.remove('hidden');
        // Trigger reflow
        void this.modalElement.offsetWidth;
        this.modalElement.classList.remove('opacity-0');
        this.modalElement.classList.add('opacity-100');

        const carousel = document.getElementById('tutorial-carousel');
        if (carousel) {
            carousel.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    carousel.scrollBy({ left: e.deltaY > 0 ? 312 : -312, behavior: 'smooth' });
                }
            });

            // Auto-advance to the first unfinished tutorial
            let firstUnfinishedIndex = this.registry.findIndex(t => !prog[t.id]);
            if (firstUnfinishedIndex > 0) {
                setTimeout(() => {
                    if (carousel.children[firstUnfinishedIndex]) {
                        carousel.children[firstUnfinishedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                }, 400); // Wait for modal fade-in
            }
        }
    }

    closeSelectionModal() {
        this.modalElement.classList.remove('opacity-100');
        this.modalElement.classList.add('opacity-0');
        setTimeout(() => {
            this.modalElement.classList.add('hidden');
        }, 300);
    }

    async startTutorial(tutorialId) {
        this.closeSelectionModal();
        
        try {
            const resp = await fetch(`tutorials/${tutorialId}.json`);
            if (!resp.ok) throw new Error("Failed to load tutorial file.");
            const steps = await resp.json();
            
            this.currentTutorial = steps;
            this.currentTutorialId = tutorialId;
            this.currentStepIndex = 0;
            this.isActive = true;
            this.startTrackingHalo();

            // Wait for modal fade out
            setTimeout(() => {
                if (this.ai) this.ai.setTutorialMode(true);
                this.renderStep();
            }, 350);

        } catch(e) {
            console.error("Tutorial Error:", e);
            if (this.ai) {
                this.ai.showTooltip(`<span class="text-red-400">Error loading tutorial: ${tutorialId}</span>`, `<button onclick="window.Tutorials.ai.hideTooltip()" class="px-2 py-1 bg-slate-700 text-xs rounded text-white ml-4">Dismiss</button>`);
            }
        }
    }

    endTutorial() {
        this.isActive = false;
        this.haloElement.style.opacity = '0';
        
        if (this.activeTargetElement && this.activeTargetListener) {
            this.activeTargetElement.removeEventListener('click', this.activeTargetListener);
            this.activeTargetElement = null;
            this.activeTargetListener = null;
        }

        if (this.ai) {
            this.ai.setTutorialMode(false);
            this.ai.hideTooltip();
        }
    }

    prevStep() {
        if (!this.isActive || !this.currentTutorial || this.currentStepIndex <= 0) return;
        this.currentStepIndex--;
        this.renderStep(false);
    }

    nextStep(isManualNextBtn = true) {
        if (!this.isActive || !this.currentTutorial) return;
        
        let stepDef = this.currentTutorial[this.currentStepIndex];
        let step = stepDef ? JSON.parse(JSON.stringify(stepDef)) : null;

        // If user clicked "Next" in tooltip, we simulate click on the target to force UI navigation
        if (isManualNextBtn && step && step.target && step.autoClick !== false) {
            const el = document.querySelector(step.target);
            if (el) {
                // Detach listener so the simulated click doesn't double-trigger nextStep
                if (this.activeTargetElement && this.activeTargetListener) {
                    this.activeTargetElement.removeEventListener('click', this.activeTargetListener);
                    this.activeTargetElement = null;
                    this.activeTargetListener = null;
                }
                el.click();
            }
        }

        this.currentStepIndex++;
        if (this.currentStepIndex >= this.currentTutorial.length) {
            this.markTutorialComplete(this.currentTutorialId);
            this.endTutorial();
            
            // Show a quick success message
            if (this.ai) {
                const actionsHtml = `
                    <div class="flex gap-2 ml-4">
                        <button onclick="window.Tutorials.ai.hideTooltip()" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-xs rounded text-slate-200 transition-colors">Dismiss</button>
                        <button onclick="window.Tutorials.ai.hideTooltip(); window.Tutorials.openSelectionModal()" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors">More</button>
                    </div>
                `;
                this.ai.showTooltip(`<span class="text-emerald-400 font-bold">🎉 Tutorial Completed!</span> Excellent work.`, actionsHtml);
                setTimeout(() => this.ai.hideTooltip(), 4000);
            }
        } else {
            this.renderStep(true);
        }
    }

    positionHalo(el, skipScroll = false) {
        if (!el || !el.getBoundingClientRect) return;
        const rect = el.getBoundingClientRect();
        
        // If element is hidden or has no size (e.g. parent is collapsed), don't draw halo
        if (rect.width === 0 && rect.height === 0) {
            this.haloElement.style.opacity = '0';
            return;
        }

        let pad = 8;
        const stepDef = this.currentTutorial && this.currentStepIndex >= 0 ? this.currentTutorial[this.currentStepIndex] : null;
        if (stepDef) {
            if (stepDef.expandHalo) pad += stepDef.expandHalo;
            if (stepDef.shape === 'circle') {
                this.haloElement.classList.replace('rounded-xl', 'rounded-full');
            } else {
                this.haloElement.classList.replace('rounded-full', 'rounded-xl');
            }
        }

        this.haloElement.style.left = `${rect.left - pad}px`;
        this.haloElement.style.top = `${rect.top - pad}px`;
        this.haloElement.style.width = `${rect.width + (pad*2)}px`;
        this.haloElement.style.height = `${rect.height + (pad*2)}px`;
        this.haloElement.style.opacity = '1';

        if (!skipScroll && el.id !== 'viewport' && (!stepDef || !stepDef.skipScroll)) {
            setTimeout(() => {
                let scrollParent = el.parentElement;
                while (scrollParent && scrollParent !== document.body && scrollParent !== document.documentElement) {
                    const style = window.getComputedStyle(scrollParent);
                    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                        const latestRect = el.getBoundingClientRect();
                        const parentRect = scrollParent.getBoundingClientRect();
                        if (latestRect.top < parentRect.top || latestRect.bottom > parentRect.bottom) {
                            scrollParent.scrollTo({
                                top: scrollParent.scrollTop + (latestRect.top - parentRect.top) - (parentRect.height / 2) + (latestRect.height / 2),
                                behavior: 'smooth'
                            });
                        }
                    }
                    scrollParent = scrollParent.parentElement;
                }
            }, 150);
        }
    }

    updateHaloPosition() {
        if (this.activeTargetElement) {
            this.positionHalo(this.activeTargetElement, true);
        } else if (this.animateToTargetElement) {
            this.positionHalo(this.animateToTargetElement, true);
        }
    }

    startTrackingHalo() {
        if (!this.trackingHalo) {
            this.trackingHalo = true;
            const loop = () => {
                if (!this.isActive) {
                    this.trackingHalo = false;
                    return;
                }
                this.updateHaloPosition();
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        }
    }

    renderStep(isForward = true) {
        if (!this.isActive || !this.currentTutorial || this.currentStepIndex < 0 || this.currentStepIndex >= this.currentTutorial.length) return;
        this.animateToTargetElement = null;
        
        // Deep copy the step so we don't mutate the original JSON array state permanently
        let stepDef = this.currentTutorial[this.currentStepIndex];
        let step = JSON.parse(JSON.stringify(stepDef));

        // Evaluate onEnter action
        if (step.onEnter) {
            try {
                eval(step.onEnter);
            } catch (e) {
                console.error("Tutorial onEnter error:", e);
            }
        }

        // Evaluate conditionText
        if (step.conditionText && Array.isArray(step.conditionText)) {
            for (let ct of step.conditionText) {
                try {
                    if (eval(ct.condition)) {
                        if (ct.text) step.text = ct.text;
                        if (ct.autoClick !== undefined) step.autoClick = ct.autoClick;
                        if (ct.skip !== undefined) step.skip = ct.skip;
                        break;
                    }
                } catch(e) {
                    console.error("Tutorial condition eval error:", e);
                }
            }
        }

        if (step.skip) {
            if (isForward) {
                this.currentStepIndex++;
            } else {
                this.currentStepIndex--;
            }
            setTimeout(() => this.renderStep(isForward), 10);
            return;
        }

        if (this.animateTimeout) {
            clearTimeout(this.animateTimeout);
            this.animateTimeout = null;
        }

        // Clean up previous event listener
        if (this.activeTargetElement && this.activeTargetListener) {
            this.activeTargetElement.removeEventListener('click', this.activeTargetListener);
            this.activeTargetElement = null;
            this.activeTargetListener = null;
        }

        // 1. Position Halo
        if (step.target) {
            const el = document.querySelector(step.target);
            if (el) {
                this.positionHalo(el);

                // Attach interactive listener
                this.activeTargetListener = () => window.Tutorials.nextStep(false);
                el.addEventListener('click', this.activeTargetListener);
                this.activeTargetElement = el;
                
                if (step.animateToTarget) {
                    this.animateTimeout = setTimeout(() => {
                        this.animateTimeout = null;
                        const targetEl = document.querySelector(step.animateToTarget);
                        if (targetEl) {
                            this.animateToTargetElement = targetEl;
                            this.positionHalo(targetEl);
                        }
                    }, 1200);
                }
            } else {
                this.haloElement.style.opacity = '0';
            }
        } else {
            this.haloElement.style.opacity = '0';
        }

        // 2. Send instructions to AI Tooltip
        if (this.ai) {
            const isLast = this.currentStepIndex === this.currentTutorial.length - 1;
            const backBtnHtml = this.currentStepIndex > 0 ? `<button onclick="window.Tutorials.prevStep()" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-bold shadow transition-colors shrink-0 mr-1" title="Previous Step">❮</button>` : '';
            const nextBtnHtml = step.requireClick ? '' : `<button onclick="window.Tutorials.nextStep(true)" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold shadow transition-colors shrink-0">${isLast ? 'Finish ➔' : 'Next ➔'}</button>`;
            
            let skipOrMoreHtml = '';
            if (isLast) {
                skipOrMoreHtml = `
                    <button onclick="window.Tutorials.endTutorial(); window.Tutorials.openSelectionModal()" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition-colors shrink-0">
                        More
                    </button>
                `;
            } else {
                skipOrMoreHtml = `
                    <button onclick="window.Tutorials.endTutorial()" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs font-bold transition-colors shrink-0">
                        Skip
                    </button>
                `;
            }

            const actionsHtml = `
                <div class="flex gap-2 ml-4 shrink-0">
                    ${backBtnHtml}
                    ${nextBtnHtml}
                    ${skipOrMoreHtml}
                </div>
            `;
            
            const formattedText = `<span class="text-indigo-300 font-bold mr-2">[Step ${this.currentStepIndex + 1}/${this.currentTutorial.length}]</span> ${step.text}`;
            this.ai.showTooltip(formattedText, actionsHtml);
        }
    }

    updateHaloPosition() {
        if (!this.isActive || !this.currentTutorial) return;
        const step = this.currentTutorial[this.currentStepIndex];
        
        const targetSelector = step.animateToTarget && !this.animateTimeout ? step.animateToTarget : step.target;
        if (targetSelector) {
            const el = document.querySelector(targetSelector);
            if (el) this.positionHalo(el);
        }
    }
}
