'use strict';

/* Loaded after common/settings.js and ui/panel.js */

(async () => {
  const $ = id => document.getElementById(id);
  const settings = await uwLoadSettings();

  const panel = new UWPanel({ mode: 'embedded', container: $('panel'), settings });
  const applyTheme = () => { document.documentElement.dataset.theme = settings.theme; };
  applyTheme();

  // ---------- on/off ----------

  const enabled = $('enabled');
  const renderEnabled = () => {
    enabled.checked = settings.enabled;
    $('enabledLabel').textContent = settings.enabled ? 'On' : 'Off';
  };
  renderEnabled();
  enabled.addEventListener('change', () => {
    settings.enabled = enabled.checked;
    renderEnabled();
    uwSaveSettings({ enabled: settings.enabled });
  });

  // ---------- selects ----------

  for (const select of document.querySelectorAll('select[data-setting]')) {
    const key = select.dataset.setting;
    select.value = String(settings[key]);
    select.addEventListener('change', () => {
      settings[key] = select.dataset.type === 'number' ? Number(select.value) : select.value;
      uwSaveSettings({ [key]: settings[key] });
      panel.setSettings(settings);
      applyTheme();
    });
  }

  for (const box of document.querySelectorAll('input[type="checkbox"][data-setting]')) {
    const key = box.dataset.setting;
    box.checked = !!settings[key];
    box.addEventListener('change', () => {
      settings[key] = box.checked;
      uwSaveSettings({ [key]: box.checked });
    });
  }

  $('openPdf').addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('pdfjs/web/uwords-viewer.html') });
    window.close();
  });

  // ---------- current site ----------

  panel.focus();

  let tab = null;
  let host = '';
  try {
    [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') host = url.hostname;
  } catch (e) { /* no URL access for this tab */ }

  if (host) {
    $('siteRow').hidden = false;
    $('siteName').textContent = host;
    const box = $('siteDisabled');
    box.checked = settings.disabledSites.includes(host);
    box.addEventListener('change', () => {
      const others = settings.disabledSites.filter(h => h !== host);
      settings.disabledSites = box.checked ? [...others, host] : others;
      uwSaveSettings({ disabledSites: settings.disabledSites });
    });
  }

  // ---------- start with the page's selection, if any ----------

  if (!tab) return;
  try {
    const [selected] = await browser.tabs.executeScript(tab.id, { code: 'String(getSelection())' });
    const initial = uwNormalizeQuery(selected);
    if (uwIsPhrase(initial)) panel.lookup(initial);
  } catch (e) { /* restricted page (about:, add-ons store, PDF viewer...) */ }
})();
