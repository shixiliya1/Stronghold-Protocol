export function isIP(s) {
  if (typeof s !== 'string') return 0;
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => +x <= 255)) return 4;
  if (s.includes(':') && /^[0-9a-f:.]+$/i.test(s)) return 6;
  return 0;
}
export default { isIP };
