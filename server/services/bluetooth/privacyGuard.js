function maskName(name='') {
  if (!name) return '???';
  if (name.length <= 1) return name + '*';
  return name.slice(0, name.length - 1) + '*';
}
function apply(user, { mask = true } = {}) {
  return { ...user, name: mask ? maskName(user.name) : user.name };
}
module.exports = { apply, maskName };
