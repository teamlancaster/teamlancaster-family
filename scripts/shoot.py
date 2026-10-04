# Screenshots of the local dev server (wrangler dev on :8787) with Playwright + system Chrome.
import asyncio, sys
from playwright.async_api import async_playwright
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
PAGES = [('public', '/'), ('admin-dashboard', '/admin'), ('admin-person', '/admin/people/p_c1'), ('admin-branches', '/admin/branches'),
         ('admin-requests', '/admin/requests')]
async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        p = await ctx.new_page()
        errs = []
        p.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        p.on('pageerror', lambda e: errs.append(str(e)))
        for name, path in PAGES:
            await p.goto(B + path, wait_until='load')
            await p.wait_for_timeout(1200)
            if name == 'admin-branches' and '--reveal' in sys.argv:
                pass
            await p.screenshot(path=f'screenshots/{name}.png')
        # Branches: rotate flow -> one-time passphrase panel
        if '--rotate' in sys.argv:
            await p.goto(B + '/admin/branches', wait_until='load')
            await p.click('[data-rotate]'); await p.click('#rotGo'); await p.wait_for_timeout(900)
            await p.screenshot(path='screenshots/admin-branches-rotated.png')
        mctx = await br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        mp = await mctx.new_page()
        await mp.goto(B + '/', wait_until='load'); await mp.wait_for_timeout(1000)
        await mp.screenshot(path='screenshots/public-mobile.png', full_page=True)
        print('console errors:', errs)
        await br.close()
asyncio.run(main())
