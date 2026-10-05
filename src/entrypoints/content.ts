import { defineContentScript } from 'wxt/utils/define-content-script';
import { boot } from '../content';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main(ctx) {
    void boot(ctx);
  },
});
