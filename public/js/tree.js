'use strict';

/* ============================================================
   Family tree layout + SVG rendering (no libraries).

   Layout model: starting from a root person, we draw that
   person with their spouse(s) side by side, and all their
   children centred beneath them, recursively.
   ============================================================ */

const Tree = (() => {
  const CARD_W = 200;
  const CARD_H = 92;
  const SPOUSE_GAP = 26;     // gap between partners in a couple
  const SIBLING_GAP = 34;    // gap between sibling subtrees
  const GEN_GAP = 120;       // vertical gap between generations
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- relationship helpers ----------

  function unionsOf(db, personId) {
    return Object.values(db.unions).filter(u => u.partner1 === personId || u.partner2 === personId);
  }

  function parentUnionsOf(db, personId) {
    return Object.values(db.unions).filter(u => u.children.includes(personId));
  }

  function parentsOf(db, personId) {
    const out = [];
    for (const u of parentUnionsOf(db, personId)) {
      for (const p of [u.partner1, u.partner2]) {
        if (p && db.persons[p] && !out.includes(p)) out.push(p);
      }
    }
    return out;
  }

  function descendantCount(db, personId, seen) {
    seen = seen || new Set();
    if (seen.has(personId)) return 0;
    seen.add(personId);
    let n = 0;
    for (const u of unionsOf(db, personId)) {
      for (const c of u.children) {
        if (db.persons[c] && !seen.has(c)) {
          n += 1 + descendantCount(db, c, seen);
        }
      }
    }
    return n;
  }

  // Pick a sensible default root: an ancestor with no recorded
  // parents and the largest number of descendants.
  function autoRoot(db) {
    const ids = Object.keys(db.persons);
    if (!ids.length) return null;
    const noParents = ids.filter(id => parentsOf(db, id).length === 0);
    const pool = noParents.length ? noParents : ids;
    let best = pool[0], bestN = -1;
    for (const id of pool) {
      const n = descendantCount(db, id);
      if (n > bestN) { best = id; bestN = n; }
    }
    return best;
  }

  // ---------- layout ----------

  function buildNode(db, personId, visited) {
    if (visited.has(personId)) return null;
    visited.add(personId);

    const person = db.persons[personId];
    if (!person) return null;

    const myUnions = unionsOf(db, personId);
    const spouses = [];
    const childIds = [];
    const childUnion = {}; // childId -> union index (for edge drawing)

    myUnions.forEach((u, idx) => {
      const other = u.partner1 === personId ? u.partner2 : u.partner1;
      spouses.push({ union: u, spouseId: other && db.persons[other] && !visited.has(other) ? other : null, unionIndex: idx });
      if (other) visited.add(other);
      for (const c of u.children) {
        if (db.persons[c] && !childIds.includes(c)) {
          childIds.push(c);
          childUnion[c] = idx;
        }
      }
    });

    const children = [];
    for (const c of childIds) {
      const node = buildNode(db, c, visited);
      if (node) { node.viaUnion = childUnion[c]; children.push(node); }
    }

    const cardCount = 1 + spouses.filter(s => s.spouseId).length;
    const blockW = cardCount * CARD_W + (cardCount - 1) * SPOUSE_GAP;

    let childrenW = 0;
    for (const c of children) childrenW += c.subtreeW;
    if (children.length) childrenW += (children.length - 1) * SIBLING_GAP;

    return {
      personId, spouses, children, blockW,
      subtreeW: Math.max(blockW, childrenW)
    };
  }

  // Assign coordinates. x is the left edge of the subtree.
  function place(node, x, depth, out) {
    const blockX = x + (node.subtreeW - node.blockW) / 2;
    const y = depth * (CARD_H + GEN_GAP);

    node.x = blockX;
    node.y = y;
    out.push(node);

    let cx = x + (node.subtreeW - childrenWidth(node)) / 2;
    for (const c of node.children) {
      place(c, cx, depth + 1, out);
      cx += c.subtreeW + SIBLING_GAP;
    }
  }

  function childrenWidth(node) {
    let w = 0;
    for (const c of node.children) w += c.subtreeW;
    if (node.children.length) w += (node.children.length - 1) * SIBLING_GAP;
    return w;
  }

  function layout(db, rootId) {
    const visited = new Set();
    const root = buildNode(db, rootId, visited);
    if (!root) return { nodes: [], width: 0, height: 0 };
    const nodes = [];
    place(root, 0, 0, nodes);
    let maxDepth = 0;
    for (const n of nodes) maxDepth = Math.max(maxDepth, n.y);
    return { nodes, width: root.subtreeW, height: maxDepth + CARD_H };
  }

  // ---------- SVG rendering ----------

  function el(name, attrs, parent) {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function yearsLine(p) {
    const b = (p.birthDate || '').trim();
    const d = (p.deathDate || '').trim();
    if (!b && !d) return p.living === false ? '✝' : '';
    if (p.living !== false && !d) return b ? 'b. ' + b : '';
    return (b || '?') + ' – ' + (d || '?');
  }

  function fitName(name, max) {
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
  }

  function drawCard(g, db, personId, x, y, focusId, onOpen) {
    const p = db.persons[personId];
    const card = el('g', { class: 'person-card' + (personId === focusId ? ' is-focus' : ''), transform: `translate(${x},${y})` }, g);
    card.style.cursor = 'pointer';
    el('rect', { class: 'card-bg', width: CARD_W, height: CARD_H, rx: 10 }, card);

    // portrait circle
    const cx = 30, cy = CARD_H / 2, r = 24;
    if (p.photo) {
      const clipId = 'clip-' + personId;
      const clip = el('clipPath', { id: clipId }, card);
      el('circle', { cx, cy, r }, clip);
      const img = el('image', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice' }, card);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', p.photo);
      img.setAttribute('href', p.photo);
      el('circle', { cx, cy, r, fill: 'none', stroke: '#8b6f3e', 'stroke-width': 1.5 }, card);
    } else {
      el('circle', { cx, cy, r, fill: p.gender === 'F' ? '#7b4a62' : '#3e5e3a' }, card);
      const t = el('text', { x: cx, y: cy + 6, 'text-anchor': 'middle', class: 'card-initials' }, card);
      t.textContent = initials(p.name);
    }

    const name1 = el('text', { x: 64, y: 36, class: 'card-name' }, card);
    name1.textContent = fitName(p.name, 17);
    const years = el('text', { x: 64, y: 60, class: 'card-years' }, card);
    years.textContent = yearsLine(p);

    card.addEventListener('click', (ev) => { ev.stopPropagation(); onOpen(personId); });
    return card;
  }

  function render(holder, db, rootId, focusId, onOpen) {
    holder.innerHTML = '';
    const lay = layout(db, rootId);
    if (!lay.nodes.length) {
      const msg = document.createElement('div');
      msg.className = 'tree-empty';
      msg.textContent = 'No one in the tree yet.';
      holder.appendChild(msg);
      return null;
    }

    const PAD = 60;
    const svg = el('svg', {
      width: '100%', height: '100%',
      viewBox: `${-PAD} ${-PAD} ${lay.width + PAD * 2} ${lay.height + PAD * 2}`
    });
    const g = el('g', {}, svg);

    // edges first (under the cards)
    for (const node of lay.nodes) {
      // marriage lines between partner cards
      let cardX = node.x;
      const positions = { [node.personId]: cardX };
      const unionMid = {}; // unionIndex -> x of midpoint between the couple
      let lastX = cardX;
      node.spouses.forEach((s) => {
        if (s.spouseId) {
          const sx = lastX + CARD_W + SPOUSE_GAP;
          positions[s.spouseId] = sx;
          const midY = node.y + CARD_H / 2;
          el('line', { class: 'marriage-line', x1: lastX + CARD_W, y1: midY, x2: sx, y2: midY }, g);
          el('circle', { class: 'marriage-mark', cx: lastX + CARD_W + SPOUSE_GAP / 2, cy: midY, r: 5 }, g);
          unionMid[s.unionIndex] = lastX + CARD_W + SPOUSE_GAP / 2;
          lastX = sx;
        } else {
          unionMid[s.unionIndex] = cardX + CARD_W / 2;
        }
      });

      // edges to children: drop from the union midpoint to a bus, then to each child
      if (node.children.length) {
        const busY = node.y + CARD_H + GEN_GAP / 2;
        for (const c of node.children) {
          const fromX = unionMid[c.viaUnion] != null ? unionMid[c.viaUnion] : cardX + CARD_W / 2;
          const toX = c.x + (c.blockW >= CARD_W ? CARD_W / 2 : c.blockW / 2);
          const startY = node.y + (unionMid[c.viaUnion] != null && node.spouses.some(s => s.spouseId && s.unionIndex === c.viaUnion) ? CARD_H / 2 : CARD_H);
          el('path', {
            class: 'edge',
            d: `M ${fromX} ${startY} L ${fromX} ${busY} L ${toX} ${busY} L ${toX} ${c.y}`
          }, g);
        }
      }
      node._positions = positions;
    }

    // cards on top
    for (const node of lay.nodes) {
      drawCard(g, db, node.personId, node.x, node.y, focusId, onOpen);
      let lastX = node.x;
      node.spouses.forEach((s) => {
        if (s.spouseId) {
          lastX = lastX + CARD_W + SPOUSE_GAP;
          drawCard(g, db, s.spouseId, lastX, node.y, focusId, onOpen);
        }
      });
    }

    holder.appendChild(svg);
    attachPanZoom(holder, svg);
    return svg;
  }

  // ---------- pan & zoom ----------

  function attachPanZoom(holder, svg) {
    let vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const original = vb.slice();

    function apply() { svg.setAttribute('viewBox', vb.join(' ')); }

    let dragging = false, sx = 0, sy = 0, startVb = null;
    holder.addEventListener('pointerdown', (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      startVb = vb.slice();
      holder.classList.add('grabbing');
      holder.setPointerCapture(e.pointerId);
    });
    holder.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = holder.getBoundingClientRect();
      const scale = vb[2] / rect.width;
      vb[0] = startVb[0] - (e.clientX - sx) * scale;
      vb[1] = startVb[1] - (e.clientY - sy) * scale;
      apply();
    });
    const stop = () => { dragging = false; holder.classList.remove('grabbing'); };
    holder.addEventListener('pointerup', stop);
    holder.addEventListener('pointercancel', stop);

    holder.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 0.85 : 1 / 0.85, e);
    }, { passive: false });

    function zoomAt(factor, e) {
      const rect = holder.getBoundingClientRect();
      let px = vb[0] + vb[2] / 2, py = vb[1] + vb[3] / 2;
      if (e) {
        px = vb[0] + (e.clientX - rect.left) / rect.width * vb[2];
        py = vb[1] + (e.clientY - rect.top) / rect.height * vb[3];
      }
      const newW = Math.min(Math.max(vb[2] * factor, 300), 60000);
      const newH = newW * (vb[3] / vb[2]);
      vb = [px - (px - vb[0]) * (newW / vb[2]), py - (py - vb[1]) * (newH / vb[3]), newW, newH];
      apply();
    }

    svg._zoomIn = () => zoomAt(0.8);
    svg._zoomOut = () => zoomAt(1 / 0.8);
    svg._fit = () => { vb = original.slice(); apply(); };
  }

  return { render, autoRoot, unionsOf, parentUnionsOf, parentsOf, yearsLine, initials };
})();
