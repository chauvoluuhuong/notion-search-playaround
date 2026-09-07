import {
  createPage,
  updatePage,
  createDatabase,
  updateDatabase,
  appendBlockChildren,
  getPage,
  getDatabase,
  readProperty,
  extractTitle,
  extractIcon,
  extractCover,
} from './notion.js';
import { dashedUuid, isUuid, resolveDatabaseId } from './databases.js';
import { getDatabaseSchema, resolveValues } from './directory.js';
import { resolveResourceId, getResourceContent } from './page_content.js';

// Computed / read-only property types that cannot be written directly to Notion
const READ_ONLY_TYPES = new Set([
  'formula',
  'rollup',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'unique_id',
  'button',
]);

/**
 * Parses simple inline markdown (**bold**, *italic*, `code`, ~~strike~~, [text](url))
 * into an array of Notion rich text objects.
 */
export function markdownToRichText(input) {
  const text = String(input ?? '');
  if (!text) return [];

  // If text is very long, Notion has a 2000-character limit per rich_text item
  const MAX_CHUNK = 1900;
  if (text.length > MAX_CHUNK) {
    const chunks = [];
    for (let i = 0; i < text.length; i += MAX_CHUNK) {
      chunks.push(...markdownToRichText(text.slice(i, i + MAX_CHUNK)));
    }
    return chunks;
  }

  const items = [];
  // Tokenize bold, italic, code, strikethrough, link, or plain text
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|[^\*`~\[]+|.)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const token = match[0];
    if (!token) continue;

    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      items.push({
        type: 'text',
        text: { content: token.slice(2, -2) },
        annotations: { bold: true },
      });
    } else if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      items.push({
        type: 'text',
        text: { content: token.slice(1, -1) },
        annotations: { italic: true },
      });
    } else if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      items.push({
        type: 'text',
        text: { content: token.slice(1, -1) },
        annotations: { code: true },
      });
    } else if (token.startsWith('~~') && token.endsWith('~~') && token.length >= 4) {
      items.push({
        type: 'text',
        text: { content: token.slice(2, -2) },
        annotations: { strikethrough: true },
      });
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const closeBracket = token.indexOf('](');
      const label = token.slice(1, closeBracket);
      const url = token.slice(closeBracket + 2, -1);
      items.push({
        type: 'text',
        text: { content: label, link: { url } },
      });
    } else {
      items.push({
        type: 'text',
        text: { content: token },
      });
    }
  }

  return items.length > 0 ? items : [{ type: 'text', text: { content: text } }];
}

/**
 * Parses markdown text into Notion block objects.
 */
export function markdownToBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let inCodeBlock = false;
  let codeLang = 'plain text';
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code fences
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim() || 'plain text';
        codeLines = [];
        continue;
      } else {
        inCodeBlock = false;
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            language: codeLang.toLowerCase(),
            rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          },
        });
        continue;
      }
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Heading 1 (# ...)
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: markdownToRichText(line.slice(2).trim()) },
      });
    }
    // Heading 2 (## ...)
    else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: markdownToRichText(line.slice(3).trim()) },
      });
    }
    // Heading 3 (### ...)
    else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: markdownToRichText(line.slice(4).trim()) },
      });
    }
    // Todo / Task (- [ ] or - [x])
    else if (/^[-*]\s+\[([ xX])\]\s+(.*)$/.test(trimmed)) {
      const match = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
      const checked = match[1].toLowerCase() === 'x';
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: markdownToRichText(match[2]),
          checked,
        },
      });
    }
    // Bulleted list item (- or *)
    else if (/^[-*]\s+(.*)$/.test(trimmed)) {
      const content = trimmed.replace(/^[-*]\s+/, '');
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: markdownToRichText(content) },
      });
    }
    // Numbered list item (1. ...)
    else if (/^\d+\.\s+(.*)$/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s+/, '');
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: markdownToRichText(content) },
      });
    }
    // Divider (--- or ***)
    else if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });
    }
    // Blockquote (> ...)
    else if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s*/, '');
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: markdownToRichText(quoteText) },
      });
    }
    // Default: paragraph
    else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: markdownToRichText(trimmed) },
      });
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        language: codeLang.toLowerCase(),
        rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
      },
    });
  }

  return blocks;
}

/**
 * Format icon for Notion API.
 */
export function formatIcon(icon) {
  if (!icon) return null;
  if (typeof icon === 'string') {
    const trimmed = icon.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return { type: 'external', external: { url: trimmed } };
    }
    return { type: 'emoji', emoji: trimmed };
  }
  if (typeof icon === 'object') {
    if (icon.type === 'emoji' && icon.emoji) return icon;
    if (icon.type === 'external' && icon.external?.url) return icon;
    if (icon.emoji) return { type: 'emoji', emoji: icon.emoji };
    if (icon.url) return { type: 'external', external: { url: icon.url } };
  }
  return null;
}

/**
 * Format cover image for Notion API.
 */
export function formatCover(cover) {
  if (!cover) return null;
  if (typeof cover === 'string') {
    const trimmed = cover.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return { type: 'external', external: { url: trimmed } };
    }
  }
  if (typeof cover === 'object') {
    if (cover.type === 'external' && cover.external?.url) return cover;
    const url = cover.url || cover.external?.url;
    if (url) return { type: 'external', external: { url } };
  }
  return null;
}

/**
 * Check if an object already looks like a valid Notion property payload.
 */
function isRawNotionProperty(val, propType) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  if (propType && val[propType] !== undefined) return true;
  const commonKeys = [
    'title',
    'rich_text',
    'number',
    'select',
    'status',
    'multi_select',
    'date',
    'people',
    'relation',
    'checkbox',
    'url',
    'email',
    'phone_number',
    'files',
  ];
  return commonKeys.some((k) => k in val);
}

/**
 * Transforms intuitive user properties into Notion API typed property objects.
 * Uses schema information when available.
 */
export function buildPageProperties(propertiesInput = {}, schemaProperties = [], schemaLookup = {}) {
  const result = {};
  if (!propertiesInput || typeof propertiesInput !== 'object') return result;

  // Build lookup maps for schema properties
  const propMap = new Map();
  for (const p of schemaProperties) {
    propMap.set(p.name.toLowerCase(), p);
    if (p.id) propMap.set(p.id.toLowerCase(), p);
  }

  for (const [key, rawVal] of Object.entries(propertiesInput)) {
    const normKey = key.trim();
    const propDef = propMap.get(normKey.toLowerCase());
    const propType = propDef?.type;
    const propName = propDef?.name || normKey;

    // Filter out computed / read-only property types
    if (propType && READ_ONLY_TYPES.has(propType)) {
      continue;
    }

    // If caller provided an already-formatted Notion property object, pass it through directly
    if (isRawNotionProperty(rawVal, propType)) {
      result[propName] = rawVal;
      continue;
    }

    // When no schema definition is known, infer basic types
    if (!propType) {
      if (typeof rawVal === 'boolean') {
        result[propName] = { checkbox: rawVal };
      } else if (typeof rawVal === 'number') {
        result[propName] = { number: rawVal };
      } else if (Array.isArray(rawVal)) {
        result[propName] = {
          multi_select: rawVal.map((v) => ({ name: String(v.name || v).trim() })),
        };
      } else if (normKey.toLowerCase() === 'title' || normKey.toLowerCase() === 'name') {
        result[propName] = {
          title: [{ type: 'text', text: { content: String(rawVal ?? '') } }],
        };
      } else {
        result[propName] = {
          rich_text: markdownToRichText(rawVal),
        };
      }
      continue;
    }

    // Handle typed schema properties
    switch (propType) {
      case 'title': {
        const str = rawVal ? String(rawVal).trim() : '';
        result[propName] = {
          title: str ? [{ type: 'text', text: { content: str } }] : [],
        };
        break;
      }

      case 'rich_text': {
        const str = rawVal ? String(rawVal) : '';
        result[propName] = {
          rich_text: str ? markdownToRichText(str) : [],
        };
        break;
      }

      case 'number': {
        if (rawVal === null || rawVal === undefined || rawVal === '') {
          result[propName] = { number: null };
        } else {
          const num = Number(rawVal);
          result[propName] = { number: Number.isNaN(num) ? null : num };
        }
        break;
      }

      case 'checkbox': {
        const bool = Boolean(rawVal && rawVal !== 'false' && rawVal !== '0');
        result[propName] = { checkbox: bool };
        break;
      }

      case 'select': {
        if (!rawVal || rawVal === 'none' || rawVal === 'null') {
          result[propName] = { select: null };
        } else {
          const name = typeof rawVal === 'object' ? (rawVal.name || rawVal.id) : String(rawVal).trim();
          result[propName] = { select: { name } };
        }
        break;
      }

      case 'status': {
        if (!rawVal || rawVal === 'none' || rawVal === 'null') {
          result[propName] = { status: null };
        } else {
          const name = typeof rawVal === 'object' ? (rawVal.name || rawVal.id) : String(rawVal).trim();
          result[propName] = { status: { name } };
        }
        break;
      }

      case 'multi_select': {
        if (!rawVal) {
          result[propName] = { multi_select: [] };
        } else {
          let items = [];
          if (Array.isArray(rawVal)) {
            items = rawVal;
          } else if (typeof rawVal === 'string') {
            items = rawVal.split(',').map((s) => s.trim()).filter(Boolean);
          }
          result[propName] = {
            multi_select: items.map((v) => ({
              name: typeof v === 'object' ? String(v.name || v.id).trim() : String(v).trim(),
            })).filter((v) => v.name),
          };
        }
        break;
      }

      case 'date': {
        if (!rawVal || rawVal === 'none' || rawVal === 'null') {
          result[propName] = { date: null };
        } else if (typeof rawVal === 'string') {
          result[propName] = { date: { start: rawVal.trim() } };
        } else if (typeof rawVal === 'object') {
          result[propName] = {
            date: {
              start: rawVal.start,
              end: rawVal.end || null,
            },
          };
        }
        break;
      }

      case 'people': {
        if (!rawVal) {
          result[propName] = { people: [] };
        } else {
          const rawItems = Array.isArray(rawVal) ? rawVal : [rawVal];
          const peopleList = schemaLookup.people_by_property?.[propName] || schemaLookup.people || [];
          const userIds = [];

          for (const item of rawItems) {
            if (!item) continue;
            if (typeof item === 'object' && item.id) {
              userIds.push(dashedUuid(item.id));
              continue;
            }
            const term = String(item).trim();
            if (isUuid(term)) {
              userIds.push(dashedUuid(term));
            } else {
              const matched = resolveValues(term, peopleList);
              if (matched.length > 0) {
                userIds.push(matched[0]);
              }
            }
          }

          result[propName] = {
            people: userIds.map((id) => ({ id })),
          };
        }
        break;
      }

      case 'relation': {
        if (!rawVal) {
          result[propName] = { relation: [] };
        } else {
          const rawItems = Array.isArray(rawVal) ? rawVal : [rawVal];
          const relationList = schemaLookup.relations_by_property?.[propName] || schemaLookup.relations || [];
          const relationIds = [];

          for (const item of rawItems) {
            if (!item) continue;
            if (typeof item === 'object' && item.id) {
              relationIds.push(dashedUuid(item.id));
              continue;
            }
            const term = String(item).trim();
            if (isUuid(term)) {
              relationIds.push(dashedUuid(term));
            } else {
              const matched = resolveValues(term, relationList);
              if (matched.length > 0) {
                relationIds.push(matched[0]);
              }
            }
          }

          result[propName] = {
            relation: relationIds.map((id) => ({ id })),
          };
        }
        break;
      }

      case 'url': {
        result[propName] = { url: rawVal ? String(rawVal).trim() : null };
        break;
      }

      case 'email': {
        result[propName] = { email: rawVal ? String(rawVal).trim() : null };
        break;
      }

      case 'phone_number': {
        result[propName] = { phone_number: rawVal ? String(rawVal).trim() : null };
        break;
      }

      default:
        result[propName] = rawVal;
        break;
    }
  }

  return result;
}

/**
 * High-level creation of a page or database item.
 */
export async function createPageItem({
  databaseId,
  pageId,
  parentId,
  parent,
  properties = {},
  title,
  content,
  markdown,
  children = [],
  icon,
  cover,
} = {}) {
  let finalParent = parent;
  let targetDbId = databaseId || properties.database_id || properties.databaseId;
  let targetPageId = pageId || parentId;
  let schema = null;

  // Determine parent container
  if (targetDbId) {
    const resolvedDb = await resolveDatabaseId(targetDbId);
    finalParent = { database_id: dashedUuid(resolvedDb) };
    try {
      schema = await getDatabaseSchema(resolvedDb);
    } catch {
      schema = null;
    }
  } else if (targetPageId) {
    const resolvedPage = await resolveResourceId(targetPageId);
    finalParent = { page_id: dashedUuid(resolvedPage) };
  } else if (!finalParent) {
    // Fall back to default database if available
    const resolvedDb = await resolveDatabaseId();
    finalParent = { database_id: dashedUuid(resolvedDb) };
    try {
      schema = await getDatabaseSchema(resolvedDb);
    } catch {
      schema = null;
    }
  }

  // Handle title shorthand
  const propsToFormat = { ...properties };
  if (title !== undefined && title !== null) {
    const titlePropName = schema?.title_property || 'title';
    if (!propsToFormat[titlePropName] && !propsToFormat.title && !propsToFormat.Name) {
      propsToFormat[titlePropName] = title;
    }
  }

  const formattedProps = buildPageProperties(propsToFormat, schema?.properties || [], schema || {});

  // Parse markdown content into blocks
  const bodyText = content || markdown;
  const blockChildren = [...children];
  if (bodyText) {
    blockChildren.push(...markdownToBlocks(bodyText));
  }

  const payload = {
    parent: finalParent,
    properties: formattedProps,
  };

  if (blockChildren.length > 0) {
    payload.children = blockChildren;
  }

  const formattedIcon = formatIcon(icon);
  if (formattedIcon) payload.icon = formattedIcon;

  const formattedCover = formatCover(cover);
  if (formattedCover) payload.cover = formattedCover;

  const created = await createPage(payload);

  // Return clean structured response
  const createdProps = {};
  for (const [pName, pVal] of Object.entries(created.properties || {})) {
    createdProps[pName] = readProperty(pVal);
  }

  return {
    id: dashedUuid(created.id),
    type: 'page',
    title: extractTitle(created),
    url: created.url || `https://app.notion.com/${created.id.replace(/-/g, '')}`,
    icon: extractIcon(created.icon),
    cover: extractCover(created.cover),
    parent: created.parent || null,
    created_time: created.created_time || null,
    last_edited_time: created.last_edited_time || null,
    properties: createdProps,
  };
}

