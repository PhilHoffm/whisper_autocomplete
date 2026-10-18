import { buildCompletion, closeTargetArray, getSuggestions, getUniquePrefixMatch } from "./whisper-logic.mjs";

const MODULE_ID = "autocomplete-whisper";
const I18N = "AUTOCOMPLETE_WHISPER";
const SETTING_INCLUDE_GM_NAMES = "includeGMNamesInList";

/** Font Awesome icons for the special (non-user) targets. */
const TARGET_ICONS = { Players: "fa-users", GM: "fa-dice-d20" };

/**
 * All live controllers (the chat input in the sidebar/notifications, and possibly one in a popout).
 * @type {Set<WhisperAutocomplete>}
 */
const controllers = new Set();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_INCLUDE_GM_NAMES, {
    name: `${I18N}.Settings.IncludeGMNames.Name`,
    hint: `${I18N}.Settings.IncludeGMNames.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

// The chat input is a ProseMirror editor since V14. Plugins are collected through ChatLog#_onConfigurePlugins when the
// editor is activated, so we hook in there. This runs before the UI is built (`ready`), and also covers chat popouts.
Hooks.once("setup", () => {
  const proto = CONFIG.ui.chat.prototype;
  const original = proto._onConfigurePlugins;
  proto._onConfigurePlugins = function(event) {
    original.call(this, event);
    if (event.target.closest("#chat-message")) event.plugins[MODULE_ID] = buildPlugin();
  };
});

// The chat input element is moved around (sidebar <-> notifications <-> popout) and the sidebar can collapse:
// never leave a stale menu behind.
Hooks.on("renderChatInput", closeAllMenus);
Hooks.on("collapseSidebar", closeAllMenus);

function closeAllMenus() {
  for (const controller of controllers) controller.close();
}

/* -------------------------------------------- */
/*  ProseMirror Plugin                          */
/* -------------------------------------------- */

/**
 * @returns {ProseMirror.Plugin}
 */
function buildPlugin() {
  const views = new WeakMap();
  return new foundry.prosemirror.Plugin({
    view(view) {
      const controller = new WhisperAutocomplete(view);
      views.set(view, controller);
      return controller;
    },
    props: {
      handleKeyDown: (view, event) => views.get(view)?.onKeyDown(event) ?? false
    }
  });
}

/**
 * Watches the chat editor for whisper commands, offers matching targets in Foundry's native autocomplete menu and
 * previews the completion as "ghost" text.
 */
class WhisperAutocomplete {
  /**
   * @param {ProseMirror.EditorView} view
   */
  constructor(view) {
    this.#view = view;
    this.#autocomplete = new foundry.applications.ux.Autocomplete.implementation({
      onSelect: this.#onSelect.bind(this)
    });
    view.dom.addEventListener("blur", () => this.close(), { signal: this.#abort.signal });
    controllers.add(this);
  }

  #view;

  /** @type {Autocomplete} */
  #autocomplete;

  /** Removes the listeners which live as long as the editor. */
  #abort = new AbortController();

  /** Removes the listeners which live as long as the menu is open. */
  #menuAbort = null;

  #menuOpen = false;

  /** Was the menu entry clicked while holding Shift? */
  #shiftSelect = false;

  /** @type {HTMLSpanElement|null} */
  #ghost = null;

  /** The element the menu and the ghost text are positioned relative to. */
  get #container() {
    return this.#view.dom.closest(".editor-container") ?? this.#view.dom;
  }

  /* -------------------------------------------- */
  /*  ProseMirror PluginView Interface            */
  /* -------------------------------------------- */

  /**
   * @param {ProseMirror.EditorView} view
   * @param {ProseMirror.EditorState} prevState
   */
  update(view, prevState) {
    this.#view = view;
    const { doc, selection } = view.state;
    if ( prevState.doc.eq(doc) && prevState.selection.eq(selection) ) return;
    this.#refresh();
  }

  destroy() {
    this.close();
    this.#abort.abort();
    controllers.delete(this);
  }

  /**
   * Handle `]` to close an open array of whisper targets.
   * @param {KeyboardEvent} event
   * @returns {boolean}  Whether the event was handled.
   */
  onKeyDown(event) {
    if ( (event.key !== "]") || event.isComposing || event.metaKey ) return false;
    const context = this.#getContext();
    const replacement = context && closeTargetArray(context.text);
    if ( !replacement ) return false;
    event.preventDefault();
    this.#replace(context.from, context.to, replacement);
    return true;
  }

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  /**
   * Close the menu and remove the ghost text.
   */
  close() {
    this.#hideGhost();
    this.#menuAbort?.abort();
    this.#menuAbort = null;
    if ( this.#menuOpen ) {
      this.#menuOpen = false;
      if ( ui.autocomplete === this.#autocomplete ) this.#autocomplete.dismiss();
    }
  }

  /* -------------------------------------------- */
  /*  Editor State                                */
  /* -------------------------------------------- */

  /**
   * Get the text in front of the cursor, if the cursor is in the first paragraph of the message.
   * Whisper commands always start the message.
   * @returns {{from: number, to: number, text: string}|null}
   */
  #getContext() {
    const { selection, doc } = this.#view.state;
    if ( !selection.empty ) return null;
    const { $head } = selection;
    if ( ($head.depth !== 1) || ($head.index(0) !== 0) || !$head.parent.isTextblock ) return null;
    const from = $head.start();
    const to = $head.pos;
    return { from, to, text: doc.textBetween(from, to, "\n", "\n") };
  }

  /**
   * Replace a range of the message and put the cursor behind the new text.
   * @param {number} from
   * @param {number} to
   * @param {string} text
   */
  #replace(from, to, text) {
    const { state } = this.#view;
    const tr = state.tr.insertText(text, from, to);
    tr.setSelection(foundry.prosemirror.TextSelection.create(tr.doc, from + text.length));
    this.#view.dispatch(tr.scrollIntoView());
    this.#view.focus();
  }

  /* -------------------------------------------- */
  /*  Menu                                        */
  /* -------------------------------------------- */

  /**
   * Re-evaluate the message and show, update or close the menu.
   */
  #refresh() {
    const context = this.#view.hasFocus() ? this.#getContext() : null;
    const users = Array.from(game.users, user => ({ name: user.name, isGM: user.isGM }));
    const includeGMNames = game.settings.get(MODULE_ID, SETTING_INCLUDE_GM_NAMES);
    const suggestions = context && getSuggestions(context.text, users, { includeGMNames });
    if ( !suggestions ) return this.close();

    const { input, matches } = suggestions;
    const uniqueMatch = getUniquePrefixMatch(input, matches);
    this.#openMenu(input, matches, uniqueMatch);
    this.#showGhost(context, uniqueMatch);
  }

  /**
   * @param {string} input         The characters typed so far for the current target.
   * @param {string[]} matches     The targets to offer.
   * @param {string|null} unique   The one target which completes the typed characters, if there is exactly one.
   */
  #openMenu(input, matches, unique) {
    const container = this.#container;
    const entries = matches.map(name => ({ identifier: name, label: buildLabel(name, input) }));
    this.#autocomplete.activate(container, entries, { prefix: input });

    // Foundry opens the menu below the target by default. The chat input sits at the bottom of the screen.
    const menu = this.#autocomplete.element;
    if ( menu ) {
      const top = container.getBoundingClientRect().top - menu.offsetHeight;
      if ( top >= 0 ) menu.style.top = `${top}px`;
    }

    // Pre-select the only candidate, so that Tab/Enter completes it.
    if ( unique ) this.#autocomplete.select();

    if ( !this.#menuOpen ) this.#attachMenuListeners();
    this.#menuOpen = true;
  }

  #attachMenuListeners() {
    const doc = this.#view.dom.ownerDocument;
    this.#menuAbort = new AbortController();
    const { signal } = this.#menuAbort;
    const inMenu = event => !!event.target.closest?.("#autocomplete");
    // Keep the focus in the editor when clicking an entry, so that the menu is not closed by the blur handler.
    doc.addEventListener("mousedown", event => {
      if ( inMenu(event) ) event.preventDefault();
    }, { capture: true, signal });
    // Remember Shift, as the click is not passed to the selection callback.
    doc.addEventListener("click", event => {
      this.#shiftSelect = event.shiftKey && inMenu(event);
    }, { capture: true, signal });
  }

  /**
   * Handle an entry being selected and committed.
   * @type {AutocompleteCallback}
   */
  #onSelect(identifier) {
    const shift = this.#shiftSelect;
    this.#shiftSelect = false;
    this.close();
    // Autocomplete#commit dismisses the menu right after this callback. Edit afterwards, since the edit may re-open it.
    queueMicrotask(() => this.#complete(identifier, shift));
  }

  /**
   * Insert the chosen target.
   * @param {string} name     The chosen target.
   * @param {boolean} shift   Start an array of targets.
   */
  #complete(name, shift) {
    const context = this.#getContext();
    const completion = context && buildCompletion(context.text, name, shift);
    if ( completion ) this.#replace(context.from, context.to, completion.overwrite);
  }

  /* -------------------------------------------- */
  /*  Ghost Text                                  */
  /* -------------------------------------------- */

  /**
   * Preview the completion of the only candidate behind the cursor.
   * @param {{text: string}} context
   * @param {string|null} match
   */
  #showGhost(context, match) {
    const { $head } = this.#view.state.selection;
    const completion = match && buildCompletion(context.text, match);
    const atEnd = $head.parentOffset === $head.parent.content.size;
    const typed = context.text;
    if ( !completion || !atEnd || !completion.ghost.toUpperCase().startsWith(typed.toUpperCase()) ) {
      return this.#hideGhost();
    }

    const container = this.#container;
    const win = container.ownerDocument.defaultView;
    if ( win.getComputedStyle(container).position === "static" ) container.style.position = "relative";
    this.#ghost ??= Object.assign(container.ownerDocument.createElement("span"), { className: "acw-ghost" });
    this.#ghost.textContent = completion.ghost.slice(typed.length);
    if ( this.#ghost.parentElement !== container ) container.append(this.#ghost);

    // Place the text at the cursor, compensating for a scaled UI.
    const caret = this.#view.coordsAtPos(this.#view.state.selection.head);
    const box = container.getBoundingClientRect();
    const scale = container.offsetWidth ? (box.width / container.offsetWidth) : 1;
    const style = win.getComputedStyle(this.#view.dom);
    Object.assign(this.#ghost.style, {
      left: `${((caret.left - box.left) / scale) - container.clientLeft}px`,
      top: `${((caret.top - box.top) / scale) - container.clientTop}px`,
      lineHeight: `${(caret.bottom - caret.top) / scale}px`,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing
    });
  }

  #hideGhost() {
    this.#ghost?.remove();
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Build the label of a menu entry: an icon, and the name with the typed characters in bold.
 * Autocomplete renders labels with `append`, so a node (rather than HTML which would need escaping) is fine.
 * @param {string} name
 * @param {string} input
 * @returns {HTMLSpanElement}
 */
function buildLabel(name, input) {
  const label = document.createElement("span");
  label.className = "acw-entry";
  const icon = document.createElement("i");
  icon.className = `fa-solid ${TARGET_ICONS[name] ?? "fa-user"} fa-fw acw-icon`;
  label.append(icon);

  const start = input ? name.toUpperCase().indexOf(input.toUpperCase()) : -1;
  if ( start < 0 ) label.append(name);
  else {
    const strong = document.createElement("strong");
    strong.textContent = name.slice(start, start + input.length);
    label.append(name.slice(0, start), strong, name.slice(start + input.length));
  }
  return label;
}
