// Turns a PDF, Word (.docx), Markdown or text file into a list of paragraphs worth reading aloud.
import * as pdfjs from './vendor/pdfjs/pdf.min.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/;
const PLAIN = /\.(txt|text)$/;

/** @returns {Promise<{ paragraphs: string[], pages?: number, warning?: string }>} */
export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return fromPdf(file);
  if (name.endsWith('.docx')) return fromDocx(file);
  if (name.endsWith('.doc')) {
    throw new Error('Old .doc files cannot be read in the browser. Save it as .docx or PDF first.');
  }
  if (MARKDOWN.test(name) || file.type === 'text/markdown') {
    return { paragraphs: splitMarkdown(await readText(file)) };
  }
  if (PLAIN.test(name) || file.type.startsWith('text/')) return { paragraphs: splitPlain(await readText(file)) };
  throw new Error(`Can't read ${file.name}. Use a PDF, Word (.docx), Markdown (.md) or text (.txt) file.`);
}

/** Decode a text file: UTF-8 or UTF-16 (by byte-order mark), else Windows-1252 as older editors save. */
async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---- Markdown ----

/**
 * Markdown to spoken paragraphs: headings, list items and table rows each become their own
 * paragraph; code blocks, images, link targets, HTML and formatting marks are dropped.
 */
export function splitMarkdown(source) {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n(---|\.\.\.)\n/, '') // YAML front matter
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const blocks = [];
  let current = [];
  let fence = null;
  let tableRow = false;
  const flush = () => {
    if (current.length) blocks.push(current.join(' '));
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const fenceMark = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMark) {
      flush();
      fence = fenceMark[1];
      continue;
    }
    line = line.replace(/^(\s*>\s?)+/, ''); // blockquotes: read the quoted text
    if (!line.trim()) {
      flush();
      tableRow = false;
      continue;
    }
    if (/^\s*\[[^\]]+\]:\s*\S/.test(line)) continue; // link reference definitions
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) && !current.length) continue; // horizontal rule

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      blocks.push(heading[1]);
      continue;
    }
    if (/^\s{0,3}(=+|-+)\s*$/.test(line) && current.length) {
      flush(); // setext heading underline: the lines above were the heading
      continue;
    }
    if (TABLE_RULE.test(line) && line.includes('-')) continue;
    if (line.includes('|') && (tableRow || /^\s*\|/.test(line) || TABLE_RULE.test(lines[i + 1] ?? ''))) {
      flush();
      tableRow = true;
      const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length) blocks.push(cells.join(', '));
      continue;
    }
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (item) {
      flush();
      current.push(item[1]);
      continue;
    }
    current.push(line.trim());
  }
  flush();
  return blocks.map((b) => tidy(inlineMarkdown(b))).filter(isSpeakable);
}

