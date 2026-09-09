/**
 * The review interface, as a single self-contained page.
 *
 * No fonts, scripts or styles are fetched from anywhere. This is a local tool
 * that reads a store on your disk, and it should work on a train, behind a
 * corporate proxy, and on an air-gapped box that runs the automations nobody is
 * allowed to talk about. That rules out a CDN and it rules out a build step.
 */

export const APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>silentgreen review</title>
<style>
  :root {
    --ground: #eef1f4; --panel: #fff; --ink: #10151a; --soft: #4e5761; --faint: #79838d;
    --rule: #d5dbe1; --rule-soft: #e8ecf0;
    --intent: #1c4ea8; --intent-bg: #eef3fb;
    --structure: #475059; --structure-bg: #eef0f2;
    --observation: #7d5200; --observation-bg: #fcf7ea;
    --ok: #157f47; --ok-bg: #eef7f2;
    --bad: #a4231b; --bad-bg: #fcf1f0;
    --sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 400 15px/1.55 var(--sans); font-variant-numeric: tabular-nums; }
  button { font: inherit; }

  header {
    background: var(--ink); color: #e8ecf0; padding: 10px 18px;
    display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  }
  header .mark { font-weight: 700; letter-spacing: -0.02em; }
  header .mark i { font-style: normal; color: #4fbe84; }
  header .meta { color: #98a4ae; font-size: 13px; }
  header .who { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 13px; color: #98a4ae; }
  header .who input {
    font: 400 13px var(--sans); padding: 5px 9px; border: 1px solid #39424c;
    background: #1b2229; color: #e8ecf0; min-width: 210px;
  }
  header .who input::placeholder { color: #6d7882; }

  .layout { display: grid; grid-template-columns: 288px 1fr; min-height: calc(100vh - 42px); }
  aside { background: var(--panel); border-right: 1px solid var(--rule); }
  aside h2 { font-size: 12.5px; font-weight: 600; color: var(--faint); margin: 0; padding: 14px 16px 8px; }
  .wf { display: block; width: 100%; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--rule-soft); padding: 12px 16px; cursor: pointer; }
  .wf:hover { background: var(--ground); }
  .wf[aria-current="true"] { background: var(--ink); color: #fff; }
  .wf .n { font-weight: 600; font-size: 14.5px; }
  .wf .c { font-size: 12.5px; color: var(--faint); margin-top: 3px; }
  .wf[aria-current="true"] .c { color: #9fb0bd; }
  .pill { display: inline-block; padding: 1px 6px; font-size: 11.5px; border: 1px solid currentColor; margin-right: 5px; }

  main { padding: 22px 26px 60px; max-width: 900px; }
  h1 { font-size: 22px; letter-spacing: -0.02em; margin: 0 0 3px; }
  .sub { color: var(--soft); font-size: 14px; margin: 0 0 18px; }

  .tabs { display: flex; border-bottom: 1px solid var(--rule); margin-bottom: 20px; }
  .tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 9px 14px; cursor: pointer; color: var(--soft); font-weight: 500; font-size: 14px; }
  .tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink); }

  .honesty { background: var(--panel); border: 1px solid var(--rule); border-left: 3px solid var(--observation); padding: 13px 16px; margin-bottom: 18px; font-size: 14.5px; }

  .card { background: var(--panel); border: 1px solid var(--rule); margin-bottom: 14px; }
  .card-head { padding: 16px 18px 0; }
  .chip { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 2px 7px; letter-spacing: .02em; margin-bottom: 8px; }
  .chip.intent { background: var(--intent-bg); color: var(--intent); }
  .chip.structure { background: var(--structure-bg); color: var(--structure); }
  .chip.observation { background: var(--observation-bg); color: var(--observation); }
  .chip.conf { background: var(--ok-bg); color: var(--ok); }
  .chip.stale { background: var(--observation-bg); color: var(--observation); }
  .card h3 { margin: 0 0 6px; font-size: 16.5px; font-weight: 600; line-height: 1.35; }
  .card .why { color: var(--soft); font-size: 14.5px; margin: 0 0 12px; }
  .card .sink { color: var(--faint); font-size: 13px; margin: 0 0 10px; }

  .proves { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rule-soft); border-top: 1px solid var(--rule-soft); border-bottom: 1px solid var(--rule-soft); }
  .proves div { background: var(--panel); padding: 11px 18px; font-size: 13.5px; }
  .proves .k { display: block; font-weight: 600; color: var(--faint); font-size: 12px; margin-bottom: 2px; }
  .proves .yes { border-left: 3px solid var(--ok); }
  .proves .no { border-left: 3px solid var(--observation); }

  .evidence { padding: 14px 18px; }
  .evidence .k { font-size: 12.5px; color: var(--faint); margin-bottom: 6px; }
  .evidence pre { margin: 0; padding: 10px 12px; background: var(--ground); border: 1px solid var(--rule-soft); font: 400 12.5px/1.6 var(--mono); overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 190px; }

  .attest { padding: 0 18px 4px; }
  .attest .box { background: var(--observation-bg); border: 1px solid var(--rule); border-left: 3px solid var(--observation); padding: 14px 16px; }
  .attest label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
  .attest .dates { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .attest input[type=date], .attest textarea, .attest input[type=text] {
    font: 400 14px var(--sans); padding: 7px 9px; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); width: 100%;
  }
  .attest .dates > div { flex: 1 1 150px; }
  .attest textarea { min-height: 62px; resize: vertical; }
  .attest .verdict { font-size: 13px; margin-top: 7px; min-height: 18px; }
  .attest .verdict.no { color: var(--bad); }
  .attest .verdict.yes { color: var(--ok); }

  .actions { padding: 14px 18px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .btn { border: 1px solid var(--ink); background: var(--ink); color: #fff; padding: 8px 15px; cursor: pointer; font-weight: 500; font-size: 14px; }
  .btn.ghost { background: transparent; color: var(--soft); border-color: var(--rule); }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btn:focus-visible, .wf:focus-visible, .tabs button:focus-visible { outline: 2px solid var(--intent); outline-offset: 2px; }

  .refusal { margin: 0 18px 16px; background: var(--bad-bg); border: 1px solid var(--rule); border-left: 3px solid var(--bad); padding: 12px 15px; font-size: 14px; }
  .refusal[hidden] { display: none; }

  .empty { background: var(--panel); border: 1px solid var(--rule); padding: 30px 24px; color: var(--soft); }
  .empty b { color: var(--ink); }

  table.led { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--rule); font-size: 13.5px; }
  table.led th, table.led td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  table.led th { font-weight: 600; color: var(--faint); font-size: 12.5px; }
  table.led td.k { font-family: var(--mono); font-size: 12px; color: var(--soft); white-space: nowrap; }
  .chainok { font-size: 13.5px; margin-bottom: 12px; }
  .chainok.ok { color: var(--ok); }
  .chainok.bad { color: var(--bad); }
</style>
</head>
<body>

<header>
  <div class="mark">silent<i>green</i></div>
  <div class="meta" id="hmeta">reading store</div>
  <div class="who">
    <label for="who">confirming as</label>
    <input id="who" type="text" placeholder="your name or email" autocomplete="email">
  </div>
</header>

<div class="layout">
  <aside>
    <h2>Workflows</h2>
    <div id="wflist"></div>
  </aside>
  <main>
    <h1 id="title">&nbsp;</h1>
    <p class="sub" id="subtitle">&nbsp;</p>
    <div class="honesty" id="honesty"></div>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="queue" aria-selected="true">Review queue</button>
      <button role="tab" data-tab="live" aria-selected="false">Live checks</button>
      <button role="tab" data-tab="stale" aria-selected="false">Stale</button>
      <button role="tab" data-tab="history" aria-selected="false">History</button>
    </div>
    <div id="body"></div>
  </main>
</div>

<script>
(function () {
  var S = null, current = null, tab = 'queue';
  var whoEl = document.getElementById('who');
  whoEl.value = localStorage.getItem('sg.who') || '';
  whoEl.addEventListener('input', function () { localStorage.setItem('sg.who', whoEl.value); render(); });

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      .then(function (r) { return r.json(); });
  }
  function load() {
    return api('/api/state').then(function (s) {
      S = s;
      if (!current || !S.workflows.some(function (w) { return w.id === current; })) {
        current = S.workflows.length ? S.workflows[0].id : null;
      }
      render();
    });
  }

  function wf() { return S.workflows.filter(function (w) { return w.id === current; })[0]; }
  function forWf(status) {
    return S.assertions.filter(function (a) { return a.workflowId === current && (status ? a.status === status : true); });
  }

  function renderSidebar() {
    var el = document.getElementById('wflist');
    if (!S.workflows.length) { el.innerHTML = '<div style="padding:16px;color:var(--faint);font-size:13.5px">Nothing scanned yet.</div>'; return; }
    el.innerHTML = S.workflows.map(function (w) {
      var c = w.counts;
      return '<button class="wf" data-id="' + esc(w.id) + '" aria-current="' + (w.id === current) + '">' +
        '<div class="n">' + esc(w.name) + '</div>' +
        '<div class="c">' + c.proposed + ' to review · ' + c.confirmed + ' live' + (c.stale ? ' · ' + c.stale + ' stale' : '') + '</div>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.wf'), function (b) {
      b.addEventListener('click', function () { current = b.dataset.id; render(); });
    });
  }

  function proposalCard(a, w) {
    var sink = (w.sinkNames && w.sinkNames[a.sinkId]) || a.sinkId;
    var samples = (w.samples && w.samples[a.sinkId]) || [];
    var evid = samples.length
      ? '<div class="evidence"><div class="k">Real values this will be judging, captured from ' + esc(w.sampleRunIds.length) + ' recent run(s)</div><pre>' +
        esc(samples.map(function (s) { return JSON.stringify(s, null, 2); }).join('\n\n')) + '</pre></div>'
      : '<div class="evidence"><div class="k">No captured output was retained for this step, so there is nothing to show you. Confirming without seeing what it judges is exactly the habit this screen exists to interrupt.</div></div>';

    // Prefill the window this was actually learned from. The reviewer is being
    // asked whether that period was good, so making them look it up first is
    // friction that teaches people to click past the only question that matters.
    var win = w.observedWindow || {};
    var ds = (win.start || '').slice(0, 10);
    var de = (win.end || '').slice(0, 10);

    var attest = a.needsAttestation
      ? '<div class="attest"><div class="box">' +
          '<label>This expectation was learned from what the workflow has been doing between ' +
            esc(ds || 'an unknown date') + ' and ' + esc(de || 'an unknown date') +
            '. On its own that proves only that it has not changed. Do you believe that period was actually correct?</label>' +
          '<div class="dates">' +
            '<div><label for="ws-' + a.id + '">from</label><input type="date" id="ws-' + a.id + '" value="' + esc(ds) + '"></div>' +
            '<div><label for="we-' + a.id + '">to</label><input type="date" id="we-' + a.id + '" value="' + esc(de) + '"></div>' +
          '</div>' +
          '<label for="hk-' + a.id + '">and how do you know it was correct?</label>' +
          '<textarea id="hk-' + a.id + '" placeholder="Reconciled against the client invoice export for August"></textarea>' +
          '<div class="verdict" id="v-' + a.id + '"></div>' +
        '</div></div>'
      : '';

    return '<div class="card" data-a="' + a.id + '">' +
      '<div class="card-head">' +
        '<span class="chip ' + a.basis + '">' + a.basis + '</span>' +
        '<h3>' + esc(a.statement) + '</h3>' +
        '<p class="sink">at ' + esc(sink) + ' · ' + esc(a.kind) + ' · confidence ' + esc(a.confidence) + '</p>' +
        '<p class="why">' + esc(a.rationale) + '</p>' +
      '</div>' +
      '<div class="proves">' +
        '<div class="yes"><span class="k">A green result here proves</span>' + esc(a.proves) + '</div>' +
        '<div class="no"><span class="k">It does not prove</span>' + esc(a.doesNotProve) + '</div>' +
      '</div>' +
      evid + attest +
      '<div class="refusal" id="r-' + a.id + '" hidden></div>' +
      '<div class="actions">' +
        '<button class="btn" data-confirm="' + a.id + '">Confirm this expectation</button>' +
        '<button class="btn ghost" data-retire="' + a.id + '">Not this one</button>' +
      '</div>' +
    '</div>';
  }

  function renderQueue() {
    var w = wf(), list = forWf('proposed');
    if (!list.length) {
      return '<div class="empty"><b>Nothing waiting.</b><br>Run <code>silentgreen scan</code> to look for new expectations, or check the live tab for what is already running.</div>';
    }
    return list.map(function (a) { return proposalCard(a, w); }).join('');
  }

  function renderLive() {
    var list = forWf('confirmed'), w = wf();
    if (!list.length) return '<div class="empty"><b>No live checks.</b><br>Until something here is confirmed, every verdict on this workflow reads as unproven, which is the honest answer rather than a failure.</div>';
    return list.map(function (a) {
      var sink = (w.sinkNames && w.sinkNames[a.sinkId]) || a.sinkId;
      return '<div class="card"><div class="card-head">' +
        '<span class="chip conf">live</span> <span class="chip ' + a.basis + '">' + a.basis + '</span>' +
        '<h3>' + esc(a.statement) + '</h3>' +
        '<p class="sink">at ' + esc(sink) + ' · confirmed by ' + esc(a.confirmation ? a.confirmation.by : '?') +
          ' on ' + esc(a.confirmation ? a.confirmation.at.slice(0, 10) : '') + '</p>' +
        (a.confirmation && a.confirmation.attestation
          ? '<p class="why"><strong>Baseline attested:</strong> ' + esc(a.confirmation.attestation) + '</p>'
          : '') +
        '</div><div class="actions"><button class="btn ghost" data-retire="' + a.id + '">Retire this check</button></div></div>';
    }).join('');
  }

  function renderStale() {
    var list = forWf('stale');
    if (!list.length) return '<div class="empty"><b>Nothing stale.</b><br>Every confirmed check still matches the workflow revision it was confirmed against.</div>';
    return '<div class="honesty">These were confirmed against an earlier revision of this workflow, so they no longer describe what runs. They report as unproven rather than continuing to report green. Re-read each one against the current graph and confirm it again.</div>' +
      list.map(function (a) {
        return '<div class="card"><div class="card-head">' +
          '<span class="chip stale">stale</span> <span class="chip ' + a.basis + '">' + a.basis + '</span>' +
          '<h3>' + esc(a.statement) + '</h3>' +
          '<p class="sink">went stale ' + esc(a.stale ? a.stale.since.slice(0, 10) : '') +
          ', when the workflow moved from ' + esc(a.stale ? a.stale.fromHash.slice(0, 10) : '') + ' to ' + esc(a.stale ? a.stale.toHash.slice(0, 10) : '') + '</p>' +
          '</div><div class="actions"><button class="btn" data-reconfirm="' + a.id + '">Re-read and confirm</button>' +
          '<button class="btn ghost" data-retire="' + a.id + '">Retire it</button></div></div>';
      }).join('');
  }

  function renderHistory() {
    return '<div id="ledger"><div class="empty">Loading the evidence log.</div></div>';
  }

  function loadHistory() {
    api('/api/ledger?workflow=' + encodeURIComponent(current)).then(function (d) {
      var el = document.getElementById('ledger');
      if (!el) return;
      var ok = d.verify && d.verify.ok;
      var head = '<div class="chainok ' + (ok ? 'ok' : 'bad') + '">' +
        (ok ? 'Chain verified: ' + d.entries.length + ' entries, each committing to the one before it.'
            : 'Chain does not verify: ' + esc(d.verify.reason)) + '</div>';
      if (!d.entries.length) { el.innerHTML = head + '<div class="empty">Nothing recorded for this workflow yet.</div>'; return; }
      el.innerHTML = head + '<table class="led"><thead><tr><th>when</th><th>what</th><th>detail</th></tr></thead><tbody>' +
        d.entries.slice().reverse().map(function (e) {
          var detail = e.payload.statement || e.payload.changes || e.payload.reason || e.payload.detail || JSON.stringify(e.payload);
          if (Array.isArray(detail)) detail = detail.join(' ');
          return '<tr><td class="k">' + esc(e.at.slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(e.kind) + '</td><td>' + esc(String(detail).slice(0, 240)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
  }

  function render() {
    if (!S) return;
    document.getElementById('hmeta').textContent =
      S.ledgerLength + ' ledger entries · chain ' + (S.ledgerOk ? 'intact' : 'BROKEN');
    renderSidebar();
    var w = wf();
    if (!w) {
      document.getElementById('title').textContent = 'Nothing scanned yet';
      document.getElementById('subtitle').textContent = 'Run silentgreen scan against an n8n instance to populate this.';
      document.getElementById('honesty').textContent = '';
      document.getElementById('body').innerHTML = '';
      return;
    }
    document.getElementById('title').textContent = w.name;
    document.getElementById('subtitle').textContent =
      'revision ' + w.shortHash + ' · ' + (w.active ? 'active' : 'inactive') + ' · last scanned ' + w.lastScannedAt.slice(0, 16).replace('T', ' ');
    document.getElementById('honesty').textContent = w.honesty.sentence;

    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });

    var body = document.getElementById('body');
    body.innerHTML = tab === 'queue' ? renderQueue()
      : tab === 'live' ? renderLive()
      : tab === 'stale' ? renderStale()
      : renderHistory();

    if (tab === 'history') loadHistory();
    wire();
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-confirm], [data-reconfirm]'), function (b) {
      b.addEventListener('click', function () { doConfirm(b.dataset.confirm || b.dataset.reconfirm); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-retire]'), function (b) {
      b.addEventListener('click', function () {
        var why = prompt('Why is this one not worth checking? Recorded in the evidence log.');
        if (why === null) return;
        api('/api/retire', { assertionId: b.dataset.retire, by: whoEl.value, why: why }).then(load);
      });
    });
    // Live feedback on the attestation, decided by the same function the gate uses.
    Array.prototype.forEach.call(document.querySelectorAll('textarea[id^="hk-"]'), function (t) {
      var id = t.id.slice(3);
      var timer = null;
      t.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          api('/api/attestation-check', { howKnown: t.value }).then(function (r) {
            var v = document.getElementById('v-' + id);
            if (!v) return;
            if (!t.value.trim()) { v.textContent = ''; v.className = 'verdict'; return; }
            v.className = 'verdict ' + (r.substantive ? 'yes' : 'no');
            v.textContent = r.substantive
              ? 'That will be accepted, and printed in the report beside every result this check produces.'
              : r.hint;
          });
        }, 260);
      });
    });
  }

  function doConfirm(id) {
    var by = whoEl.value.trim();
    var box = document.getElementById('r-' + id);
    if (!by) {
      if (box) { box.hidden = false; box.textContent = 'Put your name in the box at the top right first. A confirmation records who took responsibility for it, and that name appears in the client report beside the result it produces.'; }
      whoEl.focus();
      return;
    }
    var a = S.assertions.filter(function (x) { return x.id === id; })[0];
    var payload = { assertionId: id, by: by };
    if (a && a.needsAttestation) {
      payload.attestation = {
        windowStart: (document.getElementById('ws-' + id) || {}).value || '',
        windowEnd: (document.getElementById('we-' + id) || {}).value || '',
        howKnown: (document.getElementById('hk-' + id) || {}).value || ''
      };
      // A window whose start and end fall on the same day is still a real
      // window, so treat it as that whole day rather than rejecting it on a
      // technicality the reviewer cannot see.
      if (payload.attestation.windowStart) payload.attestation.windowStart += 'T00:00:00.000Z';
      if (payload.attestation.windowEnd) payload.attestation.windowEnd += 'T23:59:59.000Z';
    }
    api('/api/confirm', payload).then(function (r) {
      if (r.ok) { load(); return; }
      if (box) { box.hidden = false; box.textContent = (r.refusal && r.refusal.message) || r.error || 'Refused.'; }
      // The server's answer is the authoritative one. Clear the advisory hint so
      // the reviewer is not reading two near-identical red paragraphs.
      var v = document.getElementById('v-' + id);
      if (v) { v.textContent = ''; v.className = 'verdict'; }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () { tab = b.dataset.tab; render(); });
  });

  load();
})();
</script>
</body>
</html>`;
