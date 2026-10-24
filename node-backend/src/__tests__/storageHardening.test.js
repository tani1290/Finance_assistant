/**
 * Upload/download hardening.
 *
 * Receipts are untrusted user content. The API must reject active content
 * (HTML/SVG/XML), verify that the bytes match the declared type, derive the
 * stored extension from the approved MIME type, and never serve a legacy object
 * inline as HTML from the API origin.
 */

const storageService = require('../services/storageService');
const storageController = require('../controllers/storageController');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test-image-body'),
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const createRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
  };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn((name, value) => {
    res.headers[name.toLowerCase()] = value;
    return res;
  });
  res.send = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
};

const upload = async (body, user = { id: 'user-1', role: 'user' }) => {
  const req = { body, user };
  const res = createRes();
  const next = jest.fn();
  await storageController.uploadDocument(req, res, next);
  return { res, next };
};

beforeEach(() => {
  jest.spyOn(storageService, 'upload').mockResolvedValue({
    success: true,
    key: 'users/user-1/receipts/file.png',
    size: 10,
    contentType: 'image/png',
    provider: 'local',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('upload validation', () => {
  test('accepts a real PNG regardless of a misleading file extension', async () => {
    const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
    const { res } = await upload({
      fileData: dataUrl,
      fileName: 'receipt.html',
      contentType: 'image/png',
    });

    expect(res.statusCode).toBe(201);
    const call = storageService.upload.mock.calls[0][0];
    expect(call.contentType).toBe('image/png');
    expect(call.key).toMatch(/\.png$/);
    expect(call.key).not.toMatch(/\.html$/);
    expect(call.metadata.originalName).toBe('receipt.html');
  });

  test('accepts a real PDF even when the file name has a text extension', async () => {
    const { res } = await upload({
      fileData: PDF.toString('base64'),
      fileName: 'statement.txt',
      contentType: 'application/pdf',
    });
    expect(res.statusCode).toBe(201);
    expect(storageService.upload.mock.calls[0][0].key).toMatch(/\.pdf$/);
  });

  test('rejects HTML bytes disguised as an image', async () => {
    const { res } = await upload({
      fileData: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
      fileName: 'receipt.png',
      contentType: 'image/png',
    });
    expect(res.statusCode).toBe(415);
    expect(res.body.error.code).toBe('CONTENT_TYPE_MISMATCH');
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test('rejects active content types outright', async () => {
    for (const contentType of ['text/html', 'image/svg+xml', 'application/xml', 'text/javascript']) {
      const { res } = await upload({
        fileData: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
        fileName: 'receipt.svg',
        contentType,
      });
      expect(res.statusCode).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test('rejects binary data declared as CSV', async () => {
    const { res } = await upload({
      fileData: Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64'),
      fileName: 'statement.csv',
      contentType: 'text/csv',
    });
    expect(res.statusCode).toBe(415);
    expect(res.body.error.code).toBe('CONTENT_TYPE_MISMATCH');
  });

  test('accepts a real JPEG and normalises the legacy image/jpg alias', async () => {
    const { res } = await upload({
      fileData: JPEG.toString('base64'),
      fileName: 'photo.jpeg',
      contentType: 'image/jpg',
    });
    expect(res.statusCode).toBe(201);
    expect(storageService.upload.mock.calls[0][0].contentType).toBe('image/jpeg');
  });

  test('rejects empty or malformed base64', async () => {
    for (const fileData of ['', 'data:image/png;base64,', '%%%%']) {
      const { res } = await upload({ fileData, fileName: 'x.png', contentType: 'image/png' });
      expect(res.statusCode).toBe(400);
    }
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});

describe('download response hardening', () => {
  const download = async (key, contentType, user = { id: 'user-1', role: 'user' }) => {
    jest.spyOn(storageService, 'download').mockResolvedValue({
      buffer: Buffer.from('<html><script>alert(1)</script></html>'),
      size: 39,
      contentType,
      key,
      provider: 'local',
    });
    const req = { params: { key }, user };
    const res = createRes();
    const next = jest.fn();
    await storageController.getFile(req, res, next);
    return { res, next };
  };

  test('forces legacy HTML to an attachment with a sandbox CSP', async () => {
    const { res } = await download('users/user-1/receipts/old.html', 'text/html');
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('allows approved images inline but still sandboxes them', async () => {
    const { res } = await download('users/user-1/receipts/photo.png', 'image/png');
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  test('does not let one user download another user file', async () => {
    const { res } = await download(
      'users/user-2/receipts/private.png',
      'image/png',
      { id: 'user-1', role: 'user' }
    );
    expect(res.statusCode).toBe(403);
    expect(res.send).not.toHaveBeenCalled();
  });
});
