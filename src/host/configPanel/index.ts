// The plugin manager settings panel. Plain DOM, no framework. Two columns:
// settings cards on the left, a live preview (rendered with the production
// line renderer) and an about card on the right.

import { rescan } from "../annotator.ts";
import { panelLang, setPanelLang, t, type PanelLang } from "../i18n.ts";
import { resetTranslation } from "../translationLane.ts";
import {
  DEFAULT_JP_FONT_STACK,
  DEFAULT_ZH_FONT_STACK,
  getSettings,
} from "../settings.ts";
import { PANEL_CSS } from "./css.ts";
import { UI_ROOT_CLASS, ensureSharedStyles } from "../uiStyles.ts";
import { dictionaryAvailable, onDictionaryChange } from "../dictionary.ts";
import { dictionaryRow } from "./dictionaryRow.ts";
import { onPanelTeardown, teardownPanel } from "./lifecycle.ts";
import { buildPreviewCard } from "./preview.ts";
import {
  card,
  fontStackRow,
  readingOverridesRow,
  sectionTitle,
  sizeRow,
  textRow,
  toggleRow,
  type BooleanSettingKey,
} from "./rows.ts";
import { apiKeysRow, clearCacheRow, providerRow, targetLangRow } from "./translationRows.ts";

const REPO_URL = "https://github.com/eepytofu/kashiyomi";

export function buildConfigPanel(): HTMLElement {
  const root = document.createElement("div");
  root.className = `kashiyomi-config ${UI_ROOT_CLASS}`;
  render(root);
  return root;
}


/**
 * The tabs, in reading order. Labels reuse the section titles that were already
 * there, so the strip introduced no new strings.
 */
