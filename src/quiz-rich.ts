/* ==========================================================================
 * Renderer teks kaya (subset markdown aman): paragraf, tabel, LaTeX, Arab,
 * kode, gambar, audio, pranala.
 * ========================================================================== */

import { escapeHtml, resolveMediaUrl } from './quiz-util.ts';
import { ARABIC_RUN, AUDIO_EXT, IMAGE_EXT, JAVANESE_RUN, MEDIA_TOKEN } from './quiz-types.ts';
import type { Feature } from './quiz-types.ts';


/* -------------------------------------------------------------------------- */
/* Renderer teks kaya (subset markdown aman)                                  */
/* -------------------------------------------------------------------------- */

export function createStash() {
  const items: string[] = [];
  return {
    put(html: string): string {
      items.push(html);
      return `\u0000${items.length - 1}\u0000`;
    },
    has(text: string): boolean {
      return text.includes('\u0000');
    },
    restore(text: string): string {
      return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => items[Number(index)] ?? '');
    },
  };
}



export function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return trimmed
    .replace(/^\||\|$/g, '')
    .split('|')
    .every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell));
}



export function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}



export function renderTable(header: string[], rows: string[][], features: Set<Feature>, mediaBase: string): string {
  const head = header.map((cell) => `<th>${inlineRich(cell, features, mediaBase)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = header.map((_unused, index) => `<td>${inlineRich(row[index] ?? '', features, mediaBase)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="q-table-wrap"><table class="q-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}



export function inlineRich(text: string, features: Set<Feature>, mediaBase: string): string {
  const stash = createStash();
  let out = text;

  if (features.has('code')) {
    out = out.replace(/`([^`]+)`/g, (_match, code: string) => stash.put(`<code>${escapeHtml(code)}</code>`));
  }
  if (features.has('math')) {
    // Biarkan KaTeX yang mengurus isi rumus; cuma dikeluarkan dari proses escape.
    out = out.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (match) => stash.put(match));
  }

  const media = /!\[([^\]]*)\]\(([^)\s]+)\)|@(img|audio)\(([^)\s]+)\)/g;
  out = out.replace(media, (match, alt: string | undefined, mdUrl: string | undefined, kind: string | undefined, atUrl: string | undefined) => {
    const url = resolveMediaUrl(mdUrl ?? atUrl, mediaBase);
    if (!url) return match;
    const isAudio = kind === 'audio' || String(alt ?? '').toLowerCase() === 'audio' || AUDIO_EXT.test(url);
    if (isAudio) {
      if (!features.has('audio')) return match;
      return stash.put(`<audio class="q-audio" controls preload="none" src="${url}"></audio>`);
    }
    if (!features.has('image')) return match;
    return stash.put(`<img class="q-img" src="${url}" alt="${escapeHtml(alt ?? '')}" loading="lazy">`);
  });

  out = escapeHtml(out);

  if (features.has('arabic')) {
    out = out.replace(
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF](?:[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s\d\p{M}]*[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF])?/gu,
      (match) => `<span class="q-ar-inline">${match}</span>`
    );
  }

  if (features.has('jawa')) {
    out = out.replace(
      /[\uA980-\uA9DF](?:[\uA980-\uA9DF\s\d\p{M}]*[\uA980-\uA9DF])?/gu,
      (match) => `<span class="q-jv-inline">${match}</span>`
    );
  }

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  out = out.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trailing = url.match(/[.,;:!?)]+$/)?.[0] ?? '';
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    if (features.has('image') && IMAGE_EXT.test(clean)) {
      return `<img class="q-img" src="${clean}" alt="" loading="lazy">${trailing}`;
    }
    if (features.has('audio') && AUDIO_EXT.test(clean)) {
      return `<audio class="q-audio" controls preload="none" src="${clean}"></audio>${trailing}`;
    }
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trailing}`;
  });

  return stash.restore(out);
}



export function isArabicLine(text: string): boolean {
  const letters = text.replace(/\s/g, '');
  if (!letters) return false;
  const arabic = letters.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? [];
  return arabic.length / letters.length > 0.5;
}

export function isJavaneseLine(text: string): boolean {
  const letters = text.replace(/\s/g, '');
  if (!letters) return false;
  const javanese = letters.match(/[\uA980-\uA9DF]/g) ?? [];
  return javanese.length / letters.length > 0.5;
}



export function renderRichText(source: unknown, features: Set<Feature>, mediaBase = ''): string {
  const text = String(source ?? '');
  if (!text.trim()) return '';

  const stash = createStash();
  let prepared = text;
  if (features.has('code')) {
    prepared = prepared.replace(/```([a-zA-Z0-9+#-]*)\r?\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return stash.put(`<pre class="q-code"><code${cls}>${escapeHtml(code.replace(/\s+$/, ''))}</code></pre>`);
    });
  }

  const lines = prepared.split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }

    // Baris yang isinya murni placeholder (blok kode / media) dikeluarkan
    // sebagai blok sendiri supaya tidak ada <pre> di dalam <p>.
    if (/^(?:\u0000\d+\u0000\s*)+$/.test(trimmed)) {
      flush();
      out.push(stash.restore(trimmed));
      continue;
    }

    // Baris yang isinya cuma token slot (`media:fotosintesis`) jadi gambar sendiri.
    if (features.has('image') && MEDIA_TOKEN.test(trimmed)) {
      const url = resolveMediaUrl(trimmed, mediaBase);
      if (url) {
        flush();
        out.push(`<img class="q-img" src="${url}" alt="" loading="lazy">`);
        continue;
      }
    }

    if (features.has('table') && /^\|.*\|$/.test(trimmed) && isTableSeparator(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i].trim()));
        i += 1;
      }
      i -= 1;
      out.push(renderTable(header, rows, features, mediaBase));
      continue;
    }

    if (features.has('arabic') && isArabicLine(trimmed)) {
      flush();
      out.push(`<div class="q-ar">${inlineRich(trimmed, features, mediaBase)}</div>`);
      continue;
    }

    if (features.has('jawa') && isJavaneseLine(trimmed)) {
      flush();
      out.push(`<div class="q-jv">${inlineRich(trimmed, features, mediaBase)}</div>`);
      continue;
    }

    paragraph.push(inlineRich(trimmed, features, mediaBase));
  }
  flush();

  return stash.restore(out.join('\n'));
}

/* -------------------------------------------------------------------------- */
/* Penilaian                                                                  */
/* -------------------------------------------------------------------------- */

