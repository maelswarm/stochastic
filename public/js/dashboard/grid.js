// A small in-house CSS-grid widget manager: drag to move, handle to resize,
// no vendor dependency. Deliberately simple -- collisions are resolved by
// snapping a drop back to its prior spot rather than reflowing everything,
// which keeps this file readable at the cost of gridstack-style auto-packing.
import { getWidget } from './registry.js';

const COLS = 12;
const ROW_H = 32; // px
const GAP = 10; // px

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Grid {
  constructor(containerEl, { template, onLayoutChange }) {
    this.container = containerEl;
    this.template = template;
    this.onLayoutChange = onLayoutChange || (() => {});
    this.items = new Map(); // widgetId -> { el, layout, instance }
    this.container.style.setProperty('--grid-cols', COLS);
    this.container.style.setProperty('--grid-row-h', `${ROW_H}px`);
    this.container.style.setProperty('--grid-gap', `${GAP}px`);
  }

  cellSize() {
    const rect = this.container.getBoundingClientRect();
    const cellW = (rect.width - GAP * (COLS - 1)) / COLS;
    return { cellW, rect };
  }

  collides(candidate, exceptWidgetId) {
    for (const [id, item] of this.items) {
      if (id === exceptWidgetId) continue;
      if (rectsOverlap(candidate, item.layout)) return true;
    }
    return false;
  }

  findFreeSpot(w, h) {
    for (let y = 1; y < 400; y++) {
      for (let x = 1; x <= COLS - w + 1; x++) {
        const candidate = { x, y, w, h };
        if (!this.collides(candidate, null)) return candidate;
      }
    }
    return { x: 1, y: 1, w, h };
  }

  applyPosition(el, layout) {
    el.style.gridColumn = `${layout.x} / span ${layout.w}`;
    el.style.gridRow = `${layout.y} / span ${layout.h}`;
  }

  setLayout(layoutArray) {
    for (const id of Array.from(this.items.keys())) this.removeWidget(id, { silent: true });
    for (const entry of layoutArray) this._mount(entry);
    this._notifyChange();
  }

  addWidget(widgetId, config = {}) {
    if (this.items.has(widgetId)) return;
    const def = getWidget(widgetId);
    if (!def) return;
    const size = def.defaultSize || { w: 4, h: 6 };
    const spot = this.findFreeSpot(size.w, size.h);
    this._mount({ widgetId, x: spot.x, y: spot.y, w: size.w, h: size.h, config });
    this._notifyChange();
  }

  removeWidget(widgetId, { silent } = {}) {
    const item = this.items.get(widgetId);
    if (!item) return;
    try {
      if (item.instance && typeof item.instance.unmount === 'function') item.instance.unmount();
    } catch (err) {
      console.error(`[grid] unmount failed for ${widgetId}:`, err);
    }
    item.el.remove();
    this.items.delete(widgetId);
    if (!silent) this._notifyChange();
  }

  getLayout() {
    return Array.from(this.items.entries()).map(([widgetId, item]) => ({
      widgetId,
      x: item.layout.x,
      y: item.layout.y,
      w: item.layout.w,
      h: item.layout.h,
      config: item.config || {},
    }));
  }

  _notifyChange() {
    this.onLayoutChange(this.getLayout());
  }

  _mount(entry) {
    const def = getWidget(entry.widgetId);
    if (!def) return;

    const frag = this.template.content.cloneNode(true);
    const el = frag.querySelector('.widget');
    el.dataset.widgetId = entry.widgetId;
    el.querySelector('.widget-title').textContent = def.title;
    const body = el.querySelector('.widget-body');
    const removeBtn = el.querySelector('.widget-remove');

    const layout = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
    this.applyPosition(el, layout);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'widget-resize-handle';
    el.appendChild(resizeHandle);

    this.container.appendChild(el);

    removeBtn.addEventListener('click', () => this.removeWidget(entry.widgetId));

    this._wireDrag(el, entry.widgetId);
    this._wireResize(resizeHandle, el, entry.widgetId);

    let instance = null;
    try {
      instance = def.mount(body, entry.config || {}) || null;
    } catch (err) {
      console.error(`[grid] mount failed for ${entry.widgetId}:`, err);
      body.textContent = 'Widget failed to load.';
    }

    this.items.set(entry.widgetId, { el, layout, config: entry.config || {}, instance });
  }

  _wireDrag(el, widgetId) {
    const header = el.querySelector('.widget-header');
    header.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.widget-actions')) return;
      ev.preventDefault();
      const item = this.items.get(widgetId);
      const startLayout = { ...item.layout };
      const { cellW } = this.cellSize();
      const startX = ev.clientX;
      const startY = ev.clientY;
      el.classList.add('dragging');

      const onMove = (mv) => {
        const dCols = Math.round((mv.clientX - startX) / (cellW + GAP));
        const dRows = Math.round((mv.clientY - startY) / (ROW_H + GAP));
        const candidate = {
          x: Math.min(Math.max(1, startLayout.x + dCols), COLS - startLayout.w + 1),
          y: Math.max(1, startLayout.y + dRows),
          w: startLayout.w,
          h: startLayout.h,
        };
        item.layout = candidate;
        this.applyPosition(el, candidate);
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        el.classList.remove('dragging');
        if (this.collides(item.layout, widgetId)) {
          item.layout = startLayout;
          this.applyPosition(el, startLayout);
        }
        this._notifyChange();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  _wireResize(handle, el, widgetId) {
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const item = this.items.get(widgetId);
      const startLayout = { ...item.layout };
      const { cellW } = this.cellSize();
      const startX = ev.clientX;
      const startY = ev.clientY;
      el.classList.add('resizing');

      const onMove = (mv) => {
        const dCols = Math.round((mv.clientX - startX) / (cellW + GAP));
        const dRows = Math.round((mv.clientY - startY) / (ROW_H + GAP));
        const candidate = {
          x: startLayout.x,
          y: startLayout.y,
          w: Math.min(Math.max(2, startLayout.w + dCols), COLS - startLayout.x + 1),
          h: Math.max(2, startLayout.h + dRows),
        };
        item.layout = candidate;
        this.applyPosition(el, candidate);
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        el.classList.remove('resizing');
        if (this.collides(item.layout, widgetId)) {
          item.layout = startLayout;
          this.applyPosition(el, startLayout);
        }
        this._notifyChange();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }
}
