// The settings panel's dropdown.

import { isMoveKey, nextIndex, typeAheadIndex, TYPE_AHEAD_RESET_MS } from "../../engine/listboxKeys.ts";

export type DropdownOption = {
  readonly value: string;
  readonly label: string;
  /** An ASCII spelling to find this option by, for labels nobody can type. */
  readonly search?: string;
};

export type Dropdown = {
  readonly el: HTMLElement;
  /** Move the selection from outside, without firing `onChange`. */
  readonly setValue: (value: string) => void;
};

let nextId = 0;

export function dropdown(config: {
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  /** Announced to screen readers, since the visible label is the row's. */
  label?: string;
}): Dropdown {
  const { options, onChange } = config;
  const id = `kc-menu-${nextId++}`;

  const el = document.createElement("span");
  el.className = "kc-select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "kc-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (config.label) trigger.setAttribute("aria-label", config.label);

  const text = document.createElement("span");
  text.className = "kc-select-text";
  trigger.appendChild(text);
  el.appendChild(trigger);

  const menu = document.createElement("div");
  menu.className = "kc-menu";
  menu.id = id;
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const items = options.map((option, index) => {
    const item = document.createElement("div");
    item.className = "kc-menu-item";
    item.id = `${id}-${index}`;
    item.setAttribute("role", "option");
    item.textContent = option.label;
    // Mouse down rather than click, and prevented, so the trigger keeps focus:
    // a plain click blurs the button first and closes the menu under the cursor.
    item.onmousedown = (event) => {
      event.preventDefault();
      commit(index);
    };
    item.onmouseenter = () => highlight(index);
    menu.appendChild(item);
    return item;
  });
  el.appendChild(menu);

  let value = config.value;
  let active = options.findIndex((o) => o.value === value);
  let open = false;

  const labelOf = (v: string): string => options.find((o) => o.value === v)?.label ?? v;

  const paint = (): void => {
    text.textContent = labelOf(value);
    for (const [index, item] of items.entries()) {
      const option = options[index];
      item.setAttribute("aria-selected", option?.value === value ? "true" : "false");
      item.classList.toggle("kc-menu-on", index === active);
      item.classList.toggle("kc-menu-current", option?.value === value);
    }
    trigger.setAttribute("aria-activedescendant", active >= 0 ? `${id}-${active}` : "");
  };

  const highlight = (index: number): void => {
    active = index;
    paint();
    if (open) items[index]?.scrollIntoView({ block: "nearest" });
  };

  const place = (): void => {
    const rect = trigger.getBoundingClientRect();
    // Measured, not guessed at: ask the menu how tall it wants to be, then
    // decide which side has room. Reads a rect while hidden is not enough, so
    // this runs after it is shown.
    const height = menu.offsetHeight;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const flip = below < height + 8 && above > below;

    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.width = `${Math.round(rect.width)}px`;
    if (flip) {
      menu.style.top = "";
      menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
    } else {
      menu.style.bottom = "";
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    }
  };

  // Follow the trigger rather than closing on scroll. A fixed popup does not
  const reposition = (): void => {
    if (open) place();
  };

  const onDocumentPointerDown = (event: Event): void => {
    if (!el.contains(event.target as Node)) close();
  };

  function openMenu(): void {
    if (open) return;
    open = true;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (active < 0) active = 0;
    place();
    paint();
    items[active]?.scrollIntoView({ block: "nearest" });
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  }

  function close(): void {
    if (!open) return;
    open = false;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  }

  function commit(index: number): void {
    const option = options[index];
    close();
    trigger.focus();
    if (!option || option.value === value) return;
    value = option.value;
    active = index;
    paint();
    onChange(value);
  }

  trigger.onmousedown = (event) => {
    // The button would take focus on its own; doing it here keeps the toggle
    // from running twice when a click lands while the menu is already open.
    event.preventDefault();
    trigger.focus();
    if (open) close();
    else openMenu();
  };

  let buffer = "";
  let bufferAt = 0;

  trigger.onkeydown = (event) => {
    const key = event.key;

    if (key === "Escape") {
      if (open) {
        event.stopPropagation();
        close();
      }
      return;
    }
    if (key === "Tab") {
      close();
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (open) commit(active);
      else openMenu();
      return;
    }
    if (isMoveKey(key)) {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      highlight(nextIndex(active, key, options.length));
      return;
    }
    // Type-ahead. Single printable characters only, so shortcuts still work.
    if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const now = Date.now();
      buffer = now - bufferAt > TYPE_AHEAD_RESET_MS ? key : buffer + key;
      bufferAt = now;
      const found = typeAheadIndex(options, buffer, active);
      if (found < 0) return;
      event.preventDefault();
      if (open) highlight(found);
      else commit(found);
    }
  };

  trigger.onblur = () => close();

  paint();

  return {
    el,
    setValue: (next: string) => {
      value = next;
      active = options.findIndex((o) => o.value === next);
      paint();
    },
  };
}
