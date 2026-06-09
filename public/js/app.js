'use strict';

/* ============================================================
   Application: routing, views and editing.
   Views: #tree  #people  #history  #person/<id>
   ============================================================ */

const App = (() => {
  let db = null;                  // {meta, history, persons, unions}
  let auth = { required: false, authed: true };
  let treeRootId = null;

  const $ = (sel, parent) => (parent || document).querySelector(sel);
  const view = () => $('#view');

  // ---------- small utilities ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2600);
  }

  async function guard(fn) {
    try {
      await fn();
    } catch (e) {
      if (e.status === 401) {
        toast('Please sign in to make changes.', true);
        showLogin();
      } else {
        toast(e.message, true);
      }
    }
  }

  function canEdit() { return !auth.required || auth.authed; }

  // Very small markdown renderer for the history page and biographies.
  function renderMarkdown(text) {
    const lines = String(text || '').split('\n');
    const out = [];
    let inList = false;
    const inline = (s) => esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    for (const raw of lines) {
      const line = raw.trimEnd();
      const isList = /^[-*] /.test(line.trim());
      if (inList && !isList) { out.push('</ul>'); inList = false; }
      if (/^### /.test(line)) out.push('<h3>' + inline(line.slice(4)) + '</h3>');
      else if (/^## /.test(line)) out.push('<h2>' + inline(line.slice(3)) + '</h2>');
      else if (/^# /.test(line)) out.push('<h1>' + inline(line.slice(2)) + '</h1>');
      else if (/^---+$/.test(line.trim())) out.push('<hr>');
      else if (/^> /.test(line)) out.push('<blockquote>' + inline(line.slice(2)) + '</blockquote>');
      else if (isList) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(line.trim().slice(2)) + '</li>');
      }
      else if (line.trim() === '') out.push('');
      else out.push('<p>' + inline(line) + '</p>');
    }
    if (inList) out.push('</ul>');
    return out.join('\n');
  }

  function chipPhoto(p, cls) {
    if (p.photo) return `<img class="${cls}" src="${esc(p.photo)}" alt="">`;
    return `<span class="${cls}" style="background:${p.gender === 'F' ? '#7b4a62' : '#3e5e3a'}">${esc(Tree.initials(p.name))}</span>`;
  }

  function branches() {
    const set = new Set();
    for (const p of Object.values(db.persons)) if (p.branch) set.add(p.branch);
    return [...set].sort();
  }

  // ---------- modal helper ----------

  function openModal(title, bodyHtml, buttons) {
    const root = $('#modal-root');
    root.innerHTML = '';
    const d = document.createElement('dialog');
    d.innerHTML = `
      <div class="modal-head">${esc(title)}</div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>`;
    $('.modal-body', d).innerHTML = bodyHtml;
    const foot = $('.modal-foot', d);
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.kind || '');
      btn.textContent = b.label;
      btn.addEventListener('click', async () => {
        if (b.onClick) {
          const keepOpen = await b.onClick(d);
          if (keepOpen === true) return;
        }
        d.close();
      });
      foot.appendChild(btn);
    }
    d.addEventListener('close', () => root.innerHTML = '');
    root.appendChild(d);
    d.showModal();
    return d;
  }

  function confirmModal(title, message, onYes) {
    openModal(title, `<p style="font-size:1.1rem">${esc(message)}</p>`, [
      { label: 'Cancel' },
      { label: 'Yes, continue', kind: 'btn-danger', onClick: () => guard(onYes) }
    ]);
  }

  // ---------- person form ----------

  function personFormHtml(p) {
    p = p || {};
    const branchOpts = branches().map(b => `<option value="${esc(b)}">`).join('');
    return `
      <div class="field">
        <label>Full name *</label>
        <input name="name" value="${esc(p.name)}" required autocomplete="off">
      </div>
      <div class="field">
        <label>Name in Malayalam (optional)</label>
        <input name="malayalamName" value="${esc(p.malayalamName)}" autocomplete="off">
      </div>
      <div class="field-pair">
        <div class="field">
          <label>Gender</label>
          <select name="gender">
            <option value="" ${!p.gender ? 'selected' : ''}>—</option>
            <option value="M" ${p.gender === 'M' ? 'selected' : ''}>Male</option>
            <option value="F" ${p.gender === 'F' ? 'selected' : ''}>Female</option>
          </select>
        </div>
        <div class="field">
          <label>Family branch</label>
          <input name="branch" value="${esc(p.branch)}" list="branch-list" autocomplete="off">
          <datalist id="branch-list">${branchOpts}</datalist>
        </div>
      </div>
      <div class="field-pair">
        <div class="field">
          <label>Born (any form: 1932, “c. 1880”, 12 May 1951)</label>
          <input name="birthDate" value="${esc(p.birthDate)}" autocomplete="off">
        </div>
        <div class="field">
          <label>Place of birth</label>
          <input name="birthPlace" value="${esc(p.birthPlace)}" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label><input type="checkbox" name="deceased" ${p.living === false ? 'checked' : ''} style="width:auto"> No longer living</label>
      </div>
      <div class="field-pair">
        <div class="field">
          <label>Died (date)</label>
          <input name="deathDate" value="${esc(p.deathDate)}" autocomplete="off">
        </div>
        <div class="field">
          <label>Place of death</label>
          <input name="deathPlace" value="${esc(p.deathPlace)}" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>Occupation / profession</label>
        <input name="occupation" value="${esc(p.occupation)}" autocomplete="off">
      </div>
      <div class="field">
        <label>Education</label>
        <input name="education" value="${esc(p.education)}" autocomplete="off">
      </div>
      <div class="field">
        <label>Life story (the person’s biography — write freely)</label>
        <textarea name="bio">${esc(p.bio)}</textarea>
        <div class="hint">You can use **bold**, *italics* and lists starting with "- ".</div>
      </div>
      <div class="field">
        <label>Private notes (sources, things to verify…)</label>
        <textarea name="notes" style="min-height:4rem">${esc(p.notes)}</textarea>
      </div>`;
  }

  function readPersonForm(d) {
    const get = (n) => { const e = d.querySelector(`[name="${n}"]`); return e ? e.value.trim() : ''; };
    const name = get('name');
    if (!name) { toast('Please enter a name.', true); return null; }
    return {
      name, malayalamName: get('malayalamName'), gender: get('gender'),
      branch: get('branch'), birthDate: get('birthDate'), birthPlace: get('birthPlace'),
      deathDate: get('deathDate'), deathPlace: get('deathPlace'),
      occupation: get('occupation'), education: get('education'),
      bio: get('bio'), notes: get('notes'),
      living: !d.querySelector('[name="deceased"]').checked
    };
  }

  function editPersonModal(personId) {
    const p = db.persons[personId];
    openModal('Edit — ' + p.name, personFormHtml(p), [
      { label: 'Cancel' },
      {
        label: 'Save changes', kind: 'btn-primary',
        onClick: async (d) => {
          const data = readPersonForm(d);
          if (!data) return true;
          await guard(async () => {
            await API.updatePerson(personId, data);
            await reload();
            toast('Saved.');
          });
        }
      }
    ]);
  }

  // ---------- add-relation flows ----------

  // kind: 'child' | 'spouse' | 'parent'
  function addRelativeModal(personId, kind) {
    const p = db.persons[personId];
    const titles = {
      child: 'Add a child of ' + p.name,
      spouse: 'Add husband / wife of ' + p.name,
      parent: 'Add a parent of ' + p.name
    };

    const myUnions = Tree.unionsOf(db, personId);
    let unionPicker = '';
    if (kind === 'child' && myUnions.length > 1) {
      const opts = myUnions.map(u => {
        const other = u.partner1 === personId ? u.partner2 : u.partner1;
        const label = other && db.persons[other] ? 'With ' + db.persons[other].name : 'Other parent not recorded';
        return `<option value="${esc(u.id)}">${esc(label)}</option>`;
      }).join('');
      unionPicker = `<div class="field"><label>Child of which marriage?</label><select name="union">${opts}</select></div>`;
    }

    const existingOptions = Object.values(db.persons)
      .filter(x => x.id !== personId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.birthDate ? ' (b. ' + esc(x.birthDate) + ')' : ''}</option>`)
      .join('');

    const body = `
      <div class="choice-tabs">
        <button type="button" data-tab="new" class="active">New person</button>
        <button type="button" data-tab="existing">Someone already in the tree</button>
      </div>
      ${unionPicker}
      <div data-pane="new">${personFormHtml({ branch: p.branch })}</div>
      <div data-pane="existing" hidden>
        <div class="field">
          <label>Choose the person</label>
          <select name="existingId" size="8" style="height:auto">${existingOptions}</select>
        </div>
      </div>`;

    const d = openModal(titles[kind], body, [
      { label: 'Cancel' },
      {
        label: 'Add to the family', kind: 'btn-primary',
        onClick: async (dialog) => {
          const tab = dialog.querySelector('.choice-tabs .active').dataset.tab;
          let otherId = null;
          let created = null;
          if (tab === 'existing') {
            const sel = dialog.querySelector('[name="existingId"]');
            otherId = sel && sel.value;
            if (!otherId) { toast('Please choose a person from the list.', true); return true; }
          } else {
            const data = readPersonForm(dialog);
            if (!data) return true;
            created = data;
          }
          let keepOpen = false;
          await guard(async () => {
            if (created) {
              const np = await API.createPerson(created);
              otherId = np.id;
            }
            await linkRelative(personId, otherId, kind, dialog);
            await reload();
            toast('Added.');
          });
          return keepOpen;
        }
      }
    ]);

    d.querySelectorAll('.choice-tabs button').forEach(b => {
      b.addEventListener('click', () => {
        d.querySelectorAll('.choice-tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        d.querySelector('[data-pane="new"]').hidden = b.dataset.tab !== 'new';
        d.querySelector('[data-pane="existing"]').hidden = b.dataset.tab !== 'existing';
      });
    });
  }

  async function linkRelative(personId, otherId, kind, dialog) {
    if (kind === 'spouse') {
      // reuse a partnerless union if one exists
      const empty = Tree.unionsOf(db, personId).find(u => !(u.partner1 && u.partner2));
      if (empty) {
        await API.updateUnion(empty.id, empty.partner1 === personId ? { partner2: otherId } : { partner1: otherId });
      } else {
        await API.createUnion({ partner1: personId, partner2: otherId });
      }
    } else if (kind === 'child') {
      let unionId = null;
      const sel = dialog && dialog.querySelector('[name="union"]');
      if (sel) unionId = sel.value;
      else {
        const myUnions = Tree.unionsOf(db, personId);
        if (myUnions.length === 1) unionId = myUnions[0].id;
      }
      if (!unionId) {
        const u = await API.createUnion({ partner1: personId });
        unionId = u.id;
      }
      await API.addChild(unionId, otherId);
    } else if (kind === 'parent') {
      const parentUnions = Tree.parentUnionsOf(db, personId);
      const open = parentUnions.find(u => !(u.partner1 && u.partner2));
      if (open) {
        await API.updateUnion(open.id, open.partner1 ? { partner2: otherId } : { partner1: otherId });
      } else if (parentUnions.length === 0) {
        const u = await API.createUnion({ partner1: otherId });
        await API.addChild(u.id, personId);
      } else {
        // both parents already recorded — make an additional parent union
        const u = await API.createUnion({ partner1: otherId });
        await API.addChild(u.id, personId);
      }
    }
  }

  // ---------- views ----------

  function setActiveNav(name) {
    document.querySelectorAll('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.nav === name);
    });
  }

  function renderTreeView(focusId) {
    setActiveNav('tree');
    const people = Object.values(db.persons);
    if (!people.length) {
      view().innerHTML = `
        <div class="tree-empty view-pad">
          <h2>The book is open, the first page is empty.</h2>
          <p>Begin the family record by adding the first person.</p>
          <button class="btn btn-primary btn-big" id="first-person-btn">+ Add the first person</button>
        </div>`;
      $('#first-person-btn').addEventListener('click', () => addFirstPersonModal());
      return;
    }

    if (!treeRootId || !db.persons[treeRootId]) {
      treeRootId = (db.meta.rootId && db.persons[db.meta.rootId]) ? db.meta.rootId : Tree.autoRoot(db);
    }

    const rootOptions = people
      .filter(p => Tree.parentsOf(db, p.id).length === 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => `<option value="${esc(p.id)}" ${p.id === treeRootId ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');

    view().innerHTML = `
      <div class="tree-wrap">
        <div class="tree-toolbar">
          <label for="root-select">Tree begins with:</label>
          <select id="root-select" class="tree-root-select">${rootOptions}</select>
          <span class="spacer"></span>
          ${canEdit() ? '<button class="btn" id="add-person-btn">+ Add a person</button>' : ''}
          <button class="btn btn-quiet" id="zoom-in" title="Zoom in">＋</button>
          <button class="btn btn-quiet" id="zoom-out" title="Zoom out">－</button>
          <button class="btn btn-quiet" id="zoom-fit">Fit to screen</button>
        </div>
        <div id="tree-svg-holder"></div>
      </div>`;

    const holder = $('#tree-svg-holder');
    const svg = Tree.render(holder, db, treeRootId, focusId || null, (id) => { location.hash = '#person/' + id; });

    const sel = $('#root-select');
    if (!sel.querySelector(`option[value="${treeRootId}"]`)) {
      const cur = db.persons[treeRootId];
      sel.insertAdjacentHTML('afterbegin', `<option value="${esc(treeRootId)}" selected>${esc(cur.name)}</option>`);
    }
    sel.addEventListener('change', () => { treeRootId = sel.value; renderTreeView(); });
    $('#zoom-in').addEventListener('click', () => svg && svg._zoomIn());
    $('#zoom-out').addEventListener('click', () => svg && svg._zoomOut());
    $('#zoom-fit').addEventListener('click', () => svg && svg._fit());
    const addBtn = $('#add-person-btn');
    if (addBtn) addBtn.addEventListener('click', () => addFirstPersonModal());
  }

  function addFirstPersonModal() {
    openModal('Add a person', personFormHtml({}), [
      { label: 'Cancel' },
      {
        label: 'Add to the family', kind: 'btn-primary',
        onClick: async (d) => {
          const data = readPersonForm(d);
          if (!data) return true;
          await guard(async () => {
            const np = await API.createPerson(data);
            await reload();
            location.hash = '#person/' + np.id;
            toast('Added. Now you can connect them to parents, spouse or children.');
          });
        }
      }
    ]);
  }

  function relChip(pid, sub) {
    const p = db.persons[pid];
    if (!p) return '';
    return `
      <a class="rel-chip" href="#person/${esc(pid)}">
        ${chipPhoto(p, 'chip-photo')}
        <span><strong>${esc(p.name)}</strong>
        <span class="chip-sub">${esc(sub || Tree.yearsLine(p))}</span></span>
      </a>`;
  }

  function renderPersonView(personId) {
    setActiveNav(null);
    const p = db.persons[personId];
    if (!p) { view().innerHTML = '<div class="view-pad"><p>This person was not found.</p></div>'; return; }

    const parentIds = Tree.parentsOf(db, personId);
    const myUnions = Tree.unionsOf(db, personId);
    const siblings = [];
    for (const u of Tree.parentUnionsOf(db, personId)) {
      for (const c of u.children) if (c !== personId && db.persons[c] && !siblings.includes(c)) siblings.push(c);
    }

    const spousesHtml = myUnions.map(u => {
      const other = u.partner1 === personId ? u.partner2 : u.partner1;
      const note = [u.marriageDate && ('married ' + u.marriageDate), u.marriagePlace].filter(Boolean).join(', ');
      const kids = u.children.filter(c => db.persons[c]);
      return `
        <div class="union-block">
          ${other && db.persons[other] ? relChip(other, note || undefined) : '<span class="rel-none">Spouse not recorded</span>'}
          ${note && !(other && db.persons[other]) ? `<div class="marriage-note">${esc(note)}</div>` : ''}
          ${kids.length ? `<div class="marriage-note">Children: ${kids.map(c => esc(db.persons[c].name)).join(', ')}</div>` : ''}
        </div>`;
    }).join('') || '<span class="rel-none">No marriage recorded</span>';

    const childIds = [];
    for (const u of myUnions) for (const c of u.children) if (db.persons[c] && !childIds.includes(c)) childIds.push(c);

    const dates = Tree.yearsLine(p);
    const detail = (label, val) => val ? `<div class="detail-row"><dt>${esc(label)}</dt><dd>${esc(val)}</dd></div>` : '';

    view().innerHTML = `
      <div class="person-page">
        <p><a href="#tree">← Back to the family tree</a></p>
        <div class="person-head">
          ${p.photo
            ? `<img class="portrait" src="${esc(p.photo)}" alt="Photo of ${esc(p.name)}">`
            : `<div class="portrait portrait-placeholder" style="background:${p.gender === 'F' ? '#7b4a62' : '#3e5e3a'}">${esc(Tree.initials(p.name))}</div>`}
          <div>
            <h2>${esc(p.name)}</h2>
            ${p.malayalamName ? `<p class="person-malayalam">${esc(p.malayalamName)}</p>` : ''}
            ${dates ? `<p class="person-dates">${esc(dates)}</p>` : ''}
            ${p.branch ? `<span class="person-branch">${esc(p.branch)} branch</span>` : ''}
          </div>
        </div>

        ${canEdit() ? `
        <div class="person-actions">
          <button class="btn btn-primary" id="pa-edit">✎ Edit details</button>
          <button class="btn" id="pa-photo">📷 ${p.photo ? 'Change photo' : 'Add photo'}</button>
          <button class="btn" id="pa-add-parent">+ Add parent</button>
          <button class="btn" id="pa-add-spouse">+ Add husband / wife</button>
          <button class="btn" id="pa-add-child">+ Add child</button>
          <button class="btn" id="pa-show-tree">🌳 Show their tree</button>
          <button class="btn btn-danger" id="pa-delete">Remove…</button>
          <input type="file" id="pa-photo-file" accept="image/*" hidden>
        </div>` : `
        <div class="person-actions">
          <button class="btn" id="pa-show-tree">🌳 Show their tree</button>
        </div>`}

        <dl class="detail-grid">
          ${detail('Born', [p.birthDate, p.birthPlace].filter(Boolean).join(' — '))}
          ${detail('Died', [p.deathDate, p.deathPlace].filter(Boolean).join(' — '))}
          ${detail('Occupation', p.occupation)}
          ${detail('Education', p.education)}
        </dl>

        ${p.bio ? `<div class="bio-block"><h3>Life story</h3>${renderMarkdown(p.bio)}</div>` : ''}
        ${p.notes && canEdit() ? `<div class="bio-block" style="border-left-color:#9b8a64"><h3>Notes</h3>${renderMarkdown(p.notes)}</div>` : ''}

        <div class="relatives">
          <h3>Parents</h3>
          <div class="rel-list">${parentIds.length ? parentIds.map(id => relChip(id)).join('') : '<span class="rel-none">Not recorded yet</span>'}</div>
        </div>
        <div class="relatives">
          <h3>Marriage${myUnions.length > 1 ? 's' : ''}</h3>
          <div class="rel-list" style="flex-direction:column; align-items:flex-start">${spousesHtml}</div>
        </div>
        <div class="relatives">
          <h3>Children</h3>
          <div class="rel-list">${childIds.length ? childIds.map(id => relChip(id)).join('') : '<span class="rel-none">Not recorded yet</span>'}</div>
        </div>
        <div class="relatives">
          <h3>Brothers &amp; sisters</h3>
          <div class="rel-list">${siblings.length ? siblings.map(id => relChip(id)).join('') : '<span class="rel-none">Not recorded yet</span>'}</div>
        </div>
      </div>`;

    $('#pa-show-tree').addEventListener('click', () => {
      // show the tree from this person's earliest known ancestor, focused on them
      let cur = personId, hops = 0;
      while (hops++ < 50) {
        const parents = Tree.parentsOf(db, cur);
        if (!parents.length) break;
        cur = parents[0];
      }
      treeRootId = cur;
      location.hash = '#tree';
      setTimeout(() => renderTreeView(personId), 0);
    });

    if (!canEdit()) return;

    $('#pa-edit').addEventListener('click', () => editPersonModal(personId));
    $('#pa-add-parent').addEventListener('click', () => addRelativeModal(personId, 'parent'));
    $('#pa-add-spouse').addEventListener('click', () => addRelativeModal(personId, 'spouse'));
    $('#pa-add-child').addEventListener('click', () => addRelativeModal(personId, 'child'));
    $('#pa-photo').addEventListener('click', () => $('#pa-photo-file').click());
    $('#pa-photo-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await guard(async () => {
        await API.uploadPhoto(personId, file);
        await reload();
        toast('Photo saved.');
      });
    });
    $('#pa-delete').addEventListener('click', () => {
      confirmModal('Remove ' + p.name + '?',
        'This removes the person and their links from the family record. It cannot be undone (except from a backup). Are you sure?',
        async () => {
          await API.deletePerson(personId);
          await reload();
          location.hash = '#people';
          toast('Removed.');
        });
    });
  }

  function renderPeopleView() {
    setActiveNav('people');
    const branchOpts = branches().map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    view().innerHTML = `
      <div class="view-pad">
        <h2>Everyone in the family record</h2>
        <div class="people-controls">
          <input id="people-filter" type="search" placeholder="Type a name…" aria-label="Filter by name">
          <select id="branch-filter">
            <option value="">All branches</option>${branchOpts}
          </select>
          ${canEdit() ? '<button class="btn btn-primary" id="people-add">+ Add a person</button>' : ''}
        </div>
        <div id="people-list-holder"></div>
      </div>`;

    function draw() {
      const q = $('#people-filter').value.trim().toLowerCase();
      const br = $('#branch-filter').value;
      const people = Object.values(db.persons)
        .filter(p => (!q || p.name.toLowerCase().includes(q) || (p.malayalamName || '').toLowerCase().includes(q)))
        .filter(p => (!br || p.branch === br))
        .sort((a, b) => a.name.localeCompare(b.name));

      let html = '';
      let letter = '';
      for (const p of people) {
        const L = (p.name[0] || '').toUpperCase();
        if (L !== letter) { letter = L; html += `<div class="letter-head">${esc(L)}</div><ul class="people-list">`; }
        const sub = [Tree.yearsLine(p), p.occupation, p.branch && (p.branch + ' branch')].filter(Boolean).join(' · ');
        html += `<li><a class="person-row" href="#person/${esc(p.id)}">
            ${chipPhoto(p, 'chip-photo')}
            <span><span class="row-name">${esc(p.name)}</span><br><span class="row-sub">${esc(sub)}</span></span>
          </a></li>`;
      }
      $('#people-list-holder').innerHTML = html || '<p class="rel-none">No one matches.</p>';
    }

    $('#people-filter').addEventListener('input', draw);
    $('#branch-filter').addEventListener('change', draw);
    const add = $('#people-add');
    if (add) add.addEventListener('click', () => addFirstPersonModal());
    draw();
  }

  function renderHistoryView() {
    setActiveNav('history');
    view().innerHTML = `
      <div class="view-pad">
        ${canEdit() ? '<div style="text-align:right"><button class="btn" id="history-edit">✎ Edit this page</button></div>' : ''}
        <div class="history-paper" id="history-content">${renderMarkdown(db.history)}</div>
      </div>`;
    const btn = $('#history-edit');
    if (btn) btn.addEventListener('click', () => {
      view().innerHTML = `
        <div class="view-pad">
          <h2>Edit the family history</h2>
          <p class="rel-none">Headings start with “# ”, sub-headings with “## ”. Use **bold**, *italics*, and lists starting with “- ”.</p>
          <textarea id="history-editor">${esc(db.history)}</textarea>
          <div style="margin-top:.8rem; display:flex; gap:.6rem">
            <button class="btn btn-primary btn-big" id="history-save">Save the page</button>
            <button class="btn" id="history-cancel">Cancel</button>
          </div>
        </div>`;
      $('#history-save').addEventListener('click', () => guard(async () => {
        await API.saveHistory($('#history-editor').value);
        await reload();
        renderHistoryView();
        toast('History saved.');
      }));
      $('#history-cancel').addEventListener('click', renderHistoryView);
    });
  }

  // ---------- search ----------

  function setupSearch() {
    const input = $('#search-input');
    const results = $('#search-results');
    function close() { results.hidden = true; results.innerHTML = ''; }
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      const matches = Object.values(db.persons)
        .filter(p => p.name.toLowerCase().includes(q) || (p.malayalamName || '').toLowerCase().includes(q))
        .slice(0, 12);
      if (!matches.length) { close(); return; }
      results.innerHTML = matches.map(p => `
        <button data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><br>
        <span class="sr-sub">${esc([Tree.yearsLine(p), p.branch].filter(Boolean).join(' · '))}</span></button>`).join('');
      results.hidden = false;
      results.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        close();
        input.value = '';
        location.hash = '#person/' + b.dataset.id;
      }));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) close(); });
  }

  // ---------- auth ----------

  function showLogin() {
    openModal('Sign in to edit', `
      <p>Enter the family password to make changes.</p>
      <div class="field"><label>Password</label><input type="password" name="pw" autocomplete="current-password"></div>`, [
      { label: 'Cancel' },
      {
        label: 'Sign in', kind: 'btn-primary',
        onClick: async (d) => {
          const pw = d.querySelector('[name="pw"]').value;
          try {
            await API.login(pw);
            auth.authed = true;
            updateAuthButton();
            route();
            toast('Welcome! You can edit now.');
          } catch (e) {
            toast(e.message, true);
            return true;
          }
        }
      }
    ]);
  }

  function updateAuthButton() {
    const btn = $('#auth-btn');
    if (!auth.required) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = auth.authed ? 'Signed in (sign out)' : 'Sign in to edit';
    btn.onclick = async () => {
      if (auth.authed) {
        await API.logout();
        auth.authed = false;
        updateAuthButton();
        route();
      } else showLogin();
    };
  }

  // ---------- import / export ----------

  function setupImport() {
    $('#import-btn').addEventListener('click', () => {
      confirmModal('Restore from a backup?',
        'This replaces everything with the contents of a backup file you downloaded earlier. Continue?',
        async () => { $('#import-file').click(); });
    });
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      await guard(async () => {
        const text = await file.text();
        const data = JSON.parse(text);
        const r = await API.importAll(data);
        await reload();
        route();
        toast('Restored ' + r.persons + ' people from the backup.');
      });
    });
  }

  // ---------- routing & boot ----------

  function route() {
    const hash = location.hash || '#tree';
    const m = hash.match(/^#person\/(.+)$/);
    if (m) return renderPersonView(decodeURIComponent(m[1]));
    if (hash === '#people') return renderPeopleView();
    if (hash === '#history') return renderHistoryView();
    return renderTreeView();
  }

  async function reload() {
    db = await API.getData();
    $('#site-title').textContent = db.meta.title || 'Family Tree';
    $('#site-subtitle').textContent = db.meta.subtitle || '';
    document.title = (db.meta.title || 'Family Tree') + ' — Family Tree';
    $('#footer-count').textContent = Object.keys(db.persons).length + ' people in the family record';
    const hash = location.hash || '#tree';
    if (hash.startsWith('#person/')) route();
    else if (hash === '#people') renderPeopleView();
  }

  function setupFontToggle() {
    const saved = localStorage.getItem('fontsize');
    if (saved) document.documentElement.dataset.fontsize = saved;
    $('#font-toggle').addEventListener('click', () => {
      const cur = document.documentElement.dataset.fontsize || 'normal';
      const next = cur === 'normal' ? 'large' : cur === 'large' ? 'largest' : 'normal';
      document.documentElement.dataset.fontsize = next;
      localStorage.setItem('fontsize', next);
      toast(next === 'normal' ? 'Normal text size' : next === 'large' ? 'Larger text' : 'Largest text');
    });
  }

  async function boot() {
    try {
      const [data, a] = await Promise.all([API.getData(), API.getAuth()]);
      db = data;
      auth = a;
    } catch (e) {
      view().innerHTML = '<div class="view-pad"><p>Could not load the family record: ' + esc(e.message) + '</p></div>';
      return;
    }
    $('#site-title').textContent = db.meta.title || 'Family Tree';
    $('#site-subtitle').textContent = db.meta.subtitle || '';
    document.title = (db.meta.title || 'Family Tree') + ' — Family Tree';
    $('#footer-count').textContent = Object.keys(db.persons).length + ' people in the family record';
    updateAuthButton();
    setupSearch();
    setupImport();
    setupFontToggle();
    window.addEventListener('hashchange', route);
    route();
  }

  boot();
  return { reload };
})();
