const { webkit } = require('playwright');
const path = require('path');

(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.type()} - ${msg.text()}`));
  page.on('pageerror', error => console.log(`BROWSER ERROR: ${error.message}`));
  
  const fileUrl = `file:///${path.resolve('sandbox.html').replace(/\\/g, '/')}`;
  console.log(`Navigating to ${fileUrl}`);
  
  await page.goto(fileUrl);
  
  // Wait a bit for initialization
  await page.waitForTimeout(2000);
  
  console.log("Mocking Auth State...");
  await page.evaluate(() => {
    // Wait for window.Auth to be defined
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (window.Auth) {
          clearInterval(check);
          
          window.FirebaseAuth = {
            currentUser: { uid: 'mock_uid', isAnonymous: false }
          };
          
          // Execute render directly!
          try {
             window.Auth.renderDataManager(document.getElementById('data-manager-content'));
             console.log("Called renderDataManager successfully.");
          } catch(e) {
             console.log("renderDataManager ERROR: " + e.message + " " + e.stack);
          }
          
          resolve();
        }
      }, 100);
    });
  });
  
  await page.waitForTimeout(2000);
  
  const drawerHtml = await page.evaluate(() => document.getElementById('data-manager-content').innerHTML);
  console.log("Drawer HTML:");
  console.log(drawerHtml.substring(0, 200) + '...');
  
  await browser.close();
})();