/**
 * High-level editing / updating of an existing page or database item.
 */
export async function updatePageItem(
  pageIdOrUrl,
  {
    properties = {},
    title,
    content,
    markdown,
    appendContent,
    children = [],
    icon,
    cover,
    archived,
  } = {},
) {
  const pageId = await resolveResourceId(pageIdOrUrl);
  const rawPage = await getPage(pageId);

  let schema = null;
  if (rawPage.parent?.type === 'database_id') {
    try {
      schema = await getDatabaseSchema(rawPage.parent.database_id);
    } catch {
      schema = null;
    }
  }

  // Handle title shorthand
  const propsToFormat = { ...properties };
  if (title !== undefined && title !== null) {
    const titlePropName = schema?.title_property || 'title';
    if (!propsToFormat[titlePropName]) {
      propsToFormat[titlePropName] = title;
    }
  }

  // Build schema properties list (fallback to raw page property keys if schema not discovered)
  const schemaProps =
    schema?.properties ||
    Object.entries(rawPage.properties || {}).map(([name, p]) => ({
      name,
      type: p.type,
      id: p.id,
    }));

  const formattedProps = buildPageProperties(propsToFormat, schemaProps, schema || {});

  const updatePayload = {};
  if (Object.keys(formattedProps).length > 0) {
    updatePayload.properties = formattedProps;
  }

  if (typeof archived === 'boolean') {
    updatePayload.archived = archived;
  }

  if (icon !== undefined) {
    updatePayload.icon = formatIcon(icon);
  }

  if (cover !== undefined) {
    updatePayload.cover = formatCover(cover);
  }

  let updatedPage = rawPage;
  if (Object.keys(updatePayload).length > 0) {
    updatedPage = await updatePage(pageId, updatePayload);
  }

  // Handle appending blocks/content
  const bodyText = appendContent || content || markdown;
  const blockChildren = [...children];
  if (bodyText) {
    blockChildren.push(...markdownToBlocks(bodyText));
  }

  if (blockChildren.length > 0) {
    await appendBlockChildren(pageId, blockChildren);
  }

  // Return clean updated representation
  const updatedProps = {};
  for (const [pName, pVal] of Object.entries(updatedPage.properties || {})) {
    updatedProps[pName] = readProperty(pVal);
  }

  return {
    id: dashedUuid(updatedPage.id),
    type: 'page',
    title: extractTitle(updatedPage),
    url: updatedPage.url || `https://app.notion.com/${updatedPage.id.replace(/-/g, '')}`,
    icon: extractIcon(updatedPage.icon),
    cover: extractCover(updatedPage.cover),
    archived: Boolean(updatedPage.archived),
    parent: updatedPage.parent || null,
    created_time: updatedPage.created_time || null,
    last_edited_time: updatedPage.last_edited_time || null,
    properties: updatedProps,
  };
}

