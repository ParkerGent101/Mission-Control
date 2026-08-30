import sys, pathlib
from playwright.sync_api import sync_playwright

target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("static/finance-core.jsx")
code = target.read_text(encoding="utf-8")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("about:blank")
    page.add_script_tag(url="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js")
    result = page.evaluate(
        """(code) => {
            try { Babel.transform(code, { presets: ['react'], filename: 'check.jsx' }); return { ok: true }; }
            catch (e) { return { ok: false, msg: String(e && e.message || e) }; }
        }""",
        code,
    )
    browser.close()

if result.get("ok"):
    print("OK: modules.jsx transforms cleanly")
else:
    print("BABEL ERROR:\n" + result.get("msg", "unknown"))
    sys.exit(1)
