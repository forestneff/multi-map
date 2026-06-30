/**
 * Multi-Map LIBRARY SYSTEM v1.2
 * Features: Targeted Templates (Node-Specific Application) & Profile Defaults.
 */

const MultiMapLibrary = {
    defaults: [
        {
            map_id: "tpl_web_standard",
            meta: {
                title: "Standard Landing Page",
                target_type: "web-root",
                created: "2026-02-25T12:00:00Z",
                notes: "A pre-configured, responsive website structure.",
                shared: true
            },
            nodes: [
                { id: "t_wr", type: "web-root", title: "Site Root", content: "", data: { x: 0, y: 0, isCore: true, collapsed: false }, submaps: [] },
                
                { id: "t_wn", type: "web-nav", title: "Top Navigation", content: "", data: { x: -150, y: -120, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wl1", type: "web-link", title: "Features", content: '{"href":"#features","text":"Features"}', data: { x: -250, y: -200, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wb1", type: "web-button", title: "Login", content: '{"text":"Login"}', data: { x: -50, y: -200, isCore: false, collapsed: false }, submaps: [] },
                
                { id: "t_wh", type: "web-hero", title: "The Future of Federation", content: '{"text":"Build dynamic, spatial graphs that compile into live web experiences instantly.","src":"https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2000&auto=format&fit=crop"}', data: { x: 150, y: -120, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wb2", type: "web-button", title: "Get Started Free", content: '{"text":"Get Started Free"}', data: { x: 150, y: -200, isCore: false, collapsed: false }, submaps: [] },

                { id: "t_ws1", type: "web-section", title: "Core Features", content: "", data: { x: -150, y: 120, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wgrid", type: "web-grid", title: "Features Grid", content: '{"classes":"grid grid-cols-1 md:grid-cols-2 gap-8 mt-8"}', data: { x: -150, y: 200, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wc1", type: "web-card", title: "Decoupled Architecture", content: '{"text":"Your logic remains pure, completely independent from the visual DOM rendering.","classes":"bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"}', data: { x: -220, y: 280, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wc2", type: "web-card", title: "Organic Physics", content: '{"text":"A beautiful force-directed graph provides an intuitive, clutter-free spatial workspace.","classes":"bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"}', data: { x: -80, y: 280, isCore: false, collapsed: false }, submaps: [] },

                { id: "t_ws2", type: "web-section", title: "Visual Showcase", content: "", data: { x: 150, y: 120, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wcar", type: "web-carousel", title: "Image Carousel", content: '{"classes":"flex overflow-x-auto snap-x snap-mandatory gap-6 pb-6 mt-8 custom-scrollbar"}', data: { x: 150, y: 200, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wimg1", type: "web-image", title: "Slide 1", content: '{"src":"https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=400&auto=format&fit=crop","classes":"w-72 h-48 object-cover rounded-xl shadow-md"}', data: { x: 50, y: 280, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wimg2", type: "web-image", title: "Slide 2", content: '{"src":"https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=400&auto=format&fit=crop","classes":"w-72 h-48 object-cover rounded-xl shadow-md"}', data: { x: 150, y: 280, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wimg3", type: "web-image", title: "Slide 3", content: '{"src":"https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=400&auto=format&fit=crop","classes":"w-72 h-48 object-cover rounded-xl shadow-md"}', data: { x: 250, y: 280, isCore: false, collapsed: false }, submaps: [] },

                { id: "t_wmod", type: "web-modal", title: "Newsletter Signup", content: '{"text":"Subscribe for updates!","classes":"p-8 rounded-3xl shadow-2xl backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm m-auto bg-white max-w-md w-full"}', data: { x: 350, y: 0, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wform", type: "web-form", title: "Subscribe Form", content: '{"classes":"flex flex-col gap-4 mt-6"}', data: { x: 450, y: 0, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_winput", type: "web-input", title: "Email Address", content: '{"classes":"border border-slate-300 rounded-lg px-4 py-3 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"}', data: { x: 550, y: -50, isCore: false, collapsed: false }, submaps: [] },
                { id: "t_wsub", type: "web-button", title: "Subscribe", content: '{"text":"Subscribe","classes":"px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors"}', data: { x: 550, y: 50, isCore: false, collapsed: false }, submaps: [] },

                { id: "t_wf", type: "web-footer", title: "Site Footer", content: '{"text":"© 2026 Multi-Map Platform. All rights reserved."}', data: { x: 0, y: 350, isCore: false, collapsed: false }, submaps: [] }
            ],
            connections: [
                { id: "c1", from: "t_wr", to: "t_wn", type: "structural" },
                { id: "c2", from: "t_wn", to: "t_wl1", type: "structural" },
                { id: "c3", from: "t_wn", to: "t_wb1", type: "structural" },
                
                { id: "c4", from: "t_wr", to: "t_wh", type: "structural" },
                { id: "c5", from: "t_wh", to: "t_wb2", type: "structural" },

                { id: "c6", from: "t_wr", to: "t_ws1", type: "structural" },
                { id: "c7", from: "t_ws1", to: "t_wgrid", type: "structural" },
                { id: "c8", from: "t_wgrid", to: "t_wc1", type: "structural" },
                { id: "c9", from: "t_wgrid", to: "t_wc2", type: "structural" },

                { id: "c10", from: "t_wr", to: "t_ws2", type: "structural" },
                { id: "c11", from: "t_ws2", to: "t_wcar", type: "structural" },
                { id: "c12", from: "t_wcar", to: "t_wimg1", type: "structural" },
                { id: "c13", from: "t_wcar", to: "t_wimg2", type: "structural" },
                { id: "c14", from: "t_wcar", to: "t_wimg3", type: "structural" },

                { id: "c15", from: "t_wr", to: "t_wmod", type: "structural" },
                { id: "c16", from: "t_wmod", to: "t_wform", type: "structural" },
                { id: "c17", from: "t_wform", to: "t_winput", type: "structural" },
                { id: "c18", from: "t_wform", to: "t_wsub", type: "structural" },

                { id: "c19", from: "t_wr", to: "t_wf", type: "structural" }
            ],
            submaps: []
        },
        {
            map_id: "tpl_sw_arch",
            meta: {
                title: "Software Architecture",
                target_type: "hub",
                created: "2026-02-25T12:00:00Z",
                notes: "A basic starting node framework for mapping out a web application stack.",
                shared: true
            },
            nodes: [
                { id: "sa_root", type: "hub", title: "Platform Architecture", content: "Master node", data: { x: 0, y: 0, isCore: true, collapsed: false }, submaps: [] },
                { id: "sa_db", type: "note", title: "Database Layer", content: "PostgreSQL / Redis Cache", data: { x: 0, y: 150, isCore: false, collapsed: false }, submaps: [] },
                { id: "sa_api", type: "note", title: "API Gateway", content: "Node.js REST API", data: { x: -150, y: 0, isCore: false, collapsed: false }, submaps: [] },
                { id: "sa_client", type: "note", title: "Web Client", content: "React Frontend", data: { x: 150, y: 0, isCore: false, collapsed: false }, submaps: [] }
            ],
            connections: [
                { id: "sa_c1", from: "sa_root", to: "sa_db", type: "structural" },
                { id: "sa_c2", from: "sa_root", to: "sa_api", "type": "structural" },
                { id: "sa_c3", from: "sa_root", to: "sa_client", "type": "structural" },
                { id: "sa_c4", from: "sa_client", "to": "sa_api", type: "flow" },
                { id: "sa_c5", "from": "sa_api", "to": "sa_db", type: "flow" }
            ],
            submaps: []
        },
        {
            map_id: "tpl_person_profile",
            meta: {
                title: "Standard Person Profile",
                target_type: "person-root",
                created: "2026-02-27T12:00:00Z",
                notes: "Generates the standard data fields for a person identity node.",
                shared: true
            },
            nodes: [
                { id: "p_root", type: "person-root", title: "Person", content: '{"Name":"","Email":"","Phone":"","Address":""}', data: { x: 0, y: 0, isCore: true, collapsed: false }, submaps: [] },
                { id: "p_name", type: "note", title: "Name", content: "", data: { x: 0, y: -120, isCore: false, collapsed: false }, submaps: [] },
                { id: "p_email", type: "note", title: "Email", content: "", data: { x: 120, y: 0, isCore: false, collapsed: false }, submaps: [] },
                { id: "p_phone", type: "note", title: "Phone", content: "", data: { x: 0, y: 120, isCore: false, collapsed: false }, submaps: [] },
                { id: "p_addr", type: "note", title: "Address", content: "", data: { x: -120, y: 0, isCore: false, collapsed: false }, submaps: [] }
            ],
            connections: [
                { id: "pc1", from: "p_root", to: "p_name", type: "structural" },
                { id: "pc2", from: "p_root", to: "p_email", type: "structural" },
                { id: "pc3", from: "p_root", to: "p_phone", type: "structural" },
                { id: "pc4", from: "p_root", to: "p_addr", type: "structural" }
            ],
            submaps: []
        }
    ],

    getCustomTemplates() {
        try {
            const data = localStorage.getItem('mm_custom_templates');
            return data ? JSON.parse(data) : [];
        } catch (e) { return []; }
    },

    saveCustomTemplate(templateData) {
        try {
            const customs = this.getCustomTemplates();
            const idx = customs.findIndex(t => t.map_id === templateData.map_id);
            if (idx > -1) customs[idx] = templateData;
            else customs.push(templateData);
            localStorage.setItem('mm_custom_templates', JSON.stringify(customs));
            return true;
        } catch (e) { return false; }
    },

    deleteCustomTemplate(id) {
        try {
            let customs = this.getCustomTemplates();
            customs = customs.filter(t => t.map_id !== id);
            localStorage.setItem('mm_custom_templates', JSON.stringify(customs));
            return true;
        } catch (e) { return false; }
    },

    async getManifest() {
        const allTemplates = [...this.defaults, ...this.getCustomTemplates()];
        return allTemplates.map(t => ({
            id: t.map_id,
            title: t.meta?.title || "Untitled Template",
            desc: t.meta?.notes || "A pre-configured mapstate.",
            target_type: t.meta?.target_type || "any",
            nodes: t.nodes?.length || 0,
            isCustom: !this.defaults.find(d => d.map_id === t.map_id)
        }));
    },

    async getTemplateData(id) {
        const allTemplates = [...this.defaults, ...this.getCustomTemplates()];
        const tpl = allTemplates.find(t => t.map_id === id);
        if (!tpl) throw new Error(`Template ${id} not found.`);
        return JSON.parse(JSON.stringify(tpl));
    },

    loadLocalProjects() {
        try {
            const rawProjects = localStorage.getItem("mm_projects");
            const projects = rawProjects ? JSON.parse(rawProjects) : [];
            const rawLib = localStorage.getItem("mm_constellation_lib");
            const pages = rawLib ? JSON.parse(rawLib) : [];
            return { projects, pages };
        } catch (e) {
            console.error("loadLocalProjects failed:", e);
            return { projects: [], pages: [] };
        }
    },

    clearLocalProjects() {
        localStorage.removeItem("mm_projects");
        localStorage.removeItem("mm_constellation_lib");
        localStorage.removeItem("mm_core_state");
    }
};