const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  console.log("Navigating to http://localhost:5173/test/React");
  await page.goto('http://localhost:5173/test/React');
  await new Promise(r => setTimeout(r, 2000));
  const btns = await page.$$('button');
  for(let b of btns) {
    const text = await page.evaluate(el => el.textContent, b);
    if(text.includes('Easy')) {
      console.log('Clicking Easy button...');
      await b.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 3000));
  console.log("Adding debug info...");
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("BODY TEXT AFTER CLICK:", bodyText.substring(0, 200).replace(/\n/g, " "));
  await browser.close();
})();
