import {
  getPage,
  getDatabase,
  queryDatabase,
  getBlockChildren,
  getComments,
  richTextToMarkdown,
  plainText,
  readProperty,
  extractTitle,
  extractIcon,
  extractCover,
  NotionError,
} from './notion.js';
import { dashedUuid, isUuid } from './databases.js';
import { listResources } from './resources.js';

/**
 * Extract Notion ID from URL, raw 32-hex string, dashed UUID, or title.
 */
export async function resolveResourceId(input) {
  if (!input) throw new Error('Resource ID or URL is required');

  const s = String(input).trim();

  // If it's a Notion URL (e.g. https://www.notion.so/workspace/Page-Title-32hexchars or ?p=32hexchars)
  const urlMatch = s.match(/[0-9a-f]{32}/i);
  if (urlMatch) {
    return dashedUuid(urlMatch[0]);
  }

  // If it's already a dashed or raw UUID
  if (isUuid(s)) {
    return dashedUuid(s);
  }

  // Try finding in discovered resources by title
  const { resources } = await listResources();
  const lower = s.toLowerCase();
  const match = resources.find((r) => r.title.toLowerCase() === lower || r.title.toLowerCase().includes(lower));
  if (match) return match.id;

  throw new Error(`Could not resolve Notion resource ID from "${input}"`);
}

/**
 * Format a list of database rows into a Markdown table.
 */
function rowsToMarkdownTable(title, columns, rows) {
  if (!columns || columns.length === 0) return `### ${title}\n*(No columns)*\n`;
  if (!rows || rows.length === 0) return `### ${title}\n*(Empty database)*\n`;

  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => ':---').join(' | ')} |`;

  const bodyLines = rows.map((row) => {
    const cells = columns.map((col) => {
      const val = row.properties[col];
      let str = '';
      if (val === null || val === undefined) {
        str = '';
      } else if (typeof val === 'object') {
        if (Array.isArray(val)) {
          str = val.map((v) => (typeof v === 'object' ? v.name || v.label || v.id || JSON.stringify(v) : String(v))).join(', ');
        } else {
          str = val.name || val.start || val.plain_text || JSON.stringify(val);
        }
      } else {
        str = String(val);
      }
      return str.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
    });
    return `| ${cells.join(' | ')} |`;
  });

  return `### ${title} *(Inline Database)*\n\n${header}\n${divider}\n${bodyLines.join('\n')}\n`;
}

/**
 * Recursively fetch block children, resolving inline databases and native tables.
 */
