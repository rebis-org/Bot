import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  readRequestText,
  secretEqual,
  verifySignature
} from './webhook.ts';

describe('constantTimeEqual', () => {
  it('compares exact strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('secretEqual', () => {
  it('matches equal secrets of different lengths without leaking length', async () => {
    await expect(secretEqual('s3cret', 's3cret')).resolves.toBe(true);
    await expect(secretEqual('s3cret', 's3crett')).resolves.toBe(false);
    await expect(secretEqual('s3cret', 'S3CRET')).resolves.toBe(false);
  });
});

describe('verifySignature', () => {
  const secret = 'webhook-secret';
  const body = '{"action":"opened","issue":{}}';
  const expected = 'sha256=6e88a2e88668502aeb7a33a13212454f90ab4003d2ac54a952012b9a51a94ca8';

  it('accepts a valid GitHub signature', async () => {
    await expect(verifySignature(body, expected, secret)).resolves.toBe(true);
  });

  it('rejects a tampered body', async () => {
    await expect(
      verifySignature(`${body} `, expected, secret)
    ).resolves.toBe(false);
  });

  it('rejects a wrong secret', async () => {
    await expect(
      verifySignature(body, expected, 'other')
    ).resolves.toBe(false);
  });

  it('rejects a malformed signature', async () => {
    await expect(verifySignature(body, 'sha256=zz', secret)).resolves.toBe(false);
    await expect(verifySignature(body, '', secret)).resolves.toBe(false);
  });
});

describe('readRequestText', () => {
  it('reads a small body', async () => {
    const request = new Request('https://x.test', { method: 'POST', body: 'hello' });
    await expect(readRequestText(request, 1024)).resolves.toBe('hello');
  });

  it('rejects an oversized declared body', async () => {
    const request = new Request('https://x.test', {
      method: 'POST',
      body: 'x'.repeat(2048)
    });
    await expect(readRequestText(request, 1024)).resolves.toBeNull();
  });

  it('rejects a body that grows past the cap while streaming', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600));
        controller.close();
      }
    });
    const request = new Request('https://x.test', {
      method: 'POST',
      body: stream,
      // @ts-expect-error duplex is required for streaming bodies in node
      duplex: 'half'
    });
    await expect(readRequestText(request, 1024)).resolves.toBeNull();
  });
});
