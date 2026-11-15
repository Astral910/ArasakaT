// Precarga para Evolution API: todo servidor que abra Node escucha solo en 127.0.0.1
// (así Windows no muestra el aviso de firewall y nada queda expuesto a la red).
// Uso: node -r ./solo-local.cjs dist/main.js
const net = require('net');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
    return cb ? listen.call(this, Number(args[0]), '127.0.0.1', cb) : listen.call(this, Number(args[0]), '127.0.0.1');
  }
  if (args[0] && typeof args[0] === 'object' && args[0].port !== undefined && !args[0].path) {
    args[0] = { ...args[0], host: '127.0.0.1' };
  }
  return listen.apply(this, args);
};
