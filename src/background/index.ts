// Open our dashboard page in a new tab when the user clicks the extension icon
chrome.action.onClicked.addListener(async () => {
  // Try to detect a Jira base URL via cookies so we can pass it to the page
  let baseUrlParam = '';
  try {
    const candidates = ['atlassian.net', 'jira.com'];
    let found: string | null = null;
    for (const domain of candidates) {
      const cookies = await chrome.cookies.getAll({ domain });
      if (cookies && cookies.length > 0) {
        const host = cookies[0].domain?.replace(/^\./, '') || domain;
        found = `https://${host}`;
        break;
      }
    }
    if (found) {
      baseUrlParam = `?baseUrl=${encodeURIComponent(found)}`;
    }
  } catch (e) {
    // Non-fatal: if cookie lookup fails, continue without baseUrl param
    console.debug('Jira base URL detection via cookies failed', e);
  }

  const url = chrome.runtime.getURL(`src/popup/index.html${baseUrlParam}`);
  await chrome.tabs.create({ url });
});