async function fetchBlocksRecursively(blockId, depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return { blocks: [], inlineDatabases: [] };

  const blocks = [];
  const inlineDatabases = [];
  let cursor;

  try {
    do {
      const res = await getBlockChildren(blockId, cursor);
      for (const block of res.results || []) {
        // Handle Inline Database
        if (block.type === 'child_database') {
          const dbId = block.id;
          const dbTitle = block.child_database?.title || 'Inline Database';

          try {
            const dbData = await getDatabase(dbId);
            const queryRes = await queryDatabase(dbId, { page_size: 100 });

            const propNames = Object.keys(dbData.properties || {});
            const rows = (queryRes.results || []).map((page) => {
              const rowProps = {};
              for (const [pName, pVal] of Object.entries(page.properties || {})) {
                rowProps[pName] = readProperty(pVal);
              }
              return {
                id: dashedUuid(page.id),
                title: extractTitle(page),
                url: page.url || `https://app.notion.com/${page.id.replace(/-/g, '')}`,
                properties: rowProps,
              };
            });

            const inlineDbObj = {
              id: dashedUuid(dbId),
              title: dbTitle,
              columns: propNames,
              row_count: rows.length,
              rows,
              markdown_table: rowsToMarkdownTable(dbTitle, propNames, rows),
            };

            inlineDatabases.push(inlineDbObj);
            block.inline_database = inlineDbObj;
          } catch (err) {
            console.error(`Error querying inline database ${dbId}:`, err.message);
          }
        }

        // Handle Native Table block
        if (block.type === 'table') {
          try {
            const tableRowsRes = await getBlockChildren(block.id);
            const tableRows = [];
            for (const rowBlock of tableRowsRes.results || []) {
              if (rowBlock.type === 'table_row') {
                const cells = (rowBlock.table_row?.cells || []).map((cell) => richTextToMarkdown(cell).trim());
                tableRows.push(cells);
              }
            }
            block.table_rows = tableRows;
          } catch (err) {
            console.error(`Error querying table rows for ${block.id}:`, err.message);
          }
        }

        // Recursively fetch nested block children (toggles, callouts, lists, columns)
        if (block.has_children && block.type !== 'child_database') {
          try {
            const nested = await fetchBlocksRecursively(block.id, depth + 1, maxDepth);
            block.children = nested.blocks;
            inlineDatabases.push(...nested.inlineDatabases);
          } catch {
            block.children = [];
          }
        }

        blocks.push(block);
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`Error fetching blocks for ${blockId}:`, err.message);
  }

  return { blocks, inlineDatabases };
}

/**
 * Render an individual block to Markdown string.
 */
function blockToMarkdown(b, indentLevel = 0) {
  const indent = '  '.repeat(indentLevel);
  const type = b.type;
  const data = b[type] || {};

  let text = '';
  if (data.rich_text) {
    text = richTextToMarkdown(data.rich_text);
  }

  let result = '';

  switch (type) {
    case 'paragraph':
      result = `${indent}${text}\n`;
      break;
    case 'heading_1':
      result = `\n# ${text}\n`;
      break;
    case 'heading_2':
      result = `\n## ${text}\n`;
      break;
    case 'heading_3':
      result = `\n### ${text}\n`;
      break;
    case 'bulleted_list_item':
      result = `${indent}- ${text}\n`;
      break;
    case 'numbered_list_item':
      result = `${indent}1. ${text}\n`;
      break;
    case 'to_do':
      result = `${indent}- [${data.checked ? 'x' : ' '}] ${text}\n`;
      break;
    case 'toggle': {
      let childMd = '';
      if (b.children && b.children.length > 0) {
        childMd = b.children.map((k) => blockToMarkdown(k, indentLevel + 1)).join('');
      }
      result = `${indent}<details>\n${indent}<summary>${text || 'Toggle'}</summary>\n\n${childMd}\n${indent}</details>\n`;
      break;
    }
    case 'code':
      result = `\n\`\`\`${data.language || ''}\n${plainText(data.rich_text)}\n\`\`\`\n`;
      break;
    case 'quote':
      result = `${indent}> ${text.replace(/\n/g, `\n${indent}> `)}\n`;
      break;
    case 'callout': {
      const icon = extractIcon(data.icon) || '💡';
      result = `\n> ${icon} **${text.replace(/\n/g, `\n> `)}**\n`;
      break;
    }
    case 'divider':
      result = `\n---\n`;
      break;
    case 'bookmark':
      result = `[${data.url}](${data.url})\n`;
      break;
    case 'link_to_page': {
      const targetId = data.page_id || data.database_id;
      result = `[📄 Link to page](https://app.notion.com/${(targetId || '').replace(/-/g, '')})\n`;
      break;
    }
    case 'child_page':
      result = `[📄 ${data.title || 'Subpage'}](https://app.notion.com/${b.id.replace(/-/g, '')})\n`;
      break;
    case 'child_database':
      if (b.inline_database?.markdown_table) {
        result = `\n${b.inline_database.markdown_table}\n`;
      } else {
        result = `\n### ${data.title || 'Inline Database'}\n`;
      }
      break;
    case 'table':
      if (b.table_rows && b.table_rows.length > 0) {
        const rows = b.table_rows;
        const colCount = Math.max(...rows.map((r) => r.length));
        const normalized = rows.map((r) => {
          const cells = [...r];
          while (cells.length < colCount) cells.push('');
          return `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
        });
        const header = normalized[0];
        const divider = `| ${new Array(colCount).fill(':---').join(' | ')} |`;
        result = `\n${header}\n${divider}\n${normalized.slice(1).join('\n')}\n`;
      }
      break;
    case 'image': {
      const url = data.external?.url || data.file?.url;
      const caption = data.caption ? richTextToMarkdown(data.caption) : 'Image';
      result = url ? `![${caption}](${url})\n` : '';
      break;
    }
    default:
      if (text) {
        result = `${indent}${text}\n`;
      }
      break;
  }

  if (type !== 'toggle' && b.children && b.children.length > 0) {
    const childrenMd = b.children.map((k) => blockToMarkdown(k, indentLevel + 1)).join('');
    result += childrenMd;
  }

  return result;
}

/**
 * Fetch and extract full content of a page or database (all blocks, inline DBs, and comments). No caching.
 */
export async function getResourceContent(resourceIdOrUrl) {
  const id = await resolveResourceId(resourceIdOrUrl);

  // Check if it's a page or a database
  let isPage = false;
  let rawObject = null;

  try {
    rawObject = await getPage(id);
    isPage = true;
  } catch (err) {
    if (err instanceof NotionError && err.status === 404) {
      try {
        rawObject = await getDatabase(id);
        isPage = false;
      } catch {
        throw new Error(`Resource "${id}" was not found as a Page or Database in Notion.`);
      }
    } else {
      try {
        rawObject = await getDatabase(id);
        isPage = false;
      } catch {
        throw err;
      }
    }
  }

  if (isPage) {
    // Read page properties
    const properties = {};
    for (const [pName, pVal] of Object.entries(rawObject.properties || {})) {
      properties[pName] = readProperty(pVal);
    }

    const title = extractTitle(rawObject);
    const icon = extractIcon(rawObject.icon);
    const cover = extractCover(rawObject.cover);

    // Fetch recursive block tree & inline databases
    const { blocks, inlineDatabases } = await fetchBlocksRecursively(id);

    // Format Markdown content
    let markdownBody = blocks.map((b) => blockToMarkdown(b, 0)).join('');
    markdownBody = markdownBody.replace(/\n{3,}/g, '\n\n').trim();

    const titlePrefix = icon ? `${icon} ${title}` : title;
    const fullMarkdown = `# ${titlePrefix}\n\n${markdownBody}`;

    // Always fetch comments
    let comments = [];
    try {
      const commentsRes = await getComments(id);
      comments = (commentsRes.results || []).map((c) => ({
        id: c.id,
        text: richTextToMarkdown(c.rich_text),
        author_id: c.created_by?.id ?? null,
        created_time: c.created_time ?? null,
      }));
    } catch (err) {
      console.error(`Error fetching comments for ${id}:`, err.message);
    }

    return {
      id: dashedUuid(id),
      type: 'page',
      title,
      icon,
      cover,
      url: rawObject.url || `https://app.notion.com/${id.replace(/-/g, '')}`,
      parent: rawObject.parent || null,
      created_time: rawObject.created_time || null,
      last_edited_time: rawObject.last_edited_time || null,
      properties,
      markdown: fullMarkdown,
      inline_databases: inlineDatabases,
      inline_databases_count: inlineDatabases.length,
      blocks_count: blocks.length,
      comments,
    };
  } else {
    // It's a Database
    const title = extractTitle(rawObject);
    const icon = extractIcon(rawObject.icon);
    const cover = extractCover(rawObject.cover);
    const propNames = Object.keys(rawObject.properties || {});

    const queryRes = await queryDatabase(id, { page_size: 100 });
    const rows = (queryRes.results || []).map((page) => {
      const rowProps = {};
      for (const [pName, pVal] of Object.entries(page.properties || {})) {
        rowProps[pName] = readProperty(pVal);
      }
      return {
        id: dashedUuid(page.id),
        title: extractTitle(page),
        url: page.url || `https://app.notion.com/${page.id.replace(/-/g, '')}`,
        properties: rowProps,
      };
    });

    const markdownTable = rowsToMarkdownTable(title, propNames, rows);

    return {
      id: dashedUuid(id),
      type: 'database',
      title,
      icon,
      cover,
      url: rawObject.url || `https://app.notion.com/${id.replace(/-/g, '')}`,
      parent: rawObject.parent || null,
      is_inline: Boolean(rawObject.is_inline || rawObject.parent?.type === 'page_id'),
      created_time: rawObject.created_time || null,
      last_edited_time: rawObject.last_edited_time || null,
      columns: propNames,
      row_count: rows.length,
      rows,
      markdown: `# ${icon ? `${icon} ` : ''}${title}\n\n${markdownTable}`,
    };
  }
}
