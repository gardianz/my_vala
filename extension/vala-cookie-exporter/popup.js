const VALA_ORIGIN = 'https://vala-wallet.cc';
const SESSION_COOKIE_NAME = 'sessionToken';

const elements = {
  statusBadge: document.getElementById('statusBadge'),
  usernameValue: document.getElementById('usernameValue'),
  partyIdValue: document.getElementById('partyIdValue'),
  cookieCountValue: document.getElementById('cookieCountValue'),
  expiryValue: document.getElementById('expiryValue'),
  hintText: document.getElementById('hintText'),
  tokenOutput: document.getElementById('tokenOutput'),
  cookieOutput: document.getElementById('cookieOutput'),
  snippetOutput: document.getElementById('snippetOutput'),
  refreshButton: document.getElementById('refreshButton'),
  copyTokenButton: document.getElementById('copyTokenButton'),
  copyCookieButton: document.getElementById('copyCookieButton'),
  copySnippetButton: document.getElementById('copySnippetButton'),
};

function setStatus(text, mode) {
  elements.statusBadge.textContent = text;
  elements.statusBadge.className = `badge ${mode || ''}`.trim();
}

function formatExpiry(cookie) {
  if (!cookie) return '-';
  if (cookie.session) return 'Session cookie';
  if (!cookie.expirationDate) return '-';
  return new Date(cookie.expirationDate * 1000).toLocaleString();
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 18) return token;
  return `${token.slice(0, 10)}...${token.slice(-8)}`;
}

async function copyText(text, button, originalLabel) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  button.textContent = 'Copied';
  setTimeout(() => {
    button.textContent = originalLabel;
  }, 1200);
}

async function getSessionCookie() {
  return chrome.cookies.get({
    url: VALA_ORIGIN,
    name: SESSION_COOKIE_NAME,
  });
}

async function getAllCookies() {
  return chrome.cookies.getAll({
    domain: 'vala-wallet.cc',
  });
}

async function getActiveTabContext() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id || !tab.url?.startsWith(VALA_ORIGIN)) {
    return {
      username: '',
      partyId: '',
      hint: 'Buka tab Vala yang sudah login untuk mengambil username dan partyId otomatis.',
    };
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      username: window.localStorage.getItem('username') || '',
      partyId: window.localStorage.getItem('partyId') || '',
      path: window.location.pathname,
    }),
  });

  return {
    username: injection?.result?.username || '',
    partyId: injection?.result?.partyId || '',
    hint: injection?.result?.path
      ? `Data browser diambil dari tab aktif: ${injection.result.path}`
      : 'Data browser diambil dari tab aktif.',
  };
}

function buildCookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function buildSnippet({ username, partyId, sessionToken, cookieHeader }) {
  return JSON.stringify(
    {
      name: username || 'wallet-1',
      username: username || 'your_username',
      privateKey: '0xYOUR_PRIVATE_KEY',
      partyId: partyId || 'optional_party_id_from_browser_state',
      sessionToken: sessionToken || 'paste_session_token_here',
      cookieHeader: cookieHeader || 'optional_full_cookie_header',
    },
    null,
    2,
  );
}

async function refreshState() {
  setStatus('Checking...', '');
  elements.refreshButton.disabled = true;

  try {
    const [sessionCookie, cookies, tabContext] = await Promise.all([
      getSessionCookie(),
      getAllCookies(),
      getActiveTabContext(),
    ]);

    const cookieHeader = buildCookieHeader(cookies);
    const sessionToken = sessionCookie?.value || '';

    elements.usernameValue.textContent = tabContext.username || '-';
    elements.partyIdValue.textContent = tabContext.partyId || '-';
    elements.cookieCountValue.textContent = String(cookies.length);
    elements.expiryValue.textContent = formatExpiry(sessionCookie);
    elements.hintText.textContent = tabContext.hint;
    elements.tokenOutput.value = sessionToken;
    elements.cookieOutput.value = cookieHeader;
    elements.snippetOutput.value = buildSnippet({
      username: tabContext.username,
      partyId: tabContext.partyId,
      sessionToken,
      cookieHeader,
    });

    if (sessionToken) {
      setStatus(`Found ${maskToken(sessionToken)}`, 'ok');
    } else {
      setStatus('sessionToken not found', 'error');
    }
  } catch (error) {
    setStatus('Extension error', 'error');
    elements.hintText.textContent = error.message;
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton.addEventListener('click', () => {
  refreshState();
});

elements.copyTokenButton.addEventListener('click', async () => {
  await copyText(elements.tokenOutput.value, elements.copyTokenButton, 'Copy');
});

elements.copyCookieButton.addEventListener('click', async () => {
  await copyText(elements.cookieOutput.value, elements.copyCookieButton, 'Copy');
});

elements.copySnippetButton.addEventListener('click', async () => {
  await copyText(elements.snippetOutput.value, elements.copySnippetButton, 'Copy');
});

refreshState();
