// Widget registry: id -> { title, defaultSize, mount(el, config, bus), unmount(el) }.
// grid.js and main.js are the only things that read from this.
const widgets = new Map();

export function registerWidget(def) {
  if (!def || !def.id || typeof def.mount !== 'function') {
    throw new Error('registerWidget requires { id, mount(el, config, bus) }');
  }
  widgets.set(def.id, def);
}

export function getWidget(id) {
  return widgets.get(id);
}

export function listWidgets() {
  return Array.from(widgets.values());
}
