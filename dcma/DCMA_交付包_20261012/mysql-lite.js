import net from 'node:net';
import crypto from 'node:crypto';

function sha1(data) { return crypto.createHash('sha1').update(data).digest(); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest(); }
function lenEncInt(n) {
  if (n < 0xfb) return Buffer.from([n]);
  if (n <= 0xffff) return Buffer.from([0xfc, n & 255, (n >> 8) & 255]);
  if (n <= 0xffffff) return Buffer.from([0xfd, n & 255, (n >> 8) & 255, (n >> 16) & 255]);
  const b = Buffer.alloc(9); b[0] = 0xfe; b.writeBigUInt64LE(BigInt(n), 1); return b;
}
function readLenEnc(buf, offset = 0) {
  const first = buf[offset];
  if (first < 0xfb) return { value: first, offset: offset + 1 };
  if (first === 0xfb) return { value: null, offset: offset + 1 };
  if (first === 0xfc) return { value: buf.readUInt16LE(offset + 1), offset: offset + 3 };
  if (first === 0xfd) return { value: buf[offset + 1] | (buf[offset + 2] << 8) | (buf[offset + 3] << 16), offset: offset + 4 };
  return { value: Number(buf.readBigUInt64LE(offset + 1)), offset: offset + 9 };
}
function nulString(buf, offset) { const end = buf.indexOf(0, offset); return { value: buf.subarray(offset, end < 0 ? buf.length : end).toString(), offset: end < 0 ? buf.length : end + 1 }; }

export class MySQLLite {
  constructor({host, port=3306, user, password, database, connectTimeout=6000}) {
    this.options = {host, port, user, password, database, connectTimeout};
    this.socket = null; this.buffer = Buffer.alloc(0); this.waiters = [];
  }
  async connect() {
    this.socket = net.createConnection({host: this.options.host, port: this.options.port});
    this.socket.on('data', data => { this.buffer = Buffer.concat([this.buffer, data]); this.flush(); });
    this.socket.on('error', err => { while (this.waiters.length) this.waiters.shift().reject(err); });
    this.socket.on('close', () => { while (this.waiters.length) this.waiters.shift().reject(new Error('MySQL connection closed')); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MySQL connection timeout')), this.options.connectTimeout);
      this.socket.once('connect', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', err => { clearTimeout(timer); reject(err); });
    });
    const hello = await this.readPacket();
    if (hello[0] === 0xff) throw new Error(`MySQL handshake error: ${hello.toString()}`);
    let o = 0; const protocol = hello[o++];
    const ver = nulString(hello, o); o = ver.offset;
    const connectionId = hello.readUInt32LE(o); o += 4;
    const auth1 = hello.subarray(o, o + 8); o += 8; o++;
    let capLow = hello.readUInt16LE(o); o += 2;
    let charset = 33, status = 0, capHigh = 0, authLen = 0, plugin = 'mysql_native_password', auth2 = Buffer.alloc(0);
    if (o < hello.length) {
      charset = hello[o++]; status = hello.readUInt16LE(o); o += 2; capHigh = hello.readUInt16LE(o); o += 2; authLen = hello[o++]; o += 10;
      if (o < hello.length) { auth2 = hello.subarray(o, o + Math.max(13, authLen - 8)); o += Math.max(13, authLen - 8); }
      if (o < hello.length) { const p = nulString(hello, o); plugin = p.value || plugin; }
    }
    const scramble = Buffer.concat([auth1, auth2.subarray(0, 12)]);
    const caps = capLow | (capHigh << 16);
    if (plugin && plugin !== 'mysql_native_password') throw new Error(`Unsupported MySQL auth plugin: ${plugin}`);
    const pass = Buffer.from(this.options.password || '');
    const stage1 = sha1(pass), stage2 = sha1(stage1), token = sha1(Buffer.concat([scramble, stage2]));
    const auth = Buffer.alloc(stage1.length); for (let i = 0; i < stage1.length; i++) auth[i] = stage1[i] ^ token[i];
    const clientCaps = 0x00000001 | 0x00000200 | 0x00008000;
    const parts = [Buffer.alloc(4), Buffer.alloc(4), Buffer.from([charset]), Buffer.alloc(23), Buffer.from(this.options.user || ''), Buffer.from([0]), Buffer.from([auth.length]), auth];
    if (this.options.database) { parts.push(Buffer.from(this.options.database), Buffer.from([0])); } else parts.push(Buffer.from([0]));
    
    const resp = Buffer.concat(parts); resp.writeUInt32LE(clientCaps, 0); resp.writeUInt32LE(0x01000000, 4);
    await this.writePacket(resp, 1);
    const result = await this.readPacket();
    if (result[0] === 0xff) throw new Error(`MySQL auth error: ${result.toString()}`);
    return {version: ver.value, connectionId, plugin};
  }
  flush() {
    while (this.waiters.length && this.buffer.length >= 4) {
      const len = this.buffer[0] | (this.buffer[1] << 8) | (this.buffer[2] << 16);
      if (this.buffer.length < len + 4) return;
      const payload = this.buffer.subarray(4, len + 4); this.buffer = this.buffer.subarray(len + 4);
      this.waiters.shift().resolve(payload);
    }
  }
  readPacket() { return new Promise((resolve, reject) => { this.waiters.push({resolve, reject}); this.flush(); }); }
  writePacket(payload, seq = 0) {
    const h = Buffer.alloc(4); h[0] = payload.length & 255; h[1] = (payload.length >> 8) & 255; h[2] = (payload.length >> 16) & 255; h[3] = seq;
    return new Promise((resolve, reject) => this.socket.write(Buffer.concat([h, payload]), err => err ? reject(err) : resolve()));
  }
  async query(sql) {
    await this.writePacket(Buffer.concat([Buffer.from([0x03]), Buffer.from(sql)]), 0);
    let packet = await this.readPacket();
    if (packet[0] === 0xff) { const code = packet.readUInt16LE(1); throw new Error(`MySQL query error ${code}: ${packet.subarray(3).toString()}`); }
    if (packet[0] === 0x00) return {rows: [], fields: [], affectedRows: packet.length > 6 ? packet.readUIntLE(1, 3) : 0};
    const countInfo = readLenEnc(packet); const fieldCount = countInfo.value;
    const fields = [];
    for (let i = 0; i < fieldCount; i++) { const p = await this.readPacket(); fields.push(this.parseField(p)); }
    let eof = await this.readPacket();
    if (!(eof[0] === 0xfe && eof.length < 9)) { /* old server may omit EOF */ }
    const rows = [];
    while (true) {
      const row = await this.readPacket();
      if (row[0] === 0xfe && row.length < 9) break;
      if (row[0] === 0xff) throw new Error(`MySQL row error: ${row.toString()}`);
      let off = 0; const values = [];
      for (let i = 0; i < fieldCount; i++) { const v = readLenEnc(row, off); off = v.offset; if (v.value === null) values.push(null); else { const start = off; const end = off + v.value; values.push(row.subarray(start, end).toString()); off = end; } }
      const obj = {}; fields.forEach((f, i) => obj[f.name] = values[i]); rows.push(obj);
    }
    return {rows, fields};
  }
  parseField(p) { let off = 0; const vals = []; for (let i = 0; i < 6; i++) { const x = readLenEnc(p, off); off = x.offset; vals.push(x.value == null ? '' : p.subarray(off, off + x.value).toString()); off += x.value || 0; } return {name: vals[4] || vals[3] || vals[2]}; }
  close() { try { this.socket?.end(); } catch {} }
}