const TABS = [
  { key: "japanese", title: "sectionJapanese" },
  { key: "chinese", title: "sectionChinese" },
  { key: "fonts", title: "sectionFonts" },
  { key: "translation", title: "sectionAi" },
  { key: "advanced", title: "sectionAdvanced" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Module-scoped, not a local. */
let activeTab: TabKey = "japanese";

function render(root: HTMLElement, restoreTab?: TabKey): void {
  // A rebuild detaches every node below, so anything still subscribed or still
  // ticking is writing into a document it has left. Four paths reach this
  // function, so a row that does not clean up leaks once per visit.
  ensureSharedStyles();
  teardownPanel();
  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  root.appendChild(style);
  applyPanelTheme(root);

  root.appendChild(buildTabStrip(root));

  const scroll = document.createElement("div");
  scroll.className = "kc-scroll";

  const left = document.createElement("div");
  left.className = "kc-col";
  const right = document.createElement("div");
  right.className = "kc-col kc-col-side";

  const refreshPreview = buildPreviewCard(right);

  left.appendChild(tabAnchor("japanese", t("sectionJapanese")));
  const jp = card();
  jp.appendChild(dictionaryRow());
  const needsDictionary = document.createElement("div");
  needsDictionary.className = "kc-needs-dict";
  needsDictionary.textContent = t("dictNeededForThese");

  // Rows in reading order, not gating order. The notice says "greyed settings",
  const { toggle: furiganaRow, dependents: furiganaSize } = revealWhile(
    jp,
    "furigana",
    t("furigana"),
    t("furiganaDesc"),
    () => [sizeRow(refreshPreview)],
    { onChange: refreshPreview },
  );
  const romajiRow = toggleRow("romaji", t("romaji"), t("romajiDesc"), refreshPreview);
  const hintsRow = toggleRow("readingHints", t("hints"), t("hintsDesc"), refreshPreview);
  // The escape hatch for when everything above got a reading wrong, so it comes
  // last: it reads in the order someone reaches for it.
  const overrides = readingOverridesRow();
  for (const rowEl of [
    romajiRow,
    hintsRow,
    toggleRow("hanRepair", t("repair"), t("repairDesc"), refreshPreview),
    overrides,
  ]) {
    jp.appendChild(rowEl);
  }

  // Exactly the settings that do nothing without a dictionary. Kanji repair is
  const gated = [furiganaRow, ...furiganaSize, romajiRow, hintsRow, overrides];
  // Directly under the dictionary row, which is the thing it is about, and a
  // fixed position now that it no longer has to sit above its subjects.
  gateOnDictionary(gated, needsDictionary, jp, furiganaRow);
  left.appendChild(jp);

  left.appendChild(tabAnchor("chinese", t("sectionChinese")));
  const zh = card();
  zh.appendChild(toggleRow("pinyin", t("pinyin"), t("pinyinDesc"), refreshPreview));
  zh.appendChild(toggleRow("pinyinTones", t("tones"), t("tonesDesc"), refreshPreview));
  zh.appendChild(toggleRow("pinyinJoinWords", t("groupWords"), t("groupWordsDesc"), refreshPreview));
  left.appendChild(zh);

  // Typography in one place. Six rows used to sit across three sections, and the
  // reading-row font had to live in Advanced with a comment explaining it
  // belonged to neither language — the per-feature grouping failing out loud.
  left.appendChild(tabAnchor("fonts", t("sectionFonts")));
  const fonts = card();
  // `triggersRescan: false` throughout: a font change is styling, and restyling
  // does not need every line analyzed again.
  revealWhile(fonts, "useJpFont", t("jpFont"), t("jpFontDesc"), () => [
    fontStackRow("jpFontStack", DEFAULT_JP_FONT_STACK, "fontStack", "fontStackDesc", refreshPreview),
  ], { onChange: refreshPreview, triggersRescan: false });
  revealWhile(fonts, "useZhFont", t("zhFont"), t("zhFontDesc"), () => [
    fontStackRow("zhFontStack", DEFAULT_ZH_FONT_STACK, "zhFontStack", "fontStackDesc", refreshPreview),
  ], { onChange: refreshPreview, triggersRescan: false });
  revealWhile(fonts, "useRowFont", t("rowFont"), t("rowFontDesc"), () => [
    fontStackRow("rowFontStack", DEFAULT_JP_FONT_STACK, "rowFontStack", "fontStackDesc", refreshPreview),
  ], { onChange: refreshPreview, triggersRescan: false });
  left.appendChild(fonts);

  left.appendChild(tabAnchor("translation", t("sectionAi")));
  const ai = card();
  ai.appendChild(toggleRow("aiAutoTranslate", t("aiAuto"), t("aiAutoDesc"), resetTranslation));

  const baseUrlRow = textRow("aiBaseUrl", "aiBaseUrl", "aiBaseUrlDesc", {
    placeholder: "https://api.openai.com/v1",
  });
  const modelRow = textRow("aiModel", "aiModel", "aiModelDesc", {});
  const modelPlaceholder = (provider: string): string =>
    provider === "gemini" ? "gemini-3.5-flash-lite" : "gpt-5.6-luna";
  // Both rows always exist; the provider only decides how they look. Rebuilding
  // the panel to add or drop one row took the focused <select> with it.
  const applyProvider = (provider: string): void => {
    // Gemini has a fixed Google endpoint; the base URL only applies to
    // OpenAI-compatible providers.
    baseUrlRow.style.display = provider === "openai" ? "" : "none";
    const model = modelRow.querySelector("input");
    if (model) model.placeholder = modelPlaceholder(provider);
  };

  ai.appendChild(providerRow(applyProvider));
  ai.appendChild(baseUrlRow);
  ai.appendChild(apiKeysRow());
  ai.appendChild(modelRow);
  applyProvider(getSettings().aiProvider);
  ai.appendChild(targetLangRow());
  ai.appendChild(textRow("aiCustomPrompt", "aiCustomPrompt", "aiCustomPromptDesc", {}));
  ai.appendChild(clearCacheRow());
  left.appendChild(ai);

  left.appendChild(tabAnchor("advanced", t("sectionAdvanced")));
  const adv = card();
  adv.appendChild(toggleRow("annotateCredits", t("credits"), t("creditsDesc")));
  adv.appendChild(toggleRow("debug", t("debug"), t("debugDesc"), () => {}));
  // Only while there is no dictionary. Once one is installed the notice cannot
  // fire, so a switch for it is a control that does nothing, and Advanced is
  // where dead controls accumulate unnoticed.
  followMissingDictionary(
    toggleRow("lyricDictNotice", t("lyricDictNotice"), t("lyricDictNoticeDesc")),
    adv,
  );
  left.appendChild(adv);

  buildAboutCard(right);

  scroll.appendChild(left);
  scroll.appendChild(right);
  root.appendChild(scroll);
  linkTabsToScroll(root, restoreTab);
}

/** Use the rendered host surface, not a private NCM theme API. */
function applyPanelTheme(root: HTMLElement): void {
  const channels = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
  const red = Number(channels?.[0] ?? 0);
  const green = Number(channels?.[1] ?? 0);
  const blue = Number(channels?.[2] ?? 0);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  root.classList.toggle("kc-theme-light", luminance > 160);
}

/** A toggle plus the rows that only mean anything while it is on. */
function revealWhile(
  card: HTMLElement,
  key: BooleanSettingKey,
  label: string,
  description: string,
  buildDependents: () => readonly HTMLElement[],
  options: { readonly onChange?: () => void; readonly triggersRescan?: boolean } = {},
): { toggle: HTMLElement; dependents: readonly HTMLElement[] } {
  const dependents = buildDependents();
  let reveal = (): void => {};
  const toggle = toggleRow(
    key,
    label,
    description,
    () => {
      if (options.onChange) options.onChange();
      reveal();
    },
    options.triggersRescan ?? true,
  );
  card.appendChild(toggle);
  reveal = (): void => {
    const on = getSettings()[key];
    // Reversed on insert so each lands directly after the toggle and the group
    // keeps its written order.
    for (const dependent of [...dependents].reverse()) {
      const inCard = dependent.parentNode !== null;
      if (on && !inCard) card.insertBefore(dependent, toggle.nextSibling);
      else if (!on && inCard) dependent.remove();
    }
  };
  reveal();
  return { toggle, dependents };
}

/**
 * Grey out settings that cannot do anything until a dictionary exists, and say
 * so once above them.
 */
function gateOnDictionary(
  rows: readonly HTMLElement[],
  notice: HTMLElement,
  card: HTMLElement,
  before: HTMLElement,
): void {
  const paint = (): void => {
    const absent = !dictionaryAvailable();
    // Inserted and removed, never hidden. `.kc-row + .kc-row` draws the divider
    const inCard = notice.parentNode !== null;
    if (absent && !inCard) card.insertBefore(notice, before);
    else if (!absent && inCard) notice.remove();
    for (const rowEl of rows) {
      rowEl.classList.toggle("kc-inert", absent);
      for (const control of rowEl.querySelectorAll("input, select, textarea, button")) {
        (control as HTMLInputElement).disabled = absent;
      }
    }
  };
  paint();
  onPanelTeardown(onDictionaryChange(paint));
}

/** Keep a row in the card only while no dictionary is installed. */
function followMissingDictionary(row: HTMLElement, card: HTMLElement): void {
  const paint = (): void => {
    const absent = !dictionaryAvailable();
    const inCard = row.parentNode !== null;
    if (absent && !inCard) card.appendChild(row);
    else if (!absent && inCard) row.remove();
  };
  paint();
  onPanelTeardown(onDictionaryChange(paint));
}

/**
 * NCM's own settings navigation: a horizontal strip, active tab underlined,
 * only that tab's content below.
 */
/** A section heading the tab strip can scroll to and highlight. */
function tabAnchor(key: TabKey, label: string): HTMLElement {
  const el = sectionTitle(label);
  // Deliberately not `data-kc-tab`: that is the strip's own buttons. Sharing one
  el.setAttribute("data-kc-anchor", key);
  return el;
}

/** Keep the strip in step with the scroll, and scroll on click. */
function linkTabsToScroll(root: HTMLElement, restoreTab?: TabKey): void {
  const tabs = [...root.querySelectorAll<HTMLElement>(".kc-tab")];
  const anchors = [...root.querySelectorAll<HTMLElement>("[data-kc-anchor]")];
  const strip = root.querySelector<HTMLElement>(".kc-tabs");
  const scroller = root.querySelector<HTMLElement>(".kc-scroll");
  const first = anchors[0];
  if (tabs.length === 0 || !first || !strip || !scroller) return;

  const light = (key: string): void => {
    for (const tab of tabs) {
      tab.classList.toggle("kc-tab-on", tab.getAttribute("data-kc-tab") === key);
    }
  };

  /** The gap between the strip and a heading that has just been scrolled to. */
  const AIR = 8;

  const fitViewport = (): void => {
    const left = root.getBoundingClientRect().left;
    if (left <= 0) return;
    const available = Math.max(320, Math.min(980, window.innerWidth - left - 16));
    root.style.maxWidth = `${Math.round(available)}px`;
  };
  window.addEventListener("resize", fitViewport);
  onPanelTeardown(() => window.removeEventListener("resize", fitViewport));

  const scrollTo = (key: string, behavior: ScrollBehavior): boolean => {
    const target = anchors.find((anchor) => anchor.getAttribute("data-kc-anchor") === key);
    if (!target) return false;
    const destination = scroller.scrollTop
      + target.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      - AIR;
    const top = Math.max(0, Math.min(destination, scroller.scrollHeight - scroller.clientHeight));
    scroller.scrollTo({ top, behavior });
    return true;
  };

  const atBottom = (): boolean => {
    // The 2px absorbs subpixel rounding at display scaling, where scrollTop and
    // clientHeight are fractional and never sum to exactly scrollHeight.
    return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  };

  const current = (): string | null => {
    // The last section is short, so the container runs out of scroll while its
    const last = anchors[anchors.length - 1];
    if (last && atBottom()) return last.getAttribute("data-kc-anchor");

    // Where a clicked heading comes to rest counts as arrived, plus a pixel for
    // subpixel rounding. Anything stricter puts the click one section behind.
    const line = scroller.getBoundingClientRect().top + AIR + 1;
    let key: string | null = first.getAttribute("data-kc-anchor");
    for (const anchor of anchors) {
      if (anchor.getBoundingClientRect().top > line) break;
      key = anchor.getAttribute("data-kc-anchor");
    }
    return key;
  };

  /** The tab a click is still travelling to, if any. */
  let pending: string | null = null;
  let pendingAt = 0;

  // Scroll fires far more often than the answer changes, so the work is
  // coalesced into one frame and the DOM is only touched when the tab differs.
  let queued = false;
  let waitingForLayout = 0;
  let initial = true;
  let painted = false;
  let layoutObserver: MutationObserver | null = null;
  const watchLayout = (): void => {
    if (layoutObserver) return;
    layoutObserver = new MutationObserver(sync);
    layoutObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    onPanelTeardown(() => layoutObserver?.disconnect());
  };
  let hostObserver: MutationObserver | null = null;
  const watchHost = (): void => {
    if (hostObserver) return;
    const manager = root.closest(".bncm-mgr");
    if (!manager) return;
    hostObserver = new MutationObserver(() => {
      if (root.getBoundingClientRect().height === 0) return;
      applyPanelTheme(root);
      sync();
    });
    for (const button of manager.querySelectorAll(".plugin-btn")) {
      hostObserver.observe(button, { attributes: true, attributeFilter: ["class"] });
    }
    onPanelTeardown(() => hostObserver?.disconnect());
  };
  const sync = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      // BetterNCM builds the panel detached and inserts it later, so every rect
      // is 0 until it lands. That reads as "every heading is above the line" and
      // lights the last tab, which is why opening settings showed Advanced.
      fitViewport();
      const waiting = (
        strip.getBoundingClientRect().height === 0
        || scroller.clientHeight === 0
        || scroller.scrollHeight <= scroller.clientHeight + 4
        || first.getBoundingClientRect().height === 0
      );
      if (waiting) {
        watchLayout();
        if (root.isConnected && waitingForLayout++ < 10) sync();
        return;
      }
      waitingForLayout = 0;
      layoutObserver?.disconnect();
      layoutObserver = null;
      watchHost();
      if (initial) {
        initial = false;
        if (restoreTab) scrollTo(restoreTab, "auto");
      }
      const key = current();
      if (pending) {
        if (key === pending || Date.now() - pendingAt > 1200) pending = null;
        else return;
      }
      if (!key) return;
      if (key === activeTab && painted) return;
      activeTab = key as TabKey;
      light(key);
      painted = true;
      restoreTab = undefined;
    });
  };

  scroller.addEventListener("scroll", sync);
  onPanelTeardown(() => scroller.removeEventListener("scroll", sync));
  sync();

  for (const tab of tabs) {
    tab.onclick = () => {
      const key = tab.getAttribute("data-kc-tab");
      // Scrolls rather than re-renders: the sections are all present, so there
      // is nothing to rebuild and rebuilding would lose the scroll position.
      if (key && scrollTo(key, "smooth")) {
        pending = key;
        pendingAt = Date.now();
        activeTab = key as TabKey;
        light(key);
      }
    };
  }
}

