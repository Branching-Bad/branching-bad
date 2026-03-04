// ---------------------------------------------------------------------------
// AWS SigV4 request signing
// ---------------------------------------------------------------------------

import { createHmac, createHash } from 'crypto';

export async function signedAwsRequest(
  accessKey: string,
  secretKey: string,
  region: string,
  service: string,
  method: string,
  url: string,
  host: string,
  canonicalUri: string,
  body: Buffer,
  contentType: string,
  target: string,
): Promise<Response> {
  const now = new Date();
  const datestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const payloadHash = createHash('sha256').update(body).digest('hex');

  const signedHeaderNames = ['content-type', 'host', 'x-amz-date'];
  if (target) signedHeaderNames.push('x-amz-target');
  signedHeaderNames.sort();

  let canonicalHeaders = '';
  for (const h of signedHeaderNames) {
    switch (h) {
      case 'content-type':
        canonicalHeaders += `content-type:${contentType}\n`;
        break;
      case 'host':
        canonicalHeaders += `host:${host}\n`;
        break;
      case 'x-amz-date':
        canonicalHeaders += `x-amz-date:${amzDate}\n`;
        break;
      case 'x-amz-target':
        canonicalHeaders += `x-amz-target:${target}\n`;
        break;
    }
  }

  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const signingKey = getSignatureKey(secretKey, datestamp, region, service);
  const signature = hmacSha256(signingKey, Buffer.from(stringToSign)).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Amz-Date': amzDate,
    Authorization: authorization,
  };
  if (target) headers['X-Amz-Target'] = target;

  return fetch(url, { method, headers, body: body.toString() });
}

function getSignatureKey(
  key: string, datestamp: string, region: string, service: string,
): Buffer {
  const kDate = hmacSha256(Buffer.from(`AWS4${key}`), Buffer.from(datestamp));
  const kRegion = hmacSha256(kDate, Buffer.from(region));
  const kService = hmacSha256(kRegion, Buffer.from(service));
  return hmacSha256(kService, Buffer.from('aws4_request'));
}

function hmacSha256(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
