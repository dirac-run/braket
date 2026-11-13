import { readFileSync } from 'node:fs';
import { HEADER_BYTES, MAGIC, SECTIONS } from './data-format.js';
/** Private immutable views. Runtime lookup kernels consume original source spans. */
export class DataStore {
  readonly commandRecords:Buffer;
  readonly bindingRecords:Buffer;
  readonly palette:Int32Array;
  readonly commandNodes:Buffer;
  readonly commandLabels:Buffer;
  readonly optionNodes:Buffer;
  readonly optionLabels:Buffer;
  readonly commandTerminalNodes:Uint16Array;
  constructor(readonly buffer:Buffer) {
    if(buffer.length<HEADER_BYTES || buffer.toString('ascii',0,8)!==MAGIC) throw new Error('Invalid classifier data');
    const parts=SECTIONS.map((_,i)=>{const offset=buffer.readUInt32LE(8+i*8),length=buffer.readUInt32LE(12+i*8);if(offset<HEADER_BYTES||offset+length>buffer.length)throw new Error('Invalid data section');return buffer.subarray(offset,offset+length);});
    this.commandRecords=parts[0]!;this.bindingRecords=parts[1]!;
    const palette=parts[2]!;if(palette.byteOffset%4||palette.length%4)throw new Error('Unaligned palette');
    this.palette=new Int32Array(palette.buffer,palette.byteOffset,palette.length/4);
    this.commandNodes=parts[3]!;this.commandLabels=parts[4]!;this.optionNodes=parts[5]!;this.optionLabels=parts[6]!;
    if(this.commandRecords.length%12||this.bindingRecords.length%6||this.commandNodes.length%8||this.optionNodes.length%10)throw new Error('Invalid record section');
    const terminals=parts[7]!;if(terminals.byteOffset%2||terminals.length!==this.commandRecords.length/6)throw new Error('Invalid terminal section');this.commandTerminalNodes=new Uint16Array(terminals.buffer,terminals.byteOffset,terminals.length/2);
  }
}
let singleton:DataStore|undefined;
export function loadData():DataStore {return singleton??=new DataStore(readFileSync(new URL('../data/classifier.bin',import.meta.url)));}
