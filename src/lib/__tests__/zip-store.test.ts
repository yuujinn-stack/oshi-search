import { describe, it, expect } from 'vitest';
import { crc32, createStoreZip } from '@/lib/zip-store';

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);

describe('zip-store', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores every file uncompressed with a valid central directory', () => {
    const files = [1, 2, 3].map((n) => ({ name: `instagram-story-${n}.png`, data: new Uint8Array([n, n, n, 0x89]) }));
    const zip = createStoreZip(files, new Date(2026, 9, 24, 12, 0, 0));

    const eocd = zip.length - 22;
    expect(u32(zip, eocd)).toBe(0x06054b50);
    expect(u16(zip, eocd + 10)).toBe(3);
    let cd = u32(zip, eocd + 16);

    for (const f of files) {
      expect(u32(zip, cd)).toBe(0x02014b50);
      const nameLen = u16(zip, cd + 28);
      expect(new TextDecoder().decode(zip.slice(cd + 46, cd + 46 + nameLen))).toBe(f.name);
      expect(u32(zip, cd + 16)).toBe(crc32(f.data));

      const local = u32(zip, cd + 42);
      expect(u32(zip, local)).toBe(0x04034b50);
      expect(u16(zip, local + 8)).toBe(0); // STORE
      const dataStart = local + 30 + u16(zip, local + 26);
      expect(Array.from(zip.slice(dataStart, dataStart + f.data.length))).toEqual(Array.from(f.data));
      cd += 46 + nameLen;
    }
    expect(cd).toBe(eocd);
  });
});
