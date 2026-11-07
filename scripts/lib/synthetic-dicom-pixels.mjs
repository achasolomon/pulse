// Non-anatomical grayscale QA phantom. No patient image or external asset is used.
import {deflateSync} from 'node:zlib';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc]);}
export function syntheticDicomPixels(index=0){
 const size=128,header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=0;
 const rows=Buffer.alloc(size*(size+1));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const distance=Math.hypot(x-size/2,y-size/2),cross=Math.abs(x-size/2)<2||Math.abs(y-size/2)<2;
  rows[y*(size+1)+x+1]=cross?255:distance<42?Math.round(50+180*x/size):((Math.floor(x/16)+Math.floor(y/16)+index)%2)*25;
 }
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
