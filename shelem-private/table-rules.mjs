// Seats clockwise: 0 bottom, 1 left, 2 top, 3 right. Partners are opposite.
export const clockwise=seat=>(seat+1)%4;
export function nextHakem(current,scores,eights){
 const own=current%2,other=1-own;
 const opponentAhead=scores[other]>scores[own] || (scores[other]===scores[own]&&eights[other]>eights[own]);
 return opponentAhead?clockwise(current):current;
}
export function dealPackages(deck,hakem){
 if(deck.length!==52)throw Error('A 52-card deck is required');
 const hands=[[],[],[],[]];let cursor=0;
 for(const size of [5,4,4])for(let offset=0;offset<4;offset++){
  const seat=(hakem+offset)%4;
  hands[seat].push(...deck.slice(cursor,cursor+size));cursor+=size;
 }
 return hands;
}