function inlineMarkdown(text) {
  // Backslash escapes are set aside first so the formatting rules below leave them alone.
  const escaped = [];
  const restore = (s) => s.replace(/(\d+)/g, (_, i) => escaped[i]);
  return decodeEntities(restore(
    text
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, (_, c) => `${escaped.push(c) - 1}`)
      .replace(/<([^\s<>@]+@[^\s<>]+\.[a-z]{2,})>/gi, '$1') // <email@autolinks>
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/\[\^[^\]]+\]/g, '') // footnote references
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url)
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // [text][ref]
      .replace(/<((?:https?:|mailto:)[^>]+)>/g, '$1') // <autolinks>
      .replace(/<\/?[a-z][^>]*>/gi, '') // inline HTML tags
      .replace(/`+([^`]+)`+/g, '$1') // inline code
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2') // bold, strikethrough
      .replace(/(^|[^\w*])[*_]([^*_]+?)[*_](?=[^\w*]|$)/g, '$1$2'), // italics
  ));
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return named[code.toLowerCase()] ?? match;
  });
}

// ---- Word ----

async function fromDocx(file) {
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { paragraphs: splitPlain(value) };
}

// ---- Plain text ----

export function splitPlain(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => tidy(p.replace(/-\n(?=[a-z])/g, '').replace(/\n/g, ' ')))
    .filter(isSpeakable);
}

// ---- PDF ----

async function fromPdf(file) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
  }).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(pageLines(await page.getTextContent()));
    page.cleanup();
  }
  await doc.destroy();

  const chars = pages.reduce((sum, lines) => sum + lines.reduce((s, l) => s + l.text.length, 0), 0);
  if (chars < 20 * pages.length && chars < 200) {
    return {
      paragraphs: [],
      pages: pages.length,
      warning: 'This PDF has almost no text layer. It is probably scanned images, which would need OCR first.',
    };
  }

  dropRunningHeads(pages);

  const paragraphs = [];
  for (const lines of pages) {
    const paras = pageParagraphs(lines);
    // A paragraph that runs over a page break: no full stop at the end, lowercase start next page.
    const last = paragraphs.at(-1);
    if (last && paras.length && !/[.!?:;"”’)\]]$/.test(last) && /^[a-z(]/.test(paras[0])) {
      paragraphs[paragraphs.length - 1] = joinLines(last, paras.shift());
    }
    paragraphs.push(...paras);
  }
  return { paragraphs: paragraphs.map(tidy).filter(isSpeakable), pages: pages.length };
}

/** Group a page's text items into visual lines with their position. */
function pageLines(content) {
  const lines = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.replace(/\s+/g, ' ').trim() });
    cur = null;
  };
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const [, , , , x, y] = item.transform;
    const h = item.height || Math.abs(item.transform[3]) || 10;
    if (item.str) {
      if (cur && Math.abs(y - cur.y) > Math.max(cur.h, h) * 0.5) flush();
      if (!cur) cur = { text: '', x, y, h, end: x };
      else if (x - cur.end > h * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(item.str)) cur.text += ' ';
      cur.text += item.str;
      cur.end = Math.max(cur.end, x + item.width);
      cur.h = Math.max(cur.h, h);
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

const PAGE_NUMBER = /^(page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(\s*(of|\/)\s*\d{1,4})?$/i;

/** Remove page numbers and headers/footers that repeat across pages. */
function dropRunningHeads(pages) {
  const key = (text) => text.toLowerCase().replace(/\d+/g, '#');
  const counts = new Map();
  for (const lines of pages) {
    const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => key(l.text)));
    for (const k of edge) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const repeated = (text) => pages.length >= 3 && counts.get(key(text)) >= Math.max(3, pages.length * 0.4);
  for (const lines of pages) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const edge = i < 2 || i >= lines.length - 2;
      if (PAGE_NUMBER.test(lines[i].text) || (edge && repeated(lines[i].text))) lines.splice(i, 1);
    }
  }
}

/** Split a page's lines into paragraphs from line spacing, indents and short last lines. */
function pageParagraphs(lines) {
  if (!lines.length) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  // Line spacing inside a paragraph: a low percentile, since short pages can have as many
  // paragraph gaps as line gaps.
  const typical = gaps[Math.floor(gaps.length * 0.25)] ?? 12;
  const width = Math.max(...lines.map((l) => l.end - l.x));
  const left = Math.min(...lines.map((l) => l.x));

  const paras = [];
  let text = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const gap = prev.y - line.y;
    const bigGap = gap > typical * 1.45 || gap < -typical; // blank line, or a jump up to a new column
    const shortEnd = prev.end - prev.x < width * 0.8 && /[.!?:"”’)]$/.test(prev.text);
    const indented = line.x - left > prev.h * 1.2 && Math.abs(prev.x - left) < prev.h * 0.5;
    const heading = Math.abs(line.h - prev.h) > Math.max(line.h, prev.h) * 0.12;
    if (bigGap || shortEnd || indented || heading) {
      paras.push(text);
      text = line.text;
    } else {
      text = joinLines(text, line.text);
    }
  }
  paras.push(text);
  return paras;
}

/** Join two lines, undoing end-of-line hyphenation ("exam-" + "ple"). */
function joinLines(a, b) {
  if (/[a-z]-$/i.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

function tidy(text) {
  return text
    .replace(/[­​﻿]/g, '') // soft hyphens, zero-width spaces, BOMs
    .replace(/[ﬀ-ﬆ]/g, (c) => c.normalize('NFKC')) // ﬁ ﬂ ligatures
    .replace(/\s+/g, ' ')
    .trim();
}

function isSpeakable(text) {
  return /[\p{L}\p{N}]/u.test(text);
}
