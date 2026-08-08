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
import { dictionaryInventory, onDictionaryChange } from "../dictionary.ts";
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

/**
 * Module-scoped, not a local.
 *
 * `render(root)` is called by the provider dropdown and by Re-annotate, so a
 * local would snap back to Japanese the moment someone changed the AI provider
 * from inside the Translation tab. Not persisted either: NCM's own settings
 * opens on its first tab, and a remembered tab is state nobody asked for.
 */
let activeTab: TabKey = "japanese";

function render(root: HTMLElement): void {
  // A rebuild detaches every node below, so anything still subscribed or still
  // ticking is writing into a document it has left. Four paths reach this
  // function, so a row that does not clean up leaks once per visit.
  ensureSharedStyles();
  teardownPanel();
  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  root.appendChild(buildTabStrip(root));

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
  // so it names its subjects instead of meaning "the rows after me", and that
  // is what lets kanji repair sit among them: it needs no dictionary, so it is
  // never greyed, and the notice never claims it.
  // Size sits under furigana and only while it is on: it scales the ruby, so
  // with furigana off there is nothing for it to scale.
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
  // absent because `opencc-js` is bundled and it renders with nothing
  // installed. Reading hints are present because although the parsing is pure,
  // consuming a hint means moving it into a ruby, and with no analyzer there is
  // no ruby to move it into.
  // The size row is listed whether or not it is currently in the DOM: greying is
  // a property of the element, so it stays correct when furigana is switched
  // back on and the row returns.
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
  // The same split appears in the author's spicy-lyrics fork, which keeps
  // readings under Languages and font stacks under Appearance, and in browsers,
  // where per-script font choices are one panel rather than one page each.
  //
  // Directly under the two language sections, because all three are about how
  // a lyric renders; translation is a separate capability and Advanced is the
  // leftovers. The reading-row font does also style translation rows, but
  // grouping by what the reader is looking at beats grouping by coverage.
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

  root.appendChild(left);
  root.appendChild(right);
  linkTabsToScroll(root);
}

/**
 * A toggle plus the rows that only mean anything while it is on.
 *
 * A stack under a font switch that is off, or a size slider under furigana that
 * is off, is a control with no effect. Three of the six font rows were in that
 * state on a default install, which read as a wall of text boxes rather than as
 * settings. The same idea was already in this panel, where the AI base URL row
 * is only built for OpenAI-compatible providers.
 *
 * Inserted and removed, never hidden. `.kc-row + .kc-row` draws the divider
 * between rows, and a `display: none` element still sits between two rows as
 * far as the sibling combinator is concerned, so hiding it deletes the line
 * above. That exact bug shipped once already in the dictionary gate.
 *
 * Returns both parts, because the caller may still need them: the Japanese card
 * gates furigana *and* its size on the dictionary, whether or not either is
 * currently in the DOM.
 */
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
 *
 * Disabled rather than hidden: a panel that changes shape when a download
 * finishes is disorienting, and the greyed rows are also the clearest statement
 * of what the dictionary is *for*. Disabled rather than merely dimmed, too,
 * because a toggle that looks inactive but still writes a setting lets someone
 * turn on furigana, see nothing happen, and have no way to tell which of the two
 * things is broken.
 *
 * Follows the inventory rather than being decided once: the dialog this panel
 * opens can install a dictionary without the panel being rebuilt.
 */
