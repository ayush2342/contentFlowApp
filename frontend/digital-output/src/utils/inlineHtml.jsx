import React from 'react';

const ALLOWED_TAGS = new Set(['I', 'EM', 'B', 'STRONG', 'SPAN', 'SUP', 'A', 'BR']);

const getAttr = (el, name) => {
  try {
    return el.getAttribute?.(name) || '';
  } catch {
    return '';
  }
};

/**
 * Walk a DOM node tree into safe React children for paragraph/list text.
 * Supports cendoc inline markup from output JSON: i/em, b/strong, glossary spans, endnote sup.
 */
const walkNodes = (nodes, keyPrefix = 'n') => {
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
    const children = walkNodes(node.childNodes, key);

    if (!ALLOWED_TAGS.has(tag)) {
      out.push(...children);
      return;
    }

    if (tag === 'BR') {
      out.push(<br key={key} />);
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

/**
 * Render output-JSON inline HTML as React nodes (escaped text when no tags).
 */
export const renderInlineHtml = (html) => {
  const value = String(html ?? '');
  if (!value) return null;
  if (!looksLikeInlineHtml(value)) return value;

  if (typeof DOMParser === 'undefined') {
    return value.replace(/<[^>]+>/g, '');
  }

  try {
    const doc = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html');
    const root = doc.body?.firstElementChild || doc.body;
    return walkNodes(root?.childNodes || []);
  } catch {
    return value.replace(/<[^>]+>/g, '');
  }
};

export default renderInlineHtml;