function buildTabStrip(root: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "kc-tabs";

  const list = document.createElement("div");
  list.className = "kc-tablist";
  for (const tab of TABS) {
    const button = document.createElement("button");
    button.className = tab.key === activeTab ? "kc-tab kc-tab-on" : "kc-tab";
    button.textContent = t(tab.title);
    button.setAttribute("data-kc-tab", tab.key);
    list.appendChild(button);
  }
  bar.appendChild(list);

  const rightSide = document.createElement("div");
  rightSide.className = "kc-status-right";
  const reannotate = document.createElement("button");
  reannotate.className = "kc-button";
  reannotate.textContent = t("reannotate");
  reannotate.onclick = () => {
    rescan();
    render(root, activeTab);
  };
  rightSide.appendChild(reannotate);
  rightSide.appendChild(buildLangToggle(root));
  bar.appendChild(rightSide);
  return bar;
}


function buildLangToggle(root: HTMLElement): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "kc-lang";
  // Sitting in the status bar with no label, this control does not say what it
  wrap.title = t("panelLanguageDesc");
  const current = panelLang();
  const options: [PanelLang, string][] = [
    ["en", "EN"],
    ["zh", "中文"],
  ];
  for (const [lang, label] of options) {
    const button = document.createElement("button");
    button.textContent = label;
    if (lang === current) button.className = "kc-active";
    button.onclick = () => {
      setPanelLang(lang);
      render(root, activeTab);
    };
    wrap.appendChild(button);
  }
  return wrap;
}

function buildAboutCard(column: HTMLElement): void {
  column.appendChild(sectionTitle(t("about")));
  const box = card();
  box.className += " kc-about";

  const name = document.createElement("div");
  const version = (plugin as { manifest?: { version?: string } }).manifest?.version ?? "";
  name.textContent = `Kashiyomi（歌詞読み）${version ? ` v${version}` : ""}`;
  box.appendChild(name);

  // Both links are required for listing: the store asks for the source and a
  // way to report a bug, each reachable from inside the plugin's own settings.
  const link = (label: string, url: string) => {
    const el = document.createElement("span");
    el.className = "kc-link";
    el.textContent = label;
    el.onclick = () => {
      try {
        betterncm.ncm.openUrl(url);
      } catch {
        window.open(url);
      }
    };
    box.appendChild(el);
  };
  link(t("aboutRepo"), REPO_URL);
  link(t("aboutIssues"), `${REPO_URL}/issues`);

  const logPath = document.createElement("div");
  logPath.className = "kc-muted";
  logPath.textContent = `${t("aboutLog")}: C:\\betterncm\\kashiyomi.log`;
  box.appendChild(logPath);

  column.appendChild(box);
}
