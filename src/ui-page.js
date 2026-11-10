import { readFileSync } from "node:fs";

const ICON_NAMES = [
  "server", "layout-dashboard", "database", "bot", "boxes", "key-round", "refresh-cw", "plus", "pencil",
  "trash-2", "plug-zap", "book-open", "download", "check", "x", "sun", "moon", "log-in", "log-out",
  "shield-check", "circle-alert", "star", "terminal", "activity", "import", "power"
];

let spriteCache;

// Inline icons follow the text colour, which keeps them readable in both themes.
function iconSprite() {
  if (spriteCache === undefined) {
    spriteCache = ICON_NAMES.map((name) => {
      try {
        const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${name}.svg`, import.meta.url), "utf8");
        const inner = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>")).replace(/\s+/g, " ").trim();
        return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
      } catch {
        return `<symbol id="i-${name}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></symbol>`;
      }
    }).join("");
  }
  return spriteCache;
}

export function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TD/OMS MCP</title>
  <link rel="icon" href="/icons/server.svg" type="image/svg+xml">
  <script>
    try {
      var saved = localStorage.getItem("tdoms-mcp-theme");
      var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    } catch (error) { document.documentElement.dataset.theme = "light"; }
  </script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f8; --surface: #ffffff; --surface-2: #f9fafb; --hover: #f1f3f6;
      --line: rgba(15, 23, 42, 0.09); --line-strong: rgba(15, 23, 42, 0.16);
      --text: #0f172a; --text-2: #475569; --text-3: #64748b;
      --accent: #0f766e; --accent-hover: #0d5f59; --accent-soft: rgba(15, 118, 110, 0.1); --on-accent: #ffffff;
      --ok: #15803d; --ok-soft: rgba(22, 163, 74, 0.1);
      --warn: #b45309; --warn-soft: rgba(217, 119, 6, 0.11);
      --danger: #dc2626; --danger-hover: #b91c1c; --danger-soft: rgba(220, 38, 38, 0.09);
      --shadow-float: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.1), 0 24px 48px rgba(15, 23, 42, 0.08);
      --shadow-card: 0 1px 2px rgba(15, 23, 42, 0.04);
      --ring: 0 0 0 3px rgba(15, 118, 110, 0.24);
      --backdrop: rgba(15, 23, 42, 0.38);
      --r-sm: 6px; --r-md: 8px; --r-lg: 10px; --r-xl: 13px;
      --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #0b0d12; --surface: #12151c; --surface-2: #161a22; --hover: #1c212b;
      --line: rgba(255, 255, 255, 0.08); --line-strong: rgba(255, 255, 255, 0.15);
      --text: #e7eaf0; --text-2: #a6afbd; --text-3: #7c8696;
      --accent: #2dd4bf; --accent-hover: #5eead4; --accent-soft: rgba(45, 212, 191, 0.13); --on-accent: #04201d;
      --ok: #3fb950; --ok-soft: rgba(63, 185, 80, 0.13);
      --warn: #d29922; --warn-soft: rgba(210, 153, 34, 0.14);
      --danger: #f85149; --danger-hover: #ff6a62; --danger-soft: rgba(248, 81, 73, 0.13);
      --shadow-float: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.45);
      --shadow-card: none;
      --ring: 0 0 0 3px rgba(45, 212, 191, 0.3);
      --backdrop: rgba(0, 0, 0, 0.6);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { height: 100%; }
    body { margin: 0; font: 400 13.5px/1.5 var(--font); color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; }
    svg { flex: none; }
    .icon { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
    .mono { font-family: var(--mono); }

    .shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100%; }
    .sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 24px; padding: 16px 12px; border-right: 1px solid var(--line); background: var(--surface); }
    .brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px; }
    .brand-mark { width: 28px; height: 28px; border-radius: var(--r-md); display: grid; place-items: center; background: var(--accent); color: var(--on-accent); }
    .brand-name { font-weight: 600; letter-spacing: -0.01em; }
    .brand-sub { font: 500 10.5px/1.2 var(--mono); color: var(--text-3); letter-spacing: 0.08em; text-transform: uppercase; }
    .nav { display: flex; flex-direction: column; gap: 2px; }
    .nav-label { font: 500 10.5px/1 var(--mono); color: var(--text-3); letter-spacing: 0.1em; text-transform: uppercase; padding: 0 8px 8px; }
    .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: var(--r-md); background: transparent; color: var(--text-2); font: 500 13.5px/1.4 var(--font); text-align: left; cursor: pointer; }
    .nav-item:hover { background: var(--hover); color: var(--text); }
    .nav-item:focus-visible { outline: none; box-shadow: var(--ring); }
    .nav-item[aria-current="page"] { background: var(--accent-soft); color: var(--accent); }
    .nav-item .count { margin-left: auto; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--hover); color: var(--text-3); font: 500 11px/18px var(--mono); text-align: center; }
    .nav-item[aria-current="page"] .count { background: transparent; color: inherit; }
    .sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
    .service { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface-2); }
    .service-text { min-width: 0; }
    .service-title { font-weight: 500; font-size: 12.5px; }
    .service-detail { color: var(--text-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex: none; }
    .service[data-state="online"] .pulse { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    .service[data-state="offline"] .pulse { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }

    .main { min-width: 0; padding: 32px 40px 64px; }
    .page { display: none; max-width: 1080px; margin: 0 auto; }
    .page.active { display: block; animation: fade 0.18s ease-out; }
    @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
    .page-head h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; }
    .page-head p { margin: 4px 0 0; color: var(--text-2); max-width: 68ch; }
    .head-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .stack { display: grid; gap: 16px; }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }

    .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl); box-shadow: var(--shadow-card); min-width: 0; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .card-head h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .card-head .sub { color: var(--text-3); font-size: 12px; margin-top: 2px; }
    .card-body { padding: 16px; }
    .card-foot { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--line); }
    .eyebrow { font: 500 10.5px/1.2 var(--mono); color: var(--text-3); letter-spacing: 0.1em; text-transform: uppercase; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .stat { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .stat-value { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; word-break: break-word; }
    .stat-meta { color: var(--text-3); font-size: 12px; min-height: 18px; word-break: break-word; }

    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font: 500 11.5px/18px var(--font); white-space: nowrap; background: var(--hover); color: var(--text-2); }
    .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.85; }
    .chip.plain::before { display: none; }
    .chip.ok { background: var(--ok-soft); color: var(--ok); }
    .chip.warn { background: var(--warn-soft); color: var(--warn); }
    .chip.danger { background: var(--danger-soft); color: var(--danger); }
    .chip.info { background: var(--accent-soft); color: var(--accent); }
    .tag { display: inline-block; padding: 1px 6px; border: 1px solid var(--line); border-radius: var(--r-sm); font: 500 11.5px/18px var(--mono); color: var(--text-2); background: var(--surface-2); }

    .banner { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-radius: var(--r-xl); border: 1px solid var(--line); background: var(--surface); }
    .banner .b-icon { width: 28px; height: 28px; border-radius: var(--r-md); display: grid; place-items: center; background: var(--hover); color: var(--text-3); flex: none; }
    .banner.ok .b-icon { background: var(--ok-soft); color: var(--ok); }
    .banner.warn .b-icon { background: var(--warn-soft); color: var(--warn); }
    .banner-title { font-weight: 500; }
    .banner-text { color: var(--text-2); font-size: 12.5px; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--r-md); font: 500 13px/1 var(--font); white-space: nowrap; cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s; }
    .btn:focus-visible { outline: none; box-shadow: var(--ring); }
    .btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: var(--on-accent); }
    .btn-primary:not([disabled]):hover { background: var(--accent-hover); }
    .btn-secondary { background: var(--surface); color: var(--text); border-color: var(--line-strong); box-shadow: var(--shadow-card); }
    .btn-secondary:not([disabled]):hover { background: var(--hover); }
    .btn-ghost { background: transparent; color: var(--text-2); }
    .btn-ghost:not([disabled]):hover { background: var(--hover); color: var(--text); }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-danger:not([disabled]):hover { background: var(--danger-hover); }
    .btn-sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
    .btn-icon { width: 30px; height: 30px; padding: 0; }
    .btn-icon.danger-hover:not([disabled]):hover { color: var(--danger); background: var(--danger-soft); }
    .btn.loading { position: relative; color: transparent !important; pointer-events: none; }
    .btn.loading::after { content: ""; position: absolute; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--text-2); border-right-color: transparent; animation: spin 0.7s linear infinite; }
    .btn-primary.loading::after, .btn-danger.loading::after { border-color: var(--on-accent); border-right-color: transparent; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 8px 16px; text-align: left; white-space: nowrap; font: 500 10.5px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); background: var(--surface-2); border-bottom: 1px solid var(--line); }
    td { padding: 12px 16px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    tr:last-child td { border-bottom: 0; }
    tbody tr:hover td { background: var(--surface-2); }
    .cell-title { font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cell-sub { color: var(--text-3); font-size: 12px; word-break: break-all; }
    .row-actions { display: flex; gap: 4px; justify-content: flex-end; align-items: center; }
    .nowrap { white-space: nowrap; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .empty { padding: 40px 16px; text-align: center; color: var(--text-3); }
    .empty strong { display: block; color: var(--text); font-weight: 500; margin-bottom: 4px; }
    .empty .btn { margin-top: 14px; }

    .steps { list-style: none; margin: 0; padding: 0; }
    .step { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
    .step:last-child { border-bottom: 0; }
    .step-mark { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; flex: none; border: 1px solid var(--line-strong); color: var(--text-3); font: 500 11px/1 var(--mono); }
    .step.done .step-mark { background: var(--ok-soft); border-color: transparent; color: var(--ok); }
    .step-text { flex: 1; min-width: 0; }
    .step-title { font-weight: 500; }
    .step-detail { color: var(--text-3); font-size: 12px; }

    .kv { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 8px 16px; margin: 0; }
    .kv dt { color: var(--text-3); }
    .kv dd { margin: 0; word-break: break-word; }

    form.fields, .fields { display: grid; gap: 14px; }
    .field { display: grid; gap: 6px; }
    .field > span { font-weight: 500; font-size: 12.5px; }
    .field small { color: var(--text-3); font-size: 11.5px; }
    .field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    input[type="text"], input[type="password"], input[type="url"], input:not([type]), select {
      width: 100%; height: 34px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: var(--r-md);
      background: var(--surface); color: var(--text); font: 400 13.5px/1 var(--font);
    }
    input:focus-visible, select:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--ring); }
    input::placeholder { color: var(--text-3); }
    .check { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 12.5px; }
    .check input { accent-color: var(--accent); }
    details.advanced { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface-2); }
    details.advanced summary { padding: 9px 12px; cursor: pointer; font-weight: 500; font-size: 12.5px; color: var(--text-2); }
    details.advanced .fields { padding: 4px 12px 12px; }
    .segmented { display: inline-flex; padding: 2px; border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface-2); }
    .segmented button { height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); font: 500 12.5px/1 var(--font); cursor: pointer; }
    .segmented button.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-card); }
    pre.code { margin: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface-2); font: 400 12.5px/1.6 var(--mono); overflow-x: auto; white-space: pre; }
    .note { color: var(--text-3); font-size: 12px; }

    dialog { width: min(520px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--line); border-radius: var(--r-xl); background: var(--surface); color: var(--text); box-shadow: var(--shadow-float); }
    dialog::backdrop { background: var(--backdrop); }
    .dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .dialog-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
    .dialog-body { padding: 16px; display: grid; gap: 14px; }
    .dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--surface-2); border-radius: 0 0 var(--r-xl) var(--r-xl); }
    .dialog-target { padding: 8px 10px; border-radius: var(--r-md); background: var(--surface-2); border: 1px solid var(--line); font: 400 12px/1.5 var(--mono); word-break: break-word; }

    .toast { position: fixed; right: 20px; bottom: 20px; display: flex; align-items: center; gap: 10px; max-width: min(440px, calc(100vw - 40px)); padding: 10px 14px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); box-shadow: var(--shadow-float); opacity: 0; transform: translateY(8px); pointer-events: none; transition: opacity 0.16s, transform 0.16s; }
    .toast.show { opacity: 1; transform: none; }
    .toast .icon { color: var(--ok); }
    .toast.error .icon { color: var(--danger); }

    @media (max-width: 860px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; gap: 12px; border-right: 0; border-bottom: 1px solid var(--line); }
      .nav { flex-direction: row; flex-wrap: wrap; }
      .nav-label { display: none; }
      .nav-item { width: auto; }
      .sidebar-foot { flex-direction: row; align-items: center; margin-top: 0; }
      .main { padding: 20px 16px 48px; }
      .stats, .split { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">${iconSprite()}</svg>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><svg class="icon"><use href="#i-server"/></svg></div>
        <div><div class="brand-name">TD/OMS MCP</div><div class="brand-sub">Control plane</div></div>
      </div>
      <nav class="nav" aria-label="Sections">
        <div class="nav-label">Manage</div>
        <button class="nav-item" data-page="overview" aria-current="page"><svg class="icon"><use href="#i-layout-dashboard"/></svg>Overview</button>
        <button class="nav-item" data-page="connections"><svg class="icon"><use href="#i-database"/></svg>Connections<span class="count" id="count-connections">0</span></button>
        <button class="nav-item" data-page="octo"><svg class="icon"><use href="#i-key-round"/></svg>Octo sign-in</button>
        <button class="nav-item" data-page="agents"><svg class="icon"><use href="#i-bot"/></svg>Agent setup<span class="count" id="count-agents">0</span></button>
        <button class="nav-item" data-page="tools"><svg class="icon"><use href="#i-boxes"/></svg>Tool groups<span class="count" id="count-tools">0</span></button>
      </nav>
      <div class="sidebar-foot">
        <div class="service" id="service" data-state="online">
          <span class="pulse"></span>
          <div class="service-text"><div class="service-title" id="service-title">Local service</div><div class="service-detail" id="service-detail">Starting</div></div>
        </div>
        <button class="nav-item" id="stop-service" hidden><svg class="icon"><use href="#i-power"/></svg>Stop this page</button>
        <button class="nav-item" id="theme-toggle"><svg class="icon"><use id="theme-icon" href="#i-moon"/></svg><span id="theme-label">Dark mode</span></button>
      </div>
    </aside>

    <main class="main">
      <section class="page active" id="page-overview">
        <div class="page-head">
          <div><h1>Overview</h1><p>Sign in once here, then every agent on this machine uses the same TD/OMS session.</p></div>
          <div class="head-actions"><button class="btn btn-secondary" data-refresh><svg class="icon"><use href="#i-refresh-cw"/></svg>Refresh</button></div>
        </div>
        <div class="stack">
          <div class="stats">
            <div class="card stat"><div class="stat-top"><span class="eyebrow">TD/OMS on IBM i</span><span id="stat-tdoms-chip"></span></div><div class="stat-value" id="stat-tdoms">None</div><div class="stat-meta" id="stat-tdoms-meta"></div></div>
            <div class="card stat"><div class="stat-top"><span class="eyebrow">Octo</span><span id="stat-octo-chip"></span></div><div class="stat-value" id="stat-octo">Not signed in</div><div class="stat-meta" id="stat-octo-meta"></div></div>
            <div class="card stat"><div class="stat-top"><span class="eyebrow">Agents</span><span id="stat-agents-chip"></span></div><div class="stat-value" id="stat-agents">0</div><div class="stat-meta" id="stat-agents-meta"></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Get set up</h2><div class="sub">Three steps, in order</div></div></div>
            <ul class="steps" id="steps"></ul>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Working defaults</h2><div class="sub">Agents fall back to these when a request leaves them out</div></div></div>
            <div class="card-body"><dl class="kv" id="context-list"></dl></div>
          </div>
        </div>
      </section>

      <section class="page" id="page-connections">
        <div class="page-head">
          <div><h1>Connections</h1><p>TD/OMS servers on IBM i. Passwords and tokens are encrypted on this machine and never written to an agent's configuration.</p></div>
          <div class="head-actions"><button class="btn btn-primary" id="add-connection"><svg class="icon"><use href="#i-plus"/></svg>Add connection</button></div>
        </div>
        <div class="card"><div class="table-wrap" id="connections-table"></div></div>
      </section>

      <section class="page" id="page-octo">
        <div class="page-head">
          <div><h1>Octo sign-in</h1><p>Optional. TD/OMS tools only need the IBM i connection. An Octo account adds what your Octo server publishes, such as its tool definitions and agent skills.</p></div>
        </div>
        <div class="split">
          <div class="card" id="octo-account-card"></div>
          <div class="card" id="octo-local-card"></div>
        </div>
        <div class="stack" style="margin-top:16px" id="octo-probe"></div>
      </section>

      <section class="page" id="page-agents">
        <div class="page-head">
          <div><h1>Agent setup</h1><p id="environment-label">Detecting environment</p></div>
          <div class="head-actions">
            <label class="check"><input type="checkbox" id="show-all-clients">Show products not detected</label>
            <div class="segmented" aria-label="Skill installation scope">
              <button type="button" class="active" data-skill-scope="user">User skill</button>
              <button type="button" data-skill-scope="workspace">Workspace skill</button>
            </div>
            <button class="btn btn-secondary" id="install-detected-skills"><svg class="icon"><use href="#i-book-open"/></svg>Install skills</button>
            <button class="btn btn-primary" id="install-detected"><svg class="icon"><use href="#i-plug-zap"/></svg>Configure detected</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>MCP clients</h2><div class="sub" id="client-count">Scanning</div></div></div>
          <div class="table-wrap" id="clients-table"><div class="empty">Detecting MCP clients</div></div>
        </div>
      </section>

      <section class="page" id="page-tools">
        <div class="page-head">
          <div><h1>Tool groups</h1><p>Agents start with the small core group and reach every other tool through the catalog, so the tool list stays cheap to load.</p></div>
        </div>
        <div class="stack">
          <div class="card"><div class="table-wrap" id="groups-table"></div></div>
          <div class="card">
            <div class="card-head"><div><h2>Load more groups directly</h2><div class="sub">Only needed when an agent should see those tools without going through the catalog</div></div></div>
            <div class="card-body"><pre class="code">tdoms-mcp mcp --groups tasks,source,build</pre></div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div class="toast" id="toast"><svg class="icon"><use id="toast-icon" href="#i-check"/></svg><span></span></div>

  <dialog id="connection-dialog">
    <form id="connection-form" method="dialog">
      <div class="dialog-head"><h2 id="form-title">Add connection</h2><button type="button" class="btn btn-ghost btn-icon" data-close title="Close"><svg class="icon"><use href="#i-x"/></svg></button></div>
      <div class="dialog-body">
        <input type="hidden" name="id">
        <label class="field"><span>Name</span><input name="name" placeholder="Development TD/OMS"></label>
        <div class="field-row">
          <label class="field"><span>Host</span><input name="host" placeholder="tdoms.example.com" required></label>
          <label class="field"><span>REST port</span><input name="port" inputmode="numeric" placeholder="Ask your TD/OMS admin" required></label>
        </div>
        <div class="field-row">
          <label class="field"><span>IBM i user</span><input name="username" autocomplete="username" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Leave blank to keep"></label>
        </div>
        <details class="advanced">
          <summary>Advanced settings</summary>
          <div class="fields">
            <div class="field-row">
              <label class="field"><span>Protocol</span><select name="protocol"><option value="https">HTTPS</option><option value="http">HTTP</option></select></label>
              <label class="field"><span>TD/OMS library</span><input name="library" value="OMS" required></label>
            </div>
            <label class="check"><input name="verifyTls" type="checkbox" checked>Verify server certificate</label>
            <label class="field"><span>Custom CA certificate</span><input name="caFile" placeholder="/path/to/company-root-ca.pem"></label>
          </div>
        </details>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="save-connection"><svg class="icon"><use href="#i-log-in"/></svg>Save and sign in</button>
      </div>
    </form>
  </dialog>

  <dialog id="confirm-dialog">
    <div class="dialog-head"><h2 id="dialog-title">Confirm action</h2><button class="btn btn-ghost btn-icon" id="dialog-close" title="Close"><svg class="icon"><use href="#i-x"/></svg></button></div>
    <div class="dialog-body"><div id="dialog-message"></div><div class="dialog-target" id="dialog-target"></div></div>
    <div class="dialog-foot"><button class="btn btn-secondary" id="dialog-cancel">Cancel</button><button class="btn btn-primary" id="dialog-confirm">Confirm</button></div>
  </dialog>

  <script>
    var state = { connections: [], clients: [], overview: { context: {}, groups: [], octo: { account: {}, localSession: {} } }, pendingAction: null, skillScope: "user", octoNeedsCode: false, probe: null };
    var form = document.querySelector("#connection-form");
    var connectionDialog = document.querySelector("#connection-dialog");
    var confirmDialog = document.querySelector("#confirm-dialog");
    var toast = document.querySelector("#toast");
    function $(selector) { return document.querySelector(selector); }
    function icon(name) { return '<svg class="icon"><use href="#i-' + name + '"/></svg>'; }
    function chip(kind, text) { return '<span class="chip ' + kind + '">' + escapeHtml(text) + '</span>'; }

    async function request(url, options) {
      var response = await fetch(url, Object.assign({ headers: { "content-type": "application/json" } }, options || {}));
      var json = await response.json();
      if (!response.ok) throw new Error(json.error || "Request failed");
      return json;
    }
    function post(url, body) { return request(url, { method: "POST", body: JSON.stringify(body || {}) }); }

    async function refresh() {
      try {
        var results = await Promise.all([request("/api/connections"), request("/api/clients"), request("/api/overview")]);
        state.connections = results[0].connections;
        state.clients = results[1].clients;
        state.overview = results[2];
        $("#service").dataset.state = "online";
        $("#service-title").textContent = "Local service";
        $("#service-detail").textContent = "v" + state.overview.version + " on this machine";
        $("#stop-service").hidden = !state.overview.canStop;
        renderAll();
      } catch (error) {
        $("#service").dataset.state = "offline";
        $("#service-detail").textContent = "Not reachable";
        notify(error.message, true);
      }
    }

    function renderAll() { renderConnections(); renderClients(); renderOcto(); renderGroups(); renderOverview(); }

    function activeConnection() {
      var id = state.overview.context && state.overview.context.activeConnectionId;
      return state.connections.find(function (item) { return item.id === id; }) || (state.connections.length === 1 ? state.connections[0] : null);
    }

    function statusChip(item) {
      var status = item.lastStatus || "never-tested";
      if (status === "system-probe-ok" || status === "logged-in") return chip("ok", "Signed in");
      if (status === "login-failed") return chip("danger", "Sign-in failed");
      return chip("", "Not signed in");
    }
    function isSignedIn(item) { return item && (item.lastStatus === "system-probe-ok" || item.lastStatus === "logged-in"); }

    function renderOverview() {
      var active = activeConnection();
      var account = state.overview.octo.account || {};
      var detected = state.clients.filter(function (item) { return item.detected; });
      var configured = detected.filter(function (item) { return item.configured; });
      $("#stat-tdoms").textContent = active ? active.name : (state.connections.length ? "Pick a connection" : "No connection");
      $("#stat-tdoms-meta").textContent = active ? (active.username + " at " + active.host) : "Add your TD/OMS server to start";
      $("#stat-tdoms-chip").innerHTML = active ? statusChip(active) : chip("warn", "Needs setup");
      $("#stat-octo").textContent = account.signedIn ? (account.username || account.email || "Signed in") : "Not signed in";
      $("#stat-octo-meta").textContent = account.signedIn ? (account.organizationName || account.organization || account.serverUrl || "") : "Optional";
      $("#stat-octo-chip").innerHTML = account.signedIn ? chip("ok", "Signed in") : chip("plain", "Optional");
      $("#stat-agents").textContent = configured.length + " of " + detected.length;
      $("#stat-agents-meta").textContent = detected.length ? "detected agents configured" : "No supported agents detected";
      $("#stat-agents-chip").innerHTML = !detected.length ? "" : configured.length === detected.length ? chip("ok", "All set") : chip("warn", (detected.length - configured.length) + " to do");

      var steps = [
        { done: state.connections.length > 0, title: "Add your TD/OMS connection", detail: "Host, REST port and your IBM i user.", action: '<button class="btn btn-secondary btn-sm" data-go="connections" data-open-add>Add connection</button>' },
        { done: isSignedIn(active), title: "Sign in to IBM i", detail: active ? "Checks the saved password and stores a session token." : "Available once a connection exists.", action: active ? '<button class="btn btn-secondary btn-sm" data-signin="' + escapeHtml(active.id) + '">Sign in</button>' : "" },
        { done: detected.length > 0 && configured.length === detected.length, title: "Connect your agents", detail: "Adds TD/OMS MCP to the agents found on this machine.", action: '<button class="btn btn-secondary btn-sm" data-go="agents">Agent setup</button>' }
      ];
      $("#steps").innerHTML = steps.map(function (step, index) {
        return '<li class="step' + (step.done ? " done" : "") + '"><span class="step-mark">' + (step.done ? icon("check") : index + 1) + '</span><div class="step-text"><div class="step-title">' + step.title + '</div><div class="step-detail">' + step.detail + '</div></div>' + (step.done ? chip("ok", "Done") : step.action) + '</li>';
      }).join("");

      var context = state.overview.context || {};
      var rows = [["Connection", active ? active.name : ""], ["Application", context.applicationCode], ["Task", context.taskNumber], ["Request", context.requestNumber], ["Environment", context.environmentCode], ["Transfer path", context.pathCode]];
      $("#context-list").innerHTML = rows.map(function (row) {
        return '<dt>' + row[0] + '</dt><dd>' + (row[1] ? '<span class="tag">' + escapeHtml(row[1]) + '</span>' : '<span class="note">Not set</span>') + '</dd>';
      }).join("");
    }

    function renderConnections() {
      $("#count-connections").textContent = state.connections.length;
      var active = activeConnection();
      if (!state.connections.length) {
        $("#connections-table").innerHTML = '<div class="empty"><strong>No connections yet</strong>Add the TD/OMS server you use on IBM i.<br><button class="btn btn-primary" data-open-add>' + icon("plus") + 'Add connection</button></div>';
        return;
      }
      $("#connections-table").innerHTML = '<table><thead><tr><th>Connection</th><th>Server</th><th>User</th><th>Status</th><th></th></tr></thead><tbody>' + state.connections.map(function (item) {
        var id = escapeHtml(item.id);
        var isActive = active && active.id === item.id;
        return '<tr><td><div class="cell-title">' + escapeHtml(item.name) + (isActive ? chip("info", "Active") : "") + (item.source === "octo" ? '<span class="tag">from Octo</span>' : "") + '</div></td>'
          + '<td><div class="mono nowrap">' + escapeHtml(item.host) + ':' + escapeHtml(item.port) + '</div><div class="cell-sub">' + escapeHtml((item.protocol || "https").toUpperCase()) + ' · library ' + escapeHtml(item.library) + (item.verifyTls === false ? ' · certificate not verified' : '') + '</div></td>'
          + '<td>' + escapeHtml(item.username || "") + '</td>'
          + '<td>' + statusChip(item) + '</td>'
          + '<td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-signin="' + id + '">' + icon("log-in") + 'Sign in</button>'
          + (isActive ? "" : '<button class="btn btn-ghost btn-sm" data-activate="' + id + '">' + icon("star") + 'Make active</button>')
          + '<button class="btn btn-ghost btn-icon" data-edit="' + id + '" title="Edit">' + icon("pencil") + '</button>'
          + '<button class="btn btn-ghost btn-icon danger-hover" data-delete="' + id + '" title="Delete">' + icon("trash-2") + '</button></div></td></tr>';
      }).join("") + '</tbody></table>';
    }

    function renderOcto() {
      var octo = state.overview.octo || {};
      var account = octo.account || {};
      var local = octo.localSession || {};
      if (account.signedIn) {
        $("#octo-account-card").innerHTML = '<div class="card-head"><div><h2>Octo account</h2><div class="sub">Only the API key is kept, encrypted on this machine</div></div>' + chip("ok", "Signed in") + '</div>'
          + '<div class="card-body"><dl class="kv"><dt>User</dt><dd>' + escapeHtml(account.username || account.email || "") + '</dd><dt>Server</dt><dd class="mono">' + escapeHtml(account.serverUrl || "") + '</dd><dt>Organization</dt><dd>' + escapeHtml(account.organizationName || account.organization || "Not set") + '</dd><dt>Signed in</dt><dd>' + escapeHtml(formatDate(account.signedInAt)) + '</dd></dl></div>'
          + '<div class="card-foot"><button class="btn btn-ghost" id="octo-sign-out">' + icon("log-out") + 'Sign out</button><button class="btn btn-secondary" id="octo-probe-run">' + icon("activity") + 'Test access</button></div>';
      } else {
        $("#octo-account-card").innerHTML = '<div class="card-head"><div><h2>Octo account</h2><div class="sub">The password is used once and is not stored</div></div>' + chip("plain", "Optional") + '</div>'
          + '<form class="card-body fields" id="octo-form">'
          + '<label class="field"><span>Organization URL</span><input name="url" placeholder="https://octo.example.com/org/acme" required value="' + escapeHtml(account.serverUrl ? account.serverUrl + (account.organization ? "/org/" + account.organization : "") : "") + '"><small>The address you open Octo with in the browser.</small></label>'
          + '<label class="field"><span>Username or email</span><input name="username" autocomplete="username" required></label>'
          + '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>'
          + '<label class="field" id="octo-code-field"' + (state.octoNeedsCode ? "" : " hidden") + '><span>Two-factor code</span><input name="code" inputmode="numeric" autocomplete="one-time-code"></label>'
          + '<div><button class="btn btn-primary" type="submit" id="octo-submit">' + icon("log-in") + 'Sign in to Octo</button></div></form>';
      }
      if (local.found) {
        $("#octo-local-card").innerHTML = '<div class="card-head"><div><h2>Session from VS Code</h2><div class="sub">Found the TD/OMS sign-in the Octo extension saved on this machine</div></div>' + (local.tokenExpired ? chip("warn", "Token expired") : local.hasToken ? chip("ok", "Token ready") : chip("", "No token")) + '</div>'
          + '<div class="card-body"><dl class="kv"><dt>Server</dt><dd class="mono">' + escapeHtml(local.host + ":" + local.port) + '</dd><dt>Library</dt><dd>' + escapeHtml(local.library) + '</dd><dt>User</dt><dd>' + escapeHtml(local.username || "Not in the session") + '</dd><dt>Token valid until</dt><dd>' + escapeHtml(formatDate(local.tokenExpiresAt) || "Unknown") + '</dd></dl></div>'
          + '<div class="card-foot"><button class="btn btn-secondary" id="octo-import">' + icon("import") + 'Use this session</button></div>';
      } else {
        $("#octo-local-card").innerHTML = '<div class="card-head"><div><h2>Session from VS Code</h2><div class="sub">Reuses the Octo extension sign-in when there is one</div></div>' + chip("", "Not found") + '</div>'
          + '<div class="card-body"><div class="note">' + escapeHtml(local.reason || "No Octo session was found on this machine.") + '</div></div>';
      }
      renderProbe();
    }

    function renderProbe() {
      var probe = state.probe;
      if (!probe) { $("#octo-probe").innerHTML = ""; return; }
      if (!probe.checks) { $("#octo-probe").innerHTML = '<div class="banner warn"><div class="b-icon">' + icon("circle-alert") + '</div><div><div class="banner-title">Could not test access</div><div class="banner-text">' + escapeHtml(probe.reason || "") + '</div></div></div>'; return; }
      $("#octo-probe").innerHTML = '<div class="card"><div class="card-head"><div><h2>What this account can see</h2><div class="sub">Read-only check of the Octo server</div></div>' + (probe.ok ? chip("ok", "All reachable") : chip("warn", "Some failed")) + '</div><div class="table-wrap"><table><thead><tr><th>Check</th><th>Result</th><th>Found</th></tr></thead><tbody>' + probe.checks.map(function (check) {
        return '<tr><td>' + escapeHtml(check.label) + '</td><td>' + (check.ok ? chip("ok", "OK") : chip("danger", check.status ? "HTTP " + check.status : "Failed")) + '</td><td>' + (check.ok ? check.count + ' <span class="cell-sub">' + escapeHtml((check.names || []).slice(0, 6).join(", ")) + '</span>' : '<span class="cell-sub">' + escapeHtml(check.error || "") + '</span>') + '</td></tr>';
      }).join("") + '</tbody></table></div></div>';
    }

    function renderClients() {
      var showAll = $("#show-all-clients").checked;
      var clients = state.clients.filter(function (item) { return showAll || item.detected; });
      var detected = state.clients.filter(function (item) { return item.detected; }).length;
      var pending = state.clients.filter(function (item) { return item.detected && item.installable && !item.configured; }).length;
      var pendingSkills = state.clients.filter(function (item) { return item.detected && item.skill && item.skill.supported && !item.skill[state.skillScope].current; }).length;
      var environment = state.clients[0] && state.clients[0].environment;
      $("#environment-label").textContent = environment ? environment.label + ". " + environment.note : "Add TD/OMS MCP and its workflow skill to the agents on this machine.";
      $("#install-detected").disabled = pending === 0;
      $("#install-detected-skills").disabled = pendingSkills === 0;
      $("#client-count").textContent = detected + " detected on this machine";
      $("#count-agents").textContent = detected;
      if (!clients.length) {
        $("#clients-table").innerHTML = '<div class="empty"><strong>No supported MCP clients detected</strong>Tick "Show products not detected" to see what is supported.</div>';
        return;
      }
      $("#clients-table").innerHTML = '<table><thead><tr><th>Agent</th><th>Status</th><th></th></tr></thead><tbody>' + clients.map(function (item) {
        var id = escapeHtml(item.id);
        var skill = item.skill || { supported: false };
        var scoped = skill.supported ? skill[state.skillScope] : null;
        var guidance = escapeHtml(skill.guidance || "");
        var mcpButton = item.installable ? '<button class="btn btn-secondary btn-sm" data-install="' + id + '">' + icon("plug-zap") + (item.configured ? "Update MCP" : "Install MCP") + '</button>' : "";
        var skillButton = skill.supported && item.detected ? '<button class="btn btn-secondary btn-sm" data-install-skill="' + id + '" title="' + guidance + '">' + icon("book-open") + (scoped && scoped.installed ? "Update skill" : "Install skill") + '</button>' : "";
        var skillDownload = skill.downloadable && item.detected ? '<button class="btn btn-secondary btn-sm" data-install-upload-skill="' + id + '" title="' + guidance + '">' + icon("download") + 'Install skill</button>' : "";
        var mcpChip = item.configured ? chip("ok", "MCP configured") : item.detected ? chip("warn", "MCP not configured") : chip("", "Not detected");
        var skillChip = scoped ? (scoped.current ? chip("ok", "Skill current") : scoped.installedAny ? chip("warn", "Skill update") : chip("", "Skill available")) : skill.downloadable ? chip("info", "Skill by upload") : item.detected ? '<span title="' + guidance + '">' + chip("", "No skill support") + '</span>' : "";
        var paths = (item.configPath ? '<div class="cell-sub">' + escapeHtml(item.configPath) + '</div>' : "") + (scoped && scoped.targets ? scoped.targets.map(function (target) { return '<div class="cell-sub">Skill, ' + escapeHtml(target.label) + ': ' + escapeHtml(target.path) + '</div>'; }).join("") : "");
        return '<tr><td><div class="cell-title">' + escapeHtml(item.name) + '</div><div class="cell-sub" style="word-break:normal">' + escapeHtml(item.description || "") + '</div>' + paths + '</td><td><div class="chips">' + mcpChip + skillChip + '</div></td><td><div class="row-actions">' + mcpButton + skillButton + skillDownload + '</div></td></tr>';
      }).join("") + '</tbody></table>';
    }

    function renderGroups() {
      var groups = state.overview.groups || [];
      $("#count-tools").textContent = groups.reduce(function (sum, group) { return sum + (group.toolCount || 0); }, 0);
      $("#groups-table").innerHTML = '<table><thead><tr><th>Group</th><th>Covers</th><th>Tools</th></tr></thead><tbody>' + groups.map(function (group) {
        return '<tr><td><div class="cell-title">' + escapeHtml(group.title) + '</div><span class="tag">' + escapeHtml(group.id) + '</span></td><td style="color:var(--text-2)">' + escapeHtml(group.description) + '</td><td>' + (group.id === "core" ? chip("info", group.toolCount + " always loaded") : '<span class="mono">' + group.toolCount + '</span>') + '</td></tr>';
      }).join("") + '</tbody></table>';
    }

    function openConnectionForm(id) {
      var item = state.connections.find(function (entry) { return entry.id === id; });
      form.reset();
      form.elements.id.value = "";
      form.elements.library.value = "OMS";
      form.elements.verifyTls.checked = true;
      if (item) {
        ["id", "name", "protocol", "host", "port", "library", "username", "caFile"].forEach(function (key) { form.elements[key].value = item[key] || ""; });
        form.elements.verifyTls.checked = item.verifyTls !== false;
      }
      form.elements.password.placeholder = item ? "Leave blank to keep" : "";
      $("#form-title").textContent = item ? "Edit connection" : "Add connection";
      connectionDialog.showModal();
    }

    async function signIn(id, button) {
      if (button) button.classList.add("loading");
      try {
        var result = await post("/api/connections/" + encodeURIComponent(id) + "/login");
        if (!state.overview.context.activeConnectionId) await post("/api/context", { activeConnectionId: id });
        notify("Signed in. " + result.system.applicationCount + " applications available.");
      } catch (error) { notify(error.message, true); }
      await refresh();
    }

    function showPage(name) {
      document.querySelectorAll(".nav-item[data-page]").forEach(function (item) { if (item.dataset.page === name) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); });
      document.querySelectorAll(".page").forEach(function (page) { page.classList.toggle("active", page.id === "page-" + name); });
      try { history.replaceState(null, "", "#" + name); } catch (error) {}
    }

    function openConfirmation(options) {
      state.pendingAction = options.action;
      $("#dialog-title").textContent = options.title;
      $("#dialog-message").textContent = options.message;
      $("#dialog-target").textContent = options.target;
      $("#dialog-confirm").className = "btn " + (options.danger ? "btn-danger" : "btn-primary");
      $("#dialog-confirm").textContent = options.confirmLabel || "Confirm";
      confirmDialog.showModal();
    }
    function closeConfirm() { state.pendingAction = null; confirmDialog.close(); }

    function notify(message, isError) {
      toast.querySelector("span").textContent = message;
      toast.classList.toggle("error", Boolean(isError));
      $("#toast-icon").setAttribute("href", isError ? "#i-circle-alert" : "#i-check");
      toast.classList.add("show");
      clearTimeout(notify.timer);
      notify.timer = setTimeout(function () { toast.classList.remove("show"); }, 5000);
    }
    function formatDate(value) { if (!value) return ""; var date = new Date(value); return isNaN(date) ? "" : date.toLocaleString(); }
    function escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
      });
    }
    function applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      $("#theme-icon").setAttribute("href", theme === "dark" ? "#i-sun" : "#i-moon");
      $("#theme-label").textContent = theme === "dark" ? "Light mode" : "Dark mode";
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var body = {
        id: data.get("id") || undefined,
        name: data.get("name"), protocol: data.get("protocol"), host: data.get("host"), port: data.get("port"),
        library: data.get("library"), username: data.get("username"), password: data.get("password") || undefined,
        caFile: data.get("caFile") || undefined, verifyTls: data.get("verifyTls") === "on"
      };
      var button = $("#save-connection");
      button.classList.add("loading");
      try {
        var saved = await post("/api/connections", body);
        connectionDialog.close();
        await signIn(saved.connection.id);
      } catch (error) { notify(error.message, true); }
      button.classList.remove("loading");
    });

    document.addEventListener("click", function (event) {
      var target = event.target;
      var go = target.closest("[data-go]");
      if (go) showPage(go.dataset.go);
      if (target.closest("[data-open-add]")) openConnectionForm();
      if (target.closest("[data-close]")) connectionDialog.close();
      if (target.closest("[data-refresh]")) refresh();
      var nav = target.closest(".nav-item[data-page]");
      if (nav) showPage(nav.dataset.page);
      var signin = target.closest("[data-signin]");
      if (signin) signIn(signin.dataset.signin, signin);
      var edit = target.closest("[data-edit]");
      if (edit) openConnectionForm(edit.dataset.edit);
      var activate = target.closest("[data-activate]");
      if (activate) post("/api/context", { activeConnectionId: activate.dataset.activate }).then(function () { notify("Active connection changed"); return refresh(); }).catch(function (error) { notify(error.message, true); });
      var remove = target.closest("[data-delete]");
      if (remove) {
        var item = state.connections.find(function (entry) { return entry.id === remove.dataset.delete; });
        openConfirmation({ title: "Delete connection", message: "This removes the saved connection and its encrypted password and token from this machine.", target: item ? item.name : remove.dataset.delete, danger: true, confirmLabel: "Delete", action: async function () { await request("/api/connections/" + encodeURIComponent(remove.dataset.delete), { method: "DELETE" }); notify("Connection deleted"); await refresh(); } });
      }
      if (target.closest("#octo-sign-out")) {
        openConfirmation({ title: "Sign out of Octo", message: "This removes the stored Octo API key. TD/OMS connections are not affected.", target: (state.overview.octo.account || {}).serverUrl || "Octo", confirmLabel: "Sign out", action: async function () { await post("/api/octo/sign-out"); state.probe = null; notify("Signed out of Octo"); await refresh(); } });
      }
      var probe = target.closest("#octo-probe-run");
      if (probe) {
        probe.classList.add("loading");
        post("/api/octo/probe").then(function (result) { state.probe = result; }).catch(function (error) { state.probe = { reason: error.message }; }).then(function () { probe.classList.remove("loading"); renderProbe(); });
      }
      var importButton = target.closest("#octo-import");
      if (importButton) {
        importButton.classList.add("loading");
        post("/api/octo/import-session").then(function (result) {
          if (!result.imported) throw new Error(result.reason || "Nothing was imported.");
          notify((result.created ? "Connection added from the Octo session" : "Connection updated from the Octo session") + (result.warnings && result.warnings.length ? ". " + result.warnings[0] : ""));
          return refresh();
        }).catch(function (error) { importButton.classList.remove("loading"); notify(error.message, true); });
      }
      var install = target.closest("[data-install]");
      var installSkill = target.closest("[data-install-skill]");
      var installUploadSkill = target.closest("[data-install-upload-skill]");
      if (install) {
        var client = state.clients.find(function (entry) { return entry.id === install.dataset.install; });
        openConfirmation({ title: client.configured ? "Update MCP client" : "Install MCP client", message: "A backup is created before the client configuration changes.", target: client.name, action: async function () { var result = await post("/api/clients/" + encodeURIComponent(client.id) + "/install", { confirm: true }); notify(client.name + " configured" + (result.restartRequired ? ". Restart it to load TD/OMS MCP." : "")); await refresh(); } });
      }
      if (installSkill) {
        var skillClient = state.clients.find(function (entry) { return entry.id === installSkill.dataset.installSkill; });
        var scoped = skillClient.skill[state.skillScope];
        openConfirmation({ title: scoped.installed ? "Update agent skill" : "Install agent skill", message: "The TD/OMS workflow skill is installed for every compatible agent in this product. Existing skill files are backed up first.", target: skillClient.name + " | " + state.skillScope + " | " + (scoped.targets || []).map(function (entry) { return entry.label + ": " + entry.path; }).join(" | "), action: async function () { var result = await post("/api/clients/" + encodeURIComponent(skillClient.id) + "/install-skill", { confirm: true, scope: state.skillScope }); notify(skillClient.name + " skill installed" + (result.restartRequired ? ". Restart it to load the skill." : "")); await refresh(); } });
      }
      if (installUploadSkill) {
        openConfirmation({ title: "Download the skill package", message: "This product installs skills by upload. Confirm to download the packaged ZIP, then add it from the product's own skills settings.", target: "tdoms-mcp-routing.zip", confirmLabel: "Download", action: async function () { var link = document.createElement("a"); link.href = "/api/skill/archive"; link.download = "tdoms-mcp-routing.zip"; document.body.appendChild(link); link.click(); link.remove(); notify("Skill package downloaded"); } });
      }
    });

    document.addEventListener("submit", async function (event) {
      if (event.target.id !== "octo-form") return;
      event.preventDefault();
      var data = new FormData(event.target);
      var button = $("#octo-submit");
      button.classList.add("loading");
      try {
        var result = await post("/api/octo/sign-in", { url: data.get("url"), username: data.get("username"), password: data.get("password"), code: data.get("code") || undefined });
        if (result.needsCode) {
          state.octoNeedsCode = true;
          $("#octo-code-field").hidden = false;
          event.target.elements.code.focus();
          notify(result.message);
        } else {
          state.octoNeedsCode = false;
          notify("Signed in to Octo");
          await refresh();
        }
      } catch (error) { notify(error.message, true); }
      if (button.isConnected) button.classList.remove("loading");
    });

    $("#add-connection").addEventListener("click", function () { openConnectionForm(); });
    $("#show-all-clients").addEventListener("change", renderClients);
    document.querySelectorAll("[data-skill-scope]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.skillScope = button.dataset.skillScope;
        document.querySelectorAll("[data-skill-scope]").forEach(function (item) { item.classList.toggle("active", item === button); });
        renderClients();
      });
    });
    $("#install-detected").addEventListener("click", function () {
      var pending = state.clients.filter(function (item) { return item.detected && item.installable && !item.configured; });
      openConfirmation({ title: "Configure detected agents", message: "This adds TD/OMS MCP to detected agents that are not configured yet. Every existing file is backed up first.", target: pending.map(function (item) { return item.name; }).join(", "), action: async function () { var result = await post("/api/clients/install-detected", { confirm: true }); notify(result.configured + " configured, " + result.failed + " failed", result.failed > 0); await refresh(); } });
    });
    $("#install-detected-skills").addEventListener("click", function () {
      var pending = state.clients.filter(function (item) { return item.detected && item.skill && item.skill.supported && !item.skill[state.skillScope].current; });
      openConfirmation({ title: "Install detected agent skills", message: "This installs or updates the bundled TD/OMS workflow skill for the selected scope. Existing skill folders are backed up first.", target: state.skillScope + " | " + pending.map(function (item) { return item.name; }).join(", "), action: async function () { var result = await post("/api/clients/install-detected-skills", { confirm: true, scope: state.skillScope }); notify(result.installed + " installed, " + result.failed + " failed", result.failed > 0); await refresh(); } });
    });
    $("#dialog-close").addEventListener("click", closeConfirm);
    $("#dialog-cancel").addEventListener("click", closeConfirm);
    $("#dialog-confirm").addEventListener("click", async function () {
      var action = state.pendingAction;
      closeConfirm();
      if (!action) return;
      try { await action(); } catch (error) { notify(error.message, true); }
    });
    $("#stop-service").addEventListener("click", function () {
      openConfirmation({ title: "Stop the setup page", message: "This shuts down the local setup page. Agents keep working, because each one runs its own TD/OMS MCP server. Start the page again with: tdoms-mcp ui", target: location.host, danger: true, confirmLabel: "Stop", action: async function () {
        await post("/api/shutdown");
        $("#service").dataset.state = "offline";
        $("#service-title").textContent = "Stopped";
        $("#service-detail").textContent = "Run tdoms-mcp ui to start again";
        $("#stop-service").hidden = true;
        notify("Setup page stopped. You can close this tab.");
      } });
    });
    $("#theme-toggle").addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("tdoms-mcp-theme", next); } catch (error) {}
    });

    applyTheme(document.documentElement.dataset.theme || "light");
    var startPage = location.hash.replace("#", "");
    if (document.querySelector("#page-" + startPage)) showPage(startPage);
    refresh();
  </script>
</body>
</html>`;
}
