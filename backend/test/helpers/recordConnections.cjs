// Preloaded into a server under test: appends every outbound TCP connection's
// "host:port" to the file RECORD_CONNECTIONS names, so a test can prove which
// services the process dialed.
const net = require("node:net");
const { appendFileSync } = require("node:fs");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node's own callers pass one pre-normalized [options, callback] array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === "object" && first !== null ? first : { port: first, host: args[1] };
  if (options.port !== undefined) {
    appendFileSync(process.env.RECORD_CONNECTIONS, `${options.host ?? "localhost"}:${options.port}\n`);
  }
  return connect.apply(this, args);
};
