"""The Markdown converter used to publish the docs as web pages."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from md import inline, slug, to_html


class Md(unittest.TestCase):
    def test_headings_get_anchor_ids(self):
        self.assertIn('<h2 id="the-60-second-version">The 60-second version</h2>', to_html("## The 60-second version")); self.assertEqual(slug("Glossary"), "glossary")

    def test_inline_styles(self):
        self.assertEqual(inline("a **b** and *c* and `d`"), "a <strong>b</strong> and <em>c</em> and <code>d</code>")

    def test_code_spans_are_protected_from_styling_and_escaped(self):
        self.assertEqual(inline("`a*b*<c>`"), "<code>a*b*&lt;c&gt;</code>")

    def test_underscores_in_names_are_left_alone(self):
        self.assertEqual(inline("see nn_data_v3 here"), "see nn_data_v3 here")

    def test_html_is_escaped(self):
        self.assertIn("&lt;script&gt;", to_html("<script>alert(1)</script>")); self.assertNotIn("<script>", to_html("x <script>y</script>"))

    def test_links_images_and_rewrite(self):
        h = to_html("[go](A.md) ![pic](images/x.png)", rewrite=lambda u: u.replace(".md", ".html"))
        self.assertIn('<a href="A.html">go</a>', h); self.assertIn('<img src="images/x.png" alt="pic">', h)

    def test_tables(self):
        h = to_html("| a | b |\n|---|---|\n| 1 | **2** |")
        self.assertIn("<th>a</th>", h); self.assertIn("<td><strong>2</strong></td>", h); self.assertEqual(h.count("<tr>"), 2)

    def test_lists_and_wrapped_items(self):
        h = to_html("- one\n  more\n- two\n\n1. x\n2. y")
        self.assertIn("<ul><li>one more</li><li>two</li></ul>", h); self.assertIn("<ol><li>x</li><li>y</li></ol>", h)

    def test_blockquote_fence_and_rule(self):
        h = to_html("> note\n\n```\na < b\n```\n\n---")
        self.assertIn("<blockquote><p>note</p></blockquote>", h); self.assertIn("<pre><code>a &lt; b</code></pre>", h); self.assertIn("<hr>", h)

    def test_paragraphs_join_lines(self):
        self.assertEqual(to_html("one\ntwo\n\nthree"), "<p>one two</p>\n<p>three</p>")


if __name__ == "__main__":
    unittest.main()
