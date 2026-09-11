/**
 * Best-effort client IP for geo lookup (Render/nginx set X-Forwarded-For).
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return String(realIp).trim();
  if (req.socket?.remoteAddress) {
    return String(req.socket.remoteAddress).replace(/^::ffff:/, '');
  }
  return null;
}

function isPublicIp(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
    const parts = ip.split('.');
    if (parts.length === 4 && parts[0] === '172') {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return false;
    }
  }
  return true;
}

module.exports = { getClientIp, isPublicIp };
