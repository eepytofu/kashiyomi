// Small DOM primitives shared by the settings panel and dictionary dialog.

let nextId = 0;

export function uiId(prefix: string): string {
  return `kashiyomi-${prefix}-${nextId++}`;
}

export function uiButton(
  label: string,
  options: {
    readonly variant?: "outline" | "primary" | "danger" | "quiet";
    readonly className?: string;
    readonly ariaLabel?: string;
  } = {},
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = [
    "kui-button",
    `kui-button-${options.variant ?? "outline"}`,
    options.className ?? "",
  ].filter(Boolean).join(" ");
  element.textContent = label;
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  return element;
}

export function connectControl(
  text: HTMLElement,
  control: HTMLElement,
): void {
  const label = text.querySelector<HTMLElement>(".kc-label");
  if (label) {
    if (!label.id) label.id = uiId("label");
    control.setAttribute("aria-labelledby", label.id);
  }
  const description = text.querySelector<HTMLElement>(".kc-desc");
  if (description) {
    if (!description.id) description.id = uiId("description");
    control.setAttribute("aria-describedby", description.id);
  }
}

export function liveRegion(className = ""): HTMLElement {
  const element = document.createElement("div");
  element.className = ["kui-live", className].filter(Boolean).join(" ");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  return element;
}

function channels(color: string): readonly number[] | undefined {
  const values = color.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
  return values?.length === 3 && values.every(Number.isFinite) ? values : undefined;
}

/** Map the rendered host surface into semantic variables used by both roots. */
export function applyUiTheme(root: HTMLElement): void {
  const rgb = channels(getComputedStyle(document.body).backgroundColor) ?? [24, 24, 28];
  const [red = 24, green = 24, blue = 28] = rgb;
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  const light = luminance > 160;
  root.classList.toggle("kui-light", light);

  const delta = light ? -7 : 9;
  const surface = [red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value + delta))));
  root.style.setProperty("--ky-dialog-bg", `rgb(${surface.join(", ")})`);
}
