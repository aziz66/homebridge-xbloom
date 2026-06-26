/**
 * xBloom command frame builder.
 *
 * Frame layout (written to the FFE1 characteristic):
 *   0x58 | deviceId(1) | typeCode(1) | command(2, LE) | totalLength(4, LE) | 0x01 | payload | crc16(2, LE)
 *
 * - deviceId  : 0x01 for outbound (send).
 * - typeCode  : 0x01 standard (Original-class), 0x02 Studio/EasyMode.
 * - command   : decimal command id (XBloomCommand), little-endian uint16.
 * - totalLength: whole-frame length = 12 + payload bytes (the 12 covers the
 *   fixed header + the 0x01 constant + the 2-byte CRC).
 * - the byte after length is a CONSTANT 0x01 (not a counter) → frames are
 *   deterministic / replay-safe.
 *
 * Ported from PyBloom build_command / build_command_raw.
 */

import { crc16 } from './constants.js';

const HEADER = 0x58;
const CONST_BYTE = 0x01;
/** Fixed overhead in totalLength: header+devid+type+cmd(2)+len(4)+const(1)+crc(2). */
const FIXED_OVERHEAD = 12;

function assemble(
  command: number,
  payload: Uint8Array,
  typeCode: number,
  deviceId: number,
): Buffer {
  const totalLength = FIXED_OVERHEAD + payload.length;
  const head = Buffer.alloc(10);
  head.writeUInt8(HEADER, 0);
  head.writeUInt8(deviceId, 1);
  head.writeUInt8(typeCode, 2);
  head.writeUInt16LE(command & 0xffff, 3);
  head.writeUInt32LE(totalLength >>> 0, 5);
  head.writeUInt8(CONST_BYTE, 9);

  const body = Buffer.concat([head, Buffer.from(payload)]);
  const crc = crc16(body);
  const tail = Buffer.alloc(2);
  tail.writeUInt16LE(crc, 0);
  return Buffer.concat([body, tail]);
}

/**
 * Build a command whose payload is a list of 32-bit little-endian values.
 * (Floats are passed as their raw int32 bits — see floatBits.)
 */
export function buildCommand(
  command: number,
  data: number[] = [],
  typeCode = 1,
  deviceId = 1,
): Buffer {
  const payload = Buffer.alloc(data.length * 4);
  data.forEach((v, i) => payload.writeUInt32LE(v >>> 0, i * 4));
  return assemble(command, payload, typeCode, deviceId);
}

/** Build a command whose payload is raw bytes (e.g. an encoded recipe). */
export function buildCommandRaw(
  command: number,
  data: Uint8Array,
  typeCode = 1,
  deviceId = 1,
): Buffer {
  return assemble(command, data, typeCode, deviceId);
}

/**
 * IEEE-754 float32 → uint32 bit pattern, for SET_CUP weight bounds which are
 * sent as float32 values packed little-endian (i.e. their int bits as a LE uint32).
 */
export function floatBits(f: number): number {
  const b = Buffer.alloc(4);
  b.writeFloatLE(f, 0);
  return b.readUInt32LE(0);
}
