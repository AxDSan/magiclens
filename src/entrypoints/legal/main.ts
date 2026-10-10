// The same files are published in the repository, so the extension and the store listings
// link to one text.
import privacy from '../../../PRIVACY.md?raw';
import terms from '../../../TERMS.md?raw';
import { renderMarkdown } from '../../content/ui/markdown';
import '../../ui/page.css';
import './legal.css';

renderMarkdown(privacy, document.getElementById('privacy')!);
renderMarkdown(terms, document.getElementById('terms')!);
document.getElementById(location.hash.slice(1))?.scrollIntoView();