function gateOnDictionary(
  rows: readonly HTMLElement[],
  notice: HTMLElement,
  card: HTMLElement,
  before: HTMLElement,
): void {
  const paint = (): void => {
    const absent = !dictionaryInventory().installed;
    // Inserted and removed, never hidden. `.kc-row + .kc-row` draws the divider
    // between settings, and a `display:none` element still sits between two
    // rows as far as the sibling combinator is concerned, so hiding it silently
    // deleted the line under the dictionary row.
    //
    // `parentNode`, never `isConnected`: this panel is built detached and
    // handed to BetterNCM to insert, so `isConnected` is false for the whole of
    // construction. Boot resolves the asset paths asynchronously (measured at
    // 8.6s once), and opening settings inside that window inserted the notice
    // and then had the removal skipped, because the dictionary arrived while
    // the card was still detached. The panel then attached with a notice under
    // a row already reading "installed", and it stayed until some later change
    // repainted it.
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

/**
 * Keep a row in the card only while no dictionary is installed.
 *
 * `parentNode`, never `isConnected`: this panel is built detached and handed to
 * BetterNCM to insert, so `isConnected` is false for the whole of construction
 * and the removal branch would be unreachable. Same trap as the gate notice
 * above, which shipped with exactly that bug.
 */
function followMissingDictionary(row: HTMLElement, card: HTMLElement): void {
  const paint = (): void => {
    const absent = !dictionaryInventory().installed;
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
 *
 * Copied from the host rather than invented. NCM's settings page runs
 * 账号 / 常规 / 系统 / 播放 / … the same way, and it is the surface a user is
 * actually comparing this against, so it reads as native instead of as a
 * control this plugin made up.
 *
 * It also replaced an "Analyzer ready" status line that sat here. That line was
 * Japanese-specific on a global bar, said the same thing as the dictionary row
 * in different words, and read like a crash when it said "not started". What it
 * genuinely reported — that a dictionary can be on disk and still fail to open —
 * now lives on the row that owns the dictionary.
 *
 * Re-annotate and the language toggle keep the right end. The toggle in
 * particular has to stay reachable without scrolling: it was tried inside a
 * section once and landed 1500px down a page that someone who cannot read the
 * panel has to traverse to reach the control that fixes it.
 */
/**
 * A section heading the tab strip can scroll to and highlight.
 *
 * NCM's own settings work this way and its class names say so:
 * `cmd-anchor-link-wrapper` over `cmd-anchor-link-title`. Every section is on
 * one scrolling page and the strip is an index into it, not a filter — measured
 * on the running app, where the ten tabs all sit at `top: 140` while the section
 * headings are spread from -1891 to +2310.
 */
function tabAnchor(key: TabKey, label: string): HTMLElement {
  const el = sectionTitle(label);
  // Deliberately not `data-kc-tab`: that is the strip's own buttons. Sharing one
  // attribute made `querySelectorAll` return ten elements where five were meant,
  // and the five buttons come first in document order, so the click handler's
  // `find` returned a button and scrolled to a sticky element already at the top
  // — every tab click did nothing.
  el.setAttribute("data-kc-anchor", key);
  return el;
}

/**
 * Keep the strip in step with the scroll, and scroll on click.
 *
 * Compares rects on scroll rather than using `IntersectionObserver`. The
 * observer was tried and could never fire: its band was `rootMargin` of
 * `0 0 -80% 0` against the viewport, so a heading had to reach the top fifth to
 * count. Measured on the running app, that band ends at y=173 while the panel
 * starts at y=212 — BetterNCM's own chrome sits above us and the scrolling
 * container is 595px tall inside an 864px window, so no heading could ever
 * enter it and the highlight never moved off the first tab.
 *
 * Any fraction of the viewport has that bug latent in it, since the panel does
 * not own its scroll container. A rect against the strip's own bottom edge has
 * nothing to be wrong about: the current section is the last one whose heading
 * has passed under the strip.
 *
 * The listener is on the document in the capture phase, which sees scroll
 * events from any ancestor container without needing a reference to it — the
 * property the observer was chosen for in the first place.
 */
function linkTabsToScroll(root: HTMLElement): void {
  const tabs = [...root.querySelectorAll<HTMLElement>(".kc-tab")];
  const anchors = [...root.querySelectorAll<HTMLElement>("[data-kc-anchor]")];
  const strip = root.querySelector<HTMLElement>(".kc-tabs");
  const first = anchors[0];
  if (tabs.length === 0 || !first || !strip) return;

  const light = (key: string): void => {
    for (const tab of tabs) {
      tab.classList.toggle("kc-tab-on", tab.getAttribute("data-kc-tab") === key);
    }
  };

  /**
   * The gap between the strip and a heading that has just been scrolled to.
   *
   * One number on purpose: it sets where a clicked heading comes to rest and
   * where the spy counts it as arrived. Written separately they drifted 8px
   * apart, which put every click one section behind.
   */
  const AIR = 8;

  // The scrolling ancestor belongs to BetterNCM, so it is found rather than
  // assumed, and cached because this runs inside a scroll handler. Looked up
  // lazily rather than at setup: BetterNCM builds the config element detached
  // and inserts it later, so at construction there is no scrolling ancestor to
  // find and every rect is zero.
  let scroller: HTMLElement | null = null;

  /**
   * Teach the strip and the anchors how much room the strip really takes.
   *
   * Sticky `top: 0` parks the strip at the scrollport, which sits below the
   * container's own `padding-top` — measured on the running app, the container
   * starts at y=196 with 16px of padding and the strip lands at 212. That band
   * is not covered by anything, so rows scroll visibly through it above the
   * tabs, and it is dead space the tabs could have used.
   *
   * So the strip takes it: a negative margin moves it up in flow and the same
   * negative sticky offset keeps it there once stuck, which matters because the
   * two are separate positions — margin alone would leave the tabs jumping 16px
   * upward on the first scroll.
   *
   * The same padding was breaking clicks, because `scroll-margin-top` counts
   * from the container's top edge and not from below the strip: a heading asked
   * for at 44px landed underneath it. That is why the clearance is published
   * here as a custom property instead of written into the stylesheet — it is the
   * strip's measured height, so it cannot fall out of step with the strip.
   *
   * Read from the host rather than hardcoded: the padding is BetterNCM's and it
   * is free to change it.
   */
  const calibrate = (container: HTMLElement): void => {
    const pad = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
    if (pad > 0) {
      strip.style.marginTop = `-${pad}px`;
      strip.style.top = `-${pad}px`;
    }
    // Two clearances, because the two properties do not measure from the same
    // edge. `scroll-margin-top` counts from the container's border box, sticky
    // `top` counts from its content box, and the gap between them is exactly the
    // padding above. Publishing one number for both put the side column 4px
    // below the settings column at rest: PREVIEW at 259 against JAPANESE at 255.
    // The strip has to paint its own background or rows scroll through it, and
    // the colour has to match the page exactly or the strip becomes a visible
    // panel. Take it from whichever ancestor actually paints one: measured, the
    // first is `body`, because all 13 elements between are fully transparent.
    // Read rather than hardcoded so a themed or reskinned client still matches.
    for (let el: HTMLElement | null = strip.parentElement; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0")) {
        strip.style.background = bg;
        break;
      }
    }

    const clearance = Math.round(strip.getBoundingClientRect().height) + AIR;
    root.style.setProperty("--kc-strip-clearance", `${clearance}px`);
    root.style.setProperty("--kc-side-top", `${Math.max(clearance - pad, 0)}px`);
  };

  const findScroller = (): HTMLElement | null => {
    if (scroller) return scroller;
    for (let el = strip.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) {
        scroller = el;
        calibrate(el);
        break;
      }
    }
    return scroller;
  };

  const atBottom = (): boolean => {
    findScroller();
    // The 2px absorbs subpixel rounding at display scaling, where scrollTop and
    // clientHeight are fractional and never sum to exactly scrollHeight.
    return scroller !== null && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  };

  const current = (): string | null => {
    // The last section is short, so the container runs out of scroll while its
    // heading is still mid-page: Advanced sits at y=1244 in a 595px scroller and
    // can never reach the strip at y=249. Without this it is unreachable by
    // scrolling *and* by clicking, since the click settles the same way. At the
    // end of the scroll the last section is the current one by definition.
    const last = anchors[anchors.length - 1];
    if (last && atBottom()) return last.getAttribute("data-kc-anchor");

    // Where a clicked heading comes to rest counts as arrived, plus a pixel for
    // subpixel rounding. Anything stricter puts the click one section behind.
    const line = strip.getBoundingClientRect().bottom + AIR + 1;
    let key: string | null = first.getAttribute("data-kc-anchor");
    for (const anchor of anchors) {
      if (anchor.getBoundingClientRect().top > line) break;
      key = anchor.getAttribute("data-kc-anchor");
    }
    return key;
  };

  /**
   * The tab a click is still travelling to, if any.
   *
   * Without it the spy lights every section the smooth scroll crosses, walking
   * the indicator to the target instead of moving it there. Cleared on arrival
   * so a hand scroll takes over immediately; the timeout is a backstop for a
   * scroll that cannot reach its target. `scrollend` would say this exactly and
   * is Chrome 114.
   */
  let pending: string | null = null;
  let pendingAt = 0;

  // Scroll fires far more often than the answer changes, so the work is
  // coalesced into one frame and the DOM is only touched when the tab differs.
  let queued = false;
  let waitingForLayout = 0;
  const sync = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      // BetterNCM builds the panel detached and inserts it later, so every rect
      // is 0 until it lands. That reads as "every heading is above the line" and
      // lights the last tab, which is why opening settings showed Advanced.
      // Bounded so a panel that never attaches stops asking.
      if (strip.getBoundingClientRect().height === 0 && waitingForLayout++ < 120) {
        sync();
        return;
      }
      const key = current();
      if (pending) {
        if (key === pending || Date.now() - pendingAt > 1200) pending = null;
        else return;
      }
      if (!key || key === activeTab) return;
      activeTab = key as TabKey;
      light(key);
    });
  };

  document.addEventListener("scroll", sync, true);
  onPanelTeardown(() => document.removeEventListener("scroll", sync, true));
  sync();

  for (const tab of tabs) {
    tab.onclick = () => {
      const key = tab.getAttribute("data-kc-tab");
      const target = anchors.find((a) => a.getAttribute("data-kc-anchor") === key);
      // Scrolls rather than re-renders: the sections are all present, so there
      // is nothing to rebuild and rebuilding would lose the scroll position.
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (key) {
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
  // kc-full spans both grid columns. Without it the strip takes the first
  // cell and pushes the settings and side columns into the wrong ones, which
  // put every card in the right-hand column.
  bar.className = "kc-tabs kc-full";

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
    render(root);
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
  // changes; more than one reading of "EN / 中文" next to a lyrics plugin is
  // plausible. The settings-row experiment made the scope explicit and cost too
  // much elsewhere, so the wording survives as the hover text.
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
      render(root);
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
