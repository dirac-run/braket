/** Shell recognition facts about a source span; never runtime argv evaluation. */
export const WORD_DYNAMIC = 1;
/** An unquoted expansion may introduce word splitting or option/command tokens. */
export const WORD_MAY_SPLIT = 2;
/** An unquoted pathname/brace expansion may change argv cardinality. */
export const WORD_MAY_EXPAND = 4;
/** Any quoting/escaping makes a word ineligible as a bare shell reserved word. */
export const WORD_QUOTED = 8;
