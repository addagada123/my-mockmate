import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Capture console messages
        def handle_console(msg):
            print(f"[{msg.type}] {msg.text}")
        page.on("console", handle_console)
        
        # Capture unhandled exceptions
        def handle_error(err):
            print(f"[ERROR] {err.message}")
        page.on("pageerror", handle_error)
        
        print("Navigating to http://localhost:5173/test/React ...")
        await page.goto("http://localhost:5173/test/React")
        
        await page.wait_for_timeout(2000)
        print("Page loaded.")

        # Try to find and click the 'Easy' button
        buttons = await page.locator("button").all_inner_texts()
        print(f"Buttons found: {buttons}")

        easy_button = page.locator("button", has_text="Easy")
        if await easy_button.count() > 0:
            print("Clicking 'Easy' button...")
            await easy_button.first.click()
            await page.wait_for_timeout(2000)
            print("After click Easy wait done.")
        else:
            print("Easy button not found!")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
