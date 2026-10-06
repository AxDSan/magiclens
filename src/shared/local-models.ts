import { type Browser, browser } from 'wxt/browser';
import { PROVIDERS } from './providers';
import type { Settings } from './settings';

const FIRST_RULE_ID = 100;

/**
 * Ollama answers 403 to any request carrying an Origin it does not know, which includes
 * extension origins unless the user sets OLLAMA_ORIGINS. Drop the Origin header, but only
 * on requests this extension itself sends to the configured Ollama host: web pages keep
 * Ollama's protection.
 */
export async function allowLocalModelServers(settings: Settings) {
  const dnr = browser.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  const hosts = new Set<string>();
  for (const base of [PROVIDERS.ollama.baseUrl, settings.providers.ollama.baseUrl]) {
    try {
      const url = new URL(base);
      hosts.add(`${url.protocol}//${url.host}/`);
    } catch {
      // Ignore malformed URLs typed in settings.
    }
  }
  const self = new URL(browser.runtime.getURL('/')).host;
  const rules: Browser.declarativeNetRequest.Rule[] = [...hosts].map((prefix, i) => ({
    id: FIRST_RULE_ID + i,
    priority: 1,
    action: {
      type: 'modifyHeaders' as Browser.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: 'origin', operation: 'remove' as Browser.declarativeNetRequest.HeaderOperation }],
    },
    condition: {
      urlFilter: `|${prefix}`,
      initiatorDomains: [self],
      resourceTypes: ['xmlhttprequest' as Browser.declarativeNetRequest.ResourceType, 'other' as Browser.declarativeNetRequest.ResourceType],
    },
  }));
  const existing = await dnr.getSessionRules();
  await dnr.updateSessionRules({
    removeRuleIds: existing.map((rule) => rule.id).filter((id) => id >= FIRST_RULE_ID),
    addRules: rules,
  });
}
