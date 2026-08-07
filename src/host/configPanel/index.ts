// The plugin manager settings panel. Plain DOM, no framework. Two columns:
// settings cards on the left, a live preview (rendered with the production
// line renderer) and an about card on the right.

import { rescan } from "../annotator.ts";
import { panelLang, setPanelLang, t, type PanelLang } from "../i18n.ts";
import { nativeState } from "../native.ts";
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

  root.appendChild(buildStatusBar(root));

  const left = document.createElement("div");
  left.className = "kc-col";
  const right = document.createElement("div");
  right.className = "kc-col kc-col-side";

  const refreshPreview = buildPreviewCard(right);

  left.appendChild(sectionTitle(t("sectionJapanese")));
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

  left.appendChild(sectionTitle(t("sectionChinese")));
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
  left.appendChild(sectionTitle(t("sectionFonts")));
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

  left.appendChild(sectionTitle(t("sectionAi")));
  const ai = card();
  ai.appendChild(toggleRow("aiAutoTranslate", t("aiAuto"), t("aiAutoDesc"), resetTranslation));
  ai.appendChild(providerRow(() => render(root)));
  // Gemini has a fixed Google endpoint; the base URL only applies to
  // OpenAI-compatible providers.
  if (getSettings().aiProvider === "openai") {
    ai.appendChild(textRow("aiBaseUrl", "aiBaseUrl", "aiBaseUrlDesc", { placeholder: "https://api.openai.com/v1" }));
  }
  ai.appendChild(apiKeysRow());
  ai.appendChild(
    textRow("aiModel", "aiModel", "aiModelDesc", {
      placeholder: getSettings().aiProvider === "gemini" ? "gemini-3.5-flash-lite" : "gpt-5.6-luna",
    }),
  );
  ai.appendChild(targetLangRow());
  ai.appendChild(textRow("aiCustomPrompt", "aiCustomPrompt", "aiCustomPromptDesc", {}));
  ai.appendChild(clearCacheRow());
  left.appendChild(ai);

  left.appendChild(sectionTitle(t("sectionAdvanced")));
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

function buildStatusBar(root: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  const label = document.createElement("span");
  const dot = document.createElement("span");
  dot.className = "kc-dot";

  const paint = (): string => {
    const s = nativeState();
    bar.className =
      "kc-status kc-full " +
      (s.state === "ready" ? "kc-ready" : s.state === "loading" ? "kc-loading" : "kc-bad");
    label.textContent = "";
    label.appendChild(dot);
    label.appendChild(document.createTextNode(
      s.state === "ready"
        ? t("analyzerReady")
        : s.state === "loading"
          ? t("analyzerLoading")
          : s.state === "uninitialized"
            ? t("analyzerNotStarted")
            : `${t("analyzerFailed")}${s.error ? `: ${s.error}` : ""}`,
    ));
    return s.state;
  };

  // Poll only while the answer can still change. `status` costs 0.044ms
  // (measured over 200 calls), so a ~10s load is under 1ms of work in total,
  // and steady state runs no timer at all.
  //
  // Live while the analyzer is still loading, because the status is otherwise
  // sampled once at build time: opening the panel during the dictionary load
  // showed "loading" and kept showing it after the load finished, the one
  // element whose job is reporting current state reporting a stale one.
  const initial = paint();
  if (initial === "loading" || initial === "uninitialized") {
    const statusPoll = window.setInterval(() => {
      const state = paint();
      if (state !== "loading" && state !== "uninitialized") window.clearInterval(statusPoll);
    }, 500);
    onPanelTeardown(() => window.clearInterval(statusPoll));
  }
  bar.appendChild(label);

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
  // Tried and rejected: moving this into a settings row under Advanced, which
  // is where a preference "belongs". Two things killed it. The segments wrap
  // (中文 broke onto two lines in the narrower row), and it lands 1500px down a
  // 2036px scroll — so someone who opens an English panel they cannot read must
  // scroll past every section they cannot read to reach the control that fixes
  // it. Visibility wins over categorical tidiness for this one control.
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
