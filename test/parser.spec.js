import { should } from 'chai';
import escapeStringRegexp from 'escape-string-regexp';
import nock from 'nock';
import sinon from 'sinon';

import parser from '../index.js';

should();

function htmlEnvelope (head, body) {
  return '<!DOCTYPE html>' +
    '<html prefix="og: http://ogp.me/ns#">' +
    '<head><title>The Rock (1996)</title>' + head + '</head>' +
    '<body>' + (body || '') + '</body>' +
    '</html>';
};

// Taken from http://opengraphprotocol.org/
const basicHTML = htmlEnvelope(
  '<meta property="og:title" content="The Rock" />' +
  '<meta property="og:type" content="video.movie" />' +
  '<meta property="og:url" content="http://www.imdb.com/title/tt0117500/" />' +
  '<meta property="og:image" content="http://ia.media-imdb.com/images/rock.jpg" />'
);

// HTML from http://moz.com/blog/meta-data-templates-123
const bigExampleHTML = '<!-- Update your html tag to include the itemscope and itemtype attributes. -->' +
  '<html itemscope itemtype="http://schema.org/Article">' +
  '<head>' +
  '  <title>Page Title. Maximum length 60-70 characters</title>' +
  '  <meta name="description" content="Page description. No longer than 155 characters." />' +
  '  ' +
  '  <!-- Schema.org markup for Google+ -->' +
  '  <meta itemprop="name" content="The Name or Title Here">' +
  '  <meta itemprop="description" content="This is the page description">' +
  '  <meta itemprop="image" content="http://www.example.com/image.jpg">' +
  '  ' +
  '  <!-- Twitter Card data -->' +
  '  <meta name="twitter:card" content="summary_large_image">' +
  '  <meta name="twitter:site" content="@publisher_handle">' +
  '  <meta name="twitter:title" content="Page Title">' +
  '  <meta name="twitter:description" content="Page description less than 200 characters">' +
  '  <meta name="twitter:creator" content="@author_handle">' +
  '  <!-- Twitter summary card with large image must be at least 280x150px -->' +
  '  <meta name="twitter:image:src" content="http://www.example.com/image.html">' +
  '  ' +
  '  <!-- Open Graph data -->' +
  '  <meta property="og:title" content="Title Here" />' +
  '  <meta property="og:type" content="article" />' +
  '  <meta property="og:url" content="http://www.example.com/" />' +
  '  <meta property="og:image" content="http://example.com/image.jpg" />' +
  '  <meta property="og:description" content="Description Here" />' +
  '  <meta property="og:site_name" content="Site Name, i.e. Moz" />' +
  '  <meta property="article:published_time" content="2013-09-17T05:59:00+01:00" />' +
  '  <meta property="article:modified_time" content="2013-09-16T19:08:47+01:00" />' +
  '  <meta property="article:section" content="Article Section" />' +
  '  <meta property="article:tag" content="Article Tag" />' +
  '  <meta property="fb:admins" content="Facebook numberic ID" /> ' +
  '</head>' +
  '<body></body>' +
  '</html>';


