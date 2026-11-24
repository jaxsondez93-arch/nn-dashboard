#!/usr/bin/env python3
"""Build the static website (the "github.io app") into an output folder. Standard library only (plus Pillow for the icons, if installed).

    python3 tools/build_pages.py site

Result: landing page, a live demo of the real dashboard running on synthetic data from static JSON files, the playground, every Markdown doc as an HTML page,
an app manifest, icons and an offline service worker. The Markdown stays the source of truth; nothing here is hand-edited."""
import html, json, os, posixpath, shutil, sys, tempfile, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, "tools")); sys.path.insert(0, os.path.join(ROOT, "demo"))
import md, make_demo_data
from analysis import RANGES

NAV = '<header class="top"><a class="brand" href="{r}index.html">nn-dashboard</a><nav><a href="{r}demo/">Live demo</a><a href="{r}playground/">Playground</a><a href="{r}docs/PLAIN_ENGLISH.html">In plain English</a><a href="{r}docs/README.html">Docs</a><a href="https://github.com/jaxsondez93-arch/nn-dashboard">GitHub</a></nav></header>'
PAGE = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · nn-dashboard</title><link rel="stylesheet" href="{r}site.css"><link rel="manifest" href="{r}manifest.webmanifest"><meta name="theme-color" content="#2f6fdb"></head>\n<body>{nav}\n<main><article>\n{body}\n</article></main>\n<footer>Made by <a href="https://github.com/jaxsondez93-arch">jaxsondez93</a> · <a href="{r}index.html">home</a> · <a href="{r}playground/">playground</a></footer>\n<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("{r}sw.js").catch(function(){{}});</script></body></html>\n'
DOCS = ["README.md", "SECURITY.md", "CONTRIBUTING.md"] + sorted(f"docs/{f}" for f in os.listdir(os.path.join(ROOT, "docs")) if f.endswith(".md")) + sorted(f"docs/math/{f}" for f in os.listdir(os.path.join(ROOT, "docs/math")) if f.endswith(".md"))


def target(src):                                       # repo path of a markdown/image file -> path inside the site
    if src in ("README.md", "SECURITY.md", "CONTRIBUTING.md"): return "docs/" + src[:-3] + ".html"
    if src.startswith("docs/images/"): return src
    if src.endswith(".md"): return src[:-3] + ".html"
    return None


def build(out):
    if os.path.exists(out): shutil.rmtree(out)
    os.makedirs(out)
    # ---- docs pages
    for src in DOCS:
        text = open(os.path.join(ROOT, src), encoding="utf-8").read(); dst = target(src); depth = dst.count("/"); root_rel = "../" * depth
        def rewrite(u, src=src, dst=dst):
            if u.startswith(("http://", "https://", "#", "mailto:")): return u
            path, _, frag = u.partition("#"); tgt = target(posixpath.normpath(posixpath.join(posixpath.dirname(src), path)))
            if tgt is None: return u
            return posixpath.relpath(tgt, posixpath.dirname(dst)) + ("#" + frag if frag else "")
        body = md.to_html(text, rewrite); first = text.split("\n", 1)[0].lstrip("# ").strip() or src
        os.makedirs(os.path.dirname(os.path.join(out, dst)), exist_ok=True)
        open(os.path.join(out, dst), "w", encoding="utf-8").write(PAGE.format(title=html.escape(first), r=root_rel, nav=NAV.format(r=root_rel), body=body))
    shutil.copytree(os.path.join(ROOT, "docs/images"), os.path.join(out, "docs/images"))
    # ---- demo: the real dashboard page on static JSON
    from settings import settings
    import snapshot
    tmp = tempfile.mkdtemp(); make_demo_data.make(tmp + "/run", days=5.0, seed=7)
    saved = (settings.data_dir, settings.work_dir, settings.demo); settings.data_dir = settings.work_dir = tmp + "/run"; settings.demo = True
    os.makedirs(out + "/demo/data")
    try:
        for r in RANGES: json.dump(snapshot.build(r), open(f"{out}/demo/data/{r}.json", "w"), separators=(",", ":"))
    finally: settings.data_dir, settings.work_dir, settings.demo = saved
    shutil.copytree(os.path.join(ROOT, "static"), out + "/demo/static")
    page = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    page = page.replace('<script src="static/dashboard.js"></script>', '<script>window.NN_STATIC = true;</script>\n<script src="static/dashboard.js"></script>\n<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("../sw.js").catch(function(){});</script>')
    page = page.replace("<body>", '<body>\n<div style="background:#2f6fdb;color:#fff;padding:.45rem 1rem;font:14px system-ui,sans-serif">Demo with <b>synthetic data</b>: every button works, nothing is real. <a style="color:#fff" href="../">&larr; home</a> · <a style="color:#fff" href="../playground/">playground</a> · <a style="color:#fff" href="../docs/HOW_TO_READ_THE_CHARTS.html">how to read this page</a></div>', 1)
    page = page.replace("</head>", '<link rel="manifest" href="../manifest.webmanifest"><meta name="theme-color" content="#2f6fdb"></head>', 1)
    open(out + "/demo/index.html", "w", encoding="utf-8").write(page)
    # ---- playground, landing, shared css, manifest
    shutil.copytree(os.path.join(ROOT, "web/playground"), out + "/playground")
    for f in ("index.html", "site.css", "manifest.webmanifest"): shutil.copy(os.path.join(ROOT, "web", f), os.path.join(out, f))
    # ---- icons
    try:
        from PIL import Image, ImageDraw
        for size in (192, 512):
            im = Image.new("RGBA", (size, size), (47, 111, 219, 255)); d = ImageDraw.Draw(im); s = size / 192
            pts = [(30 * s, 140 * s), (68 * s, 96 * s), (100 * s, 118 * s), (138 * s, 52 * s), (164 * s, 70 * s)]
            d.line(pts, fill="white", width=int(10 * s), joint="curve")
            for p in pts: d.ellipse([p[0] - 8 * s, p[1] - 8 * s, p[0] + 8 * s, p[1] + 8 * s], fill=(255, 255, 255, 255))
            im.save(f"{out}/icon-{size}.png")
    except ImportError:
        for size in (192, 512): open(f"{out}/icon-{size}.png", "wb").write(b"")
    # ---- service worker (version + file list), .nojekyll
    core = ["./", "./index.html", "./site.css", "./icon-192.png", "./demo/", "./demo/index.html", "./demo/static/dashboard.css", "./demo/static/dashboard.js", "./playground/", "./playground/index.html", "./playground/playground.js"] + [f"./demo/data/{r}.json" for r in RANGES] + ["./docs/PLAIN_ENGLISH.html", "./docs/README.html"]
    sw = open(os.path.join(ROOT, "web/sw.js")).read().replace("@@VERSION@@", time.strftime("%Y%m%d%H%M%S")).replace("@@CORE@@", json.dumps(core))
    open(out + "/sw.js", "w").write(sw); open(out + "/.nojekyll", "w").write("")
    return out


if __name__ == "__main__":
    out = build(sys.argv[1] if len(sys.argv) > 1 else "site"); n = sum(len(f) for _, _, f in os.walk(out)); print(f"built {n} files into {out}")
