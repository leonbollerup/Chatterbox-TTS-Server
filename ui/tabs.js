/* Progressive enhancement: retain existing controls and their event handlers. */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('tts-form');
    if (!form) return;
    const card = form.closest('.card');
    const parent = card.parentElement;
    const nav = document.createElement('div');
    nav.className = 'workspace-tabs'; nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Workspace');
    parent.insertBefore(nav, card);
    const panels = {};
    const labels = {dashboard:'Dashboard', generate:'Generate speech', add:'Add voice', voices:'Voices', settings:'Settings'};
    function activate(key) {
        if (!panels[key]) key = 'dashboard';
        Object.entries(panels).forEach(([id, panel]) => {
            panel.hidden = id !== key;
            const tab = document.getElementById(`tab-${id}`);
            tab.setAttribute('aria-selected', String(id === key));
            tab.tabIndex = id === key ? 0 : -1;
        });
        if (key === 'dashboard' || key === 'voices') refresh();
        window.dispatchEvent(new Event('resize'));
    }
    Object.entries(labels).forEach(([id, label]) => {
        const tab = document.createElement('button');
        tab.type = 'button'; tab.className = 'btn secondary'; tab.textContent = label;
        tab.id = `tab-${id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `panel-${id}`);
        tab.addEventListener('click', () => activate(id)); nav.append(tab);
        const panel = document.createElement('section');
        panel.id = `panel-${id}`; panel.className = 'workspace-panel';
        panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
        panel.hidden = true; parent.insertBefore(panel, card); panels[id] = panel;
    });
    nav.addEventListener('keydown', event => {
        const tabs = [...nav.children]; let i = tabs.indexOf(document.activeElement);
        if (i < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        i = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[i].click(); tabs[i].focus();
    });
    const settings = document.getElementById('server-config-form')?.closest('details');
    if (settings) panels.settings.append(settings);
    const footer = form.querySelector('.card__footer');
    if (footer) panels.settings.append(footer);
    panels.generate.append(card);
    const player = document.getElementById('audio-player-container');
    if (player) panels.generate.append(player);
    const tips = [...parent.children].find(el => el.querySelector?.('.tips-list'));
    if (tips) panels.dashboard.append(tips);
    function heading(panel, text) {
        const h = document.createElement('h2'); h.className = 'card__title'; h.textContent = text; panel.prepend(h);
    }
    heading(panels.dashboard, 'Dashboard'); heading(panels.add, 'Add voice'); heading(panels.voices, 'Voices'); heading(panels.settings, 'Settings');
    const status = document.createElement('p'); status.className = 'workspace-status'; status.setAttribute('role', 'status');
    panels.dashboard.children[0].after(status);
    const start = document.createElement('button'); start.type = 'button'; start.className = 'btn primary'; start.textContent = 'Generate speech'; start.onclick = () => activate('generate'); status.after(start);
    panels.add.append(document.getElementById('add-voice-form'));
    document.getElementById('new-voice-cancel').textContent = 'Clear';
    const info = document.createElement('p'); info.className = 'workspace-status'; info.setAttribute('role','status'); panels.voices.append(info);
    const search = document.createElement('input'); search.type = 'search'; search.className = 'form-input'; search.placeholder = 'Search voices'; search.setAttribute('aria-label','Search voices'); panels.voices.append(search);
    const refreshButton = document.createElement('button'); refreshButton.type = 'button'; refreshButton.className = 'btn secondary'; refreshButton.textContent = 'Refresh'; refreshButton.onclick = refresh; panels.voices.append(refreshButton);
    const list = document.createElement('div'); panels.voices.append(list);
    let entries = [], sequence = 0;
    async function json(url, options) {
        const response = await fetch(url, options); const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`); return data;
    }
    function render() {
        list.replaceChildren();
        entries.filter(v => v.name.toLowerCase().includes(search.value.toLowerCase())).forEach(v => {
            const row = document.createElement('div'); row.className = 'voice-row';
            const name = document.createElement('span'); name.textContent = `${v.name}${v.language ? ' — ' + v.language : ''} (${v.kind === 'predefined' ? 'Library' : 'Reference'})`; row.append(name);
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn secondary'; edit.textContent = 'Edit / presets'; edit.onclick = () => window.dispatchEvent(new CustomEvent('edit-voice', {detail:v})); row.append(edit);
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn danger'; remove.textContent = 'Remove';
            remove.onclick = async () => {
                if (!confirm(`Remove “${v.name}” from the shared library for ALL models? The recording will be archived on the server, not permanently deleted.`)) return;
                remove.disabled = true;
                try {
                    await json('/api/voices/archive', {method:'POST', headers:{'Content-Type':'application/json','X-Voice-Management':'1'}, body:JSON.stringify({kind:v.kind, filename:v.filename})});
                    document.getElementById('predefined-voice-refresh-button')?.click(); document.getElementById('clone-refresh-button')?.click(); await refresh();
                } catch (error) { info.textContent = `Removal failed: ${error.message}`; remove.disabled = false; }
            }; row.append(remove); list.append(row);
        });
        if (!list.children.length) { const empty = document.createElement('p'); empty.textContent = 'No matching voices.'; list.append(empty); }
    }
    search.addEventListener('input', render);
    async function refresh() {
        const request = ++sequence;
        try {
            const [model, voices, references] = await Promise.all([json('/api/model-info'), json('/get_predefined_voices'), json('/get_reference_files')]);
            if (request !== sequence) return;
            status.textContent = `Model: ${model.type || 'None'}\nStatus: ${model.loaded ? 'Loaded' : 'Not loaded'}\nDevice: ${model.device || '—'}\nLibrary voices: ${voices.length}\nCloning references: ${references.length}`;
            info.textContent = `Current model: ${model.type || 'Not loaded'}. Recordings are shared across models; there is no separate model-specific catalog. ${model.supports_multilingual ? 'Multilingual generation supported.' : 'English generation only.'}`;
            entries = voices.map(v => ({kind:'predefined', name:v.display_name || v.filename, language:v.recording_language, filename:v.filename})).concat(references.map(filename => ({kind:'reference',name:filename,filename})));
            render();
        } catch (error) { if (request === sequence) { status.textContent = `Server unavailable: ${error.message}`; info.textContent = `Unable to refresh voices: ${error.message}`; } }
    }
    activate('dashboard');
});
