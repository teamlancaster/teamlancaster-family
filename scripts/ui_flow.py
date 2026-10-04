# Browser flow check against local wrangler dev (after re-seeding): diff-then-apply, photo upload
# pipeline (EXIF JPEG in -> clean WebP stored), fix-7 toggle, public guide + search + request form.
import asyncio
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
B = 'http://localhost:8787'
im = Image.new('RGB', (1200, 800), (86, 96, 74)); ImageDraw.Draw(im).ellipse((400, 200, 800, 600), fill=(185, 164, 135))
ex = im.getexif(); ex[0x010F] = 'FakeCam'; im.save('/tmp/test-photo.jpg', exif=ex.tobytes())
async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        p = await (await br.new_context(viewport={'width': 1280, 'height': 800})).new_page()
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        p.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await p.goto(B + '/admin/requests'); await p.wait_for_timeout(500)
        await p.click('[data-review="1"]')
        await p.select_option('.rvrow select >> nth=0', 'p_c1'); await p.select_option('.rvrow select >> nth=1', 'birth_year'); await p.fill('.rvrow input', '1974')
        apply_disabled_before = await p.get_attribute('#rvApply', 'disabled')
        await p.click('#rvPreview'); await p.wait_for_timeout(600)
        await p.screenshot(path='screenshots/admin-request-diff.png')
        await p.click('#rvApply'); await p.wait_for_timeout(1200)
        await p.goto(B + '/admin/people/p_c1'); await p.set_input_files('#photoIn', '/tmp/test-photo.jpg'); await p.wait_for_timeout(3000)
        await p.goto(B + '/admin/people/p_c1'); await p.wait_for_timeout(800)
        thumbs = await p.eval_on_selector_all('.ph img', 'e=>e.map(x=>x.naturalWidth)')
        by = await p.input_value('input[name=birth_year]')
        await p.goto(B + '/admin/people/p_k1'); await p.wait_for_timeout(400)
        dis = await p.get_attribute('[data-tog="public_ok"]', 'disabled')
        await p.click('[data-tog="adult_confirmed"]'); dis2 = await p.get_attribute('[data-tog="public_ok"]', 'disabled')
        await p.goto(B + '/'); await p.wait_for_timeout(500)
        await p.fill('#gq', 'how do I request a change?'); await p.press('#gq', 'Enter'); await p.wait_for_timeout(800)
        await p.fill('#gq', 'what is the passphrase?'); await p.press('#gq', 'Enter'); await p.wait_for_timeout(800)
        await p.fill('#q', 'te'); await p.wait_for_timeout(800)
        await p.screenshot(path='screenshots/public-guide-search.png')
        await p.click('#openReq'); await p.wait_for_timeout(1500); await p.screenshot(path='screenshots/public-request-form.png')
        print('apply disabled before preview:', apply_disabled_before is not None, '| birth_year after apply:', by, '| thumbs:', thumbs,
              '| public toggle disabled (minor):', dis is not None, '| after Confirmed adult on:', dis2 is not None, '| errors:', errs)
        await br.close()
asyncio.run(main())
