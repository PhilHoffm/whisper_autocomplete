/**
 * Pure whisper-syntax logic. It has no dependency on Foundry globals or the DOM, so it can be unit-tested in Node.
 */

export const PLAYERS = "Players";
export const GM = ["GM", "DM"];

// This is the all-important whisper syntax matcher.
// It must match any of the following examples:
//
// /w ' or '/whisper ' or '/wHiSpEr ' (case-insensitive)
//
// Note: '/w' stands for any of the above syntaxes (like '/whisper') from here on in this comment.
// '/w [' (match the start of an Array of targets)
//
// '/w [someName,' (an array with any name(s) followed by a comma)
//
// BUT NOT!...
// '/w someName ' or '/w someName,' or '/w someName, ' (i.e. stop matching after a non-array whisper target is complete)
// '/w [someName, otherName] hello,' (i.e. stop matching if an array whisper target is complete)
//
// For reference, ChatLog.CHAT_COMMANDS.whisper.rgx in Foundry core does not meet all our needs:
// /^(\/w(?:hisper)?\s)(\[[^\]]+]|\S+)\s*([^]*)/i
const whisperPattern = /^(\/w(?:hisper)?\s{1}(?:\[)?)((?<=\[)\s*(?:\s*[^,\]]+,\s*)*)?(?!.*\])/i;
// when the above regex pattern is used in a split(), define the parts by array index...
const WHISPER_SYNTAX_INDEX = 1;
const TARGETS_IN_ARRAY_INDEX = 2;

// match if the input represents a list (array) of targets
const listOfNamesRegex = /^(\/w(?:hisper)?\s{1}\[)((?:\s*[^,\]]+,\s*)+)(?!.*\])/i;

/**
 * @typedef WhisperUser
 * @property {string} name
 * @property {boolean} isGM
 */

/**
 * Collect the (upper-cased) names that must not be offered again, because they were already targeted in the array.
 * Targeting "Players" also covers every non-GM user, and targeting "GM"/"DM" covers every GM user.
 * @param {string|undefined} names     The already-typed part of the target array, e.g. "Alice, Bob, ".
 * @param {WhisperUser[]} users
 * @returns {string[]}
 */
export function getAlreadyTargeted(names, users) {
  if (typeof names === "undefined") return [];
  // split by commas, then remove the last blank item
  let arr = names.toUpperCase().split(",");
  arr.pop();
  arr = arr.map(n => n.trim());
  const upperNames = (isGM) => users.filter(u => u.isGM === isGM && u.name).map(u => u.name.toUpperCase());
  if (arr.includes(PLAYERS.toUpperCase())) arr = arr.concat(upperNames(false));
  if (GM.some(g => arr.includes(g.toUpperCase()))) arr = arr.concat(upperNames(true), GM);
  return arr;
}

/**
 * Determine the whisper targets that could be offered for the given input.
 * @param {string} text                   The chat text in front of the cursor.
 * @param {WhisperUser[]} users
 * @param {object} [options]
 * @param {boolean} [options.includeGMNames=false]  Offer the names of GM users as individual targets.
 * @returns {{input: string, matches: string[]}|null}  `null` if this is no whisper or nothing matches.
 */
export function getSuggestions(text, users, { includeGMNames = false } = {}) {
  if (!whisperPattern.test(text)) return null;

  const parts = text.split(whisperPattern);
  const input = parts[parts.length - 1]; // newly typed input
  const alreadyTargeted = getAlreadyTargeted(parts[TARGETS_IN_ARRAY_INDEX], users);

  const names = users.filter(u => u.name && (includeGMNames || !u.isGM)).map(u => u.name);
  names.push(PLAYERS, GM[0]);

  const needle = input.toUpperCase();
  const matches = names.filter(target => {
    const p = target.toUpperCase();
    return p.includes(needle) && p !== needle && !alreadyTargeted.includes(p);
  });
  return matches.length ? { input, matches: [...new Set(matches)] } : null;
}

/**
 * If exactly one suggestion starts with the typed characters, return it. It is the typeahead (ghost text) candidate.
 * @param {string} input        The characters typed for the current target.
 * @param {string[]} matches
 * @returns {string|null}
 */
export function getUniquePrefixMatch(input, matches) {
  const needle = input.toUpperCase();
  const candidates = matches.filter(target => {
    const p = target.toUpperCase();
    return p.startsWith(needle) && p !== needle;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Build the text that results from choosing a target.
 * @param {string} text                      The chat text in front of the cursor.
 * @param {string} match                     The chosen target name.
 * @param {boolean} [isShiftSelected=false]  Shift-selection starts a `[...]` target array.
 * @returns {{ghost: string, overwrite: string}|null}  `ghost` is the completion without added brackets (used for the
 *                                           typeahead preview), `overwrite` is the text that replaces `text`.
 */
export function buildCompletion(text, match, isShiftSelected = false) {
  if (!match) return null;
  const arr = text.split(whisperPattern);
  if (arr.length <= TARGETS_IN_ARRAY_INDEX) return null;
  let startingSyntax = arr[WHISPER_SYNTAX_INDEX];
  const targetsAlreadyInArray = arr[TARGETS_IN_ARRAY_INDEX] || "";

  const isArrayOfTargets = startingSyntax.includes("[");
  // add a `, ` if this is an array of targets
  let charactersAfter = isArrayOfTargets ? ", " : " ";
  const ghost = startingSyntax + targetsAlreadyInArray + match + charactersAfter;

  if (!isArrayOfTargets) {
    if (isShiftSelected) {
      // shift-selection: start the bracket syntax now, so more targets can be added
      startingSyntax += "[";
      charactersAfter = ", ";
    } else if (match.includes(" ")) {
      // a whisper target with a space in it only works if wrapped in [], so close the array right away
      startingSyntax += "[";
      charactersAfter = "] ";
    }
  }
  return { ghost, overwrite: startingSyntax + targetsAlreadyInArray + match + charactersAfter };
}

/**
 * Handle typing "]": close an open array of targets, dropping a trailing comma.
 * @param {string} text  The chat text in front of the cursor.
 * @returns {string|null}  The replacement text, or `null` if there is no open array of completed targets.
 */
export function closeTargetArray(text) {
  if (!listOfNamesRegex.test(text)) return null;
  const trimmed = text.trim();
  return (trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed) + "] ";
}
