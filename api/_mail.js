import https from 'https';

export function sendOrder(order) {
  return new Promise((resolve, reject) => {
    const key = process.env.AGENTMAIL_API_KEY;
    if (!key) return reject(new Error('AGENTMAIL_API_KEY not set'));
    const inbox = process.env.AGENTMAIL_INBOX_ID || 'tiny-coder-2104@agentmail.to';
    const payload = JSON.stringify({
      to: inbox,
      subject: 'New portfolio order request',
      text: 'Name: ' + order.name + '\nEmail: ' + order.email + '\nProject type: ' + order.type + '\nDetails: ' + order.details
    });
    const req = https.request({
      hostname: 'api.agentmail.to',
      path: '/v0/inboxes/' + encodeURIComponent(inbox) + '/messages/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let chunks = '';
      res.on('data', c => (chunks += c));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
