"""A tiny Markdown-to-HTML converter for the subset these docs use (standard library only).

Supports: headings (with anchor ids), paragraphs, bullet and numbered lists, tables, block quotes, fenced code, horizontal rules, and inline
code, bold, italic (*x*), links and images. `rewrite(href)` lets the caller turn links to .md files into links to the generated pages."""
import html, re


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", text).lower()).strip("-")


def inline(s, rewrite=lambda u: u):
    codes = []
    s = re.sub(r"`([^`]+)`", lambda m: codes.append(m.group(1)) or f"\0{len(codes) - 1}\0", s)      # protect code spans first
    s = html.escape(s, quote=False)
    s = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", lambda m: f'<img src="{html.escape(rewrite(m.group(2)), quote=True)}" alt="{html.escape(m.group(1), quote=True)}">', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", lambda m: f'<a href="{html.escape(rewrite(m.group(2)), quote=True)}">{m.group(1)}</a>', s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^*\s][^*]*?[^*\s]|[^*\s])\*(?![\w*])", r"<em>\1</em>", s)
    return re.sub(r"\0(\d+)\0", lambda m: f"<code>{html.escape(codes[int(m.group(1))], quote=False)}</code>", s)


def to_html(text, rewrite=lambda u: u):
    lines, out, i = text.replace("\r\n", "\n").split("\n"), [], 0
    inl = lambda s: inline(s, rewrite)
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"): j += 1
            out.append("<pre><code>" + html.escape("\n".join(lines[i + 1:j]), quote=False) + "</code></pre>"); i = j + 1; continue
        m = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if m:
            body = inl(m.group(2)); out.append(f'<h{len(m.group(1))} id="{slug(body)}">{body}</h{len(m.group(1))}>'); i += 1; continue
        if re.match(r"^(-{3,}|\*{3,})\s*$", ln): out.append("<hr>"); i += 1; continue
        if ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|\s*$", lines[i + 1]):
            cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
            head = cells(ln); j = i + 2; rows = []
            while j < len(lines) and lines[j].startswith("|"): rows.append(cells(lines[j])); j += 1
            out.append("<div class=\"table-wrap\"><table><thead><tr>" + "".join(f"<th>{inl(c)}</th>" for c in head) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{inl(c)}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table></div>"); i = j; continue
        if ln.startswith(">"):
            j = i; buf = []
            while j < len(lines) and lines[j].startswith(">"): buf.append(lines[j].lstrip(">").strip()); j += 1
            out.append("<blockquote><p>" + inl(" ".join(buf)) + "</p></blockquote>"); i = j; continue
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", ln)
        if m:
            tag = "ol" if m.group(2)[0].isdigit() else "ul"; items = []; j = i
            while j < len(lines):
                mm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[j])
                if mm: items.append(mm.group(3)); j += 1
                elif lines[j].startswith("  ") and lines[j].strip() and items: items[-1] += " " + lines[j].strip(); j += 1
                else: break
            out.append(f"<{tag}>" + "".join(f"<li>{inl(x)}</li>" for x in items) + f"</{tag}>"); i = j; continue
        if not ln.strip(): i += 1; continue
        j = i; buf = []
        while j < len(lines) and lines[j].strip() and not re.match(r"^(#{1,6}\s|```|>|\||(\s*)([-*]|\d+\.)\s+|-{3,}\s*$)", lines[j]): buf.append(lines[j].strip()); j += 1
        if not buf: buf = [ln.strip()]; j = i + 1
        out.append("<p>" + inl(" ".join(buf)) + "</p>"); i = j
    return "\n".join(out)
