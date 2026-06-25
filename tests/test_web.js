const fs = require('fs');
const path = require('path');

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const webHtml = fs.readFileSync(path.join(__dirname, '../engines/web-architect.html'), 'utf8');
const scriptStart = webHtml.indexOf('<script>');
const scriptEnd = webHtml.lastIndexOf('</script>');
const scriptContent = webHtml.substring(scriptStart + 8, scriptEnd);

const template = {
    map_id: "tpl_web_standard",
    meta: { title: "Standard Landing Page", type: "web" },
    nodes: [
        { id: "t_wr", type: "web-root", title: "Site Root", content: "", data: { x: 0, y: 0, isCore: true, collapsed: false } },
        { id: "t_wn", type: "web-nav", title: "Top Navigation", content: "", data: { x: -150, y: -120, isCore: false, collapsed: false } },
        { id: "t_wl1", type: "web-link", title: "Features", content: '{"href":"#features","text":"Features"}', data: { x: -250, y: -200, isCore: false, collapsed: false } }
    ],
    connections: [
        { id: "c1", from: "t_wr", to: "t_wn", type: "structural" },
        { id: "c2", from: "t_wn", to: "t_wl1", type: "structural" }
    ],
    session: { selectedId: "t_wr" }
};

let messageListener = null;
global.window = {
    addEventListener: (type, callback) => {
        if (type === 'message') messageListener = callback;
    }
};

global.document = {
    createElement: (tag) => {
        let val = '';
        return {
            set textContent(v) { val = v; },
            get textContent() { return val; },
            get innerHTML() { return val; }
        };
    },
    getElementById: (id) => {
        if (id === 'canvas') {
            return {
                set srcdoc(val) {
                    console.log("--- FULL GENERATED HTML ---");
                    console.log(val);
                    console.log("---------------------------");
                }
            };
        }
        return null;
    }
};

eval(scriptContent);
messageListener({ data: { type: 'STATE_UPDATE', state: template } });
