/* Small dependency-free ZIP writer (ZIP32, STORE). Compatible with Safari/iOS.
   Media files are already compressed; ZIP intentionally avoids recompressing them. */
(() => {
  "use strict";
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  async function crc32(blob) {
    let crc = 0xffffffff;
    const step = 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += step) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + step).arrayBuffer());
      for (let i = 0; i < chunk.length; i++) crc = crcTable[(crc ^ chunk[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function dosDateTime(date) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return {time, day};
  }
  async function createZip(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 65535) throw new Error("ZIPのファイル数が不正です");
    const chunks = [], centralParts = [];
    let offset = 0, centralSize = 0;
    const {time, day} = dosDateTime(new Date());
    for (const entry of entries) {
      if (typeof entry.name !== "string" || !entry.name || entry.name.includes("/") || entry.name.includes("\\") ||
          entry.name === "." || entry.name === "..") throw new Error("ファイル名が不正です");
      const name = encoder.encode(entry.name);
      const blob = entry.blob instanceof Blob ? entry.blob : new Blob([entry.blob]);
      if (name.length > 65535 || blob.size > 0xffffffff) throw new Error("ZIP32の容量制限を超えています");
      const crc = await crc32(blob);
      const fileOffset = offset;

      const local = new Uint8Array(30 + name.length), h = new DataView(local.buffer);
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true); // needed ZIP version
      h.setUint16(6, 0x0800, true); // UTF-8 names
      h.setUint16(8, 0, true); // stored without compression
      h.setUint16(10, time, true);h.setUint16(12, day, true);
      h.setUint32(14, crc, true);h.setUint32(18, blob.size, true);h.setUint32(22, blob.size, true);
      h.setUint16(26, name.length, true);h.setUint16(28, 0, true);
      local.set(name, 30);
      chunks.push(local, blob);
      offset += local.length + blob.size;

      const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);c.setUint16(10, 0, true);
      c.setUint16(12, time, true);c.setUint16(14, day, true);
      c.setUint32(16, crc, true);c.setUint32(20, blob.size, true);c.setUint32(24, blob.size, true);
      c.setUint16(28, name.length, true);c.setUint16(30, 0, true);c.setUint16(32, 0, true);
      c.setUint16(34, 0, true);c.setUint16(36, 0, true);
      c.setUint32(38, 0, true);c.setUint32(42, fileOffset, true);
      central.set(name, 46);
      centralParts.push(central);
      centralSize += central.length;
      if (offset > 0xffffffff || centralSize > 0xffffffff) throw new Error("ZIP32の容量制限を超えています");
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(4, 0, true);e.setUint16(6, 0, true);
    e.setUint16(8, entries.length, true);e.setUint16(10, entries.length, true);
    e.setUint32(12, centralSize, true);e.setUint32(16, offset, true);
    e.setUint16(20, 0, true);
    return new Blob([...chunks, ...centralParts, end], {type:"application/zip"});
  }
  window.LightingZip = {createZip};
})();