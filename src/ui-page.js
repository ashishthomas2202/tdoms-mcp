export function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TD/OMS MCP Console</title>
  <link rel="icon" href="/icons/server.svg" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17202a;
      background: #f4f6f8;
      font-synthesis: none;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; min-height: 100vh; }
    button, input, select { font: inherit; letter-spacing: 0; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .48; }
    .shell { min-height: 100vh; }
    .topbar { background: #162433; color: #fff; border-bottom: 3px solid #2f7d67; }
    .topbar-inner { width: min(1180px, calc(100% - 40px)); min-height: 68px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid #536171; border-radius: 6px; background: #223445; }
    .brand-mark img { width: 19px; height: 19px; filter: brightness(0) invert(1); }
    .brand-name { font-size: 17px; font-weight: 700; }
    .brand-subtitle { margin-top: 2px; color: #b9c4ce; font-size: 12px; }
    .local-state { display: flex; align-items: center; gap: 8px; color: #d8e1e7; font-size: 12px; white-space: nowrap; }
    .state-dot { width: 8px; height: 8px; border-radius: 50%; background: #45b58f; box-shadow: 0 0 0 3px rgba(69,181,143,.16); }
    .nav-band { background: #fff; border-bottom: 1px solid #d9e0e6; }
    .nav-inner { width: min(1180px, calc(100% - 40px)); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; min-height: 52px; gap: 16px; }
    .tabs { display: flex; align-self: stretch; gap: 24px; }
    .tab { position: relative; border: 0; background: transparent; color: #556270; padding: 0 2px; font-size: 13px; font-weight: 650; }
    .tab.active { color: #17202a; }
    .tab.active::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #2f7d67; }
    .icon-button { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #ccd5dd; border-radius: 6px; background: #fff; }
    .icon-button:hover { background: #f4f7f9; }
    .icon-button img { width: 16px; height: 16px; }
    main { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 24px 0 42px; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid #d8e0e6; border-radius: 8px; background: #fff; overflow: hidden; margin-bottom: 20px; }
    .metric { padding: 15px 18px; border-right: 1px solid #e1e6ea; display: flex; align-items: center; gap: 12px; min-width: 0; }
    .metric:last-child { border-right: 0; }
    .metric-icon { width: 34px; height: 34px; border-radius: 6px; display: grid; place-items: center; background: #eef4f2; }
    .metric-icon.blue { background: #edf2f7; }
    .metric-icon.amber { background: #fbf3e3; }
    .metric-icon img { width: 17px; height: 17px; }
    .metric-value { font-size: 18px; line-height: 1; font-weight: 750; }
    .metric-label { margin-top: 4px; color: #687582; font-size: 11px; text-transform: uppercase; font-weight: 700; }
    .view { display: none; }
    .view.active { display: block; }
    .workspace { display: grid; grid-template-columns: minmax(320px, 410px) minmax(0, 1fr); gap: 20px; align-items: start; }
    .panel { border: 1px solid #d8e0e6; border-radius: 8px; background: #fff; overflow: hidden; }
    .panel-header { min-height: 51px; padding: 0 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e1e6ea; gap: 12px; }
    .panel-title { font-size: 14px; font-weight: 720; }
    .panel-count { color: #71808d; font-size: 12px; }
    .panel-body { padding: 18px; }
    form { display: grid; gap: 14px; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    label { display: grid; gap: 6px; color: #44515e; font-size: 12px; font-weight: 650; }
    input, select { width: 100%; min-height: 38px; border: 1px solid #bcc7d0; border-radius: 6px; padding: 8px 10px; background: #fff; color: #17202a; outline: none; }
    input:focus, select:focus { border-color: #2f7d67; box-shadow: 0 0 0 3px rgba(47,125,103,.12); }
    .check-row { display: flex; align-items: center; gap: 9px; min-height: 30px; color: #33414e; }
    .check-row input { width: 16px; min-height: 16px; margin: 0; }
    details { border-top: 1px solid #e5e9ed; padding-top: 12px; }
    summary { color: #455361; font-size: 12px; font-weight: 700; cursor: pointer; }
    .details-fields { display: grid; gap: 12px; margin-top: 12px; }
    details:not([open]) .details-fields { display: none; }
    .form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
    .button { min-height: 36px; border: 1px solid #1f6d59; border-radius: 6px; padding: 7px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; background: #2f7d67; color: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; text-decoration: none; }
    .button:hover { background: #276b58; }
    .button.secondary { background: #fff; border-color: #bdc8d0; color: #283642; }
    .button.secondary:hover { background: #f5f7f8; }
    .button.danger { background: #fff; border-color: #d8b6b6; color: #9a3333; }
    .button img { width: 15px; height: 15px; filter: brightness(0) invert(1); }
    .button.secondary img, .button.danger img { filter: none; }
    .empty { min-height: 215px; display: grid; place-items: center; color: #75828e; text-align: center; font-size: 13px; }
    .list { display: grid; }
    .connection-row, .client-row { padding: 16px 18px; border-bottom: 1px solid #e5e9ed; display: grid; gap: 10px; }
    .connection-row:last-child, .client-row:last-child { border-bottom: 0; }
    .row-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
    .row-identity { min-width: 0; display: flex; align-items: flex-start; gap: 11px; }
    .row-icon { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 6px; background: #eef2f5; }
    .row-icon img { width: 17px; height: 17px; }
    .row-name { font-size: 13px; font-weight: 730; }
    .row-description { margin-top: 3px; color: #687582; font-size: 12px; overflow-wrap: anywhere; }
    .row-path { padding-left: 45px; color: #75818c; font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .row-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .status { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 750; text-transform: uppercase; white-space: nowrap; }
    .status.configured { color: #17634f; background: #e8f4ef; }
    .status.detected { color: #805f19; background: #fbf2dc; }
    .status.not-detected { color: #687582; background: #eef1f3; }
    .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .clients-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 14px; }
    .clients-toolbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
    .segmented { display: inline-flex; border: 1px solid #bdc8d0; border-radius: 6px; overflow: hidden; background: #fff; }
    .segmented button { min-height: 34px; border: 0; border-right: 1px solid #d5dde3; padding: 6px 10px; background: #fff; color: #53616d; font-size: 11px; font-weight: 700; }
    .segmented button:last-child { border-right: 0; }
    .segmented button.active { background: #eaf3f0; color: #215f50; }
    .path-stack { display: grid; gap: 3px; }
    .path-label { display: inline-block; width: 38px; color: #52616d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-weight: 700; }
    .section-heading { font-size: 15px; font-weight: 750; }
    .environment-label { margin-top: 3px; color: #687582; font-size: 11px; }
    .filter { display: flex; align-items: center; gap: 7px; color: #66737f; font-size: 12px; }
    .filter input { width: 16px; min-height: 16px; }
    .activity { position: fixed; right: 20px; bottom: 20px; max-width: min(420px, calc(100% - 40px)); min-height: 42px; padding: 11px 14px; display: none; align-items: center; gap: 9px; border: 1px solid #cbd5dc; border-radius: 7px; background: #172431; color: #fff; box-shadow: 0 12px 34px rgba(18,31,43,.2); font-size: 12px; z-index: 30; }
    .activity.show { display: flex; }
    .activity.error { background: #7e2e2e; border-color: #7e2e2e; }
    .activity img { width: 16px; height: 16px; filter: brightness(0) invert(1); }
    dialog { width: min(470px, calc(100% - 32px)); border: 1px solid #cdd6dd; border-radius: 8px; padding: 0; color: #17202a; box-shadow: 0 24px 70px rgba(17,30,42,.28); }
    dialog::backdrop { background: rgba(14,25,35,.48); }
    .dialog-header { min-height: 52px; padding: 0 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e1e6ea; }
    .dialog-body { padding: 18px; color: #4f5d69; font-size: 13px; line-height: 1.55; }
    .dialog-target { margin-top: 12px; padding: 10px 12px; border-radius: 6px; background: #f1f4f6; color: #263541; font-weight: 700; }
    .dialog-actions { padding: 13px 18px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #e1e6ea; }
    .spin { animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 820px) {
      .topbar-inner, .nav-inner, main { width: min(100% - 28px, 1180px); }
      .workspace { grid-template-columns: 1fr; }
      .summary { grid-template-columns: 1fr; }
      .metric { border-right: 0; border-bottom: 1px solid #e1e6ea; }
      .metric:last-child { border-bottom: 0; }
    }
    @media (max-width: 560px) {
      .brand-subtitle, .local-state span { display: none; }
      .nav-inner { align-items: stretch; }
      .tabs { gap: 16px; }
      .field-row { grid-template-columns: 1fr; }
      .row-main { align-items: stretch; flex-direction: column; }
      .row-actions { justify-content: flex-start; padding-left: 45px; }
      .row-path { padding-left: 0; }
      .clients-toolbar, .clients-toolbar-actions { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-mark"><img src="/icons/server.svg" alt=""></div>
          <div><div class="brand-name">TD/OMS MCP</div><div class="brand-subtitle">Change Management Console</div></div>
        </div>
        <div class="local-state"><span class="state-dot"></span><span>Local service</span></div>
      </div>
    </header>
    <div class="nav-band">
      <div class="nav-inner">
        <nav class="tabs" aria-label="Console views">
          <button class="tab active" data-view="connections">Connections</button>
          <button class="tab" data-view="clients">Agent setup</button>
        </nav>
        <button class="icon-button" id="refresh" title="Refresh"><img src="/icons/refresh-cw.svg" alt=""></button>
      </div>
    </div>
    <main>
      <section class="summary" aria-label="Status summary">
        <div class="metric"><div class="metric-icon blue"><img src="/icons/database.svg" alt=""></div><div><div class="metric-value" id="metric-connections">0</div><div class="metric-label">Connections</div></div></div>
        <div class="metric"><div class="metric-icon"><img src="/icons/shield-check.svg" alt=""></div><div><div class="metric-value" id="metric-secure">0</div><div class="metric-label">TLS verified</div></div></div>
        <div class="metric"><div class="metric-icon amber"><img src="/icons/bot.svg" alt=""></div><div><div class="metric-value" id="metric-clients">0</div><div class="metric-label">Agents configured</div></div></div>
      </section>

      <section class="view active" id="view-connections">
        <div class="workspace">
          <section class="panel">
            <div class="panel-header"><div class="panel-title" id="form-title">Connection profile</div></div>
            <div class="panel-body">
              <form id="connection-form">
                <input type="hidden" name="id">
                <label>Profile name<input name="name" placeholder="Development TD/OMS"></label>
                <label>Host<input name="host" placeholder="tdoms.example.com" required></label>
                <label>Username<input name="username" autocomplete="username" required></label>
                <label>Password<input name="password" type="password" autocomplete="current-password"></label>
                <details>
                  <summary>Advanced settings</summary>
                  <div class="details-fields">
                    <div class="field-row">
                      <label>Protocol<select name="protocol"><option value="https">HTTPS</option><option value="http">HTTP</option></select></label>
                      <label>REST port<input name="port" inputmode="numeric" required></label>
                    </div>
                    <label>TD/OMS library<input name="library" value="OMS" required></label>
                    <label class="check-row"><input name="verifyTls" type="checkbox" checked>Verify server certificate</label>
                    <label>Custom CA certificate<input name="caFile" placeholder="C:/certificates/company-root-ca.pem"></label>
                  </div>
                </details>
                <div class="form-actions">
                  <button type="button" class="button secondary" id="clear-form"><img src="/icons/x.svg" alt="">Clear</button>
                  <button type="submit" class="button"><img src="/icons/save.svg" alt="">Save profile</button>
                </div>
              </form>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header"><div class="panel-title">Saved connections</div><div class="panel-count" id="connection-count">0 profiles</div></div>
            <div id="connections-list" class="list"><div class="empty">No connection profiles</div></div>
          </section>
        </div>
      </section>

      <section class="view" id="view-clients">
        <div class="clients-toolbar">
          <div><div class="section-heading">MCP clients</div><div class="environment-label" id="environment-label">Detecting environment</div></div>
          <div class="clients-toolbar-actions">
            <label class="filter"><input type="checkbox" id="show-all-clients">Show products not detected</label>
            <div class="segmented" aria-label="Skill installation scope">
              <button type="button" class="active" data-skill-scope="user">User skill</button>
              <button type="button" data-skill-scope="workspace">Workspace skill</button>
            </div>
            <button class="button secondary" id="install-detected-skills"><img src="/icons/book-open.svg" alt="">Install skills</button>
            <button class="button" id="install-detected"><img src="/icons/plug-zap.svg" alt="">Configure detected</button>
          </div>
        </div>
        <section class="panel">
          <div class="panel-header"><div class="panel-title">Agent installations</div><div class="panel-count" id="client-count">Scanning</div></div>
          <div id="clients-list" class="list"><div class="empty">Detecting MCP clients</div></div>
        </section>
      </section>
    </main>
  </div>

  <div class="activity" id="activity"><img src="/icons/check.svg" alt=""><span></span></div>
  <dialog id="confirm-dialog">
    <div class="dialog-header"><strong id="dialog-title">Confirm action</strong><button class="icon-button" id="dialog-close" title="Close"><img src="/icons/x.svg" alt=""></button></div>
    <div class="dialog-body"><div id="dialog-message"></div><div class="dialog-target" id="dialog-target"></div></div>
    <div class="dialog-actions"><button class="button secondary" id="dialog-cancel">Cancel</button><button class="button" id="dialog-confirm"><img src="/icons/check.svg" alt="">Confirm</button></div>
  </dialog>

  <script>
    const state = { connections: [], clients: [], pendingAction: null, skillScope: "user" };
    const form = document.querySelector("#connection-form");
    const connectionList = document.querySelector("#connections-list");
    const clientList = document.querySelector("#clients-list");
    const activity = document.querySelector("#activity");
    const dialog = document.querySelector("#confirm-dialog");

    async function request(url, options) {
      const response = await fetch(url, { headers: { "content-type": "application/json" }, ...(options || {}) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Request failed");
      return json;
    }

    async function refresh() {
      const icon = document.querySelector("#refresh img");
      icon.classList.add("spin");
      try {
        const results = await Promise.all([request("/api/connections"), request("/api/clients")]);
        state.connections = results[0].connections;
        state.clients = results[1].clients;
        renderConnections();
        renderClients();
        renderMetrics();
      } catch (error) {
        notify(error.message, true);
      } finally {
        icon.classList.remove("spin");
      }
    }

    function renderMetrics() {
      document.querySelector("#metric-connections").textContent = state.connections.length;
      document.querySelector("#metric-secure").textContent = state.connections.filter(function (item) { return item.verifyTls !== false; }).length;
      document.querySelector("#metric-clients").textContent = state.clients.filter(function (item) { return item.configured; }).length;
    }

    function renderConnections() {
      document.querySelector("#connection-count").textContent = state.connections.length + (state.connections.length === 1 ? " profile" : " profiles");
      if (!state.connections.length) {
        connectionList.innerHTML = '<div class="empty">No connection profiles</div>';
        return;
      }
      connectionList.innerHTML = state.connections.map(function (item) {
        const tls = item.verifyTls === false ? "TLS verification off" : "TLS verified";
        return '<div class="connection-row"><div class="row-main"><div class="row-identity"><div class="row-icon"><img src="/icons/database.svg" alt=""></div><div><div class="row-name">' + escapeHtml(item.name) + '</div><div class="row-description">' + escapeHtml(item.username) + ' | ' + escapeHtml(tls) + '</div></div></div><div class="row-actions"><button class="button secondary" data-edit="' + escapeHtml(item.id) + '"><img src="/icons/pencil.svg" alt="">Edit</button><button class="button secondary" data-test="' + escapeHtml(item.id) + '"><img src="/icons/plug-zap.svg" alt="">Test</button><button class="button danger" data-delete="' + escapeHtml(item.id) + '"><img src="/icons/trash-2.svg" alt="">Delete</button></div></div><div class="row-path">' + escapeHtml(item.baseUrl) + '</div></div>';
      }).join("");
    }

    function renderClients() {
      const showAll = document.querySelector("#show-all-clients").checked;
      const clients = state.clients.filter(function (item) { return showAll || item.detected; });
      const detected = state.clients.filter(function (item) { return item.detected; }).length;
      const pending = state.clients.filter(function (item) { return item.detected && item.installable && !item.configured; }).length;
      const pendingSkills = state.clients.filter(function (item) { return item.detected && item.skill && item.skill.supported && !item.skill[state.skillScope].current; }).length;
      const environment = state.clients[0] && state.clients[0].environment;
      document.querySelector("#environment-label").textContent = environment ? environment.label + " | " + environment.note : "Current environment";
      document.querySelector("#install-detected").disabled = pending === 0;
      document.querySelector("#install-detected-skills").disabled = pendingSkills === 0;
      document.querySelector("#client-count").textContent = detected + " detected";
      if (!clients.length) {
        clientList.innerHTML = '<div class="empty">No supported MCP clients detected</div>';
        return;
      }
      clientList.innerHTML = clients.map(function (item) {
        const mcpAction = item.configured ? "Update MCP" : "Install MCP";
        const mcpButton = item.installable ? '<button class="button secondary" data-install="' + escapeHtml(item.id) + '"><img src="/icons/plug-zap.svg" alt="">' + mcpAction + '</button>' : '';
        const skill = item.skill || { supported: false };
        const scopedSkill = skill.supported ? skill[state.skillScope] : null;
        const skillAction = scopedSkill && scopedSkill.installed ? "Update skill" : "Install skill";
        const skillButton = skill.supported && item.detected ? '<button class="button secondary" data-install-skill="' + escapeHtml(item.id) + '" title="' + escapeHtml(skill.guidance) + '"><img src="/icons/book-open.svg" alt="">' + skillAction + '</button>' : '';
        const skillDownload = skill.downloadable && item.detected ? '<button class="button secondary" data-install-upload-skill="' + escapeHtml(item.id) + '" title="' + escapeHtml(skill.guidance) + '"><img src="/icons/download.svg" alt="">Install skill</button>' : '';
        const unavailableStatus = !skill.supported && !skill.downloadable && item.detected ? '<span class="status not-detected" title="' + escapeHtml(skill.guidance) + '">skill unavailable</span>' : '';
        const uploadStatus = skill.downloadable ? '<span class="status detected">upload required</span>' : '';
        const skillStatus = scopedSkill ? '<span class="status ' + (scopedSkill.current ? 'configured' : 'detected') + '">' + (scopedSkill.current ? 'skill current' : scopedSkill.installedAny ? 'skill update' : 'skill available') + '</span>' : uploadStatus || unavailableStatus;
        const skillPath = scopedSkill ? scopedSkill.targets.map(function (target) { return '<div><span class="path-label">Skill</span>' + escapeHtml(target.label) + ': ' + escapeHtml(target.path) + '</div>'; }).join('') : '';
        return '<div class="client-row"><div class="row-main"><div class="row-identity"><div class="row-icon"><img src="/icons/terminal.svg" alt=""></div><div><div class="row-name">' + escapeHtml(item.name) + '</div><div class="row-description">' + escapeHtml(item.description) + '</div></div></div><div class="row-actions"><span class="status ' + escapeHtml(item.status) + '">' + escapeHtml(item.status.replace("-", " ")) + '</span>' + skillStatus + skillButton + skillDownload + mcpButton + '</div></div><div class="row-path path-stack"><div><span class="path-label">MCP</span>' + escapeHtml(item.configPath) + '</div>' + skillPath + '</div></div>';
      }).join("");
    }

    function resetForm() {
      form.reset();
      form.elements.id.value = "";
      form.elements.port.value = "";
      form.elements.library.value = "OMS";
      form.elements.protocol.value = "https";
      form.elements.verifyTls.checked = true;
      document.querySelector("#form-title").textContent = "Connection profile";
    }

    function editConnection(id) {
      const item = state.connections.find(function (entry) { return entry.id === id; });
      if (!item) return;
      ["id", "name", "protocol", "host", "port", "library", "username", "caFile"].forEach(function (key) {
        if (form.elements[key]) form.elements[key].value = item[key] || "";
      });
      form.elements.password.value = "";
      form.elements.verifyTls.checked = item.verifyTls !== false;
      document.querySelector("#form-title").textContent = "Edit connection";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function openConfirmation(options) {
      state.pendingAction = options.action;
      document.querySelector("#dialog-title").textContent = options.title;
      document.querySelector("#dialog-message").textContent = options.message;
      document.querySelector("#dialog-target").textContent = options.target;
      dialog.showModal();
    }

    function closeDialog() {
      state.pendingAction = null;
      dialog.close();
    }

    function notify(message, isError) {
      activity.querySelector("span").textContent = message;
      activity.classList.toggle("error", Boolean(isError));
      activity.classList.add("show");
      clearTimeout(notify.timer);
      notify.timer = setTimeout(function () { activity.classList.remove("show"); }, 5000);
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const data = new FormData(form);
      const body = {
        id: data.get("id") || undefined,
        name: data.get("name"), protocol: data.get("protocol"), host: data.get("host"), port: data.get("port"),
        library: data.get("library"), username: data.get("username"), password: data.get("password") || undefined,
        caFile: data.get("caFile") || undefined, verifyTls: data.get("verifyTls") === "on"
      };
      try {
        await request("/api/connections", { method: "POST", body: JSON.stringify(body) });
        notify("Connection profile saved");
        resetForm();
        await refresh();
      } catch (error) { notify(error.message, true); }
    });

    connectionList.addEventListener("click", function (event) {
      const edit = event.target.closest("[data-edit]");
      const test = event.target.closest("[data-test]");
      const remove = event.target.closest("[data-delete]");
      if (edit) editConnection(edit.dataset.edit);
      if (test) runConnectionTest(test.dataset.test);
      if (remove) {
        const item = state.connections.find(function (entry) { return entry.id === remove.dataset.delete; });
        openConfirmation({ title: "Delete connection", message: "This removes the local profile and its encrypted credentials.", target: item ? item.name : remove.dataset.delete, action: async function () { await request("/api/connections/" + encodeURIComponent(remove.dataset.delete), { method: "DELETE" }); notify("Connection profile deleted"); await refresh(); } });
      }
    });

    async function runConnectionTest(id) {
      try {
        notify("Testing TD/OMS connection");
        await request("/api/connections/" + encodeURIComponent(id) + "/login", { method: "POST", body: "{}" });
        notify("Connection verified");
        await refresh();
      } catch (error) { notify(error.message, true); }
    }

    clientList.addEventListener("click", function (event) {
      const install = event.target.closest("[data-install]");
      const installSkill = event.target.closest("[data-install-skill]");
      const installUploadSkill = event.target.closest("[data-install-upload-skill]");
      if (install) {
        const item = state.clients.find(function (entry) { return entry.id === install.dataset.install; });
        openConfirmation({ title: item.configured ? "Update MCP client" : "Install MCP client", message: "A backup is created before the client configuration changes.", target: item.name, action: async function () { notify("Configuring " + item.name); const result = await request("/api/clients/" + encodeURIComponent(item.id) + "/install", { method: "POST", body: JSON.stringify({ confirm: true }) }); notify(result.restartRequired ? item.name + " configured. Restart the client." : item.name + " configured."); await refresh(); } });
      }
      if (installSkill) {
        const item = state.clients.find(function (entry) { return entry.id === installSkill.dataset.installSkill; });
        const scopedSkill = item.skill[state.skillScope];
        openConfirmation({ title: scopedSkill.installed ? "Update agent skill" : "Install agent skill", message: "The complete TD/OMS workflow skill is installed for every compatible detected agent in this product. Existing skill files are backed up first.", target: item.name + " | " + state.skillScope + " | " + scopedSkill.targets.map(function (target) { return target.label + ": " + target.path; }).join(" | "), action: async function () { notify("Installing skill for " + item.name); const result = await request("/api/clients/" + encodeURIComponent(item.id) + "/install-skill", { method: "POST", body: JSON.stringify({ confirm: true, scope: state.skillScope }) }); notify(result.restartRequired ? item.name + " skill installed. Restart the agent session." : item.name + " skill installed."); await refresh(); } });
      }
      if (installUploadSkill) {
        const item = state.clients.find(function (entry) { return entry.id === installUploadSkill.dataset.installUploadSkill; });
        openConfirmation({ title: "Install skill in Claude Desktop", message: "Claude Desktop chat requires an account upload. Confirm to download the correctly packaged ZIP, then open Customize > Skills > Create skill > Upload a skill and select it.", target: "tdoms-mcp-routing.zip", action: async function () { const link = document.createElement("a"); link.href = "/api/skill/archive"; link.download = "tdoms-mcp-routing.zip"; document.body.appendChild(link); link.click(); link.remove(); notify("Skill ZIP downloaded. Upload it in Claude Desktop Customize > Skills."); } });
      }
    });

    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(function (item) { item.classList.toggle("active", item === tab); });
        document.querySelectorAll(".view").forEach(function (view) { view.classList.toggle("active", view.id === "view-" + tab.dataset.view); });
      });
    });
    document.querySelector("#refresh").addEventListener("click", refresh);
    document.querySelector("#clear-form").addEventListener("click", resetForm);
    document.querySelector("#show-all-clients").addEventListener("change", renderClients);
    document.querySelectorAll("[data-skill-scope]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.skillScope = button.dataset.skillScope;
        document.querySelectorAll("[data-skill-scope]").forEach(function (item) { item.classList.toggle("active", item === button); });
        renderClients();
      });
    });
    document.querySelector("#install-detected").addEventListener("click", function () {
      const pending = state.clients.filter(function (item) { return item.detected && item.installable && !item.configured; });
      openConfirmation({ title: "Configure detected agents", message: "This adds TD/OMS only to detected agents that are not configured yet. Every existing file is backed up first.", target: pending.map(function (item) { return item.name; }).join(", "), action: async function () { notify("Configuring detected agents"); const result = await request("/api/clients/install-detected", { method: "POST", body: JSON.stringify({ confirm: true }) }); notify(result.configured + " agents configured" + (result.failed ? ", " + result.failed + " failed" : ""), Boolean(result.failed)); await refresh(); } });
    });
    document.querySelector("#install-detected-skills").addEventListener("click", function () {
      const pending = state.clients.filter(function (item) { return item.detected && item.skill && item.skill.supported && !item.skill[state.skillScope].current; });
      openConfirmation({ title: "Install detected agent skills", message: "This installs or updates the bundled TD/OMS workflow skill for the selected scope. Existing skill folders are backed up first.", target: state.skillScope + " | " + pending.map(function (item) { return item.name; }).join(", "), action: async function () { notify("Installing detected agent skills"); const result = await request("/api/clients/install-detected-skills", { method: "POST", body: JSON.stringify({ confirm: true, scope: state.skillScope }) }); notify(result.installed + " skills installed" + (result.failed ? ", " + result.failed + " failed" : ""), Boolean(result.failed)); await refresh(); } });
    });
    document.querySelector("#dialog-close").addEventListener("click", closeDialog);
    document.querySelector("#dialog-cancel").addEventListener("click", closeDialog);
    document.querySelector("#dialog-confirm").addEventListener("click", async function () {
      const action = state.pendingAction;
      closeDialog();
      if (!action) return;
      try { await action(); } catch (error) { notify(error.message, true); }
    });
    refresh();
  </script>
</body>
</html>`;
}
