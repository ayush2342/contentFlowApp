/**
 * Markdown support for ParagraphText blocks.
 *
 * A ParagraphText block can carry a whole Markdown snippet in `data.text`
 * (headings, lists, a quote, inline emphasis, highlights, links). Parsing it
 * here — on the document data both the web renderer and the InDesign job read —
 * keeps one implementation instead of one per renderer, and leaves every other
 * block type untouched.
 *
 * The result is attached as `data.rich_text`: a flat list of
 * `{ kind, html, number?, markerColor? }` entries, where `html` uses the inline
 * markup both renderers already understand (b/i/u/span/mark/a/sup/sub/br).
 * A single newline stays inside the paragraph as `<br>`. A blank line starts
 * the next block. Renderers only decide how
 * each `kind` looks; they do no Markdown parsing.
 */

const ESCAPED_ASTERISK = '\u0000';
const ESCAPED_UNDERSCORE = '\u0001';

const MARKDOWN_SIGNALS = [
  /^\s{0,3}#{1,6}\s+\S/m, // # Heading
  /^\s{0,3}>\s+\S/m, // > quote
  /^\s{0,3}[-*+]\s+\S/m, // - item
  /^\s{0,3}\d+[.)]\s+\S/m, // 1. item
  /\*\*\*[^*\n]+?\*\*\*/, // ***bold italic***
  /\*\*[^*\n]+\*\*/, // **bold**
  /__[^_\n]+__/, // __bold__
  /(^|[^*\n])\*(?!\s)[^*\n]+?\*(?!\*)/, // *italic*
  /<mark[\s>]/i, // <mark>
  /<u[\s>]/i, // <u>
  /<sub[\s>]/i, // <sub>
  /<span\b[^>]*font-size\s*:/i,
  /<span\b[^>]*background-color\s*:/i,
  /<span\b[^>]*(?:^|[^-a-zA-Z])color\s*:/i,
  /\[[^\]\n]+\]\([^)\s]+\)/, // [text](url)
];

/** True when a ParagraphText string carries Markdown worth expanding. */
export const hasMarkdown = (value) => {
  const text = String(value ?? '');
  if (!text) return false;
  return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text));
};

const escapeAttribute = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Convert inline Markdown to the HTML tags the renderers already handle.
 * Existing HTML in the source (mark, span, sup) is passed through as-is.
 */
export const markdownInlineToHtml = (value) => {
  let text = String(value ?? '');
  if (!text) return '';

  // Keep backslash-escaped emphasis characters literal.
  text = text.replace(/\\\*/g, ESCAPED_ASTERISK).replace(/\\_/g, ESCAPED_UNDERSCORE);

  // Links before emphasis: link text may itself be emphasised.
  text = text.replace(
    /\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
    (match, label, href) => `<a href="${escapeAttribute(href)}">${label}</a>`
  );

  text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<b><i>$1</i></b>');
  text = text.replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__([^\n]+?)__/g, '<b>$1</b>');
  // Single markers only run after the double ones are gone, so no lookbehind.
  text = text.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>');
  // Underscores only at word boundaries, so file_name_here stays intact.
  text = text.replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s.,;:!?)])/g, '$1<i>$2</i>');

  return text.replace(new RegExp(ESCAPED_ASTERISK, 'g'), '*').replace(
    new RegExp(ESCAPED_UNDERSCORE, 'g'),
    '_'
  );
};

const classifyLine = (rawLine) => {
  const line = String(rawLine ?? '').replace(/\s+$/, '');
  const trimmed = line.replace(/^\s+/, '');

  if (!trimmed) return { kind: 'blank', text: '' };

  let match = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (match) {
    return { kind: match[1].length === 1 ? 'h1' : 'h2', text: match[2] };
  }

  match = /^>\s?(.*)$/.exec(trimmed);
  if (match) return { kind: 'quote', text: match[1] };

  match = /^[-*+]\s+(.*)$/.exec(trimmed);
  if (match) return { kind: 'bullet', text: match[1] };

  match = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
  if (match) return { kind: 'number', text: match[2] };

  return { kind: 'paragraph', text: trimmed };
};

/**
 * Parse a Markdown snippet into the flat block list renderers consume.
 * Consecutive plain lines stay one paragraph, joined with `<br>`. A blank line
 * starts the next block. Numbered items are renumbered sequentially per run.
 */
export const parseMarkdownRichText = (value) => {
  const text = String(value ?? '');
  if (!text.trim()) return [];

  const out = [];
  let paragraphLines = [];
  let numberCounter = 0;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    // One newline is a line break. A blank line already flushed this paragraph.
    out.push({ kind: 'paragraph', html: markdownInlineToHtml(paragraphLines.join('<br>')) });
    paragraphLines = [];
  };

  text.split(/\r\n|\r|\n/).forEach((rawLine) => {
    const line = classifyLine(rawLine);

    if (line.kind !== 'paragraph') flushParagraph();
    if (line.kind !== 'number') numberCounter = 0;

    switch (line.kind) {
      case 'blank':
        break;
      case 'paragraph':
        paragraphLines.push(line.text);
        break;
      case 'number':
        numberCounter += 1;
        out.push({
          kind: 'number',
          html: markdownInlineToHtml(line.text),
          number: numberCounter,
        });
        break;
      default:
        out.push({ kind: line.kind, html: markdownInlineToHtml(line.text) });
    }
  });

  flushParagraph();

  return out.filter((entry) => entry.html !== '');
};

const normalizeType = (value) =>
  String(value ?? '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase();

const PARAGRAPH_TYPES = new Set(['paragraphtext', 'paragraph']);

export const normalizeMarkerColor = (value) => {
  const raw = String(value ?? '').trim();
  const hex = raw.replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex.split('').map((char) => char + char).join('')}`;
  }
  return '';
};

/**
 * Attach `data.rich_text` to every ParagraphText block whose text is Markdown.
 * Blocks without Markdown, and all other block types, are left alone.
 */
export const expandMarkdownRichText = (document) => {
  const pages = document?.pages;
  if (!Array.isArray(pages)) return document;

  for (const page of pages) {
    const blocks = Array.isArray(page?.content) ? page.content : [];
    for (const block of blocks) {
      if (!PARAGRAPH_TYPES.has(normalizeType(block?.type))) continue;

      const text = block?.data?.text;
      if (!hasMarkdown(text)) continue;

      const richText = parseMarkdownRichText(text);
      const markerColor = normalizeMarkerColor(
        block?.data?.marker_color || block?.data?.markerColor
      );
      if (markerColor) {
        richText.forEach((entry) => {
          if (entry.kind === 'bullet' || entry.kind === 'number') {
            entry.markerColor = markerColor;
          }
        });
      }
      if (richText.length) block.data.rich_text = richText;
    }
  }

  return document;
};

export default expandMarkdownRichText;
