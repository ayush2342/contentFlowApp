import React from 'react';

const ALLOWED_TAGS = new Set(['I', 'EM', 'B', 'STRONG', 'SPAN', 'SUP', 'A', 'BR', 'MARK']);

const getAttr = (el, name) => {
  try {
    return el.getAttribute?.(name) || '';
  } catch {
    return '';
  }
};

const readStyleValue = (style, property) => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Don't let "color" match the end of "background-color".
  const match = new RegExp(`(?:^|;)\\s*(?<![\\w-])${escaped}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return match ? match[1].trim().replace(/^['"]+|['"]+$/g, '') : '';
};

/**
 * Inline styles the PDF already honors on spans. Theme-owned badges pass
 * ignoreColors so their CSS color, size, and fill win.
 */
const getSpanStyle = (el, options) => {
  if (options.ignoreColors) return null;

  const style = getAttr(el, 'style');
  if (!style) return null;

  const backgroundColor = readStyleValue(style, 'background-color');
  const color = readStyleValue(style, 'color');
  const fontSize = readStyleValue(style, 'font-size');
  const fontFamily = readStyleValue(style, 'font-family');
  const next = {};

  if (color) next.color = color;
  if (backgroundColor) next.backgroundColor = backgroundColor;
  if (fontSize) next.fontSize = fontSize;
  if (fontFamily) next.fontFamily = /\s/.test(fontFamily) ? `'${fontFamily}'` : fontFamily;

  return Object.keys(next).length ? next : null;
};

/**
 * Walk a DOM node tree into safe React children for paragraph/list text.
 * Supports cendoc inline markup from output JSON: i/em, b/strong, glossary spans, endnote sup.
 */
const walkNodes = (nodes, keyPrefix = 'n', options = {}) => {
  const out = [];

  Array.from(nodes || []).forEach((node, index) => {
    const key = `${keyPrefix}-${index}`;

    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || '';
      if (value) out.push(<React.Fragment key={key}>{value}</React.Fragment>);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = String(node.tagName || '').toUpperCase();
    const children = walkNodes(node.childNodes, key, options);

    if (!ALLOWED_TAGS.has(tag)) {
      out.push(...children);
      return;
    }

    if (tag === 'BR') {
      out.push(<br key={key} />);
      return;
    }

    if (tag === 'MARK') {
      out.push(
        <mark key={key} className="cendoc-mark">
          {children}
        </mark>
      );
      return;
    }

    if (tag === 'I' || tag === 'EM') {
      out.push(<em key={key}>{children}</em>);
      return;
    }

    if (tag === 'B' || tag === 'STRONG') {
      out.push(<strong key={key}>{children}</strong>);
      return;
    }

    if (tag === 'SUP') {
      const noteClass = getAttr(node, 'class');
      const isEndnote = /cendoc-endnote/i.test(noteClass);
      out.push(
        <sup
          key={key}
          className={isEndnote ? 'cendoc-endnote' : undefined}
          title={isEndnote ? getAttr(node, 'data-body') || undefined : undefined}
        >
          {children}
        </sup>
      );
      return;
    }

    if (tag === 'SPAN') {
      const cls = getAttr(node, 'class');
      if (/cendoc-glossary-term/i.test(cls)) {
        out.push(
          <span
            key={key}
            className="cendoc-glossary-term"
            title={getAttr(node, 'data-def') || getAttr(node, 'data-term') || undefined}
            data-term={getAttr(node, 'data-term') || undefined}
          >
            {children}
          </span>
        );
        return;
      }
      const spanStyle = getSpanStyle(node, options);
      if (spanStyle) {
        out.push(
          <span key={key} style={spanStyle}>
            {children}
          </span>
        );
        return;
      }
      out.push(<React.Fragment key={key}>{children}</React.Fragment>);
      return;
    }

    if (tag === 'A') {
      const href = getAttr(node, 'href');
      if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {children.length ? children : href}
          </a>
        );
        return;
      }
      out.push(...children);
    }
  });

  return out;
};

/** True when the string looks like it may contain inline HTML tags. */
export const looksLikeInlineHtml = (value) =>
  /<\/?[a-z][\s\S]*>/i.test(String(value ?? ''));

/** Plain text version of inline HTML, for regex matching and alt text. */
export const stripInlineHtml = (html) => {
  const value = String(html ?? '');
  if (!value || !looksLikeInlineHtml(value)) return value;

  if (typeof DOMParser === 'undefined') {
    return value.replace(/<[^>]+>/g, '');
  }

  try {
    const doc = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html');
    return doc.body?.textContent ?? value.replace(/<[^>]+>/g, '');
  } catch {
    return value.replace(/<[^>]+>/g, '');
  }
};

/**
 * Render output-JSON inline HTML as React nodes (escaped text when no tags).
 * Pass { ignoreColors: true } for blocks whose theme color must win, e.g. badges.
 */
export const renderInlineHtml = (html, options = {}) => {
  const value = String(html ?? '');
  if (!value) return null;
  if (!looksLikeInlineHtml(value)) return value;

  if (typeof DOMParser === 'undefined') {
    return value.replace(/<[^>]+>/g, '');
  }

  try {
    const doc = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html');
    const root = doc.body?.firstElementChild || doc.body;
    return walkNodes(root?.childNodes || [], 'n', options);
  } catch {
    return value.replace(/<[^>]+>/g, '');
  }
};

export default renderInlineHtml;
