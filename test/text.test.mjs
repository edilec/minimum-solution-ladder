/**
 * The primitives underneath the report: ordering, decoding, pointers.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { byCodeUnit, decodeUtf8, escapePointerSegment } from '../src/index.mjs'

test('byCodeUnit orders by code unit and is a valid comparator', () => {
  assert.equal(byCodeUnit('Z', 'a'), -1)
  assert.equal(byCodeUnit('a-b', 'a_b'), -1)
  assert.equal(byCodeUnit('README', 'assets'), -1)
  assert.equal(byCodeUnit('same', 'same'), 0)
  assert.equal(byCodeUnit('b', 'a'), 1)

  // The three orderings above are exactly the ones a collator disagrees with,
  // which is why they are the fixtures used in the behavioural ordering tests.
  const collate = new Intl.Collator('en').compare
  assert.equal(collate('Z', 'a') > 0, true)
  assert.equal(collate('README', 'assets') > 0, true)
})

test('decodeUtf8 decides encoding by decoding, never by inspecting the result', () => {
  const decoded = decodeUtf8(new TextEncoder().encode('hello'))
  assert.deepEqual(decoded, { ok: true, text: 'hello' })

  assert.deepEqual(decodeUtf8(new Uint8Array([0xff, 0xfe])), { ok: false, reason: 'not-utf8' })

  // A document that legitimately contains a replacement character is valid
  // UTF-8. A decoder that inferred "not UTF-8" from a U+FFFD in its own output
  // would refuse this, which is how an unreadable input once reported a pass.
  const withReplacement = decodeUtf8(new TextEncoder().encode(`a${String.fromCharCode(0xfffd)}b`))
  assert.equal(withReplacement.ok, true)
  assert.equal(withReplacement.text, `a${String.fromCharCode(0xfffd)}b`)
})

test('a UTF-8 byte order mark is removed, so a worksheet written with one still parses', () => {
  // `ignoreBOM: false` is the WHATWG spelling of "strip the BOM", which reads
  // backwards and matters: JSON.parse refuses a leading U+FEFF, so a worksheet
  // saved by an editor that writes a BOM would otherwise be reported as
  // unparseable JSON rather than read.
  const decoded = decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))
  assert.equal(decoded.ok, true)
  assert.equal(decoded.text, '{}')
  assert.deepEqual(JSON.parse(decoded.text), {})
})

test('escapePointerSegment follows RFC 6901 and then sanitises', () => {
  assert.equal(escapePointerSegment('a/b'), 'a~1b')
  assert.equal(escapePointerSegment('a~b'), 'a~0b')
  assert.equal(escapePointerSegment('a~/b'), 'a~0~1b')
  assert.equal(escapePointerSegment(`a${String.fromCharCode(0x2028)}b`), 'a b')
})
