// IBM i data conversions: EBCDIC text, packed decimal and zoned decimal.
// Bytes are exchanged as hexadecimal strings so they survive JSON transport.

const CP037 = "\u0000\u0001\u0002\u0003\u009c\t\u0086\u007f\u0097\u008d\u008e\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\b\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\n\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a \u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2.<(+|&\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df!$*);\u00ac-/\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6,%_>?\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc`:#@'=\"\u00d8abcdefghi\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0jklmnopqr\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4\u00b5~stuvwxyz\u00a1\u00bf\u00d0\u00dd\u00de\u00ae^\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be[]\u00af\u00a8\u00b4\u00d7{ABCDEFGHI\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5}JKLMNOPQR\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\\\u00f7STUVWXYZ\u00b2\u00d4\u00d6\u00d2\u00d3\u00d50123456789\u00b3\u00db\u00dc\u00d9\u00da\u009f";
const CP037_REVERSE = new Map([...CP037].map((char, index) => [char, index]));

export function hexToBytes(hex) {
  const clean = String(hex || "").replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error("Expected an even-length hexadecimal string.");
  }
  return Uint8Array.from(clean.match(/../g) || [], (pair) => Number.parseInt(pair, 16));
}

export function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export function ebcdicToText(hex) {
  return [...hexToBytes(hex)].map((byte) => CP037[byte]).join("");
}

export function textToEbcdic(text) {
  return bytesToHex([...String(text ?? "")].map((char) => {
    const byte = CP037_REVERSE.get(char);
    if (byte === undefined) throw new Error(`Character ${JSON.stringify(char)} has no CCSID 37 mapping.`);
    return byte;
  }));
}

export function packedToNumber(hex, scale = 0) {
  const nibbles = bytesToHex(hexToBytes(hex));
  if (!nibbles) throw new Error("Packed decimal value is empty.");
  const sign = nibbles.at(-1);
  const digits = nibbles.slice(0, -1);
  if (/[^0-9]/.test(digits) || !/[A-F]/.test(sign)) throw new Error("Invalid packed decimal value.");
  return formatDecimal(digits, scale, sign === "D" || sign === "B");
}

export function numberToPacked(value, precision, scale = 0) {
  const { digits, negative } = parseDecimal(value, precision, scale);
  const padded = (digits.length % 2 === 0 ? "0" : "") + digits;
  return padded + (negative ? "D" : "F");
}

export function zonedToNumber(hex, scale = 0) {
  const bytes = hexToBytes(hex);
  if (bytes.length === 0) throw new Error("Zoned decimal value is empty.");
  let digits = "";
  for (const byte of bytes) {
    const digit = byte & 0x0f;
    if (digit > 9) throw new Error("Invalid zoned decimal value.");
    digits += String(digit);
  }
  const zone = bytes.at(-1) >> 4;
  return formatDecimal(digits, scale, zone === 0x0d || zone === 0x0b);
}

export function numberToZoned(value, precision, scale = 0) {
  const { digits, negative } = parseDecimal(value, precision, scale);
  const bytes = [...digits].map((digit) => 0xf0 | Number(digit));
  if (negative) bytes[bytes.length - 1] = 0xd0 | Number(digits.at(-1));
  return bytesToHex(bytes);
}

function parseDecimal(value, precision, scale) {
  const text = String(value ?? "").trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) throw new Error(`Not a decimal number: ${text}`);
  if (!Number.isInteger(precision) || precision < 1 || precision > 63) throw new Error("precision must be between 1 and 63.");
  if (!Number.isInteger(scale) || scale < 0 || scale > precision) throw new Error("scale must be between 0 and precision.");
  const fraction = match[3] || "";
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) {
    throw new Error(`Value has more than ${scale} decimal places.`);
  }
  const integer = (match[2] || "0").replace(/^0+(?=\d)/, "");
  const digits = (integer + fraction.slice(0, scale).padEnd(scale, "0")).replace(/^0+(?=\d)/, "");
  if (digits.length > precision) throw new Error(`Value does not fit in ${precision} digits.`);
  const padded = digits.padStart(precision, "0");
  return { digits: padded, negative: match[1] === "-" && /[1-9]/.test(padded) };
}

function formatDecimal(digits, scale, negative) {
  if (!Number.isInteger(scale) || scale < 0) throw new Error("scale must be zero or greater.");
  const padded = digits.padStart(scale + 1, "0");
  const integer = padded.slice(0, padded.length - scale).replace(/^0+(?=\d)/, "");
  const fraction = scale > 0 ? `.${padded.slice(-scale)}` : "";
  const isZero = !/[1-9]/.test(padded);
  return `${negative && !isZero ? "-" : ""}${integer}${fraction}`;
}
