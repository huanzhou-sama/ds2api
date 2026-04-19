'use strict';

const TOOL_CALL_MARKUP_BLOCK_PATTERN = /<(?:[a-z0-9_:-]+:)?(tool_call|function_call|invoke)\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/gi;
const TOOL_CALL_MARKUP_SELFCLOSE_PATTERN = /<(?:[a-z0-9_:-]+:)?invoke\b([^>]*)\/>/gi;
const TOOL_CALL_MARKUP_KV_PATTERN = /<(?:[a-z0-9_:-]+:)?([a-z0-9_.-]+)\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/gi;
const TOOL_CALL_MARKUP_ATTR_PATTERN = /(name|function|tool)\s*=\s*"([^"]+)"/i;
const TOOL_CALL_MARKUP_NAME_PATTERNS = [
  /<(?:[a-z0-9_:-]+:)?tool_name\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?tool_name>/i,
  /<(?:[a-z0-9_:-]+:)?function_name\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?function_name>/i,
  /<(?:[a-z0-9_:-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?name>/i,
  /<(?:[a-z0-9_:-]+:)?function\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?function>/i,
];
const TOOL_CALL_MARKUP_ARGS_PATTERNS = [
  /<(?:[a-z0-9_:-]+:)?input\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?input>/i,
  /<(?:[a-z0-9_:-]+:)?arguments\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?arguments>/i,
  /<(?:[a-z0-9_:-]+:)?argument\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?argument>/i,
  /<(?:[a-z0-9_:-]+:)?parameters\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?parameters>/i,
  /<(?:[a-z0-9_:-]+:)?parameter\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?parameter>/i,
  /<(?:[a-z0-9_:-]+:)?args\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?args>/i,
  /<(?:[a-z0-9_:-]+:)?params\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?params>/i,
];

const {
  toStringSafe,
} = require('./state');

function stripFencedCodeBlocks(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t) {
    return '';
  }
  return t.replace(/```[\s\S]*?```/g, ' ');
}

function parseMarkupToolCalls(text) {
  const raw = toStringSafe(text).trim();
  if (!raw) {
    return [];
  }
  const out = [];
  for (const m of raw.matchAll(TOOL_CALL_MARKUP_BLOCK_PATTERN)) {
    const parsed = parseMarkupSingleToolCall(toStringSafe(m[2]).trim(), toStringSafe(m[3]).trim());
    if (parsed) {
      out.push(parsed);
    }
  }
  for (const m of raw.matchAll(TOOL_CALL_MARKUP_SELFCLOSE_PATTERN)) {
    const parsed = parseMarkupSingleToolCall(toStringSafe(m[1]).trim(), '');
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function parseMarkupSingleToolCall(attrs, inner) {
  // Try inline JSON parse for the inner content.
  if (inner) {
    try {
      const decoded = JSON.parse(inner);
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded) && decoded.name) {
        return {
          name: toStringSafe(decoded.name),
          input: decoded.input && typeof decoded.input === 'object' && !Array.isArray(decoded.input) ? decoded.input : {},
        };
      }
    } catch (_err) {
      // Not JSON, continue with markup parsing.
    }
  }
  let name = '';
  const attrMatch = attrs.match(TOOL_CALL_MARKUP_ATTR_PATTERN);
  if (attrMatch && attrMatch[2]) {
    name = toStringSafe(attrMatch[2]).trim();
  }
  if (!name) {
    name = stripTagText(findMarkupTagValue(inner, TOOL_CALL_MARKUP_NAME_PATTERNS));
  }
  if (!name) {
    return null;
  }

  let input = {};
  const argsRaw = findMarkupTagValue(inner, TOOL_CALL_MARKUP_ARGS_PATTERNS);
  if (argsRaw) {
    input = parseMarkupInput(argsRaw);
  } else {
    const kv = parseMarkupKVObject(inner);
    if (Object.keys(kv).length > 0) {
      input = kv;
    }
  }
  return { name, input };
}

function parseMarkupInput(raw) {
  const s = toStringSafe(raw).trim();
  if (!s) {
    return {};
  }
  const parsed = parseToolCallInput(s);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
    return parsed;
  }
  const kv = parseMarkupKVObject(s);
  if (Object.keys(kv).length > 0) {
    return kv;
  }
  return { _raw: stripTagText(s) };
}

function parseMarkupKVObject(text) {
  const raw = toStringSafe(text).trim();
  if (!raw) {
    return {};
  }
  const out = {};
  for (const m of raw.matchAll(TOOL_CALL_MARKUP_KV_PATTERN)) {
    const key = toStringSafe(m[1]).trim();
    if (!key) {
      continue;
    }
    const valueRaw = stripTagText(m[2]);
    if (!valueRaw) {
      continue;
    }
    try {
      out[key] = JSON.parse(valueRaw);
    } catch (_err) {
      out[key] = valueRaw;
    }
  }
  return out;
}

function stripTagText(text) {
  return toStringSafe(text).replace(/<[^>]+>/g, ' ').trim();
}

function findMarkupTagValue(text, patterns) {
  const source = toStringSafe(text);
  for (const p of patterns) {
    const m = source.match(p);
    if (m && m[1]) {
      return toStringSafe(m[1]);
    }
  }
  return '';
}

function parseToolCallInput(v) {
  if (v == null) {
    return {};
  }
  if (typeof v === 'string') {
    const raw = toStringSafe(v);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return { _raw: raw };
    } catch (_err) {
      return { _raw: raw };
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v;
  }
  try {
    const parsed = JSON.parse(JSON.stringify(v));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_err) {
    return {};
  }
  return {};
}

module.exports = {
  stripFencedCodeBlocks,
  parseMarkupToolCalls,
};
