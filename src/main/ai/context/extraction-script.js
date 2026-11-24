// Page content extraction script - runs in an isolated page context via
// webContents.executeJavaScript. Returns a JSON string.
//
// Privacy rules enforced here (defense in depth; the main process also
// redacts credential-shaped strings and never reads cookies or form values):
// - form controls (input/textarea/select/option) are never read
// - elements marked data-private / data-sensitive are skipped
// - hidden elements, scripts, styles and embedded frames are skipped
// - output is bounded

(function () {
  'use strict';

  var MAX_TEXT_LENGTH = 50000;
  var MAX_SELECTED_LENGTH = 20000;
  var MAX_HEADINGS = 200;
  var MAX_LINKS = 150;
  var MAX_METADATA_VALUE = 1000;

  var BLOCKED_SELECTOR = [
    'script', 'style', 'noscript', 'iframe', 'frame', 'svg', 'canvas',
    'template', 'object', 'embed', 'form', 'input', 'textarea', 'select',
    'option', 'button', 'nav', 'footer',
    '[contenteditable="true"]', '[data-private]', '[data-sensitive]',
    '[aria-hidden="true"]', '[hidden]'
  ].join(',');

  var SENSITIVE_HINT = /password|passwd|pwd|credit|card|cvv|cvc|ssn|social.?security|secret|token|api.?key|iban|routing|account.?number|one.?time|otp/i;

  var styleCache = new WeakMap();

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return true;
    var cached = styleCache.get(el);
    if (cached !== undefined) return cached;
    var visible = true;
    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        visible = false;
      }
    } catch (e) {
      visible = true;
    }
    styleCache.set(el, visible);
    return visible;
  }

  function isBlocked(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.closest(BLOCKED_SELECTOR)) return true;
      var hint = [
        el.getAttribute('name') || '',
        el.getAttribute('id') || '',
        el.getAttribute('autocomplete') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('placeholder') || ''
      ].join(' ');
      if (SENSITIVE_HINT.test(hint)) return true;
    } catch (e) {
      // Ignore selector errors on exotic documents.
    }
    return false;
  }

  function blockTextLength(el) {
    try {
      return (el.innerText || el.textContent || '').length;
    } catch (e) {
      return 0;
    }
  }

  function pickRoot() {
    var selectors = [
      'article', 'main', '[role="main"]', '.post-content', '.article-content',
      '.entry-content', '.article-body', '.post-body', '#content', '.content'
    ];
    var best = null;
    var bestLength = 0;
    for (var i = 0; i < selectors.length; i++) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (!isVisible(node)) continue;
        var length = blockTextLength(node);
        if (length > bestLength) {
          best = node;
          bestLength = length;
        }
      }
    }
    // Only trust a narrow root when it actually contains a useful amount of
    // prose; otherwise fall back to the whole body.
    if (best && bestLength >= 300) return best;
    return document.body || document.documentElement;
  }

  function getReadableText(root) {
    if (!root) return '';
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (isBlocked(parent)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var parts = [];
    var total = 0;
    var node;
    while ((node = walker.nextNode())) {
      var text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      parts.push(text);
      total += text.length + 1;
      if (total >= MAX_TEXT_LENGTH) break;
    }

    var joined = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return joined.slice(0, MAX_TEXT_LENGTH);
  }

  function getSelectedText() {
    try {
      var selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return undefined;
      var text = selection.toString().replace(/\s+/g, ' ').trim();
      return text ? text.slice(0, MAX_SELECTED_LENGTH) : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function getHeadings() {
    var headings = [];
    var seen = {};
    var nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < nodes.length && headings.length < MAX_HEADINGS; i++) {
      var el = nodes[i];
      if (!isVisible(el) || isBlocked(el)) continue;
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 300) continue;
      var level = parseInt(el.tagName.charAt(1), 10) || 1;
      var key = level + ':' + text;
      if (seen[key]) continue;
      seen[key] = true;
      headings.push({ level: level, text: text });
    }
    return headings;
  }

  function getMetadata() {
    var metadata = {};
    var metas = document.querySelectorAll('meta');
    for (var i = 0; i < metas.length; i++) {
      var meta = metas[i];
      var name = meta.getAttribute('name') || meta.getAttribute('property');
      var content = meta.getAttribute('content');
      if (!name || !content) continue;
      name = name.trim().toLowerCase();
      if (!name || metadata[name]) continue;
      metadata[name] = content.replace(/\s+/g, ' ').trim().slice(0, MAX_METADATA_VALUE);
    }

    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.getAttribute('href')) {
      metadata.canonical = canonical.getAttribute('href');
    }
    metadata.lang = document.documentElement.getAttribute('lang') || 'unknown';

    var description = metadata['description'] || metadata['og:description'];
    if (description) metadata.description = description;
    var author = metadata['author'] || metadata['article:author'];
    if (author) metadata.author = author;
    var keywords = metadata['keywords'];
    if (keywords) metadata.keywords = keywords;

    return metadata;
  }

  function getLinks() {
    var links = [];
    var seen = {};
    var nodes = document.querySelectorAll('a[href]');
    for (var i = 0; i < nodes.length && links.length < MAX_LINKS; i++) {
      var a = nodes[i];
      if (!isVisible(a) || isBlocked(a)) continue;
      var href = a.getAttribute('href');
      if (!href) continue;
      var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      try {
        var url = new URL(href, window.location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        url.username = '';
        url.password = '';
        var key = url.href + '|' + text;
        if (seen[key]) continue;
        seen[key] = true;
        links.push({
          url: url.href.slice(0, 2000),
          text: text.slice(0, 300),
          title: (a.getAttribute('title') || '').slice(0, 300) || undefined
        });
      } catch (e) {
        // Ignore malformed hrefs.
      }
    }
    return links;
  }

  function getAccessibility(headings, selectedText) {
    var images = document.images ? document.images.length : 0;
    var withAlt = 0;
    if (document.images) {
      for (var i = 0; i < document.images.length; i++) {
        if ((document.images[i].getAttribute('alt') || '').trim()) withAlt++;
      }
    }
    var landmarks = document.querySelectorAll(
      'header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]'
    ).length;
    return {
      language: document.documentElement.getAttribute('lang') || 'unknown',
      landmarkCount: landmarks,
      imagesTotal: images,
      imagesWithAlt: withAlt,
      headingCount: headings.length,
      hasSelection: Boolean(selectedText)
    };
  }

  try {
    var root = pickRoot();
    var headings = getHeadings();
    var selectedText = getSelectedText();
    var metadata = getMetadata();
    var title = (document.title || '').trim();
    if (!title) {
      var ogTitle = metadata['og:title'] || metadata['twitter:title'];
      title = ogTitle || (headings[0] && headings[0].text) || window.location.href;
    }

    var result = {
      url: window.location.href,
      title: title.slice(0, 500),
      readableText: getReadableText(root),
      selectedText: selectedText,
      headings: headings,
      metadata: metadata,
      links: getLinks(),
      accessibility: getAccessibility(headings, selectedText),
      timestamp: Date.now(),
      readyState: document.readyState
    };

    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({
      url: window.location.href,
      title: document.title || '',
      readableText: '',
      headings: [],
      metadata: {},
      links: [],
      accessibility: {},
      timestamp: Date.now(),
      error: String(error && error.message ? error.message : error)
    });
  }
})();