describe('Parselovin', function () {
  describe('extract', function () {
    let mockedConsole;

    beforeEach(function () {
      mockedConsole = sinon.mock(console);
    });

    afterEach(function () {
      mockedConsole.restore();
    });

    // Based on spec at http://opengraphprotocol.org/ and tool at https://developers.facebook.com/tools/debug/og/object/

    it('should parse basically all Open Graph generic tags', async function () {
      const result = await parser.extract('http://example.com/', basicHTML);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        title: [{value: 'The Rock'}],
        type: [{value: 'video.movie'}],
        url: [{value: 'http://www.imdb.com/title/tt0117500/'}],
        image: [{value: 'http://ia.media-imdb.com/images/rock.jpg'}]
      });
    });

    it('should parse all Open Graph generic tags', async function () {
      // Taken from http://opengraphprotocol.org/
      var exampleHtml = htmlEnvelope(
        '<meta property="og:image" content="http://example.com/rock.jpg" />' +
        '<meta property="og:image:width" content="300" />' +
        '<meta property="og:image:height" content="300" />' +
        '<meta property="og:image" content="http://example.com/rock2.jpg" />' +
        '<meta property="og:image" content="http://example.com/rock3.jpg" />' +
        '<meta property="og:image:height" content="1000" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [
          {value: 'http://example.com/rock.jpg', properties: {width: 300, height: 300}},
          {value: 'http://example.com/rock2.jpg'},
          {value: 'http://example.com/rock3.jpg', properties: {height: 1000}}
        ]
      });
    });

    it('should normalize Open Graph generic tags', async function () {
      const exampleHtml = htmlEnvelope(
        '<meta property="og:image" content="http://example.com/rock.jpg" />' +
        '<meta property="og:image:url" content="http://example.com/rock2.jpg" />' +
        '<meta property="og:image" content="http://example.com/rock3.jpg" />' +
        '<meta property="og:video:url" content="http://example.com/rock.avi" />' +
        '<meta property="og:audio:secure_url" content="http://example.com/rock.wav" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [
          {value: 'http://example.com/rock2.jpg'},
          {value: 'http://example.com/rock3.jpg'}
        ],
        video: [{value: 'http://example.com/rock.avi'}],
        audio: [{value: 'http://example.com/rock.wav'}]
      });
    });

    it('should parse all Open Graph type-specific tags', async function () {
      const result = await parser.extract('http://example.com/', bigExampleHTML);

      return Promise.all([
        result.should.be.an('object'),
        result.should.have.property('og'),
        result.og.should.have.property('type').that.deep.equals([{value: 'article'}]),
        result.should.have.property('ogType', 'article'),
        result.should.have.property('ogTypeData').that.deep.equals({
          'published_time': [{value: '2013-09-17T05:59:00+01:00'}],
          'modified_time': [{value: '2013-09-16T19:08:47+01:00'}],
          'section': [{value: 'Article Section'}],
          'tag': [{value: 'Article Tag'}]
        })
      ]);
    });

    it('should ignore broken tags', async function () {
      const exampleHtml = htmlEnvelope(
        '<meta property="og:image" content="http://example.com/rock.jpg" />' +
        '<meta property="og:image:" content="http://example.com/rock2.jpg" />' +
        '<meta property="og:" content="http://example.com/rock3.jpg" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [{value: 'http://example.com/rock.jpg'}]
      });
    });

    // Eg. Vimeo contains these
    it('should parse all App Links');

    it('should parse base tag', async function () {
      const exampleHtml = htmlEnvelope('<base href="http://www.example.org/foo/" />');

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('baseUrl', 'http://www.example.org/foo/');
    });

    it('should parse relative base tag', async function () {
      const exampleHtml = htmlEnvelope('<base href="bar/" />');

      const result = await parser.extract('http://example.com/foo/', exampleHtml);

      return result.should.be.an('object').with.property('baseUrl', 'http://example.com/foo/bar/');
    });

    it('should resolve URL:s in Open Graph tags', async function () {
      const exampleHtml = htmlEnvelope(
        '<meta property="og:image" content="/rock.jpg" />' +
        '<meta property="og:video" content="/rock.avi" />' +
        '<meta property="og:audio" content="/rock.wav" />' +
        '<meta property="og:url" content="/home" />'
      );

      const result = await parser.extract('http://example.org/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [{value: 'http://example.org/rock.jpg'}],
        video: [{value: 'http://example.org/rock.avi'}],
        audio: [{value: 'http://example.org/rock.wav'}],
        url: [{value: 'http://example.org/home'}]
      });
    });

    it('should resolve URL:s in Open Graph tags using base-tag', async function () {
      const exampleHtml = htmlEnvelope(
        '<base href="http://www.example.org/foo/" />' +
        '<meta property="og:image" content="rock.jpg" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [{value: 'http://www.example.org/foo/rock.jpg'}]
      });
    });

    it('should ignore empty Open Graph tags', async function () {
      const exampleHtml = htmlEnvelope(
        '<meta property="og:image" content="" />' +
        '<meta property="og:video" content="" />' +
        '<meta property="og:audio" content="" />' +
        '<meta property="og:url" content="" />' +
        '<meta property="og:title" content="" />' +
        '<meta property="og:image" content="http://example.com/rock.jpg" />' +
        '<meta property="og:image:width" content="" />'
      );

      const result = await parser.extract('http://example.org/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [
          {value: 'http://example.com/rock.jpg'}
        ]
      });
    });

    it('should ignore content-less Open Graph tags', async function () {
      const exampleHtml = htmlEnvelope(
        '<meta property="og:image" />' +
        '<meta property="og:image" content="http://example.com/rock.jpg" />' +
        '<meta property="og:image:width" />' +
        '<meta property="og:title" />'
      );

      const result = await parser.extract('http://example.org/', exampleHtml);

      return result.should.be.an('object').with.property('og').that.deep.equals({
        image: [
          {value: 'http://example.com/rock.jpg'}
        ]
      });
    });

    it('should parse non-Open Graph social media tags', async function () {
      const result = await parser.extract('http://example.com/', bigExampleHTML);

      return result.should.be.an('object').with.property('metaProperties').that.deep.equals({
        'fb:admins': ['Facebook numberic ID'],
        'twitter:card': ['summary_large_image'],
        'twitter:site': ['@publisher_handle'],
        'twitter:title': ['Page Title'],
        'twitter:description': ['Page description less than 200 characters'],
        'twitter:creator': ['@author_handle'],
        'twitter:image:src': ['http://www.example.com/image.html']
      });
    });

    it('should parse generator names', async function () {
      const exampleHtml = htmlEnvelope('<meta name="generator" content="WordPress 4.1" />');

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('metaProperties').that.deep.equals({
        generator: ['WordPress 4.1']
      });
    });

    it('should parse link relations from link-tags', async function () {
      const exampleHtml = htmlEnvelope(
        '<link rel="home alternate" type="application/atom+xml" href="/all.xml" title="All posts" />' +
        '<link rel="home alternate" type="application/atom+xml" href="/english.xml" title="English posts" />' +
        '<link rel="alternate" hreflang="es" href="http://es.example.com/" />' +
        '<link rel="canonical" href="/2015/01/entry-name/" />' +
        '<link rel="author" type="text/html" href="/" title="Bob Smith" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('links').that.deep.equals({
        home: [
          {href: 'http://example.com/all.xml', title: 'All posts', type: 'application/atom+xml'},
          {href: 'http://example.com/english.xml', title: 'English posts', type: 'application/atom+xml'}
        ],
        alternate: [
          {href: 'http://example.com/all.xml', title: 'All posts', type: 'application/atom+xml'},
          {href: 'http://example.com/english.xml', title: 'English posts', type: 'application/atom+xml'},
          {href: 'http://es.example.com/', hreflang: 'es'}
        ],
        canonical: [{href: 'http://example.com/2015/01/entry-name/'}],
        author: [{href: 'http://example.com/', title: 'Bob Smith', type: 'text/html'}]
      });
    });

    it('should lower case link relations', async function () {
      const exampleHtml = htmlEnvelope(
        '<link rel="HOME aLternate" href="/english.xml" />' +
        '<link rel="AlTeRnAtE" href="http://es.example.com/" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('links').that.deep.equals({
        home: [
          {href: 'http://example.com/english.xml'}
        ],
        alternate: [
          {href: 'http://example.com/english.xml'},
          {href: 'http://es.example.com/'}
        ]
      });
    });

    it('should ignore href-less link relations', async function () {
      const exampleHtml = htmlEnvelope(
        '<link rel="alternate" type="application/atom+xml" title="All posts" />' +
        '<link rel="alternate" type="application/atom+xml" title="English posts" href="/english.xml" />'
      );

      const result = await parser.extract('http://example.com/', exampleHtml);

      return result.should.be.an('object').with.property('links').that.deep.equals({
        alternate: [
          {href: 'http://example.com/english.xml', title: 'English posts', type: 'application/atom+xml'}
        ]
      });
    });

    // TODO: Properly design test
    it.skip('should not crash on recursion error', async function () {
      // "RangeError: Maximum call stack size exceeded" should not crash the script

      function repeat (data, count) {
        let result = '';
        for (let i = 0; i < count; i++) {
          result += data;
        }
        return result;
      };

      const length = 100000;
      const exampleHtml = htmlEnvelope('', repeat('<div><p>Test</p>', length) + repeat('</div>', length));

      const expectation = mockedConsole.expects('log').atLeast(1);
      let result;
      let exception;

      try {
        result = await parser.extract('http://example.com/', exampleHtml);
      } catch (e) {
        exception = e;
      }

      should.not.exist(exception);

      return result.then(function () {
        throw new Error('Should trigger an error');
      }).catch(function (result) {
        should.exist(result);

        result.should.be.instanceof(RangeError).with.property('message').that.has.string('call stack size');

        mockedConsole.verify();
        expectation.calledWith('Error parsing HTML').should.be.ok;
      });
    });

    it('should parse x-frame-options headers', async function () {
      const res = {
        headers: { 'x-frame-options': 'SAMEORIGIN' }
      };

      const result = await parser.extract('http://example.com/', basicHTML, res);

      return result.should.be.an('object').with.property('headers').that.deep.equals({
        'x-frame-options': 'SAMEORIGIN'
      });
    });

    // Should adhere to http://tools.ietf.org/html/rfc5988 and parse both HTTP headers and HTML link-tags
    it('should parse link relations from all valid locations');

    it('should only run requested extractors', async function () {
      const result = await parser.extract('http://example.com/', bigExampleHTML, undefined, {
        extractors: 'og'
      });

      return Promise.all([
        result.should.be.an('object'),
        result.should.have.property('og'),
        result.og.should.have.property('type').that.deep.equals([{value: 'article'}]),
        result.should.not.have.property('metaProperties')
      ]);
    });
  });

  describe('fetch methods', function () {
    let defaultUserAgentRegExp, testUserAgentRegExp;

    beforeEach(function () {
      nock.disableNetConnect();

      defaultUserAgentRegExp = 'metadataparser\\/\\d+\\.\\d+\\.\\d+ ' + escapeStringRegexp('(https://github.com/ryuno-ki/metadataparser)') + '$';
      testUserAgentRegExp = escapeStringRegexp('Test/1.0 ') + defaultUserAgentRegExp;

      defaultUserAgentRegExp = new RegExp('^' + defaultUserAgentRegExp);
      testUserAgentRegExp = new RegExp('^' + testUserAgentRegExp);
    });

    afterEach(function () {
      nock.cleanAll();
    });

    describe('fetch', function () {
      it('should process the webpage', async function () {
        const mock = nock('http://example.com/')
          .matchHeader('User-Agent', defaultUserAgentRegExp)
          .get('/')
          .reply(200, function () {
            return basicHTML;
          });

        const result = await parser.fetch('http://example.com/', {foo: 123});
        mock.done();

        result.should.have.property('url', 'http://example.com/');
        result.should.have.property('meta').that.deep.equals({foo: 123});
        result.should.have.property('data');
        result.data.should.have.property('og').that.is.not.empty;
      });

      it('should accept custom user-agent', async function () {
        const mock = nock('http://example.com/')
          .matchHeader('User-Agent', testUserAgentRegExp)
          .get('/')
          .reply(200, function () {
            return basicHTML;
          });

        const result = await parser.fetch('http://example.com/', {foo: 123}, {userAgent: 'Test/1.0'});
        mock.done();

        result.should.have.property('url', 'http://example.com/');
        result.should.have.property('meta').that.deep.equals({foo: 123});
        result.should.have.property('data');
        result.data.should.have.property('og').that.is.not.empty;
      });

      it('should send an error on non-2xx response', async function () {
        const mock = nock('http://example.com/')
          .get('/')
          .reply(404, function () {
            return basicHTML;
          });

        try {
          const result = await parser.fetch('http://example.com/', {foo: 123});
          mock.done();

          result.should.have.property('url', 'http://example.com/');
          result.should.have.property('meta').that.deep.equals({foo: 123});
          result.should.not.have.property('data');
        } catch (err) {
          mock.done();

          err.should.equal('Invalid response. Code 404');
          return;
        }
      });
    });

    describe('fetchBatch', function () {
      it('should process the webpages', async function () {
        const mock = nock('http://example.com/')
          .matchHeader('User-Agent', defaultUserAgentRegExp)
          .get('/foo')
          .reply(200, function () {
            return basicHTML;
          })
          .get('/bar')
          .reply(200, function () {
            return bigExampleHTML;
          });

        const result = await parser.fetchBatch({
          batch: [
            {url: 'http://example.com/foo', meta: {foo: 123}},
            {url: 'http://example.com/bar', meta: {bar: 456}}
          ]
        });
        mock.done();

        result.should.be.an('array').with.a.lengthOf(2);
        const [firstResult, secondResult] = result;

        firstResult.should.have.property('status', 'fulfilled');
        firstResult.should.have.property('value');
        firstResult.value.should.have.property('url', 'http://example.com/foo');
        firstResult.value.should.have.property('meta').that.deep.equals({foo: 123});
        firstResult.value.should.have.property('data');
        firstResult.value.data.should.have.property('og').that.is.not.empty;

        secondResult.should.have.property('status', 'fulfilled');
        secondResult.should.have.property('value');
        secondResult.value.should.have.property('url', 'http://example.com/bar');
        secondResult.value.should.have.property('meta').that.deep.equals({bar: 456});
        secondResult.value.should.have.property('data');
        secondResult.value.data.should.have.property('og').that.is.not.empty;
        secondResult.value.data.should.have.property('metaProperties').that.is.not.empty;
      });

      it('should accept custom user-agent', async function () {
        const mock = nock('http://example.com/')
          .matchHeader('User-Agent', testUserAgentRegExp)
          .get('/foo')
          .reply(200, function () {
            return basicHTML;
          })
          .get('/bar')
          .reply(200, function () {
            return bigExampleHTML;
          });

        const result = await parser.fetchBatch({
          batch: [
            {url: 'http://example.com/foo', meta: {foo: 123}},
            {url: 'http://example.com/bar', meta: {bar: 456}}
          ],
          options: {userAgent: 'Test/1.0'}
        });
        mock.done();

        result.should.be.an('array').with.a.lengthOf(2);
        const [firstResult, secondResult] = result;

        firstResult.should.have.property('status', 'fulfilled');
        firstResult.should.have.property('value');
        firstResult.value.should.have.property('url', 'http://example.com/foo');
        firstResult.value.should.have.property('meta').that.deep.equals({foo: 123});
        firstResult.value.should.have.property('data');
        firstResult.value.data.should.have.property('og').that.is.not.empty;

        secondResult.should.have.property('status', 'fulfilled');
        secondResult.should.have.property('value');
        secondResult.value.should.have.property('url', 'http://example.com/bar');
        secondResult.value.should.have.property('meta').that.deep.equals({bar: 456});
        secondResult.value.should.have.property('data');
        secondResult.value.data.should.have.property('og').that.is.not.empty;
        secondResult.value.data.should.have.property('metaProperties').that.is.not.empty;
      });

      it('should send an error on non-2xx response', async function () {
        const mock = nock('http://example.com/')
          .get('/foo')
          .reply(404, function () {
            return basicHTML;
          })
          .get('/bar')
          .reply(200, function () {
            return bigExampleHTML;
          });

        const result = await parser.fetchBatch({
          batch: [
            {url: 'http://example.com/foo', meta: {foo: 123}},
            {url: 'http://example.com/bar', meta: {bar: 456}}
          ]
        });
        mock.done();

        result.should.be.an('array').with.a.lengthOf(2);
        const [firstResult, secondResult] = result;

        firstResult.should.have.property('status').that.equals('rejected');
        firstResult.should.have.property('reason').that.equals('Invalid response. Code 404');
        firstResult.should.not.have.property('value');

        secondResult.should.have.property('status').that.equals('fulfilled');
        secondResult.should.have.property('value');
        secondResult.value.should.have.property('url', 'http://example.com/bar');
        secondResult.value.should.have.property('meta').that.deep.equals({bar: 456});
        secondResult.value.should.have.property('data');
        secondResult.value.data.should.have.property('og').that.is.not.empty;
        secondResult.value.data.should.have.property('metaProperties').that.is.not.empty;
      });
    });
  });
});
