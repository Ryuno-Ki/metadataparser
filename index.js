import urlModule from 'node:url';

import * as cheerio from 'cheerio';
import extend from 'ampersand-class-extend';

import pkg from './package.json' with { type: 'json' };

const defaultUserAgent = pkg.name.replace(/^@[^/]*\//, '') + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');

const ogTypes = [
  'video',
  'music',
  'article',
  'book',
  'profile'
];

function createRequestHeaders (options) {
  return {
    'User-Agent': ((options.userAgent || '') + ' ' + defaultUserAgent).trim(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };
}

function isEmptyObject (obj) {
  for (let key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }
  return true;
}

function convertValue (typeTag, rootTag, property, value, baseUrl) {
  value = value ? value.trim() : '';

  if (value === '') {
    return '';
  }

  if (['url', 'secure_url', 'image', 'video', 'audio'].indexOf(property || rootTag) !== -1) {
    return resolve(baseUrl, value);
  }

  if (['width', 'height'].indexOf(property) !== -1) {
    return parseInt(value, 10);
  }

  return value;
}

function normalizeOGData (og) {
  function setUrlAsValue (item) {
    if (!item.properties) {
      return item;
    }
    if (item.properties.url) {
      item.value = item.properties.url;
      delete item.properties.url;
    } else if (!item.value && item.properties.secure_url) {
      item.value = item.properties.secure_url;
      delete item.properties.secure_url;
    }
    if (isEmptyObject(item.properties)) {
      delete item.properties;
    }
    return item;
  }

  function normalize (data, key, method) {
    if (Array.isArray(data[key])) {
      data[key] = data[key].map(method).filter(function (row) {
        return row.value !== undefined && row.value !== '';
      });
    }
    return og;
  }

  og = normalize(og, 'image', setUrlAsValue);
  og = normalize(og, 'video', setUrlAsValue);
  og = normalize(og, 'audio', setUrlAsValue);

  for (let key in og) {
    if (Object.prototype.hasOwnProperty.call(og, key) && isEmptyObject(og[key])) {
      delete og[key];
    }
  }

  return og;
}

// c.f. https://nodejs.org/api/url.html#urlresolvefrom-to
function resolve(from, to) {
  const resolvedUrl = new urlModule.URL(to, new urlModule.URL(from, 'resolve://'));

  if (resolvedUrl.protocol === 'resolve:') {
    // `from` is a relative URL.
    const { pathname, search, hash } = resolvedUrl;
    return `${pathname}${search}${hash}`;
  }

  return resolvedUrl.toString();
}

export class MetaDataParser {
  constructor () {
    this.extractors = {};
    this.orderedExtractors = [];

    this.addDefaultExtractors();
  }

  addDefaultExtractors () {
    this.addExtractor('og', this._extractOg);
    this.addExtractor('metaProperties', this._extractMetaProperties);
    this.addExtractor('links', this._extractLinks);
    this.addExtractor('headers', this._extractHeaders);
  }

  addExtractor (name, method) {
    this.extractors[name] = method;
    this.orderedExtractors.push(method);
  }

  removeExtractor (name) {
    let method, pos;

    method = this.extractors[name];

    if (method) {
      pos = this.orderedExtractors.indexOf(method);
      if (pos !== -1) {
        this.orderedExtractors.splice(pos, 1);
      }
      delete this.extractors[name];
    }
  }

  extract (url, html, res, options) {
    options = options || {};

    const self = this;
    const $ = cheerio.load(html);
    let baseUrl;
    const context = {
      url: url,
      res: res
    };
    let dataChain;
    let extractorSubset;

    try {
      baseUrl = $('base').attr('href');
    } catch (e) {
      console.log('Error parsing HTML', e, e.stack);
      return Promise.reject(e);
    }

    baseUrl = baseUrl ? resolve(url, baseUrl) : url;

    if (options.extractors) {
      extractorSubset = [];
      [].concat(options.extractors).forEach(function (extractorName) {
        extractorSubset.push(self.extractors[extractorName]);
      });
    }

    dataChain = this.orderedExtractors.reduce(function (dataChain, extractionMethod) {
      // Only apply the requested extractors
      if (extractorSubset && extractorSubset.indexOf(extractionMethod) === -1) {
        return dataChain;
      }
      // Add the extractor to the Promise chain
      return dataChain.then(function (data) {
        return extractionMethod.call(self, $, data, context);
      });
    }, Promise.resolve({ baseUrl: baseUrl }));

    return dataChain;
  }

  async fetch (url, meta, options = {}) {
    try {
      const res = await globalThis.fetch(
        url,
        {
          headers: createRequestHeaders(options),
          // TODO: Figure out whether `pool: {maxSockets: Infinity}` is needed
          redirect: 'manual', // = do not follow redirects
          signal: AbortSignal.timeout(8000),
        }
      );

      const result = {
        meta,
        url,
      };

      if (res.status > 299) {
        if (res.status < 400 && res.headers.location) {
          result.redirect = resolve(url, res.headers.location);
          return Promise.resolve(result);
        } else {
          return Promise.reject('Invalid response. Code ' + res.status);
        }
      } else {
        const body = await res.text();
        const data = await this.extract(url, body, res, {
          extractors: options.extractors
        });
        result.data = data;
        return Promise.resolve(result);
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async fetchBatch ({ batch, options }) {
    if (!batch || !Array.isArray(batch)) {
      throw new Error('Unknown input data');
    }

    return Promise.allSettled(batch
      .filter((item) => item.url)
      .map((item) => this.fetch(item.url, item.meta || {}, options))
    );
  }

  _extractOg ($, data) {
    let currentRootTag;
    let currentRootName;
    let ogType;

    function extractOG (localData, elem) {
      const $elem = $(elem);
      let value = $elem.attr('content');
      const property = $elem.attr('property').split(':');
      const typeTag = property[0];
      const rootTag = property[1];
      const metaTag = property[2];

      if (!rootTag || metaTag === '') {
        return localData;
      }

      value = convertValue(typeTag, rootTag, metaTag, value, data.baseUrl);

      if (!metaTag || rootTag !== currentRootName) {
        currentRootName = rootTag;
        currentRootTag = {};
        localData[rootTag] = localData[rootTag] || [];
        localData[rootTag].push(currentRootTag);
      }

      if (metaTag) {
        if (currentRootTag && value !== '') {
          currentRootTag.properties = currentRootTag.properties || {};
          currentRootTag.properties[metaTag] = value;
        }
      } else if (value !== '') {
        currentRootTag.value = value;
      } else {
        localData[rootTag].pop();
        currentRootTag = false;
      }

      return localData;
    }

    data.og = $('meta[property^="og:"]').get().reduce(extractOG, {});
    data.og = normalizeOGData(data.og);

    ogType = data.og.type ? data.og.type[0].value.split('.')[0] : false;
    if (ogType && ogTypes.indexOf(ogType) !== -1) {
      currentRootTag = false;
      data.ogType = data.og.type[0].value;
      data.ogTypeData = $('meta[property^="' + ogType + ':"]').get().reduce(extractOG, {});
    }

    return data;
  }

  _extractMetaProperties ($, data) {
    data.metaProperties = {};

    $('meta[property^="fb:"]').each(function () {
      const $this = $(this);
      const value = $this.attr('content');
      const property = $this.attr('property');

      data.metaProperties[property] = data.metaProperties[property] || [];
      data.metaProperties[property].push(value);
    });

    $('meta[name^="twitter:"], meta[name="generator"]').each(function () {
      const $this = $(this);
      const value = $this.attr('content');
      const property = $this.attr('name');

      data.metaProperties[property] = data.metaProperties[property] || [];
      data.metaProperties[property].push(value);
    });

    return data;
  }

  _extractLinks ($, data) {
    // TODO: Extract from context.res headers as well

    data.links = {};

    $('head > link[rel]').each(function () {
      const attributes = ['hreflang', 'title', 'type'];

      const $this = $(this);
      const relations = $this.attr('rel').split(' ');
      const value = {};

      value.href = $this.attr('href');

      if (!value.href) {
        return;
      }

      value.href = resolve(data.baseUrl, value.href);

      attributes.forEach(function (attributeName) {
        const attribute = $this.attr(attributeName);
        if (attribute) {
          value[attributeName] = attribute;
        }
      });

      relations.forEach(function (relation) {
        relation = relation.trim().toLowerCase();

        if (relation === '') {
          return;
        }

        data.links[relation] = data.links[relation] || [];
        data.links[relation].push(value);
      });
    });

    return data;
  }

  _extractHeaders ($, data, context) {
    const res = context.res;

    data.headers = {};

    if (res && res.headers['x-frame-options']) {
      data.headers['x-frame-options'] = res.headers['x-frame-options'];
    }

    return data;
  }
}

MetaDataParser.extend = extend;

export default new MetaDataParser();