/**
 * Archive (soft-delete) a page or database item.
 */
export async function archivePageItem(pageIdOrUrl) {
  const pageId = await resolveResourceId(pageIdOrUrl);
  const res = await updatePage(pageId, { archived: true });
  return {
    success: true,
    id: dashedUuid(res.id),
    archived: Boolean(res.archived),
  };
}

/**
 * High-level creation of a Notion Database.
 */
export async function createDatabaseItem({ parentPageId, title, properties = {} }) {
  if (!parentPageId) throw new Error('parentPageId is required to create a database');
  const pageId = await resolveResourceId(parentPageId);

  const payload = {
    parent: { type: 'page_id', page_id: dashedUuid(pageId) },
    title: [{ type: 'text', text: { content: title || 'Untitled Database' } }],
    properties: {
      Name: { title: {} },
      ...properties,
    },
  };

  const created = await createDatabase(payload);
  return {
    id: dashedUuid(created.id),
    title: extractTitle(created),
    url: created.url || `https://app.notion.com/${created.id.replace(/-/g, '')}`,
    created_time: created.created_time || null,
    property_names: Object.keys(created.properties || {}),
  };
}

/**
 * High-level editing / updating of a Notion Database.
 */
export async function updateDatabaseItem(databaseId, { title, description, icon, cover, properties }) {
  const resolvedDb = await resolveDatabaseId(databaseId);
  const payload = {};

  if (title) {
    payload.title = [{ type: 'text', text: { content: String(title).trim() } }];
  }
  if (description !== undefined) {
    payload.description = description
      ? [{ type: 'text', text: { content: String(description).trim() } }]
      : [];
  }
  if (icon !== undefined) {
    payload.icon = formatIcon(icon);
  }
  if (cover !== undefined) {
    payload.cover = formatCover(cover);
  }
  if (properties && typeof properties === 'object') {
    payload.properties = properties;
  }

  const updated = await updateDatabase(resolvedDb, payload);
  return {
    id: dashedUuid(updated.id),
    title: extractTitle(updated),
    url: updated.url || `https://app.notion.com/${updated.id.replace(/-/g, '')}`,
    description: updated.description ? updated.description.map((t) => t.plain_text).join('') : null,
    property_names: Object.keys(updated.properties || {}),
  };
}
