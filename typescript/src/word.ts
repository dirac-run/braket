/** Reusable numeric cursor. The source is borrowed only for each call. */
let position=0,quote=0;
export function beginWord(start:number):void {position=start;quote=0;}
export function nextWordChar(source:string,end:number):number {
 while(position<end){let c=source.charCodeAt(position++);
  if(c===39&&quote!==34){quote=quote===39?0:39;continue;}
  if(c===34&&quote!==39){quote=quote===34?0:34;continue;}
  if(c===92&&quote!==39&&position<end){const next=source.charCodeAt(position);if(quote===0||next===36||next===96||next===34||next===92||next===10){position++;if(next===10)continue;c=next;}}
  return c;
 }
 return -1;
}
/** Slow random access is only for isolated characters, never a token-length loop. */
export function wordCharAt(source:string,start:number,end:number,index:number):number {beginWord(start);let c=-1;for(let i=0;i<=index;i++){c=nextWordChar(source,end);if(c<0)break;}return c;}
export function wordLength(source:string,start:number,end:number):number {beginWord(start);let n=0;while(nextWordChar(source,end)!==-1)n++;return n;}
/** Decoded prefix length before an unescaped expansion identity becomes unknown. */
export function staticWordPrefix(source:string,start:number,end:number):number {
 let q=0,n=0;
 for(let p=start;p<end;p++){let c=source.charCodeAt(p);
  if(c===39&&q!==34){q=q===39?0:39;continue;}
  if(c===34&&q!==39){q=q===34?0:34;continue;}
  if(c===92&&q!==39&&p+1<end){const next=source.charCodeAt(p+1);if(q===0||next===36||next===96||next===34||next===92||next===10){p++;if(next===10)continue;n++;continue;}}
  if(q!==39&&(c===36||c===96))return n;
  n++;
 }
 return n;
}
