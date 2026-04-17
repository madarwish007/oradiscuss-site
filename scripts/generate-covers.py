#!/usr/bin/env python3
"""Generate themed SVG cover images for blog articles that don't have one.

Creates a 1600x840 (16:9) SVG per article:
  - Dark slate background with subtle grid
  - Oracle red accent bar on the left
  - Small "Od" logo mark top-right
  - Category tag + 2-3-line wrapped title
  - The first fenced code block from the article, lightly syntax-highlighted

Writes to public/images/blog/<slug>.svg, then patches the markdown frontmatter
with `cover: /images/blog/<slug>.svg` if the article has no cover yet. Articles
that already have a cover (CMS-uploaded or hand-set) are left alone.
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG = ROOT / 'src' / 'content' / 'blog'
OUT = ROOT / 'public' / 'images' / 'blog'
OUT.mkdir(parents=True, exist_ok=True)

CATEGORY_LABEL = {
    'dba': 'ADVANCED DBA',
    'oci': 'OCI / CLOUD',
    'goldengate': 'GOLDENGATE',
    'scripts': 'SCRIPTS',
    'community': 'COMMUNITY',
    'asm': 'ASM',
}

SQL_KEYWORDS = {
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'BY', 'ORDER', 'GROUP', 'HAVING',
    'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'BEGIN', 'END',
    'DECLARE', 'LIKE', 'IN', 'AS', 'SET', 'VALUES', 'CASE', 'WHEN', 'THEN',
    'ELSE', 'EXISTS', 'NOT', 'NULL', 'IS', 'JOIN', 'ON', 'INTO', 'UNION',
    'DISTINCT', 'WITH', 'RECURSIVE', 'FETCH', 'FIRST', 'ROWS', 'ONLY',
    'BETWEEN', 'RAISE', 'EXCEPTION', 'RETURN', 'IF', 'LOOP', 'EXIT',
    'ROWCOUNT',
}


def escape_svg(s: str) -> str:
    return (
        s.replace('&', '&amp;')
         .replace('<', '&lt;')
         .replace('>', '&gt;')
         .replace("'", '&#39;')
         .replace('"', '&quot;')
    )


def parse_frontmatter(text: str):
    m = re.match(r'^---\n(.*?)\n---\n?(.*)', text, re.DOTALL)
    if not m:
        return {}, text, (0, 0)
    fm_raw = m.group(1)
    body = m.group(2)
    fm = {}
    for line in fm_raw.splitlines():
        if re.match(r'^[A-Za-z_]+:', line):
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm, body, (m.start(1), m.end(1))


def first_code_block(body: str):
    m = re.search(r'```(\w*)\n(.*?)```', body, re.DOTALL)
    if not m:
        return None, None
    lang = (m.group(1) or '').lower()
    return lang, m.group(2)


def wrap_title(title: str, max_chars: int = 32, max_lines: int = 3):
    words = title.split()
    lines, current = [], ''
    for w in words:
        candidate = (current + ' ' + w).strip()
        if len(candidate) <= max_chars or not current:
            current = candidate
        else:
            lines.append(current)
            current = w
            if len(lines) == max_lines - 1:
                # Everything remaining goes on the last line
                remaining = ' '.join([current] + words[words.index(w) + 1:])
                if len(remaining) > max_chars:
                    remaining = remaining[: max_chars - 1] + '…'
                lines.append(remaining)
                return lines
    if current:
        lines.append(current)
    return lines[:max_lines]


def highlight_code(lang: str, code: str, max_lines: int = 6, max_chars: int = 64):
    raw_lines = [l.rstrip() for l in code.split('\n')]
    # Trim leading blank lines
    while raw_lines and not raw_lines[0].strip():
        raw_lines.pop(0)
    raw_lines = raw_lines[:max_lines]

    out = []
    for i, line in enumerate(raw_lines):
        truncated = line[:max_chars] + ('…' if len(line) > max_chars else '')
        stripped = truncated.strip()
        if stripped.startswith('--') or stripped.startswith('#'):
            spans = f'<tspan fill="#8a837c" font-style="italic">{escape_svg(truncated)}</tspan>'
        elif lang in ('sql', 'pl/sql', 'plsql'):
            parts = []
            # Alternating split on whitespace/punct keeps separators
            tokens = re.split(r'(\s+|[;,()=<>!]+)', truncated)
            for tok in tokens:
                if tok.upper().strip() in SQL_KEYWORDS:
                    parts.append(f'<tspan fill="#e86454" font-weight="600">{escape_svg(tok)}</tspan>')
                elif re.match(r"'.*?'", tok):
                    parts.append(f'<tspan fill="#9fcf87">{escape_svg(tok)}</tspan>')
                elif re.match(r'^\d+(\.\d+)?$', tok.strip()):
                    parts.append(f'<tspan fill="#70b0ff">{escape_svg(tok)}</tspan>')
                else:
                    parts.append(escape_svg(tok))
            spans = ''.join(parts)
        elif lang in ('bash', 'sh', 'shell'):
            # Highlight $ prompts and command names
            if truncated.lstrip().startswith('$'):
                spans = f'<tspan fill="#e86454">{escape_svg(truncated[:truncated.index("$")+1])}</tspan>{escape_svg(truncated[truncated.index("$")+1:])}'
            else:
                spans = escape_svg(truncated)
        else:
            spans = escape_svg(truncated)

        dy = 38 if i == 0 else 34
        out.append(f'<tspan x="48" dy="{dy}">{spans}</tspan>')
    return '\n      '.join(out)


SVG_TMPL = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 840" preserveAspectRatio="xMidYMid slice" role="img" aria-label="{aria}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1614"/>
      <stop offset="100%" stop-color="#2b2623"/>
    </linearGradient>
    <pattern id="grid" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
      <circle cx="24" cy="24" r="1.2" fill="#3a3532"/>
    </pattern>
    <linearGradient id="redglow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#c74634" stop-opacity="0.18"/>
      <stop offset="40%" stop-color="#c74634" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="840" fill="url(#bg)"/>
  <rect width="1600" height="840" fill="url(#grid)" opacity="0.55"/>
  <rect width="1600" height="840" fill="url(#redglow)"/>
  <rect x="0" y="0" width="14" height="840" fill="#c74634"/>

  <!-- Od logo mark (top-right) -->
  <g transform="translate(1440, 72)">
    <rect width="88" height="88" rx="16" fill="#c74634"/>
    <text x="44" y="60" text-anchor="middle" font-family="Inter, -apple-system, Segoe UI, sans-serif" font-size="42" font-weight="800" fill="#ffffff" letter-spacing="-1.2">Od</text>
    <rect x="22" y="68" width="44" height="4" rx="1.5" fill="#ffffff" opacity="0.9"/>
  </g>

  <!-- Category tag -->
  <g transform="translate(88, 120)">
    <rect width="{cat_w}" height="44" rx="6" fill="#c74634" fill-opacity="0.14" stroke="#c74634" stroke-opacity="0.38" stroke-width="1"/>
    <text x="{cat_cx}" y="29" text-anchor="middle" font-family="Inter, -apple-system, Segoe UI, sans-serif" font-size="14" font-weight="700" fill="#e86454" letter-spacing="2.2">{cat_label}</text>
  </g>

  <!-- Title -->
  <g transform="translate(88, 222)">
    <text font-family="Inter, -apple-system, Segoe UI, sans-serif" font-weight="700" fill="#ffffff" letter-spacing="-2.2" font-size="{title_size}">
      {title_tspans}
    </text>
  </g>

  {code_block}

  <!-- Footer: oradiscuss.com watermark -->
  <text x="88" y="800" font-family="Inter, -apple-system, Segoe UI, sans-serif" font-size="16" font-weight="600" fill="#665f59" letter-spacing="1.5">ORADISCUSS.COM  ·  MAHMOUD DARWISH  ·  ORACLE ACE APPRENTICE</text>
</svg>
'''

CODE_BLOCK_TMPL = '''<g transform="translate(88, 540)">
    <rect width="1424" height="230" rx="12" fill="#0e0c0b" stroke="#3a3532" stroke-width="1"/>
    <circle cx="28" cy="24" r="6" fill="#e86454"/>
    <circle cx="48" cy="24" r="6" fill="#c5720a"/>
    <circle cx="68" cy="24" r="6" fill="#2f7e4b"/>
    <text font-family="'JetBrains Mono', 'SF Mono', Menlo, monospace" font-size="22" fill="#e8e3dd">
      {code_lines}
    </text>
  </g>'''


def build_svg(title: str, category: str, code_lang: str | None, code: str | None) -> str:
    cat_label = CATEGORY_LABEL.get(category, category.upper())
    cat_w = max(160, len(cat_label) * 11 + 48)
    cat_cx = cat_w / 2

    title_lines = wrap_title(title, max_chars=32, max_lines=3)
    title_size = 70 if len(title_lines) <= 2 else 56
    title_tspans = '\n      '.join(
        f'<tspan x="0" dy="{int(title_size * 1.15) if i > 0 else 0}">{escape_svg(l)}</tspan>'
        for i, l in enumerate(title_lines)
    )

    code_block = ''
    if code:
        code_lines = highlight_code(code_lang or '', code)
        if code_lines:
            code_block = CODE_BLOCK_TMPL.format(code_lines=code_lines)

    return SVG_TMPL.format(
        aria=escape_svg(title),
        cat_label=escape_svg(cat_label),
        cat_w=cat_w,
        cat_cx=cat_cx,
        title_size=title_size,
        title_tspans=title_tspans,
        code_block=code_block,
    )


def set_cover_in_frontmatter(text: str, cover_path: str) -> str:
    m = re.match(r'^---\n(.*?)\n---', text, re.DOTALL)
    if not m:
        return text
    fm = m.group(1)
    if re.search(r'^cover:\s*\S', fm, re.MULTILINE):
        # Already has a non-empty cover, don't touch
        return text
    # Replace an empty cover: line if present, otherwise append one
    if re.search(r'^cover:\s*$', fm, re.MULTILINE):
        new_fm = re.sub(r'^cover:\s*$', f'cover: {cover_path}', fm, flags=re.MULTILINE)
    else:
        new_fm = fm + f'\ncover: {cover_path}'
    return '---\n' + new_fm + '\n---' + text[m.end():]


def main() -> int:
    written = []
    skipped = []
    for md in sorted(BLOG.glob('*.md')):
        slug = md.stem
        text = md.read_text(encoding='utf-8')
        fm, body, _ = parse_frontmatter(text)
        existing_cover = fm.get('cover', '').strip()
        title = fm.get('title', slug)
        category = fm.get('category', 'dba')
        lang, code = first_code_block(body)

        svg_path = OUT / f'{slug}.svg'
        svg_url = f'/images/blog/{slug}.svg'
        if existing_cover:
            skipped.append((slug, existing_cover))
            continue

        svg_path.write_text(build_svg(title, category, lang, code), encoding='utf-8')
        md.write_text(set_cover_in_frontmatter(text, svg_url), encoding='utf-8')
        written.append(slug)

    print(f'Generated {len(written)} covers:')
    for s in written:
        print(f'  + /images/blog/{s}.svg')
    print(f'\nSkipped {len(skipped)} (cover already set):')
    for s, c in skipped:
        print(f'  - {s}  ({c})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
